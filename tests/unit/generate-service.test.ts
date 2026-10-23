/**
 * 生成サービスの安全装置（外部 API は呼ばない。runAnthropic を差し替える）。
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";

const dir = mkdtempSync(path.join(os.tmpdir(), "lps-gen-"));
process.env.DATA_DIR = dir;
process.env.ANTHROPIC_API_KEY = "test-key-not-used";

const sent: { system: string; user: string }[] = [];
vi.mock("@/lib/server/providers", async (orig) => {
  const real = await orig<typeof import("@/lib/server/providers")>();
  return {
    ...real,
    runAnthropic: vi.fn(async (pkg: { system: string; user: string; task: string }) => {
      sent.push({ system: pkg.system, user: pkg.user });
      return {
        rawText: JSON.stringify({ segments: [{ text: "テスト本文", voice: "developer", jaGloss: "", provenance: [] }], creativeNotes: "" }),
        model: "claude-opus-5-5",
        usage: { inputTokens: 1000, outputTokens: 500 },
      };
    }),
  };
});

const store = await import("@/lib/server/store");
const { handleGenerate, GenerateRequest } = await import("@/lib/server/generate");

let postId = "";
beforeAll(async () => {
  await store.listProjects();
  const p = await store.createPost("sample-saltroad", { type: "story", title: "gen" });
  postId = p.id;
});
afterAll(() => rmSync(dir, { recursive: true, force: true }));

const req = (o: object) => GenerateRequest.parse({ task: "draft", provider: "anthropic", postId, ...o });

describe("Anthropic API への送信の安全装置", () => {
  it("プロジェクトで許可していなければ送らない（既定）", async () => {
    const pre = (await handleGenerate("sample-saltroad", req({ action: "preview" }))) as { prompt: { hash: string }; allowExternal: boolean; estimate: { usdTypical: number } };
    expect(pre.allowExternal).toBe(false);
    expect(pre.estimate.usdTypical).toBeGreaterThan(0);
    await expect(handleGenerate("sample-saltroad", req({ action: "run", confirmHash: pre.prompt.hash }))).rejects.toThrow(/許可されていません/);
    expect(sent).toHaveLength(0);
  });

  it("確認した内容（ハッシュ）と違えば送らない", async () => {
    const proj = await store.getProject("sample-saltroad");
    await store.updateProject("sample-saltroad", { settings: { ...proj!.settings, allowExternalModel: true } });
    await expect(handleGenerate("sample-saltroad", req({ action: "run", confirmHash: "deadbeef" }))).rejects.toThrow(/確認時から変わりました/);
    await expect(handleGenerate("sample-saltroad", req({ action: "run" }))).rejects.toThrow(/確認時から変わりました/);
    expect(sent).toHaveLength(0);
  });

  it("確認した内容なら送り、未公開設定は含めず、送信記録を残し、新しい版として追加する", async () => {
    const pre = (await handleGenerate("sample-saltroad", req({ action: "preview" }))) as { prompt: { hash: string } };
    const post = (await handleGenerate("sample-saltroad", req({ action: "run", confirmHash: pre.prompt.hash }))) as { drafts: { origin: string; generator: string }[] };
    expect(sent).toHaveLength(1);
    expect(sent[0].user).not.toContain("交易商ルカ");
    expect(post.drafts.at(-1)?.origin).toBe("model");
    const log = await store.listSendLog("sample-saltroad");
    expect(log[0].provider).toBe("anthropic");
    expect(log[0].excludedEntryIds).toContain("ent_s_chr_luka");
    expect(log[0].usage).toEqual({ inputTokens: 1000, outputTokens: 500 });
    expect(log[0].estimatedCostUsd).toBeCloseTo((1000 * 4 + 500 * 20) / 1e6);
  });

  it("テンプレート生成は外部送信も記録もしない", async () => {
    const before = (await store.listSendLog("sample-saltroad")).length;
    await handleGenerate("sample-saltroad", GenerateRequest.parse({ action: "run", task: "angles", provider: "template", postId }));
    expect((await store.listSendLog("sample-saltroad")).length).toBe(before);
    expect(sent).toHaveLength(1);
  });

  it("手動中継は run できず、貼り戻し（import）だけ受け付ける", async () => {
    await expect(handleGenerate("sample-saltroad", GenerateRequest.parse({ action: "run", task: "draft", provider: "relay", postId }))).rejects.toThrow(/貼り戻して/);
    await expect(handleGenerate("sample-saltroad", GenerateRequest.parse({ action: "import", task: "draft", provider: "relay", postId, raw: "not json" }))).rejects.toThrow(/JSON/);
  });
});

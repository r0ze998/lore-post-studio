import { describe, expect, it } from "vitest";
import { buildPrompt, relayText } from "@/lib/generation/prompt";
import { parseOutput } from "@/lib/generation/parse";
import { templateAngles, templateDraft } from "@/lib/generation/template";
import { estimateCost, estimateTokens } from "@/lib/generation/pricing";
import { runChecks } from "@/lib/checks/engine";
import { DraftVersion } from "@/lib/domain/schema";
import { makePost, sampleCtx } from "./helpers";

function input(over: Partial<Parameters<typeof makePost>[1]> = {}, task: "angles" | "draft" = "draft") {
  const ctx = sampleCtx();
  const { post } = makePost([{ text: "" }], over);
  return { ...ctx, posts: [...ctx.posts, post], post, task };
}

describe("送る資料の選択", () => {
  it("未公開・提案段階・根拠のない実績・廃止の本文は送らない", () => {
    const pkg = buildPrompt(input());
    const sent = new Set(pkg.included.map((i) => i.id));
    expect(sent.has("ent_s_chr_luka")).toBe(false); // 未公開
    expect(sent.has("ent_s_lore_dry_old")).toBe(false); // 提案
    expect(sent.has("ent_s_claim_contest")).toBe(false); // 根拠なし
    expect(sent.has("ent_s_term_enka")).toBe(false); // 廃止
    expect(pkg.user).not.toContain("交易商ルカ");
    expect(pkg.user).not.toContain("100年前");
    // 廃止語は名前だけ「使わない語」として送る
    expect(pkg.user).toMatch(/使わない語[\s\S]*塩貨/);
    const reasons = Object.fromEntries(pkg.excluded.map((x) => [x.id, x.reason]));
    expect(reasons["ent_s_chr_luka"]).toBe("未公開");
  });

  it("本人が個別に選べば未公開の項目も送る（既定は送らない）", () => {
    const pkg = buildPrompt({ ...input(), includeInternalIds: ["ent_s_chr_luka"] });
    expect(pkg.included.some((i) => i.id === "ent_s_chr_luka")).toBe(true);
  });

  it("他のプロジェクトのデータは入らない（入力にない）", () => {
    const pkg = buildPrompt(input());
    expect(pkg.user).not.toContain("Wylls");
  });

  it("同じ入力なら同じハッシュ、指示が変われば別のハッシュ", () => {
    const a = buildPrompt(input());
    const b = buildPrompt(input());
    expect(a.hash).toBe(b.hash);
    const c = buildPrompt({ ...input(), extraInstruction: "短く" });
    expect(c.hash).not.toBe(a.hash);
    expect(relayText(a)).toContain("出力は指定された JSON だけ");
  });
});

describe("貼り戻し・モデル出力の読み取り", () => {
  const known = new Set(["ent_s_chr_sen"]);
  it("コードブロック付きでも読み取る", () => {
    const out = parseOutput("angles", '説明です\n```json\n{"angles":[{"title":"A","approach":"x","why":"y"}]}\n```\nどうぞ', known);
    expect(out.angles[0].title).toBe("A");
  });
  it("存在しない資料 ID の参照は外して注記する", () => {
    const out = parseOutput(
      "draft",
      JSON.stringify({ segments: [{ text: "t", voice: "in_world", jaGloss: "", provenance: [{ quote: "q", basis: "canon", refIds: ["ent_fake"], note: "" }] }], creativeNotes: "" }),
      known,
    );
    expect(out.segments[0].provenance[0].refIds).toEqual([]);
    expect(out.segments[0].provenance[0].basis).toBe("unknown");
    expect(out.segments[0].provenance[0].note).toContain("ent_fake");
  });
  it("形式が違えば分かるエラーにする", () => {
    expect(() => parseOutput("draft", '{"segments":[]}', known)).toThrow(/形式/);
    expect(() => parseOutput("draft", "ただの文章", known)).toThrow(/JSON/);
  });
});

describe("テンプレート生成（API 不要）", () => {
  it("種類ごとに複数の切り口を出す", () => {
    for (const type of ["story", "gameplay", "devlog", "recruit", "showcase", "series"] as const) {
      const i = input({ type });
      expect(templateAngles(i).angles.length, type).toBeGreaterThanOrEqual(2);
    }
  });

  it("開発中の機能は「開発中です」と書き、検査で断定にならない", () => {
    const i = input({ type: "devlog", brief: { factIds: ["ent_s_feat_storm"] } });
    const out = templateDraft(i);
    expect(out.segments[0].text).toContain("「砂嵐」を開発中です");
    const draft = DraftVersion.parse({ id: "d1", createdAt: "x", origin: "template", language: "ja", segments: out.segments.map((s, k) => ({ ...s, id: `s${k}` })) });
    const r = runChecks(i, i.post, draft);
    expect(r.findings.some((f) => f.ruleId === "feature-assertion")).toBe(false);
    // 創作が必要な部分は穴埋めとして残り、検査で止まる
    expect(r.findings.some((f) => f.ruleId === "placeholder" && f.severity === "error")).toBe(true);
  });

  it("募集は告知情報の文面をそのまま使い、要項の検査を通る", () => {
    const i = input({ type: "recruit", brief: { factIds: ["ent_s_notice_ct2"] }, options: { cta: "explicit" } });
    const out = templateDraft(i);
    const draft = DraftVersion.parse({ id: "d2", createdAt: "x", origin: "template", language: "ja", segments: out.segments.map((s, k) => ({ ...s, id: `s${k}` })) });
    const r = runChecks(i, i.post, draft);
    expect(r.findings.filter((f) => ["recruit-notice", "claim-evidence", "real-promise"].includes(f.ruleId))).toEqual([]);
  });

  it("英語の物語には日本語の意味確認の骨組みが付く", () => {
    const i = input({ type: "story", language: "en" });
    const out = templateDraft(i);
    expect(out.segments[0].jaGloss).toMatch(/[ぁ-ん]/);
    expect(out.segments[0].voice).toBe("in_world");
  });
});

describe("費用の概算", () => {
  it("日本語は英語より多くのトークンとして見積もる", () => {
    expect(estimateTokens("あいうえお")).toBeGreaterThan(estimateTokens("abcde"));
  });
  it("既知のモデルは金額を出し、上限値も示す", () => {
    const e = estimateCost("claude-opus-5-5", "あ".repeat(1000), "draft", 16000);
    expect(e.known).toBe(true);
    expect(e.usdMax).toBeGreaterThan(e.usdTypical);
    expect(estimateCost("unknown-model", "x", "draft", 100).known).toBe(false);
  });
});

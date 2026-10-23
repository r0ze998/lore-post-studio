/**
 * ローカル保存のテスト（一時ディレクトリを DATA_DIR にする）。
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync, readdirSync, existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";

const dir = mkdtempSync(path.join(os.tmpdir(), "lps-store-"));
process.env.DATA_DIR = dir;

const store = await import("@/lib/server/store");
const { findConflictCandidates } = await import("@/lib/domain/canon");

afterAll(() => rmSync(dir, { recursive: true, force: true }));

describe("初期データ", () => {
  beforeAll(async () => {
    await store.listProjects();
  });
  it("Wylls（空・実プロジェクト）と架空サンプルが別ディレクトリに作られる", async () => {
    const ps = await store.listProjects();
    expect(ps.map((p) => [p.id, p.kind])).toEqual([
      ["wylls", "real"],
      ["sample-saltroad", "sample"],
    ]);
    expect(await store.listEntries("wylls")).toEqual([]);
    expect((await store.listEntries("sample-saltroad")).length).toBeGreaterThan(10);
    expect(readdirSync(path.join(dir, "projects")).sort()).toEqual(["sample-saltroad", "wylls"]);
  });
  it("サンプルの矛盾候補（同名の確定と提案）を検出するが、自動では統合しない", async () => {
    const entries = await store.listEntries("sample-saltroad");
    const c = findConflictCandidates(entries);
    expect(c.map((x) => x.entryIds)).toContainEqual(["ent_s_lore_dry", "ent_s_lore_dry_old"]);
    expect(entries.find((e) => e.id === "ent_s_lore_dry_old")?.status).toBe("proposed");
  });
});

describe("正本の編集", () => {
  it("更新すると前の内容が履歴に残り、更新日が変わる", async () => {
    const e = await store.createEntry("wylls", { kind: "term", title: "テスト用語", status: "proposed", body: "v1" });
    expect(e.history).toEqual([]);
    const u = await store.updateEntry("wylls", e.id, { body: "v2", status: "confirmed" }, "確定にした");
    expect(u.body).toBe("v2");
    expect(u.history[0].snapshot.body).toBe("v1");
    expect(u.history[0].snapshot.status).toBe("proposed");
    expect(u.history[0].note).toBe("確定にした");
    // 変更がなければ履歴を増やさない
    const same = await store.updateEntry("wylls", e.id, { body: "v2" });
    expect(same.history).toHaveLength(1);
  });

  it("資料の一括取り込みは「確定」を指定しても「提案」で入る", async () => {
    const xs = await store.importEntriesAsProposed("wylls", [{ kind: "lore", title: "古い資料の設定", status: "confirmed", body: "..." }], "旧資料 2025");
    expect(xs[0].status).toBe("proposed");
    expect(xs[0].visibility).toBe("internal");
    expect(xs[0].source.label).toBe("旧資料 2025");
  });

  it("プロジェクト間で設定が混ざらない", async () => {
    const w = await store.listEntries("wylls");
    const s = await store.listEntries("sample-saltroad");
    expect(w.every((e) => e.projectId === "wylls")).toBe(true);
    expect(s.some((e) => e.title === "テスト用語")).toBe(false);
  });

  it("不正な ID ではディレクトリの外に出られない", async () => {
    await expect(store.listEntries("../etc")).rejects.toThrow();
  });
});

describe("投稿の流れ", () => {
  it("承認・却下には理由が必要で、承認後に本文を変えると確認待ちに戻る", async () => {
    const p = await store.createPost("sample-saltroad", { type: "story", title: "t" });
    expect(p.status).toBe("idea");
    const withDraft = await store.updatePost("sample-saltroad", p.id, {
      drafts: [{ id: "drf_x", createdAt: "x", origin: "manual", language: "ja", segments: [{ id: "seg_x", text: "本文" }] }],
      currentDraftId: "drf_x",
      status: "review",
    });
    expect(withDraft.status).toBe("review");
    await expect(store.decidePost("sample-saltroad", p.id, { kind: "approved", reason: "", draftId: "drf_x" })).rejects.toThrow();
    const ok = await store.decidePost("sample-saltroad", p.id, { kind: "approved", reason: "具体的", draftId: "drf_x" });
    expect(ok.status).toBe("approved");
    // updatePost では承認状態を直接変えられない
    await expect(store.updatePost("sample-saltroad", p.id, { status: "posted" })).rejects.toThrow(/変更できません/);
    await expect(store.updatePost("sample-saltroad", p.id, { status: "idea" })).rejects.toThrow(/変更できません/);
    const ignored = await store.updatePost("sample-saltroad", p.id, { status: "idea", title: "t" });
    expect(ignored.status).toBe("approved");
    const edited = await store.updatePost("sample-saltroad", p.id, {
      drafts: [{ id: "drf_x", createdAt: "x", origin: "manual", language: "ja", segments: [{ id: "seg_x", text: "本文を変更" }] }],
    });
    expect(edited.status).toBe("review");
  });

  it("投稿記録は承認済みにだけ付けられ、手動記録として保存される", async () => {
    const p = await store.createPost("sample-saltroad", { type: "devlog", title: "t2" });
    await store.updatePost("sample-saltroad", p.id, { drafts: [{ id: "drf_y", createdAt: "x", origin: "manual", language: "ja", segments: [{ id: "s", text: "本文" }] }], currentDraftId: "drf_y" });
    await expect(store.recordPublication("sample-saltroad", p.id, { url: "https://x.com/a/status/1" })).rejects.toThrow(/承認済み/);
    await store.decidePost("sample-saltroad", p.id, { kind: "approved", reason: "ok", draftId: "drf_y" });
    await expect(store.recordPublication("sample-saltroad", p.id, { url: "https://example.com/x" })).rejects.toThrow(/x\.com/);
    const r = await store.recordPublication("sample-saltroad", p.id, { url: "https://x.com/a/status/1", postedAt: "2026-10-22T10:00", metrics: [{ at: "2026-10-23T00:00:00Z", likes: 3 }] });
    expect(r.status).toBe("posted");
    expect(r.publication?.verification).toBe("manual");
    expect(r.publication?.metrics[0].source).toBe("manual");
  });

  it("投稿済みの記録がある投稿は本文・版を変えられず、生成結果も追加できない", async () => {
    const posted = (await store.listPosts("sample-saltroad")).find((x) => x.id === "pst_s_story1")!;
    const d = posted.drafts[0];
    await expect(
      store.updatePost("sample-saltroad", posted.id, { drafts: [{ ...d, segments: [{ ...d.segments[0], text: "変更" }] }] }),
    ).rejects.toThrow(/投稿済み/);
    await expect(store.appendToPost("sample-saltroad", posted.id, (p) => p)).rejects.toThrow(/投稿済み/);
    // 予約候補などのメモは変えられる
    const ok = await store.updatePost("sample-saltroad", posted.id, { title: "ミズハ到着（改題）" });
    expect(ok.status).toBe("posted");
  });

  it("却下後に本文を直すと下書きに戻る", async () => {
    const p = await store.createPost("sample-saltroad", { type: "story", title: "rj" });
    await store.updatePost("sample-saltroad", p.id, { drafts: [{ id: "drf_r", createdAt: "x", origin: "manual", language: "ja", segments: [{ id: "s", text: "a" }] }], currentDraftId: "drf_r" });
    await store.decidePost("sample-saltroad", p.id, { kind: "rejected", reason: "抽象的", draftId: "drf_r" });
    const fixed = await store.updatePost("sample-saltroad", p.id, { drafts: [{ id: "drf_r", createdAt: "x", origin: "manual", language: "ja", segments: [{ id: "s", text: "b" }] }] });
    expect(fixed.status).toBe("drafting");
  });

  it("同じ投稿を別画面で更新していたら衝突として止める", async () => {
    const p = await store.createPost("sample-saltroad", { type: "story", title: "t3" });
    await store.updatePost("sample-saltroad", p.id, { title: "t3-a" }, p.updatedAt);
    await expect(store.updatePost("sample-saltroad", p.id, { title: "t3-b" }, p.updatedAt)).rejects.toThrow(/別の画面/);
  });
});

describe("エクスポート・インポート", () => {
  it("書き出したものを新しいプロジェクトとして取り込める（元と混ざらない）", async () => {
    const asset = await store.createAsset("sample-saltroad", { name: "a.png", type: "image/png", data: Buffer.from([0x89, 0x50, 0x4e, 0x47]) }, { altText: "テスト" });
    const { bundle, files } = await store.exportBundle("sample-saltroad");
    expect(files.get(asset.storedName)?.length).toBe(4);
    const imported = await store.importBundle(JSON.parse(JSON.stringify(bundle)), files, "new");
    expect(imported.id).not.toBe("sample-saltroad");
    expect(imported.name).toContain("取り込み");
    const a = await store.listEntries(imported.id);
    const b = await store.listEntries("sample-saltroad");
    expect(a.length).toBe(b.length);
    expect(a.every((e) => e.projectId === imported.id)).toBe(true);
    const file = await store.readAssetFile(imported.id, asset.id);
    expect(file.data.length).toBe(4);
  });

  it("置き換え取り込みは旧データを trash に退避する", async () => {
    const { bundle, files } = await store.exportBundle("wylls");
    const before = existsSync(path.join(dir, "trash")) ? readdirSync(path.join(dir, "trash")).length : 0;
    await store.importBundle(bundle, files, "replace");
    expect(readdirSync(path.join(dir, "trash")).length).toBe(before + 1);
    expect((await store.getProject("wylls"))?.name).toBe("Wylls");
  });

  it("形式の違うファイルは取り込まない", async () => {
    await expect(store.importBundle({ format: "other" }, new Map(), "new")).rejects.toThrow(/形式/);
  });

  it("取り込みファイルの素材に許可外の形式（HTML など）があれば取り込まない", async () => {
    const { bundle } = await store.exportBundle("wylls");
    const bad = JSON.parse(JSON.stringify(bundle));
    bad.assets = [{ id: "ast_x", projectId: "wylls", filename: "x.html", storedName: "ast_x.html", mime: "text/html", size: 1, createdAt: "x", updatedAt: "x" }];
    await expect(store.importBundle(bad, new Map([["ast_x.html", Buffer.from("<script>alert(1)</script>")]]), "new")).rejects.toThrow(/形式が不正/);
  });

  it("置き換え取り込みが形式エラーなら、元のプロジェクトはそのまま残る", async () => {
    const before = await store.listEntries("sample-saltroad");
    const { bundle } = await store.exportBundle("sample-saltroad");
    const bad = JSON.parse(JSON.stringify(bundle));
    bad.entries[0].status = "unknown";
    await expect(store.importBundle(bad, new Map(), "replace")).rejects.toThrow();
    expect((await store.listEntries("sample-saltroad")).length).toBe(before.length);
  });

  it("壊れたプロジェクトが 1 つあっても一覧は表示でき、壊れたものを知らせる", async () => {
    const { mkdirSync, writeFileSync } = await import("node:fs");
    mkdirSync(path.join(dir, "projects", "broken1"), { recursive: true });
    writeFileSync(path.join(dir, "projects", "broken1", "project.json"), "{ not json");
    const ps = await store.listProjects();
    expect(ps.some((p) => p.id === "wylls")).toBe(true);
    expect(store.getBrokenProjects().map((b) => b.id)).toEqual(["broken1"]);
    rmSync(path.join(dir, "projects", "broken1"), { recursive: true, force: true });
  });

  it("未対応の素材形式は受け付けない", async () => {
    await expect(store.createAsset("wylls", { name: "a.exe", type: "application/x-msdownload", data: Buffer.from("x") }, {})).rejects.toThrow(/未対応/);
  });
});

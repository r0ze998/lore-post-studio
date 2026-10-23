/**
 * Web 用の保存先（Postgres ＋ ファイル置き場）のテスト。
 * Postgres は PGlite（本物の Postgres をメモリ上で動かすもの）、ファイル置き場はメモリで代用する。
 */
import { beforeAll, describe, expect, it } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { createMemoryBlobStore, createPostgresBackend, type Sql } from "@/lib/server/backend/postgres";
import { VersionConflict, type Backend } from "@/lib/server/backend/types";
import { setBackendForTests } from "@/lib/server/backend";
import { createPostgresSql } from "@/lib/server/backend/supabase";
import * as store from "@/lib/server/store";

/**
 * 既定は PGlite。PG_TEST_URL（例 postgres://postgres@127.0.0.1:55432/postgres）があれば、
 * 本番と同じドライバ（postgres ライブラリ）で実際の Postgres サーバーに対して実行する（毎回新しい DB を作る）。
 */
const PG_URL = process.env.PG_TEST_URL;
const db = PG_URL ? null : new PGlite();
let realSql: Sql | null = null;
const sql: Sql = {
  async query(text, params = []) {
    if (realSql) return realSql.query(text, params);
    const r = await db!.query(text, params);
    return { rows: r.rows as Record<string, unknown>[], count: r.affectedRows ?? r.rows.length };
  },
};
const blobs = createMemoryBlobStore();
const backend = createPostgresBackend({ sql, blobs, maxAssetBytes: 50 * 1024 * 1024, describe: "test" });

/** 別のサーバー（インスタンス）が同時に書いた状況を再現するための差し込み。 */
let interfere: { key: RegExp; run: (key: string) => Promise<void> } | null = null;
const wrapped: Backend = {
  ...backend,
  async readDoc(key) {
    const r = await backend.readDoc(key);
    if (interfere && interfere.key.test(key)) {
      const f = interfere;
      interfere = null;
      await f.run(key);
    }
    return r;
  },
};

beforeAll(async () => {
  if (PG_URL) {
    const admin = createPostgresSql(PG_URL);
    const name = `lps_test_${Date.now()}`;
    await admin.query(`create database ${name}`);
    const u = new URL(PG_URL);
    u.pathname = `/${name}`;
    realSql = createPostgresSql(u.toString());
  } else {
    await db!.waitReady;
  }
  setBackendForTests(wrapped);
  await store.listProjects();
}, 60_000);

describe("Postgres 保存先：基本", () => {
  it("初回にサンプルと Wylls が作られ、プロジェクトごとに分かれる", async () => {
    const ps = await store.listProjects();
    expect(ps.map((p) => p.id)).toEqual(["wylls", "sample-saltroad"]);
    expect(await store.listEntries("wylls")).toEqual([]);
    expect((await store.listEntries("sample-saltroad")).length).toBeGreaterThan(10);
    const keys = (await sql.query("select key from lps_docs order by key")).rows.map((r) => r.key as string);
    expect(keys.filter((k) => k.startsWith("projects/wylls/"))).toEqual(["projects/wylls/project.json"]);
  });

  it("JSON は二重に文字列化されず、オブジェクト・配列として保存される", async () => {
    const r = await sql.query("select jsonb_typeof(data) as t from lps_docs where key = 'projects/wylls/project.json' or key = 'projects/sample-saltroad/entries.json' order by key");
    expect(r.rows.map((x) => x.t)).toEqual(["array", "object"]);
  });

  it("公開 API からは読めないよう行レベルセキュリティが有効", async () => {
    const r = await sql.query("select relrowsecurity from pg_class where relname = 'lps_docs'");
    expect(r.rows[0].relrowsecurity).toBe(true);
  });

  it("版番号が違う書き込みは拒否される（同時更新の検出）", async () => {
    await backend.writeDoc("test/a", { n: 1 });
    const cur = await backend.readDoc("test/a");
    await backend.writeDoc("test/a", { n: 2 }, cur!.version);
    await expect(backend.writeDoc("test/a", { n: 3 }, cur!.version)).rejects.toBeInstanceOf(VersionConflict);
    await expect(backend.writeDoc("test/a", { n: 4 }, 0)).rejects.toBeInstanceOf(VersionConflict);
    expect((await backend.readDoc("test/a"))!.data).toEqual({ n: 2 });
  });

  it("別のサーバーが同時に書いても、両方の変更が残る（読み直して再試行）", async () => {
    const p = await store.createProject({ name: "同時", kind: "real" });
    interfere = { key: /entries\.json$/, run: async (key) => {
      // 読み込みの直後に、別インスタンスが項目を 1 つ追加した想定
      const r = await backend.readDoc(key);
      const items = (r?.data as unknown[]) ?? [];
      await backend.writeDoc(key, [...items, { id: "ent_other", projectId: p.id, kind: "lore", title: "別の端末", status: "proposed", createdAt: "x", updatedAt: "x" }]);
    } };
    await store.createEntry(p.id, { kind: "lore", title: "この端末", status: "proposed" });
    const titles = (await store.listEntries(p.id)).map((e) => e.title).sort();
    expect(titles).toEqual(["この端末", "別の端末"]);
  });
});

describe("Postgres 保存先：業務の流れ", () => {
  it("正本の履歴・取り込みは提案かつ未公開", async () => {
    const e = await store.createEntry("wylls", { kind: "term", title: "語", status: "proposed", body: "v1" });
    const u = await store.updateEntry("wylls", e.id, { body: "v2" }, "メモ");
    expect(u.history[0].snapshot.body).toBe("v1");
    const [x] = await store.importEntriesAsProposed("wylls", [{ kind: "lore", title: "古い", status: "confirmed" }], "旧資料");
    expect([x.status, x.visibility]).toEqual(["proposed", "internal"]);
  });

  it("承認・投稿記録・投稿済みの固定が同じように働く", async () => {
    const p = await store.createPost("sample-saltroad", { type: "story", title: "pg" });
    await store.updatePost("sample-saltroad", p.id, { drafts: [{ id: "drf_pg", createdAt: "x", origin: "manual", language: "ja", segments: [{ id: "s", text: "本文" }] }], currentDraftId: "drf_pg" });
    await store.decidePost("sample-saltroad", p.id, { kind: "approved", reason: "ok", draftId: "drf_pg" });
    const posted = await store.recordPublication("sample-saltroad", p.id, { url: "https://x.com/a/status/1" });
    expect(posted.status).toBe("posted");
    await expect(store.appendToPost("sample-saltroad", p.id, (x) => x)).rejects.toThrow(/投稿済み/);
  });

  it("素材：直接アップロードの準備 → ファイル到着 → 登録 → 表示用 URL → 削除で退避", async () => {
    const prep = await store.prepareAssetUpload("wylls", { name: "a.png", type: "image/png", size: 4 });
    expect(prep.uploadUrl).toMatch(/^memory:\/\/upload\//);
    await expect(store.completeAssetUpload("wylls", { assetId: prep.assetId, storedName: prep.storedName, name: "a.png", type: "image/png" })).rejects.toThrow(/見つかりません/);
    // ブラウザが保存先へ直接送った想定
    await blobs.put(store.assetKey("wylls", prep.storedName), Buffer.from([1, 2, 3, 4]), "image/png");
    const a = await store.completeAssetUpload("wylls", { assetId: prep.assetId, storedName: prep.storedName, name: "a.png", type: "image/png" });
    expect(a.size).toBe(4);
    expect(await store.assetDownloadUrl("wylls", a.id, true)).toContain("name=a.png");
    await store.deleteAsset("wylls", a.id);
    expect(blobs.files.has(`trash/wylls-assets/${a.storedName}`)).toBe(true);
    await expect(store.prepareAssetUpload("wylls", { name: "x.html", type: "text/html", size: 1 })).rejects.toThrow(/未対応/);
    await expect(store.prepareAssetUpload("wylls", { name: "big.mp4", type: "video/mp4", size: 60 * 1024 * 1024 })).rejects.toThrow(/50MB/);
  });

  it("書き出し → 新規取り込み（素材ファイルごと）／置き換え取り込みは旧データを退避", async () => {
    const asset = await store.createAsset("sample-saltroad", { name: "b.png", type: "image/png", data: Buffer.from([9, 9]) }, {});
    const { bundle, files } = await store.exportBundle("sample-saltroad");
    expect(files.get(asset.storedName)?.length).toBe(2);
    const imported = await store.importBundle(JSON.parse(JSON.stringify(bundle)), files, "new");
    expect(imported.id).not.toBe("sample-saltroad");
    expect((await store.readAssetFile(imported.id, asset.id)).data.length).toBe(2);

    const before = (await sql.query("select count(*)::int as n from lps_docs where key like 'trash/%'")).rows[0].n as number;
    await store.importBundle(bundle, files, "replace");
    const after = (await sql.query("select count(*)::int as n from lps_docs where key like 'trash/%'")).rows[0].n as number;
    expect(after).toBeGreaterThan(before);
    expect((await store.listEntries("sample-saltroad")).length).toBe(bundle.entries.length);
    expect(blobs.files.has(store.assetKey("sample-saltroad", asset.storedName))).toBe(true);
    // 一時置き場は残らない
    expect((await sql.query("select count(*)::int as n from lps_docs where key like 'staging/%'")).rows[0].n).toBe(0);
  });

  it("プロジェクト削除は trash へ移動し、一覧から消える", async () => {
    const p = await store.createProject({ name: "消す", kind: "real" });
    await store.deleteProject(p.id);
    expect((await store.listProjects()).some((x) => x.id === p.id)).toBe(false);
    const r = await sql.query("select count(*)::int as n from lps_docs where key like $1", [`trash/${p.id}-%`]);
    expect(r.rows[0].n).toBe(1);
  });

  it("取り込み用の一時ファイルは決まった場所のものだけ受け取り、受け取ったら消す", async () => {
    const t = await store.stageTransfer("imports", "p.zip");
    await blobs.put(t.key, Buffer.from("zip"), "application/zip");
    expect((await store.takeTransfer(t.key)).toString()).toBe("zip");
    expect(blobs.files.has(t.key)).toBe(false);
    await expect(store.takeTransfer("projects/wylls/project.json")).rejects.toThrow(/不正/);
  });
});

describe("受け渡し用ファイルの掃除", () => {
  it("1 時間以上前の受け渡し用ファイルは、次の受け渡しのときに消える", async () => {
    const old = `transfers/exports/${(Date.now() - 2 * 3600_000).toString(36)}-t_old/x.zip`;
    const fresh = `transfers/exports/${Date.now().toString(36)}-t_new/y.zip`;
    await blobs.put(old, Buffer.from("a"), "application/zip");
    await blobs.put(fresh, Buffer.from("b"), "application/zip");
    await store.stageTransfer("exports", "z.zip", Buffer.from("c"));
    expect(blobs.files.has(old)).toBe(false);
    expect(blobs.files.has(fresh)).toBe(true);
  });
});

describe("実ドライバ：同時の問い合わせ", () => {
  it.runIf(!!process.env.PG_TEST_URL)("同時に投げた問い合わせも 1 つずつ送られ、結果が取り違えられない", async () => {
    const results = await Promise.all(Array.from({ length: 30 }, (_, i) => sql.query("select $1::int as n, pg_sleep(0.001)", [i])));
    expect(results.map((r) => r.rows[0].n)).toEqual(Array.from({ length: 30 }, (_, i) => i));
  });
});

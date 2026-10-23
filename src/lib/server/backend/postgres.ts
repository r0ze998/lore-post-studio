/**
 * Web 用の保存先：文書は Postgres（Supabase）、素材ファイルはオブジェクトストレージ（Supabase Storage）。
 *
 * 文書は 1 キー = 1 行（jsonb）。版番号による楽観的排他で、複数のサーバー（サーバーレスの複数インスタンス）から
 * 同時に書かれても上書きで消えないようにする。
 */
import type { Backend, DocRecord } from "./types";
import { VersionConflict } from "./types";

/** 最小限の SQL 実行インターフェース（本番は postgres ライブラリ、テストは PGlite）。 */
export interface Sql {
  query(text: string, params?: unknown[]): Promise<{ rows: Record<string, unknown>[]; count: number }>;
}

/** ファイル置き場（本番は Supabase Storage、テストはメモリ）。 */
export interface BlobStore {
  put(key: string, data: Buffer, mime: string): Promise<void>;
  get(key: string): Promise<Buffer | null>;
  move(from: string, to: string): Promise<void>;
  size(key: string): Promise<number | null>;
  remove(key: string): Promise<void>;
  /** 接頭辞以下のキー（再帰）。 */
  list(prefix: string): Promise<string[]>;
  signedDownloadUrl(key: string, downloadName?: string, expiresInSec?: number): Promise<string>;
  signedUploadUrl(key: string): Promise<string>;
}

const TABLE = "lps_docs";

/** 1 文ずつ実行する（接続プール経由では複数文を一度に送れないため）。 */
const MIGRATION = [
  `create table if not exists ${TABLE} (
    key text primary key,
    data jsonb not null,
    version bigint not null default 1,
    updated_at timestamptz not null default now()
  )`,
  // Supabase の公開 API（PostgREST）からは読めないようにする。サーバーは DB 接続で直接読む。
  `alter table ${TABLE} enable row level security`,
];

const dir = (p: string) => (p.endsWith("/") ? p : `${p}/`);

export function createPostgresBackend(opts: { sql: Sql; blobs: BlobStore; maxAssetBytes: number; describe: string }): Backend {
  const { sql, blobs } = opts;
  let ready: Promise<void> | null = null;
  const init = () => {
    if (!ready) {
      ready = (async () => {
        for (const stmt of MIGRATION) await sql.query(stmt);
      })();
      ready.catch(() => {
        ready = null;
      });
    }
    return ready;
  };

  return {
    kind: "supabase",
    maxAssetBytes: opts.maxAssetBytes,
    directTransfer: true,
    describe: () => opts.describe,

    async readDoc(key): Promise<DocRecord | null> {
      await init();
      const r = await sql.query(`select data, version from ${TABLE} where key = $1`, [key]);
      if (!r.rows.length) return null;
      return { data: r.rows[0].data, version: Number(r.rows[0].version) };
    },

    async writeDoc(key, data, expectedVersion) {
      await init();
      const json = JSON.stringify(data);
      if (expectedVersion === undefined) {
        await sql.query(
          `insert into ${TABLE} (key, data) values ($1, $2::text::jsonb)
           on conflict (key) do update set data = excluded.data, version = ${TABLE}.version + 1, updated_at = now()`,
          [key, json],
        );
        return;
      }
      const r =
        expectedVersion === 0
          ? await sql.query(`insert into ${TABLE} (key, data) values ($1, $2::text::jsonb) on conflict (key) do nothing`, [key, json])
          : await sql.query(`update ${TABLE} set data = $2::text::jsonb, version = version + 1, updated_at = now() where key = $1 and version = $3`, [key, json, expectedVersion]);
      if (r.count === 0) throw new VersionConflict(key);
    },

    async listProjectIds() {
      await init();
      const r = await sql.query(`select key from ${TABLE} where key like 'projects/%/project.json'`);
      return r.rows.map((x) => String(x.key).match(/^projects\/([^/]+)\/project\.json$/)?.[1]).filter((x): x is string => !!x);
    },

    async moveTree(fromPrefix, toPrefix) {
      await init();
      const from = dir(fromPrefix);
      const to = dir(toPrefix);
      await sql.query(`update ${TABLE} set key = $2 || substr(key, length($1) + 1), updated_at = now() where left(key, length($1)) = $1`, [from, to]);
      for (const k of await blobs.list(from)) await blobs.move(k, to + k.slice(from.length));
    },

    async hasTree(prefix) {
      await init();
      const r = await sql.query(`select 1 from ${TABLE} where left(key, length($1)) = $1 limit 1`, [dir(prefix)]);
      return r.rows.length > 0;
    },

    putFile: (key, data, mime) => blobs.put(key, data, mime),
    getFile: (key) => blobs.get(key),
    moveFile: (a, b) => blobs.move(a, b),
    fileSize: (key) => blobs.size(key),
    removeFile: (key) => blobs.remove(key),
    listFiles: (prefix) => blobs.list(prefix.endsWith("/") ? prefix : `${prefix}/`),
    signedDownloadUrl: (key, name, exp) => blobs.signedDownloadUrl(key, name, exp),
    signedUploadUrl: (key) => blobs.signedUploadUrl(key),
  };
}

/** テスト用のメモリ上のファイル置き場。 */
export function createMemoryBlobStore(): BlobStore & { files: Map<string, { data: Buffer; mime: string }> } {
  const files = new Map<string, { data: Buffer; mime: string }>();
  return {
    files,
    async put(key, data, mime) {
      files.set(key, { data: Buffer.from(data), mime });
    },
    async get(key) {
      return files.get(key)?.data ?? null;
    },
    async move(from, to) {
      const f = files.get(from);
      if (!f) return;
      files.delete(from);
      files.set(to, f);
    },
    async size(key) {
      return files.get(key)?.data.length ?? null;
    },
    async remove(key) {
      files.delete(key);
    },
    async list(prefix) {
      return Array.from(files.keys()).filter((k) => k.startsWith(prefix));
    },
    async signedDownloadUrl(key, name) {
      return `memory://download/${encodeURIComponent(key)}${name ? `?name=${encodeURIComponent(name)}` : ""}`;
    },
    async signedUploadUrl(key) {
      return `memory://upload/${encodeURIComponent(key)}`;
    },
  };
}

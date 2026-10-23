/**
 * 保存先の選択。
 * - STORAGE_BACKEND=supabase … DATABASE_URL / SUPABASE_URL / SUPABASE_SECRET_KEY（または従来の SUPABASE_SERVICE_ROLE_KEY）が必要（Web 用）
 * - それ以外 …………………… ローカルファイル（DATA_DIR、既定 ./data）
 */
import path from "node:path";
import { ConfigError, type Backend } from "./types";
import { createFileBackend } from "./file";

let current: Backend | null = null;

/** サーバー専用の Supabase キー（新しい secret キーを優先、従来の service_role キーも可）。 */
function supabaseKey(): string {
  return (process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || "").trim();
}

export function backendConfigError(): string | null {
  if (process.env.STORAGE_BACKEND !== "supabase") {
    // Vercel ではサーバーのファイルが保存されないため、ファイル保存は使えない
    return process.env.VERCEL ? "Vercel ではデータを保存できるよう、環境変数 STORAGE_BACKEND=supabase と Supabase の接続情報を設定してください（docs/DEPLOY.md）。" : null;
  }
  const missing = ["DATABASE_URL", "SUPABASE_URL"].filter((k) => !process.env[k]?.trim());
  if (!supabaseKey()) missing.push("SUPABASE_SECRET_KEY（または SUPABASE_SERVICE_ROLE_KEY）");
  return missing.length ? `STORAGE_BACKEND=supabase ですが、環境変数 ${missing.join("・")} が未設定です。` : null;
}

export async function getBackend(): Promise<Backend> {
  if (current) return current;
  if (process.env.STORAGE_BACKEND === "postgres-test" && !process.env.VERCEL) {
    // E2E テスト専用：文書は実際の Postgres（本番と同じドライバ）、ファイルはローカル＋テスト用の受け渡し口
    if (!process.env.DATABASE_URL) throw new ConfigError("STORAGE_BACKEND=postgres-test には DATABASE_URL が必要です");
    const { createPostgresBackend } = await import("./postgres");
    const { createPostgresSql } = await import("./supabase");
    const root = path.resolve(process.env.DATA_DIR || path.join(process.cwd(), "data"));
    const files = createFileBackend(root);
    const pg = createPostgresBackend({
      sql: createPostgresSql(process.env.DATABASE_URL),
      blobs: {
        put: (k, d, m) => files.putFile(k, d, m),
        get: (k) => files.getFile(k),
        move: (a, b) => files.moveFile(a, b),
        size: (k) => files.fileSize(k),
        remove: (k) => files.removeFile(k),
        list: (p) => files.listFiles(p),
        signedDownloadUrl: async () => "",
        signedUploadUrl: async () => "",
      },
      maxAssetBytes: 50 * 1024 * 1024,
      describe: "Postgres（テスト）",
    });
    current = withTestDirectTransfer(pg);
    return current;
  }
  if (process.env.STORAGE_BACKEND === "supabase") {
    const err = backendConfigError();
    if (err) throw new ConfigError(err);
    const { createPostgresBackend } = await import("./postgres");
    const { createPostgresSql, createSupabaseBlobStore } = await import("./supabase");
    const bucket = process.env.SUPABASE_BUCKET?.trim() || "lore-post-studio";
    current = createPostgresBackend({
      sql: createPostgresSql(process.env.DATABASE_URL!),
      blobs: createSupabaseBlobStore(process.env.SUPABASE_URL!, supabaseKey(), bucket),
      // Supabase の無料プランはファイル 1 つ 50MB まで
      maxAssetBytes: Number(process.env.MAX_ASSET_MB || 50) * 1024 * 1024,
      describe: `Supabase（データベース＋ Storage バケット「${bucket}」）`,
    });
  } else {
    const err = backendConfigError();
    if (err) throw new ConfigError(err);
    const root = path.resolve(process.env.DATA_DIR || path.join(process.cwd(), "data"));
    current = testDirectTransferEnabled() ? withTestDirectTransfer(createFileBackend(root)) : createFileBackend(root);
  }
  return current;
}

/** テスト用：保存先を差し替える。 */
export function setBackendForTests(b: Backend | null) {
  current = b;
}

/**
 * E2E テスト専用：ファイル保存のまま、Web 版と同じ「保存先へ直接送る／保存先の URL へ転送する」流れを再現する。
 * 送り先は /api/test-blob（Supabase Storage と同じ形式で受け付ける）。Vercel 上では決して有効にならない。
 */
export function testDirectTransferEnabled(): boolean {
  return (process.env.TEST_DIRECT_TRANSFER === "1" || process.env.STORAGE_BACKEND === "postgres-test") && !process.env.VERCEL;
}

function withTestDirectTransfer(b: Backend): Backend {
  const base = process.env.TEST_BASE_URL || "http://127.0.0.1:3000";
  return {
    ...b,
    directTransfer: true,
    maxAssetBytes: 50 * 1024 * 1024,
    describe: () => `${b.describe()}（テスト用の直接転送）`,
    async signedUploadUrl(key) {
      return `${base}/api/test-blob?op=up&key=${encodeURIComponent(key)}`;
    },
    async signedDownloadUrl(key, name) {
      return `${base}/api/test-blob?op=down&key=${encodeURIComponent(key)}${name ? `&name=${encodeURIComponent(name)}` : ""}`;
    },
  };
}

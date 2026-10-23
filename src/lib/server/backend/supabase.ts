/**
 * Supabase の接続（サーバー側のみ）。
 * - 文書：DATABASE_URL（Supabase の接続文字列。Vercel では Transaction pooler の 6543 番）
 * - ファイル：SUPABASE_URL ＋ SUPABASE_SECRET_KEY（または SUPABASE_SERVICE_ROLE_KEY）（非公開バケット）
 * これらのキーはサーバーの環境変数だけで使い、ブラウザには一切渡さない。
 */
import postgres from "postgres";
import { createClient } from "@supabase/supabase-js";
import type { BlobStore, Sql } from "./postgres";

export function createPostgresSql(url: string): Sql {
  const host = new URL(url).hostname;
  const local = host === "localhost" || host === "127.0.0.1" || host === "::1";
  // Supabase の Transaction pooler の注意に従う:
  // - prepared statement を使わない（prepare: false）
  // - サーバーレスでは接続を 1 本に（max: 1）
  // - postgres ライブラリは同じ接続に複数の問い合わせを並べて送る（パイプライン）ことがあり、
  //   pooler では応答の取り違えや停止の原因になる。下の queue で必ず 1 つずつ送る。
  const client = postgres(url, {
    prepare: false,
    max: 1,
    idle_timeout: 20,
    connect_timeout: 15,
    ssl: local ? false : "require",
    onnotice: () => undefined,
  });
  let queue: Promise<unknown> = Promise.resolve();
  return {
    query(text, params = []) {
      const run = queue.then(async () => {
        const r = await client.unsafe(text, params as never[]);
        return { rows: r as unknown as Record<string, unknown>[], count: r.count ?? 0 };
      });
      queue = run.catch(() => undefined);
      return run;
    },
  };
}

export function createSupabaseBlobStore(url: string, serviceKey: string, bucket: string): BlobStore {
  const sb = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const store = () => sb.storage.from(bucket);
  let ready: Promise<void> | null = null;
  const init = () => {
    if (!ready) {
      ready = (async () => {
        const { data } = await sb.storage.getBucket(bucket);
        if (data) return;
        const { error } = await sb.storage.createBucket(bucket, { public: false });
        if (error && !/already exists/i.test(error.message)) throw new Error(`Supabase Storage のバケットを作れませんでした: ${error.message}`);
      })();
      ready.catch(() => {
        ready = null;
      });
    }
    return ready;
  };

  const listDir = async (folder: string): Promise<string[]> => {
    const out: string[] = [];
    for (let offset = 0; ; offset += 1000) {
      const { data, error } = await store().list(folder.replace(/\/$/, ""), { limit: 1000, offset });
      if (error) throw new Error(`一覧を取得できませんでした: ${error.message}`);
      for (const item of data ?? []) {
        const full = `${folder.replace(/\/$/, "")}/${item.name}`;
        if (item.id === null) out.push(...(await listDir(full)));
        else out.push(full);
      }
      if (!data || data.length < 1000) break;
    }
    return out;
  };

  return {
    async put(key, data, mime) {
      await init();
      const { error } = await store().upload(key, data, { contentType: mime, upsert: true });
      if (error) throw new Error(`ファイルを保存できませんでした: ${error.message}`);
    },
    async get(key) {
      await init();
      const { data, error } = await store().download(key);
      if (error || !data) return null;
      return Buffer.from(await data.arrayBuffer());
    },
    async move(from, to) {
      await init();
      const { error } = await store().move(from, to);
      if (error && !/not found/i.test(error.message)) throw new Error(`ファイルを移動できませんでした: ${error.message}`);
    },
    async size(key) {
      await init();
      const { data, error } = await store().info(key);
      if (error || !data) return null;
      return typeof data.size === "number" ? data.size : null;
    },
    async remove(key) {
      await init();
      await store().remove([key]);
    },
    async list(prefix) {
      await init();
      return listDir(prefix);
    },
    async signedDownloadUrl(key, downloadName, expiresInSec = 600) {
      await init();
      const { data, error } = await store().createSignedUrl(key, expiresInSec, downloadName ? { download: downloadName } : undefined);
      if (error || !data) throw new Error(`ダウンロード URL を作れませんでした: ${error?.message ?? ""}`);
      return data.signedUrl;
    },
    async signedUploadUrl(key) {
      await init();
      const { data, error } = await store().createSignedUploadUrl(key);
      if (error || !data) throw new Error(`アップロード URL を作れませんでした: ${error?.message ?? ""}`);
      return data.signedUrl;
    },
  };
}

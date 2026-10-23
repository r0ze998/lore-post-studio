/**
 * データの保存（業務ルール付き）。読み書きの実体は保存先（backend）に任せる。
 *
 * キーの構成（ファイル保存なら data/ 以下のパス、Supabase なら文書のキー）:
 *   projects/<projectId>/
 *     project.json  entries.json  assets.json  posts.json  learnings.json  sendlog.json
 *     assets/<storedName>
 *   trash/          削除・置換前の退避先（自動では消さない）
 *   staging/        置き換え取り込みの一時置き場
 *   meta/seeded     初回シード済みの印
 *
 * プロジェクト間でキーを共有しないことで、設定の混入を構造的に防ぐ。
 */
import path from "node:path";
import { z } from "zod";
import {
  Asset,
  AssetMime,
  Decision,
  Entry,
  EntrySnapshot,
  Learning,
  Post,
  Project,
  ProjectBundle,
  Publication,
  SCHEMA_VERSION,
  SendLogEntry,
} from "@/lib/domain/schema";
import { newId, nowIso } from "@/lib/util";
import { getBackend } from "./backend";
import { CorruptDoc } from "./backend/file";
import { VersionConflict } from "./backend/types";

export class StoreError extends Error {
  constructor(
    message: string,
    public status: number = 400,
  ) {
    super(message);
  }
}

/** 保存先の説明（画面表示用）。 */
export async function storageInfo() {
  const b = await getBackend();
  return { kind: b.kind, description: b.describe(), maxAssetBytes: b.maxAssetBytes, directTransfer: b.directTransfer };
}

const SAFE_ID = /^[A-Za-z0-9_-]{1,64}$/;

function assertSafeId(value: string, what = "id"): void {
  if (!SAFE_ID.test(value)) throw new StoreError(`不正な ${what} です`, 400);
}

function projectPrefix(projectId: string): string {
  assertSafeId(projectId, "projectId");
  return `projects/${projectId}/`;
}

const docKey = (projectId: string, name: string) => `${projectPrefix(projectId)}${name}`;
export const assetKey = (projectId: string, storedName: string) => `${projectPrefix(projectId)}assets/${storedName}`;

async function projectExists(projectId: string): Promise<boolean> {
  return (await getBackend()).hasTree(projectPrefix(projectId));
}

async function readJsonV<T>(key: string, schema: z.ZodType<T>, fallback: T): Promise<{ value: T; version: number }> {
  const b = await getBackend();
  let rec;
  try {
    rec = await b.readDoc(key);
  } catch (e) {
    if (e instanceof CorruptDoc) throw new StoreError(`保存データが壊れています（JSON として読めません）: ${key}`, 500);
    throw e;
  }
  if (!rec) return { value: fallback, version: 0 };
  const parsed = schema.safeParse(rec.data);
  if (!parsed.success) {
    throw new StoreError(`保存データの形式が不正です: ${path.basename(key)}: ${parsed.error.issues[0]?.message ?? ""}`, 500);
  }
  return { value: parsed.data, version: rec.version };
}

async function readJson<T>(key: string, schema: z.ZodType<T>, fallback: T): Promise<T> {
  return (await readJsonV(key, schema, fallback)).value;
}

async function writeJson(key: string, value: unknown, expectedVersion?: number): Promise<void> {
  await (await getBackend()).writeDoc(key, value, expectedVersion);
}

/* 直列化: 同じプロジェクトへの書き込みは、このサーバー内では順番に処理する。
 * 複数のサーバー（サーバーレス）にまたがる同時書き込みは、版番号の照合（CAS）と再試行で防ぐ。 */
const locks = new Map<string, Promise<unknown>>();
async function withLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const prev = locks.get(key) ?? Promise.resolve();
  const next = prev.catch(() => undefined).then(fn);
  locks.set(
    key,
    next.catch(() => undefined),
  );
  return next;
}

/** 1 つの文書を読み、変更し、版が変わっていなければ書く（変わっていたら読み直してやり直す）。 */
async function mutateDoc<T, R>(key: string, schema: z.ZodType<T>, fallback: T, fn: (value: T) => R | Promise<R>, writeBack: (value: T, result: R) => unknown = (v) => v): Promise<R> {
  for (let attempt = 0; ; attempt++) {
    const { value, version } = await readJsonV(key, schema, fallback);
    const result = await fn(value);
    try {
      await writeJson(key, writeBack(value, result), version);
      return result;
    } catch (e) {
      if (e instanceof VersionConflict && attempt < 5) continue;
      if (e instanceof VersionConflict) throw new StoreError("同時に更新が重なりました。もう一度お試しください。", 409);
      throw e;
    }
  }
}

/* ------------------------------------------------------------------ */
/* Collections                                                         */
/* ------------------------------------------------------------------ */

type CollectionName = "entries" | "assets" | "posts" | "learnings" | "sendlog";
const COLLECTION_SCHEMA = {
  entries: z.array(Entry),
  assets: z.array(Asset),
  posts: z.array(Post),
  learnings: z.array(Learning),
  sendlog: z.array(SendLogEntry),
} as const;
type CollectionType = {
  entries: Entry;
  assets: Asset;
  posts: Post;
  learnings: Learning;
  sendlog: SendLogEntry;
};

async function readCollection<K extends CollectionName>(projectId: string, name: K): Promise<CollectionType[K][]> {
  await requireProject(projectId);
  return readJson(docKey(projectId, `${name}.json`), COLLECTION_SCHEMA[name] as unknown as z.ZodType<CollectionType[K][]>, []);
}

/**
 * コレクションの変更。fn は再試行で複数回呼ばれることがあるので、ファイルの書き込みなどの副作用を入れないこと。
 */
async function mutateCollection<K extends CollectionName, R>(
  projectId: string,
  name: K,
  fn: (items: CollectionType[K][]) => R | Promise<R>,
): Promise<R> {
  return withLock(projectId, async () => {
    await requireProject(projectId);
    const schema = COLLECTION_SCHEMA[name] as unknown as z.ZodType<CollectionType[K][]>;
    const result = await mutateDoc(docKey(projectId, `${name}.json`), schema, [], fn, (items) => schema.parse(items));
    await touchProject(projectId);
    return result;
  });
}

/* ------------------------------------------------------------------ */
/* Projects                                                            */
/* ------------------------------------------------------------------ */

let seedPromise: Promise<void> | null = null;

/** 初回のみサンプル（架空）と Wylls（空）を作る。 */
export async function ensureSeeded(): Promise<void> {
  if (!seedPromise) {
    seedPromise = (async () => {
      const b = await getBackend();
      if (await b.readDoc("meta/seeded")) return;
      const { buildSampleBundle, buildWyllsProject } = await import("./seed");
      if (!(await projectExists("wylls"))) {
        await writeJson(docKey("wylls", "project.json"), buildWyllsProject(), 0).catch((e) => {
          if (!(e instanceof VersionConflict)) throw e;
        });
      }
      const sample = buildSampleBundle();
      if (!(await projectExists(sample.project.id))) {
        await writeBundleTo(projectPrefix(sample.project.id), sample, new Map(), sample.project.id, sample.project.name);
      }
      await writeJson("meta/seeded", { at: nowIso() });
    })().catch((e) => {
      seedPromise = null;
      throw e;
    });
  }
  return seedPromise;
}

let brokenProjects: { id: string; error: string }[] = [];
/** 直近の一覧取得で読めなかったプロジェクト。 */
export function getBrokenProjects() {
  return brokenProjects;
}

export async function listProjects(): Promise<Project[]> {
  await ensureSeeded();
  const ids = await (await getBackend()).listProjectIds();
  const out: Project[] = [];
  brokenProjects = [];
  for (const n of ids) {
    if (!SAFE_ID.test(n)) continue;
    try {
      const p = await readJson(docKey(n, "project.json"), Project.nullable(), null);
      if (p) out.push(p);
    } catch (e) {
      // 1 つ壊れていても、ほかのプロジェクトは使えるようにする
      brokenProjects.push({ id: n, error: e instanceof Error ? e.message : String(e) });
    }
  }
  // 実プロジェクトを先、サンプルを後に
  return out.sort((a, b) => (a.kind === b.kind ? a.createdAt.localeCompare(b.createdAt) : a.kind === "real" ? -1 : 1));
}

export async function getProject(projectId: string): Promise<Project | null> {
  await ensureSeeded();
  return readJson(docKey(projectId, "project.json"), Project.nullable(), null);
}

async function requireProject(projectId: string): Promise<Project> {
  const p = await getProject(projectId);
  if (!p) throw new StoreError("プロジェクトが見つかりません", 404);
  return p;
}

async function touchProject(projectId: string): Promise<void> {
  await mutateDoc(docKey(projectId, "project.json"), Project.nullable(), null, () => undefined, (p) => (p ? { ...p, updatedAt: nowIso() } : p));
}

export async function createProject(input: { name: string; kind: Project["kind"]; description?: string }): Promise<Project> {
  await ensureSeeded();
  const now = nowIso();
  const project = Project.parse({
    id: newId("prj"),
    name: input.name,
    kind: input.kind,
    description: input.description ?? "",
    createdAt: now,
    updatedAt: now,
  });
  await writeJson(docKey(project.id, "project.json"), project, 0);
  return project;
}

export async function updateProject(projectId: string, patch: Partial<Pick<Project, "name" | "description" | "settings">>): Promise<Project> {
  return withLock(projectId, async () => {
    await requireProject(projectId);
    return mutateDoc(docKey(projectId, "project.json"), Project.nullable(), null, (p) => {
      if (!p) throw new StoreError("プロジェクトが見つかりません", 404);
      return Project.parse({ ...p, ...patch, id: p.id, kind: p.kind, updatedAt: nowIso() });
    }, (_p, next) => next);
  });
}

/** 削除は trash への移動（復元可能）。 */
export async function deleteProject(projectId: string): Promise<void> {
  await withLock(projectId, async () => {
    await requireProject(projectId);
    await (await getBackend()).moveTree(projectPrefix(projectId), `trash/${projectId}-${Date.now()}/`);
  });
}

/* ------------------------------------------------------------------ */
/* Entries                                                             */
/* ------------------------------------------------------------------ */

export const listEntries = (projectId: string) => readCollection(projectId, "entries");

export type EntryInput = Omit<Entry, "id" | "projectId" | "createdAt" | "updatedAt" | "history">;

function snapshotOf(e: Entry): z.infer<typeof EntrySnapshot> {
  return {
    title: e.title,
    body: e.body,
    aliases: e.aliases,
    status: e.status,
    visibility: e.visibility,
    source: e.source,
    details: e.details,
    contradictions: e.contradictions,
  };
}

export async function createEntry(projectId: string, input: unknown): Promise<Entry> {
  return mutateCollection(projectId, "entries", (items) => {
    const now = nowIso();
    const entry = Entry.parse({
      ...(input as object),
      id: newId("ent"),
      projectId,
      createdAt: now,
      updatedAt: now,
      history: [],
    });
    items.push(entry);
    return entry;
  });
}

/** 更新すると直前の内容を履歴に残す。 */
export async function updateEntry(projectId: string, entryId: string, input: unknown, note = ""): Promise<Entry> {
  return mutateCollection(projectId, "entries", (items) => {
    const idx = items.findIndex((e) => e.id === entryId);
    if (idx < 0) throw new StoreError("項目が見つかりません", 404);
    const prev = items[idx];
    const merged = Entry.parse({
      ...prev,
      ...(input as object),
      id: prev.id,
      projectId,
      kind: (input as Partial<Entry>).kind ?? prev.kind,
      createdAt: prev.createdAt,
      history: prev.history,
    });
    const changed = JSON.stringify(snapshotOf(prev)) !== JSON.stringify(snapshotOf(merged)) ||
      JSON.stringify(prev.tags) !== JSON.stringify(merged.tags) ||
      JSON.stringify(prev.supersedes) !== JSON.stringify(merged.supersedes) ||
      JSON.stringify(prev.notConflictingWith) !== JSON.stringify(merged.notConflictingWith);
    if (!changed) return prev;
    const next: Entry = {
      ...merged,
      updatedAt: nowIso(),
      history: [{ at: prev.updatedAt, note, snapshot: snapshotOf(prev) }, ...prev.history].slice(0, 50),
    };
    items[idx] = next;
    return next;
  });
}

export async function deleteEntry(projectId: string, entryId: string): Promise<void> {
  await mutateCollection(projectId, "entries", (items) => {
    const idx = items.findIndex((e) => e.id === entryId);
    if (idx < 0) throw new StoreError("項目が見つかりません", 404);
    items.splice(idx, 1);
    for (const e of items) {
      e.supersedes = e.supersedes.filter((s) => s !== entryId);
      e.notConflictingWith = e.notConflictingWith.filter((s) => s !== entryId);
    }
  });
}

/** 取り込みは必ず「提案」状態で追加する（確定設定として扱わない）。 */
export async function importEntriesAsProposed(projectId: string, inputs: unknown[], sourceLabel: string): Promise<Entry[]> {
  return mutateCollection(projectId, "entries", (items) => {
    const now = nowIso();
    const created: Entry[] = [];
    for (const raw of inputs) {
      const r = raw as Partial<Entry>;
      const entry = Entry.parse({
        ...r,
        id: newId("ent"),
        projectId,
        status: r.status === "deprecated" ? "deprecated" : "proposed",
        // 過去資料は未公開の情報を含みやすいので、指定がなければ「未公開」で入れる
        visibility: r.visibility === "public" ? "public" : "internal",
        source: { label: r.source?.label || sourceLabel, url: r.source?.url ?? "", note: r.source?.note ?? "" },
        createdAt: now,
        updatedAt: now,
        history: [],
        supersedes: [],
        notConflictingWith: [],
      });
      items.push(entry);
      created.push(entry);
    }
    return created;
  });
}

/* ------------------------------------------------------------------ */
/* Assets                                                              */
/* ------------------------------------------------------------------ */

export const listAssets = (projectId: string) => readCollection(projectId, "assets");
export const MAX_ASSET_BYTES = 200 * 1024 * 1024;

const ALLOWED_MIME = new Set<string>(AssetMime.options);

function extFor(mime: string, filename: string): string {
  const fromName = path.extname(filename).toLowerCase().replace(/[^a-z0-9.]/g, "");
  if (fromName && fromName.length <= 6) return fromName;
  return { "image/png": ".png", "image/jpeg": ".jpg", "image/gif": ".gif", "image/webp": ".webp", "video/mp4": ".mp4", "video/quicktime": ".mov" }[mime] ?? ".bin";
}

async function checkAssetInput(file: { name: string; type: string; size: number }) {
  const max = (await getBackend()).maxAssetBytes;
  if (!ALLOWED_MIME.has(file.type)) throw new StoreError(`未対応の形式です: ${file.type || "不明"}（PNG/JPEG/GIF/WebP/MP4/MOV）`);
  if (file.size > max) throw new StoreError(`ファイルが大きすぎます（${Math.floor(max / 1024 / 1024)}MB まで）`);
}

function buildAsset(projectId: string, file: { name: string; type: string; size: number }, meta: Partial<Asset>, assetId = newId("ast")): Asset {
  const now = nowIso();
  return Asset.parse({
    status: "proposed",
    ...meta,
    id: assetId,
    projectId,
    filename: file.name.slice(0, 200),
    storedName: `${assetId}${extFor(file.type, file.name)}`,
    mime: file.type,
    size: file.size,
    title: meta.title || file.name,
    createdAt: now,
    updatedAt: now,
  });
}

/** サーバー経由のアップロード（ファイル保存の PC 版、または小さなファイル）。 */
export async function createAsset(projectId: string, file: { name: string; type: string; data: Buffer }, meta: Partial<Asset>): Promise<Asset> {
  await requireProject(projectId);
  await checkAssetInput({ name: file.name, type: file.type, size: file.data.byteLength });
  // 先に記録を検証し、ファイルを書いてから一覧に加える（再試行でファイルが重複しないよう、一覧の更新とは分ける）
  const asset = buildAsset(projectId, { name: file.name, type: file.type, size: file.data.byteLength }, meta);
  await (await getBackend()).putFile(assetKey(projectId, asset.storedName), file.data, asset.mime);
  await mutateCollection(projectId, "assets", (items) => {
    items.push(asset);
  });
  return asset;
}

/**
 * ブラウザから保存先へ直接アップロードする準備（Web 版）。
 * ここで発行した URL にブラウザがファイルを送り、completeAssetUpload で一覧に登録する。
 */
export async function prepareAssetUpload(projectId: string, file: { name: string; type: string; size: number }) {
  await requireProject(projectId);
  await checkAssetInput(file);
  const b = await getBackend();
  if (!b.signedUploadUrl) throw new StoreError("この保存先では直接アップロードは使えません");
  const asset = buildAsset(projectId, file, {});
  const uploadUrl = await b.signedUploadUrl(assetKey(projectId, asset.storedName));
  return { assetId: asset.id, storedName: asset.storedName, uploadUrl };
}

export async function completeAssetUpload(projectId: string, input: { assetId: string; storedName: string; name: string; type: string }): Promise<Asset> {
  await requireProject(projectId);
  assertSafeId(input.assetId, "assetId");
  const b = await getBackend();
  const size = await b.fileSize(assetKey(projectId, input.storedName));
  if (size === null) throw new StoreError("アップロードされたファイルが見つかりません。もう一度お試しください。", 404);
  try {
    await checkAssetInput({ name: input.name, type: input.type, size });
  } catch (e) {
    await b.removeFile(assetKey(projectId, input.storedName));
    throw e;
  }
  const asset = buildAsset(projectId, { name: input.name, type: input.type, size }, {}, input.assetId);
  if (asset.storedName !== input.storedName) throw new StoreError("ファイル名が一致しません");
  await mutateCollection(projectId, "assets", (items) => {
    if (!items.some((a) => a.id === asset.id)) items.push(asset);
  });
  return asset;
}

export async function updateAsset(projectId: string, assetId: string, patch: Partial<Asset>): Promise<Asset> {
  return mutateCollection(projectId, "assets", (items) => {
    const idx = items.findIndex((a) => a.id === assetId);
    if (idx < 0) throw new StoreError("素材が見つかりません", 404);
    const prev = items[idx];
    const next = Asset.parse({
      ...prev,
      ...patch,
      id: prev.id,
      projectId,
      storedName: prev.storedName,
      mime: prev.mime,
      size: prev.size,
      filename: prev.filename,
      createdAt: prev.createdAt,
      updatedAt: nowIso(),
    });
    items[idx] = next;
    return next;
  });
}

export async function deleteAsset(projectId: string, assetId: string): Promise<void> {
  const removed = await mutateCollection(projectId, "assets", (items) => {
    const idx = items.findIndex((a) => a.id === assetId);
    if (idx < 0) throw new StoreError("素材が見つかりません", 404);
    return items.splice(idx, 1)[0];
  });
  await (await getBackend()).moveFile(assetKey(projectId, removed.storedName), `trash/${projectId}-assets/${removed.storedName}`);
}

async function findAsset(projectId: string, assetId: string): Promise<Asset> {
  const asset = (await listAssets(projectId)).find((a) => a.id === assetId);
  if (!asset) throw new StoreError("素材が見つかりません", 404);
  return asset;
}

export async function readAssetFile(projectId: string, assetId: string): Promise<{ asset: Asset; data: Buffer }> {
  const asset = await findAsset(projectId, assetId);
  const data = await (await getBackend()).getFile(assetKey(projectId, asset.storedName));
  if (!data) throw new StoreError("素材のファイルが見つかりません", 404);
  return { asset, data };
}

/** Web 版：素材を表示・ダウンロードするための短時間有効な URL（なければ null）。 */
export async function assetDownloadUrl(projectId: string, assetId: string, download: boolean): Promise<string | null> {
  const b = await getBackend();
  if (!b.signedDownloadUrl) return null;
  const asset = await findAsset(projectId, assetId);
  return b.signedDownloadUrl(assetKey(projectId, asset.storedName), download ? asset.filename : undefined, 3600);
}

/** Web 版：書き出し・取り込み用のファイルの受け渡し（Vercel の 4.5MB 制限を避ける）。 */
export async function stageTransfer(kind: "exports" | "imports", name: string, data?: Buffer): Promise<{ key: string; url: string }> {
  const b = await getBackend();
  if (!b.signedDownloadUrl || !b.signedUploadUrl) throw new StoreError("この保存先では使えません");
  const key = `transfers/${kind}/${Date.now().toString(36)}-${newId("t")}/${name.replace(/[^A-Za-z0-9._-]/g, "_")}`;
  // 1 時間以上前の受け渡し用ファイルは消す（保存先の容量を圧迫しないように）
  await cleanupTransfers(b).catch(() => undefined);
  if (data) {
    await b.putFile(key, data, "application/zip");
    return { key, url: await b.signedDownloadUrl(key, name, 600) };
  }
  return { key, url: await b.signedUploadUrl(key) };
}

async function cleanupTransfers(b: Awaited<ReturnType<typeof getBackend>>) {
  const cutoff = Date.now() - 60 * 60 * 1000;
  for (const k of await b.listFiles("transfers/")) {
    const stamp = k.split("/")[2]?.split("-")[0];
    const t = stamp ? parseInt(stamp, 36) : NaN;
    if (Number.isFinite(t) && t < cutoff) await b.removeFile(k);
  }
}

export async function takeTransfer(key: string): Promise<Buffer> {
  if (!/^transfers\/imports\/[A-Za-z0-9_-]+\/[A-Za-z0-9._-]+$/.test(key)) throw new StoreError("不正な取り込みファイルです");
  const b = await getBackend();
  const data = await b.getFile(key);
  if (!data) throw new StoreError("取り込みファイルが見つかりません。もう一度アップロードしてください。", 404);
  await b.removeFile(key);
  return data;
}

/* ------------------------------------------------------------------ */
/* Posts                                                               */
/* ------------------------------------------------------------------ */

export const listPosts = (projectId: string) => readCollection(projectId, "posts");

export async function getPost(projectId: string, postId: string): Promise<Post> {
  const posts = await listPosts(projectId);
  const p = posts.find((x) => x.id === postId);
  if (!p) throw new StoreError("投稿が見つかりません", 404);
  return p;
}

export async function createPost(projectId: string, input: unknown): Promise<Post> {
  const project = await requireProject(projectId);
  return mutateCollection(projectId, "posts", (items) => {
    const now = nowIso();
    const post = Post.parse({
      options: project.settings.defaults,
      ...(input as object),
      id: newId("pst"),
      projectId,
      status: "idea",
      decisions: [],
      acknowledgements: [],
      createdAt: now,
      updatedAt: now,
    });
    items.push(post);
    return post;
  });
}

/**
 * 投稿の更新。承認・却下・投稿記録は専用の関数を通す（理由の保存を強制するため）。
 * expectedUpdatedAt を渡すと、別画面での更新との衝突を検出する。
 */
export async function updatePost(projectId: string, postId: string, input: unknown, expectedUpdatedAt?: string): Promise<Post> {
  return mutateCollection(projectId, "posts", (items) => {
    const idx = items.findIndex((p) => p.id === postId);
    if (idx < 0) throw new StoreError("投稿が見つかりません", 404);
    const prev = items[idx];
    if (expectedUpdatedAt && expectedUpdatedAt !== prev.updatedAt) {
      throw new StoreError("別の画面でこの投稿が更新されています。再読み込みしてください。", 409);
    }
    const patch = input as Partial<Post>;
    const draftChanged = (a: Post, b: Post) =>
      a.currentDraftId !== b.currentDraftId || JSON.stringify(a.drafts.find((d) => d.id === a.currentDraftId)) !== JSON.stringify(b.drafts.find((d) => d.id === b.currentDraftId));
    const next = Post.parse({
      ...prev,
      ...patch,
      id: prev.id,
      projectId,
      createdAt: prev.createdAt,
      // 以下は専用操作でのみ変更
      decisions: prev.decisions,
      publication: prev.publication,
      status: prev.status,
      updatedAt: nowIso(),
    });
    // 投稿済みの記録がある投稿は、記録と本文がずれないよう本文・版を固定する
    if (prev.status === "posted") {
      if (draftChanged(prev, next) || JSON.stringify(prev.drafts) !== JSON.stringify(next.drafts)) {
        throw new StoreError("投稿済みの記録がある投稿の本文は変更できません。記録を取り消してから編集するか、複製して新しい投稿にしてください。", 409);
      }
    }
    // 状態の変更は決められた遷移だけ許す（承認・却下・投稿記録は専用操作）
    const want = patch.status;
    if (want && want !== prev.status) {
      const editable = ["idea", "drafting", "review", "archived"] as const;
      const allowed =
        prev.status === "posted"
          ? false
          : prev.status === "approved"
            ? want === "archived"
            : (editable as readonly string[]).includes(want);
      if (allowed) next.status = want;
      // 状態だけを変える要求なら、許されない遷移はエラーとして返す（本文の保存に付いてきた古い状態は無視する）
      else if (Object.keys(patch).length === 1) throw new StoreError(`「${prev.status}」から「${want}」へは変更できません`, 409);
    }
    // 承認後に本文を変えたら承認を外す（承認した版と違うものを出さないため）。却下後に直したら下書きに戻す
    if (prev.status === "approved" && draftChanged(prev, next)) next.status = "review";
    if (prev.status === "rejected" && draftChanged(prev, next)) next.status = "drafting";
    items[idx] = next;
    return next;
  });
}

/** 生成結果などを、その時点の最新の投稿に追記する（読み込みから書き込みまでの間の更新を消さない）。 */
export async function appendToPost(projectId: string, postId: string, fn: (current: Post) => Post): Promise<Post> {
  return mutateCollection(projectId, "posts", (items) => {
    const idx = items.findIndex((p) => p.id === postId);
    if (idx < 0) throw new StoreError("投稿が見つかりません", 404);
    const prev = items[idx];
    if (prev.status === "posted") throw new StoreError("投稿済みの記録がある投稿には追加できません", 409);
    const next = Post.parse({ ...fn(prev), id: prev.id, projectId, decisions: prev.decisions, publication: prev.publication, createdAt: prev.createdAt, updatedAt: nowIso() });
    if (prev.status === "approved" && next.currentDraftId !== prev.currentDraftId) next.status = "review";
    items[idx] = next;
    return next;
  });
}

export async function decidePost(projectId: string, postId: string, decisionInput: unknown): Promise<Post> {
  return mutateCollection(projectId, "posts", (items) => {
    const idx = items.findIndex((p) => p.id === postId);
    if (idx < 0) throw new StoreError("投稿が見つかりません", 404);
    const prev = items[idx];
    if (prev.status === "posted") throw new StoreError("投稿済みの記録がある投稿は承認・却下を変更できません");
    const decision = Decision.parse({ ...(decisionInput as object), at: nowIso() });
    if (!prev.drafts.some((d) => d.id === decision.draftId)) throw new StoreError("下書きが見つかりません");
    const next: Post = {
      ...prev,
      decisions: [...prev.decisions, decision],
      status: decision.kind === "approved" ? "approved" : "rejected",
      currentDraftId: decision.draftId,
      updatedAt: nowIso(),
    };
    items[idx] = next;
    return next;
  });
}

export async function recordPublication(projectId: string, postId: string, input: unknown): Promise<Post> {
  return mutateCollection(projectId, "posts", (items) => {
    const idx = items.findIndex((p) => p.id === postId);
    if (idx < 0) throw new StoreError("投稿が見つかりません", 404);
    const prev = items[idx];
    if (prev.status !== "approved" && prev.status !== "posted") {
      throw new StoreError("承認済みの投稿だけ投稿記録を付けられます");
    }
    const pub = Publication.parse({
      ...(prev.publication ?? {}),
      ...(input as object),
      recordedAt: prev.publication?.recordedAt ?? nowIso(),
      verification: "manual",
    });
    if (pub.url && !/^https:\/\/(x|twitter)\.com\//.test(pub.url)) {
      throw new StoreError("投稿 URL は https://x.com/ で始まる形式で入力してください");
    }
    const next: Post = { ...prev, publication: pub, status: "posted", updatedAt: nowIso() };
    items[idx] = next;
    return next;
  });
}

/** 投稿記録を取り消して承認済みに戻す（誤記録の訂正用）。 */
export async function clearPublication(projectId: string, postId: string): Promise<Post> {
  return mutateCollection(projectId, "posts", (items) => {
    const idx = items.findIndex((p) => p.id === postId);
    if (idx < 0) throw new StoreError("投稿が見つかりません", 404);
    const prev = items[idx];
    const next: Post = { ...prev, publication: undefined, status: "approved", updatedAt: nowIso() };
    items[idx] = next;
    return next;
  });
}

export async function deletePost(projectId: string, postId: string): Promise<void> {
  await mutateCollection(projectId, "posts", (items) => {
    const idx = items.findIndex((p) => p.id === postId);
    if (idx < 0) throw new StoreError("投稿が見つかりません", 404);
    items.splice(idx, 1);
  });
}

/* ------------------------------------------------------------------ */
/* Learnings / Send log                                                */
/* ------------------------------------------------------------------ */

export const listLearnings = (projectId: string) => readCollection(projectId, "learnings");

export async function createLearning(projectId: string, input: unknown): Promise<Learning> {
  return mutateCollection(projectId, "learnings", (items) => {
    const l = Learning.parse({ ...(input as object), id: newId("lrn"), projectId, createdAt: nowIso() });
    items.push(l);
    return l;
  });
}

export async function updateLearning(projectId: string, learningId: string, patch: unknown): Promise<Learning> {
  return mutateCollection(projectId, "learnings", (items) => {
    const idx = items.findIndex((l) => l.id === learningId);
    if (idx < 0) throw new StoreError("学びが見つかりません", 404);
    const prev = items[idx];
    const next = Learning.parse({ ...prev, ...(patch as object), id: prev.id, projectId, createdAt: prev.createdAt });
    items[idx] = next;
    return next;
  });
}

export async function deleteLearning(projectId: string, learningId: string): Promise<void> {
  await mutateCollection(projectId, "learnings", (items) => {
    const idx = items.findIndex((l) => l.id === learningId);
    if (idx >= 0) items.splice(idx, 1);
  });
}

export const listSendLog = (projectId: string) => readCollection(projectId, "sendlog");

export async function appendSendLog(projectId: string, entry: Omit<SendLogEntry, "id" | "at">): Promise<SendLogEntry> {
  return mutateCollection(projectId, "sendlog", (items) => {
    const e = SendLogEntry.parse({ ...entry, id: newId("snd"), at: nowIso() });
    items.unshift(e);
    if (items.length > 500) items.length = 500;
    return e;
  });
}

/* ------------------------------------------------------------------ */
/* Export / Import                                                     */
/* ------------------------------------------------------------------ */

export async function exportBundle(projectId: string): Promise<{ bundle: ProjectBundle; files: Map<string, Buffer> }> {
  const project = await requireProject(projectId);
  const [entries, assets, posts, learnings, sendLog] = await Promise.all([
    listEntries(projectId),
    listAssets(projectId),
    listPosts(projectId),
    listLearnings(projectId),
    listSendLog(projectId),
  ]);
  const files = new Map<string, Buffer>();
  const b = await getBackend();
  for (const a of assets) {
    // 実体が無い素材はメタデータのみ
    const data = await b.getFile(assetKey(projectId, a.storedName)).catch(() => null);
    if (data) files.set(a.storedName, data);
  }
  const bundle = ProjectBundle.parse({
    format: "lore-post-studio/project",
    schemaVersion: SCHEMA_VERSION,
    exportedAt: nowIso(),
    project,
    entries,
    assets,
    posts,
    learnings,
    sendLog,
  });
  return { bundle, files };
}

export type ImportMode = "new" | "replace";

/**
 * 取り込みは常に「プロジェクト単位」。既存プロジェクトへ混ぜることはしない。
 * - new: 新しいプロジェクトとして追加（ID が重なれば新しい ID を振る）
 * - replace: 同じ ID のプロジェクトを置き換える（旧データは trash に退避）
 */
export async function importBundle(raw: unknown, files: Map<string, Buffer>, mode: ImportMode): Promise<Project> {
  await ensureSeeded();
  const parsed = ProjectBundle.safeParse(raw);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    throw new StoreError(`取り込みファイルの形式が不正です: ${issue?.path.join(".")} ${issue?.message ?? ""}`);
  }
  if (parsed.data.schemaVersion > SCHEMA_VERSION) {
    throw new StoreError("新しい版のツールで書き出されたファイルです。ツールを更新してください。");
  }
  const bundle = parsed.data;
  if (mode === "replace") {
    const pid = bundle.project.id;
    if (!SAFE_ID.test(pid)) throw new StoreError("不正なプロジェクト ID です");
    // まず一時置き場に完全に書き出し、成功してから旧データを退避して差し替える
    const staging = `staging/tmp-${Date.now().toString(36)}-${newId("s")}/`;
    await writeBundleTo(staging, bundle, files, pid, bundle.project.name);
    return withLock(pid, async () => {
      const b = await getBackend();
      if (await projectExists(pid)) await b.moveTree(projectPrefix(pid), `trash/${pid}-${Date.now()}/`);
      await b.moveTree(staging, projectPrefix(pid));
      return (await getProject(pid))!;
    });
  }
  return importBundleRaw(bundle, files, {});
}

/** prefix（例 "projects/<id>/"）の下にバンドルを書く。 */
async function writeBundleTo(prefix: string, bundle: ProjectBundle, files: Map<string, Buffer>, pid: string, name: string): Promise<Project> {
  const b = await getBackend();
  const project: Project = { ...bundle.project, id: pid, name, updatedAt: nowIso() };
  const re = <T extends { projectId: string }>(xs: T[]) => xs.map((x) => ({ ...x, projectId: pid }));
  const assets = re(bundle.assets);
  for (const a of assets) {
    const buf = files.get(a.storedName);
    if (!buf) continue;
    await b.putFile(`${prefix}assets/${a.storedName}`, buf, a.mime);
  }
  // 検証してから書く（途中で形式エラーになって中途半端に書かれないように）
  const docs: [string, unknown][] = [
    ["entries.json", z.array(Entry).parse(re(bundle.entries))],
    ["assets.json", z.array(Asset).parse(assets)],
    ["posts.json", z.array(Post).parse(re(bundle.posts))],
    ["learnings.json", z.array(Learning).parse(re(bundle.learnings))],
    ["sendlog.json", z.array(SendLogEntry).parse(bundle.sendLog ?? [])],
    ["project.json", Project.parse(project)],
  ];
  // project.json は最後に書く（一覧に出るのは全部そろってから）
  for (const [n, v] of docs) await b.writeDoc(`${prefix}${n}`, v);
  return project;
}

async function importBundleRaw(bundle: ProjectBundle, files: Map<string, Buffer>, opts: { forceId?: string }): Promise<Project> {
  let pid = opts.forceId ?? bundle.project.id;
  let name = bundle.project.name;
  if (!opts.forceId && (!SAFE_ID.test(pid) || (await projectExists(pid)))) {
    pid = newId("prj");
    name = `${name}（取り込み）`;
  }
  return withLock(pid, () => writeBundleTo(projectPrefix(pid), bundle, files, pid, name));
}

/** サンプルプロジェクトを初期状態に戻す（Wylls など他のプロジェクトには触れない）。 */
export async function resetSampleProject(): Promise<Project> {
  const { buildSampleBundle } = await import("./seed");
  const sample = buildSampleBundle();
  if (await projectExists(sample.project.id)) await deleteProject(sample.project.id);
  return importBundleRaw(sample, new Map(), { forceId: sample.project.id });
}


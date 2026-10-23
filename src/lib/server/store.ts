/**
 * ローカル JSON ストア。
 *
 * data/
 *   projects/<projectId>/
 *     project.json  entries.json  assets.json  posts.json  learnings.json  sendlog.json
 *     assets/<storedName>
 *   trash/          削除・置換前の退避先（自動では消さない）
 *   .seeded         初回シード済みの印
 *
 * プロジェクト間でファイルを共有しないことで、設定の混入を構造的に防ぐ。
 */
import { promises as fs } from "node:fs";
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

export class StoreError extends Error {
  constructor(
    message: string,
    public status: number = 400,
  ) {
    super(message);
  }
}

export function dataDir(): string {
  return path.resolve(process.env.DATA_DIR || path.join(process.cwd(), "data"));
}

const SAFE_ID = /^[A-Za-z0-9_-]{1,64}$/;

function assertSafeId(value: string, what = "id"): void {
  if (!SAFE_ID.test(value)) throw new StoreError(`不正な ${what} です`, 400);
}

function projectDir(projectId: string): string {
  assertSafeId(projectId, "projectId");
  return path.join(dataDir(), "projects", projectId);
}

async function exists(p: string): Promise<boolean> {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

async function readJson<T>(file: string, schema: z.ZodType<T>, fallback: T): Promise<T> {
  let raw: string;
  try {
    raw = await fs.readFile(file, "utf8");
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return fallback;
    throw e;
  }
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    throw new StoreError(`保存データが壊れています（JSON として読めません）: ${path.relative(dataDir(), file)}`, 500);
  }
  const parsed = schema.safeParse(json);
  if (!parsed.success) {
    throw new StoreError(`保存データの形式が不正です: ${path.basename(file)}: ${parsed.error.issues[0]?.message ?? ""}`, 500);
  }
  return parsed.data;
}

/** 一時ファイルに書いてから rename する（途中で落ちても壊れたファイルを残さない）。 */
async function writeJson(file: string, value: unknown): Promise<void> {
  await fs.mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(value, null, 2) + "\n", "utf8");
  await fs.rename(tmp, file);
}

/* 直列化: 同じプロジェクトへの書き込みは順番に処理する。 */
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
  const file = path.join(projectDir(projectId), `${name}.json`);
  return readJson(file, COLLECTION_SCHEMA[name] as unknown as z.ZodType<CollectionType[K][]>, []);
}

async function writeCollection<K extends CollectionName>(
  projectId: string,
  name: K,
  items: CollectionType[K][],
): Promise<void> {
  const schema = COLLECTION_SCHEMA[name] as unknown as z.ZodType<CollectionType[K][]>;
  const checked = schema.parse(items);
  await writeJson(path.join(projectDir(projectId), `${name}.json`), checked);
}

async function mutateCollection<K extends CollectionName, R>(
  projectId: string,
  name: K,
  fn: (items: CollectionType[K][]) => R | Promise<R>,
): Promise<R> {
  return withLock(projectId, async () => {
    const items = await readCollection(projectId, name);
    const result = await fn(items);
    await writeCollection(projectId, name, items);
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
      const marker = path.join(dataDir(), ".seeded");
      if (await exists(marker)) return;
      const { buildSampleBundle, buildWyllsProject } = await import("./seed");
      await fs.mkdir(path.join(dataDir(), "projects"), { recursive: true });
      if (!(await exists(projectDir("wylls")))) {
        await writeJson(path.join(projectDir("wylls"), "project.json"), buildWyllsProject());
      }
      const sample = buildSampleBundle();
      if (!(await exists(projectDir(sample.project.id)))) {
        await importBundleRaw(sample, new Map(), { forceId: sample.project.id });
      }
      await writeJson(marker, { at: nowIso() });
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
  const root = path.join(dataDir(), "projects");
  let names: string[] = [];
  try {
    names = await fs.readdir(root);
  } catch {
    return [];
  }
  const out: Project[] = [];
  brokenProjects = [];
  for (const n of names) {
    if (!SAFE_ID.test(n)) continue;
    try {
      const p = await readJson(path.join(root, n, "project.json"), Project.nullable(), null);
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
  return readJson(path.join(projectDir(projectId), "project.json"), Project.nullable(), null);
}

async function requireProject(projectId: string): Promise<Project> {
  const p = await getProject(projectId);
  if (!p) throw new StoreError("プロジェクトが見つかりません", 404);
  return p;
}

async function touchProject(projectId: string): Promise<void> {
  const file = path.join(projectDir(projectId), "project.json");
  const p = await readJson(file, Project.nullable(), null);
  if (p) await writeJson(file, { ...p, updatedAt: nowIso() });
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
  await writeJson(path.join(projectDir(project.id), "project.json"), project);
  return project;
}

export async function updateProject(projectId: string, patch: Partial<Pick<Project, "name" | "description" | "settings">>): Promise<Project> {
  return withLock(projectId, async () => {
    const p = await requireProject(projectId);
    const next = Project.parse({ ...p, ...patch, id: p.id, kind: p.kind, updatedAt: nowIso() });
    await writeJson(path.join(projectDir(projectId), "project.json"), next);
    return next;
  });
}

/** 削除は trash への移動（復元可能）。 */
export async function deleteProject(projectId: string): Promise<void> {
  await withLock(projectId, async () => {
    await requireProject(projectId);
    const trash = path.join(dataDir(), "trash");
    await fs.mkdir(trash, { recursive: true });
    await fs.rename(projectDir(projectId), path.join(trash, `${projectId}-${Date.now()}`));
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

const ALLOWED_MIME = new Set<string>(AssetMime.options);
export const MAX_ASSET_BYTES = 200 * 1024 * 1024;

function extFor(mime: string, filename: string): string {
  const fromName = path.extname(filename).toLowerCase().replace(/[^a-z0-9.]/g, "");
  if (fromName && fromName.length <= 6) return fromName;
  return { "image/png": ".png", "image/jpeg": ".jpg", "image/gif": ".gif", "image/webp": ".webp", "video/mp4": ".mp4", "video/quicktime": ".mov" }[mime] ?? ".bin";
}

export async function createAsset(projectId: string, file: { name: string; type: string; data: Buffer }, meta: Partial<Asset>): Promise<Asset> {
  if (!ALLOWED_MIME.has(file.type)) throw new StoreError(`未対応の形式です: ${file.type || "不明"}（PNG/JPEG/GIF/WebP/MP4/MOV）`);
  if (file.data.byteLength > MAX_ASSET_BYTES) throw new StoreError("ファイルが大きすぎます（200MB まで）");
  return mutateCollection(projectId, "assets", async (items) => {
    const now = nowIso();
    const assetId = newId("ast");
    const storedName = `${assetId}${extFor(file.type, file.name)}`;
    // 先に記録を検証してから書く（検証に失敗したときにファイルだけ残らないように）
    const asset = Asset.parse({
      ...meta,
      id: assetId,
      projectId,
      filename: file.name.slice(0, 200),
      storedName,
      mime: file.type,
      size: file.data.byteLength,
      title: meta.title || file.name,
      createdAt: now,
      updatedAt: now,
    });
    await fs.mkdir(path.join(projectDir(projectId), "assets"), { recursive: true });
    await fs.writeFile(path.join(projectDir(projectId), "assets", storedName), file.data);
    items.push(asset);
    return asset;
  });
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
  await mutateCollection(projectId, "assets", async (items) => {
    const idx = items.findIndex((a) => a.id === assetId);
    if (idx < 0) throw new StoreError("素材が見つかりません", 404);
    const [a] = items.splice(idx, 1);
    const trash = path.join(dataDir(), "trash", `${projectId}-assets`);
    await fs.mkdir(trash, { recursive: true });
    await fs.rename(path.join(projectDir(projectId), "assets", a.storedName), path.join(trash, a.storedName)).catch(() => undefined);
  });
}

export async function readAssetFile(projectId: string, assetId: string): Promise<{ asset: Asset; data: Buffer }> {
  const assets = await listAssets(projectId);
  const asset = assets.find((a) => a.id === assetId);
  if (!asset) throw new StoreError("素材が見つかりません", 404);
  assertSafeId(asset.storedName.replace(/\.[a-z0-9]+$/i, ""), "storedName");
  const data = await fs.readFile(path.join(projectDir(projectId), "assets", asset.storedName));
  return { asset, data };
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
  for (const a of assets) {
    try {
      files.set(a.storedName, await fs.readFile(path.join(projectDir(projectId), "assets", a.storedName)));
    } catch {
      /* 実体が無い素材はメタデータのみ */
    }
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
    // まず一時フォルダに完全に書き出し、成功してから旧データを退避して差し替える
    const tmpId = `tmp-${Date.now().toString(36)}`;
    await writeBundleTo(path.join(dataDir(), "staging", tmpId), bundle, files, pid, bundle.project.name);
    return withLock(pid, async () => {
      const dir = projectDir(pid);
      if (await exists(dir)) {
        const trash = path.join(dataDir(), "trash");
        await fs.mkdir(trash, { recursive: true });
        await fs.rename(dir, path.join(trash, `${pid}-${Date.now()}`));
      }
      await fs.rename(path.join(dataDir(), "staging", tmpId), dir);
      return (await getProject(pid))!;
    });
  }
  return importBundleRaw(bundle, files, {});
}

async function writeBundleTo(dir: string, bundle: ProjectBundle, files: Map<string, Buffer>, pid: string, name: string): Promise<Project> {
  await fs.mkdir(path.join(dir, "assets"), { recursive: true });
  const project: Project = { ...bundle.project, id: pid, name, updatedAt: nowIso() };
  const re = <T extends { projectId: string }>(xs: T[]) => xs.map((x) => ({ ...x, projectId: pid }));
  const assets = re(bundle.assets);
  for (const a of assets) {
    const buf = files.get(a.storedName);
    if (!buf) continue;
    await fs.writeFile(path.join(dir, "assets", a.storedName), buf);
  }
  await writeJson(path.join(dir, "project.json"), Project.parse(project));
  await writeJson(path.join(dir, "entries.json"), z.array(Entry).parse(re(bundle.entries)));
  await writeJson(path.join(dir, "assets.json"), z.array(Asset).parse(assets));
  await writeJson(path.join(dir, "posts.json"), z.array(Post).parse(re(bundle.posts)));
  await writeJson(path.join(dir, "learnings.json"), z.array(Learning).parse(re(bundle.learnings)));
  await writeJson(path.join(dir, "sendlog.json"), z.array(SendLogEntry).parse(bundle.sendLog ?? []));
  return project;
}

async function importBundleRaw(bundle: ProjectBundle, files: Map<string, Buffer>, opts: { forceId?: string }): Promise<Project> {
  let pid = opts.forceId ?? bundle.project.id;
  let name = bundle.project.name;
  if (!opts.forceId && (!SAFE_ID.test(pid) || (await exists(projectDir(pid))))) {
    pid = newId("prj");
    name = `${name}（取り込み）`;
  }
  return withLock(pid, () => writeBundleTo(projectDir(pid), bundle, files, pid, name));
}

/** サンプルプロジェクトを初期状態に戻す（Wylls など他のプロジェクトには触れない）。 */
export async function resetSampleProject(): Promise<Project> {
  const { buildSampleBundle } = await import("./seed");
  const sample = buildSampleBundle();
  if (await exists(projectDir(sample.project.id))) await deleteProject(sample.project.id);
  return importBundleRaw(sample, new Map(), { forceId: sample.project.id });
}


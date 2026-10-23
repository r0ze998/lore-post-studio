import { buildSampleBundle } from "@/lib/server/seed";
import { runChecks, type CheckContext, type CheckReport } from "@/lib/checks/engine";
import { Post, type DraftVersion, type Segment } from "@/lib/domain/schema";

export function sampleCtx(): CheckContext {
  const b = buildSampleBundle();
  return { project: b.project, entries: b.entries, posts: b.posts, learnings: b.learnings, assets: b.assets };
}

let n = 0;
export function makePost(
  segments: (Partial<Segment> & { text: string })[],
  opts: { type?: Post["type"]; language?: "ja" | "en"; brief?: Partial<Post["brief"]>; options?: Partial<Post["options"]> } = {},
): { post: Post; draft: DraftVersion } {
  n++;
  const draft: DraftVersion = {
    id: `drf_t${n}`,
    createdAt: "2026-10-22T00:00:00.000Z",
    origin: "manual",
    generator: "",
    language: opts.language ?? "ja",
    creativeNotes: "",
    segments: segments.map((s, i) => ({ id: `seg_t${n}_${i}`, voice: "developer", jaGloss: "", assetIds: [], provenance: [], ...s })),
  };
  const post = Post.parse({
    id: `pst_t${n}`,
    projectId: "sample-saltroad",
    type: opts.type ?? "devlog",
    title: "テスト",
    status: "drafting",
    brief: { language: opts.language ?? "ja", ...(opts.brief ?? {}) },
    options: { emoji: "none", maxEmoji: 0, maxHashtags: 1, hashtags: ["#塩の街道"], cta: "none", ctaText: "", ...(opts.options ?? {}) },
    drafts: [draft],
    currentDraftId: draft.id,
    createdAt: "2026-10-22T00:00:00.000Z",
    updatedAt: "2026-10-22T00:00:00.000Z",
  });
  return { post, draft };
}

export function check(segments: Parameters<typeof makePost>[0], opts: Parameters<typeof makePost>[1] = {}, ctx = sampleCtx()): CheckReport {
  const { post, draft } = makePost(segments, opts);
  return runChecks({ ...ctx, posts: [...ctx.posts, post] }, post, draft);
}

export function rules(r: CheckReport): string[] {
  return r.findings.map((f) => `${f.severity}:${f.ruleId}`);
}

export function has(r: CheckReport, ruleId: string, severity?: string) {
  return r.findings.some((f) => f.ruleId === ruleId && (!severity || f.severity === severity));
}

export function find(r: CheckReport, ruleId: string) {
  return r.findings.filter((f) => f.ruleId === ruleId);
}

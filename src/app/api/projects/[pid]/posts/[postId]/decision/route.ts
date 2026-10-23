import { z } from "zod";
import { handle, type RouteCtx } from "@/lib/server/http";
import * as store from "@/lib/server/store";
import { StoreError } from "@/lib/server/store";
import { runChecks, unacknowledgedErrors } from "@/lib/checks/engine";
import { Acknowledgement } from "@/lib/domain/schema";

export const dynamic = "force-dynamic";

const Body = z.object({
  kind: z.enum(["approved", "rejected"]),
  reason: z.string().trim().min(1, "理由は必須です"),
  tags: z.array(z.string()).default([]),
  draftId: z.string(),
  acknowledgements: z.array(Acknowledgement.omit({ at: true }).extend({ at: z.string().optional() })).default([]),
});

/**
 * 承認・却下（理由必須）。
 * 承認の場合は、サーバー側でも検査し直し、「要修正」がすべて修正済みか理由付きで確認済みであることを確かめる。
 * 検査結果の件数もサーバーで数えたものを記録する。
 */
export async function POST(req: Request, { params }: RouteCtx<{ pid: string; postId: string }>) {
  return handle(async () => {
    const { pid, postId } = await params;
    const body = Body.parse(await req.json());
    const project = await store.getProject(pid);
    if (!project) throw new StoreError("プロジェクトが見つかりません", 404);
    const [entries, posts, learnings, assets] = await Promise.all([store.listEntries(pid), store.listPosts(pid), store.listLearnings(pid), store.listAssets(pid)]);
    const post = posts.find((p) => p.id === postId);
    if (!post) throw new StoreError("投稿が見つかりません", 404);
    const draft = post.drafts.find((d) => d.id === body.draftId);
    if (!draft) throw new StoreError("下書きが見つかりません");
    const report = runChecks({ project, entries, posts, learnings, assets }, post, draft);
    const now = new Date().toISOString();
    const acks = body.acknowledgements
      .filter((a) => report.findings.some((f) => f.key === a.findingKey))
      .map((a) => ({ findingKey: a.findingKey, reason: a.reason, at: a.at ?? now }));
    if (body.kind === "approved") {
      if (draft.segments.every((s) => !s.text.trim())) throw new StoreError("本文が空です");
      const blocking = unacknowledgedErrors(report, acks);
      if (blocking.length) {
        throw new StoreError(`未確認の「要修正」が ${blocking.length} 件あります（${blocking.slice(0, 3).map((f) => f.title).join("、")}）`, 409);
      }
    }
    return store.decidePost(pid, postId, {
      kind: body.kind,
      reason: body.reason,
      tags: body.tags,
      draftId: body.draftId,
      acknowledgements: acks,
      checkSummary: { errors: report.counts.error, warnings: report.counts.warning, infos: report.counts.info },
    });
  });
}

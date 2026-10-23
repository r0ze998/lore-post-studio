import { z } from "zod";
import { handle, type RouteCtx } from "@/lib/server/http";
import * as store from "@/lib/server/store";
import { StoreError } from "@/lib/server/store";
import { ProjectSettings } from "@/lib/domain/schema";

export const dynamic = "force-dynamic";

/** プロジェクトのデータ一式（このプロジェクトの分だけ）。 */
export async function GET(_req: Request, { params }: RouteCtx<{ pid: string }>) {
  return handle(async () => {
    const { pid } = await params;
    const project = await store.getProject(pid);
    if (!project) throw new StoreError("プロジェクトが見つかりません", 404);
    const [entries, assets, posts, learnings, sendLog] = await Promise.all([
      store.listEntries(pid),
      store.listAssets(pid),
      store.listPosts(pid),
      store.listLearnings(pid),
      store.listSendLog(pid),
    ]);
    return { project, entries, assets, posts, learnings, sendLog };
  });
}

const PatchBody = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  description: z.string().max(2000).optional(),
  settings: ProjectSettings.optional(),
});

export async function PATCH(req: Request, { params }: RouteCtx<{ pid: string }>) {
  return handle(async () => {
    const { pid } = await params;
    return store.updateProject(pid, PatchBody.parse(await req.json()));
  });
}

export async function DELETE(_req: Request, { params }: RouteCtx<{ pid: string }>) {
  return handle(async () => {
    const { pid } = await params;
    await store.deleteProject(pid);
    return { ok: true };
  });
}

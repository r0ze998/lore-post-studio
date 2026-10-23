import { handle, type RouteCtx } from "@/lib/server/http";
import * as store from "@/lib/server/store";

export const dynamic = "force-dynamic";

export async function PATCH(req: Request, { params }: RouteCtx<{ pid: string; postId: string }>) {
  return handle(async () => {
    const { pid, postId } = await params;
    const body = (await req.json()) as { post: unknown; expectedUpdatedAt?: string };
    return store.updatePost(pid, postId, body.post, body.expectedUpdatedAt);
  });
}

export async function DELETE(_req: Request, { params }: RouteCtx<{ pid: string; postId: string }>) {
  return handle(async () => {
    const { pid, postId } = await params;
    await store.deletePost(pid, postId);
    return { ok: true };
  });
}

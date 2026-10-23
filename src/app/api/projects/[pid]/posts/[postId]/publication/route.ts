import { handle, type RouteCtx } from "@/lib/server/http";
import * as store from "@/lib/server/store";

export const dynamic = "force-dynamic";

/** 投稿記録（手動）。このツールは X に接続しないため、記録は本人の申告として保存する。 */
export async function PUT(req: Request, { params }: RouteCtx<{ pid: string; postId: string }>) {
  return handle(async () => {
    const { pid, postId } = await params;
    return store.recordPublication(pid, postId, await req.json());
  });
}

export async function DELETE(_req: Request, { params }: RouteCtx<{ pid: string; postId: string }>) {
  return handle(async () => {
    const { pid, postId } = await params;
    return store.clearPublication(pid, postId);
  });
}

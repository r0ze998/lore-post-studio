import { handle, type RouteCtx } from "@/lib/server/http";
import * as store from "@/lib/server/store";

export const dynamic = "force-dynamic";

/** 承認・却下（理由必須）。 */
export async function POST(req: Request, { params }: RouteCtx<{ pid: string; postId: string }>) {
  return handle(async () => {
    const { pid, postId } = await params;
    return store.decidePost(pid, postId, await req.json());
  });
}

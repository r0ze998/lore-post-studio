import { handle, type RouteCtx } from "@/lib/server/http";
import * as store from "@/lib/server/store";

export const dynamic = "force-dynamic";

export async function POST(req: Request, { params }: RouteCtx<{ pid: string }>) {
  return handle(async () => {
    const { pid } = await params;
    return store.createPost(pid, await req.json());
  }, 201);
}

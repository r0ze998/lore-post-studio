import { handle, type RouteCtx } from "@/lib/server/http";
import * as store from "@/lib/server/store";

export const dynamic = "force-dynamic";

export async function PATCH(req: Request, { params }: RouteCtx<{ pid: string; lid: string }>) {
  return handle(async () => {
    const { pid, lid } = await params;
    return store.updateLearning(pid, lid, await req.json());
  });
}

export async function DELETE(_req: Request, { params }: RouteCtx<{ pid: string; lid: string }>) {
  return handle(async () => {
    const { pid, lid } = await params;
    await store.deleteLearning(pid, lid);
    return { ok: true };
  });
}

import { handle, type RouteCtx } from "@/lib/server/http";
import * as store from "@/lib/server/store";

export const dynamic = "force-dynamic";

export async function PATCH(req: Request, { params }: RouteCtx<{ pid: string; eid: string }>) {
  return handle(async () => {
    const { pid, eid } = await params;
    const body = (await req.json()) as { entry: unknown; note?: string };
    return store.updateEntry(pid, eid, body.entry, typeof body.note === "string" ? body.note.slice(0, 500) : "");
  });
}

export async function DELETE(_req: Request, { params }: RouteCtx<{ pid: string; eid: string }>) {
  return handle(async () => {
    const { pid, eid } = await params;
    await store.deleteEntry(pid, eid);
    return { ok: true };
  });
}

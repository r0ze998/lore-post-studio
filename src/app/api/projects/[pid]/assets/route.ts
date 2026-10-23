import { handle, type RouteCtx } from "@/lib/server/http";
import * as store from "@/lib/server/store";
import { StoreError } from "@/lib/server/store";

export const dynamic = "force-dynamic";

export async function POST(req: Request, { params }: RouteCtx<{ pid: string }>) {
  return handle(async () => {
    const { pid } = await params;
    const form = await req.formData();
    const files = form.getAll("file").filter((f): f is File => typeof f !== "string");
    if (!files.length) throw new StoreError("ファイルがありません");
    const created = [];
    for (const f of files) {
      created.push(await store.createAsset(pid, { name: f.name, type: f.type, data: Buffer.from(await f.arrayBuffer()) }, { status: "proposed" }));
    }
    return { assets: created };
  }, 201);
}

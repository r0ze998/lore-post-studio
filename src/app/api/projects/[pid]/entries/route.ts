import { z } from "zod";
import { handle, type RouteCtx } from "@/lib/server/http";
import * as store from "@/lib/server/store";

export const dynamic = "force-dynamic";

export async function POST(req: Request, { params }: RouteCtx<{ pid: string }>) {
  return handle(async () => {
    const { pid } = await params;
    return store.createEntry(pid, await req.json());
  }, 201);
}

const ImportBody = z.object({ entries: z.array(z.record(z.string(), z.unknown())).min(1).max(500), sourceLabel: z.string().max(200).default("取り込み資料") });

/** 資料の一括取り込み（常に「提案」）。 */
export async function PUT(req: Request, { params }: RouteCtx<{ pid: string }>) {
  return handle(async () => {
    const { pid } = await params;
    const body = ImportBody.parse(await req.json());
    return { entries: await store.importEntriesAsProposed(pid, body.entries, body.sourceLabel) };
  });
}

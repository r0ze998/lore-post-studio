import { z } from "zod";
import { handle, type RouteCtx } from "@/lib/server/http";
import * as store from "@/lib/server/store";

export const dynamic = "force-dynamic";

const Prepare = z.object({ action: z.literal("prepare"), name: z.string().min(1).max(300), type: z.string(), size: z.number().int().nonnegative() });
const Complete = z.object({ action: z.literal("complete"), assetId: z.string(), storedName: z.string(), name: z.string().min(1).max(300), type: z.string() });

/**
 * Web 版の素材アップロード（ブラウザ → 保存先へ直接）。
 * prepare: 送り先の URL を発行 / complete: 届いたファイルを確認して一覧に登録
 */
export async function POST(req: Request, { params }: RouteCtx<{ pid: string }>) {
  return handle(async () => {
    const { pid } = await params;
    const body = await req.json();
    if (body?.action === "prepare") return store.prepareAssetUpload(pid, Prepare.parse(body));
    return store.completeAssetUpload(pid, Complete.parse(body));
  });
}

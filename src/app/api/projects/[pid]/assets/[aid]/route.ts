import { handle, errorResponse, type RouteCtx } from "@/lib/server/http";
import * as store from "@/lib/server/store";

export const dynamic = "force-dynamic";

export async function GET(req: Request, { params }: RouteCtx<{ pid: string; aid: string }>) {
  try {
    const { pid, aid } = await params;
    const download = new URL(req.url).searchParams.get("download") === "1";
    // Web 版：保存先の短時間有効な URL へ転送（サーバーを経由しないので大きなファイルも扱える）
    const signed = await store.assetDownloadUrl(pid, aid, download);
    if (signed) return Response.redirect(signed, 302);
    const { asset, data } = await store.readAssetFile(pid, aid);
    return new Response(new Uint8Array(data), {
      headers: {
        "Content-Type": asset.mime,
        "Content-Length": String(data.length),
        "Cache-Control": "private, max-age=60",
        "X-Content-Type-Options": "nosniff",
        // 素材が文書として開かれてもスクリプトを動かさない
        "Content-Security-Policy": "sandbox; default-src 'none'; img-src 'self'; media-src 'self'",
        ...(download ? { "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(asset.filename)}` } : {}),
      },
    });
  } catch (e) {
    return errorResponse(e);
  }
}

export async function PATCH(req: Request, { params }: RouteCtx<{ pid: string; aid: string }>) {
  return handle(async () => {
    const { pid, aid } = await params;
    return store.updateAsset(pid, aid, await req.json());
  });
}

export async function DELETE(_req: Request, { params }: RouteCtx<{ pid: string; aid: string }>) {
  return handle(async () => {
    const { pid, aid } = await params;
    await store.deleteAsset(pid, aid);
    return { ok: true };
  });
}

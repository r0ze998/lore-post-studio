import JSZip from "jszip";
import { errorResponse, type RouteCtx } from "@/lib/server/http";
import * as store from "@/lib/server/store";

export const dynamic = "force-dynamic";

/** プロジェクト一式（正本・素材・投稿・学び・送信記録）を zip で書き出す。 */
export async function GET(_req: Request, { params }: RouteCtx<{ pid: string }>) {
  try {
    const { pid } = await params;
    const { bundle, files } = await store.exportBundle(pid);
    const zip = new JSZip();
    zip.file("project.json", JSON.stringify(bundle, null, 2));
    zip.file(
      "README.txt",
      `Lore Post Studio のプロジェクト書き出しです。\nプロジェクト: ${bundle.project.name}\n書き出し日時: ${bundle.exportedAt}\n取り込みはトップ画面の「取り込み」から行えます（既存プロジェクトには混ぜず、別のプロジェクトとして追加されます）。\n`,
    );
    for (const [name, buf] of files) zip.file(`assets/${name}`, buf);
    const out = await zip.generateAsync({ type: "uint8array", compression: "DEFLATE" });
    const date = bundle.exportedAt.slice(0, 10);
    return new Response(out as BodyInit, {
      headers: {
        "Content-Type": "application/zip",
        "Content-Disposition": `attachment; filename="project-${pid}-${date}.zip"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (e) {
    return errorResponse(e);
  }
}

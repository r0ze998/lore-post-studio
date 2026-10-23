import JSZip from "jszip";
import { errorResponse, type RouteCtx } from "@/lib/server/http";
import * as store from "@/lib/server/store";
import { StoreError } from "@/lib/server/store";
import { altTextFile, postMarkdown, threadPlainText } from "@/lib/domain/exporting";
import { currentDraft } from "@/lib/checks/engine";

export const dynamic = "force-dynamic";

/** 投稿の本文と素材を zip で書き出す（X へは送信しない）。 */
export async function GET(_req: Request, { params }: RouteCtx<{ pid: string; postId: string }>) {
  try {
    const { pid, postId } = await params;
    const project = await store.getProject(pid);
    if (!project) throw new StoreError("プロジェクトが見つかりません", 404);
    const post = await store.getPost(pid, postId);
    const assets = await store.listAssets(pid);
    const d = currentDraft(post);
    if (!d) throw new StoreError("下書きがありません");
    const zip = new JSZip();
    zip.file("post.txt", threadPlainText(d));
    d.segments.forEach((s, i) => zip.file(`segments/${String(i + 1).padStart(2, "0")}.txt`, s.text));
    zip.file("post.md", postMarkdown(project, post, d, assets));
    zip.file("alt-text.txt", altTextFile(d, assets));
    let n = 0;
    for (const [i, s] of d.segments.entries()) {
      for (const id of s.assetIds) {
        try {
          const { asset, data } = await store.readAssetFile(pid, id);
          n++;
          zip.file(`assets/${String(i + 1).padStart(2, "0")}-${n}-${asset.filename.replace(/[\\/:*?"<>|]/g, "_")}`, data);
        } catch {
          /* 見つからない素材は検査で指摘済み */
        }
      }
    }
    const out = await zip.generateAsync({ type: "uint8array", compression: "DEFLATE" });
    return new Response(out as BodyInit, {
      headers: {
        "Content-Type": "application/zip",
        "Content-Disposition": `attachment; filename="post-${postId}.zip"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (e) {
    return errorResponse(e);
  }
}

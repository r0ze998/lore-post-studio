import JSZip from "jszip";
import { handle } from "@/lib/server/http";
import * as store from "@/lib/server/store";
import { StoreError } from "@/lib/server/store";

export const dynamic = "force-dynamic";

/** プロジェクトの取り込み（zip または json）。既存プロジェクトへは混ぜない。 */
export async function POST(req: Request) {
  return handle(async () => {
    let buf: Buffer;
    let mode: "new" | "replace";
    let filename = "";
    if ((req.headers.get("content-type") ?? "").includes("application/json")) {
      // Web 版：先に保存先へ直接送った zip を受け取る
      const body = (await req.json()) as { transferKey?: string; mode?: string };
      mode = body.mode === "replace" ? "replace" : "new";
      buf = await store.takeTransfer(String(body.transferKey ?? ""));
    } else {
      const form = await req.formData();
      const file = form.get("file");
      mode = form.get("mode") === "replace" ? "replace" : "new";
      if (!file || typeof file === "string") throw new StoreError("ファイルがありません");
      filename = file.name;
      buf = Buffer.from(await file.arrayBuffer());
    }
    const files = new Map<string, Buffer>();
    let raw: unknown;
    if (filename.endsWith(".zip") || buf.subarray(0, 2).toString() === "PK") {
      let zip: JSZip;
      try {
        zip = await JSZip.loadAsync(buf);
      } catch {
        throw new StoreError("zip を開けませんでした");
      }
      const manifest = zip.file("project.json");
      if (!manifest) throw new StoreError("zip に project.json がありません");
      raw = JSON.parse(await manifest.async("string"));
      for (const [name, entry] of Object.entries(zip.files)) {
        if (entry.dir || !name.startsWith("assets/")) continue;
        const base = name.slice("assets/".length);
        if (!base || base.includes("/")) continue;
        files.set(base, await entry.async("nodebuffer"));
      }
    } else {
      raw = JSON.parse(buf.toString("utf8"));
    }
    return store.importBundle(raw, files, mode);
  });
}

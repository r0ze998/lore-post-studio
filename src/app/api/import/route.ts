import JSZip from "jszip";
import { handle } from "@/lib/server/http";
import * as store from "@/lib/server/store";
import { StoreError } from "@/lib/server/store";

export const dynamic = "force-dynamic";

/** プロジェクトの取り込み（zip または json）。既存プロジェクトへは混ぜない。 */
export async function POST(req: Request) {
  return handle(async () => {
    const form = await req.formData();
    const file = form.get("file");
    const mode = form.get("mode") === "replace" ? "replace" : "new";
    if (!file || typeof file === "string") throw new StoreError("ファイルがありません");
    const buf = Buffer.from(await file.arrayBuffer());
    const files = new Map<string, Buffer>();
    let raw: unknown;
    if (file.name.endsWith(".zip") || buf.subarray(0, 2).toString() === "PK") {
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

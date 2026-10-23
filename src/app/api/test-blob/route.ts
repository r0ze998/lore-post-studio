/**
 * E2E テスト専用の受け渡し口（TEST_DIRECT_TRANSFER=1 のときだけ動く。Vercel 上では常に 404）。
 * Supabase Storage の署名付き URL と同じ形式（FormData の PUT、Content-Disposition 付きの GET）を受け付ける。
 */
import { getBackend, testDirectTransferEnabled } from "@/lib/server/backend";

export const dynamic = "force-dynamic";

const KEY = /^(projects\/[A-Za-z0-9_-]+\/assets|transfers\/(imports|exports)\/[A-Za-z0-9_-]+)\/[A-Za-z0-9._-]+$/;

function check(req: Request, op: string): string | Response {
  if (!testDirectTransferEnabled()) return new Response("not found", { status: 404 });
  const url = new URL(req.url);
  const key = url.searchParams.get("key") ?? "";
  if (url.searchParams.get("op") !== op || !KEY.test(key)) return new Response("bad key", { status: 400 });
  return key;
}

export async function PUT(req: Request) {
  const key = check(req, "up");
  if (key instanceof Response) return key;
  const b = await getBackend();
  if ((await b.fileSize(key)) !== null && req.headers.get("x-upsert") !== "true") return new Response("exists", { status: 409 });
  const form = await req.formData();
  const file = form.get("");
  if (!file || typeof file === "string") return new Response("no file", { status: 400 });
  await b.putFile(key, Buffer.from(await file.arrayBuffer()), file.type);
  return Response.json({ Key: key });
}

export async function GET(req: Request) {
  const key = check(req, "down");
  if (key instanceof Response) return key;
  const data = await (await getBackend()).getFile(key);
  if (!data) return new Response("not found", { status: 404 });
  const name = new URL(req.url).searchParams.get("name");
  return new Response(new Uint8Array(data), {
    headers: {
      "Content-Type": ({ png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", webp: "image/webp", mp4: "video/mp4", mov: "video/quicktime" } as Record<string, string>)[key.split(".").pop()!.toLowerCase()] ?? "application/octet-stream",
      ...(name ? { "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(name)}` } : {}),
    },
  });
}

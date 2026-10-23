import { handle, type RouteCtx } from "@/lib/server/http";
import { GenerateRequest, handleGenerate } from "@/lib/server/generate";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function POST(req: Request, { params }: RouteCtx<{ pid: string }>) {
  return handle(async () => {
    const { pid } = await params;
    return handleGenerate(pid, GenerateRequest.parse(await req.json()));
  });
}

import { handle } from "@/lib/server/http";
import { resetSampleProject } from "@/lib/server/store";

export const dynamic = "force-dynamic";

export async function POST() {
  return handle(async () => resetSampleProject());
}

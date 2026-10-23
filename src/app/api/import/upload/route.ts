import { handle } from "@/lib/server/http";
import * as store from "@/lib/server/store";

export const dynamic = "force-dynamic";

/** Web 版の取り込み：zip をブラウザから保存先へ直接送るための URL を発行する。 */
export async function POST() {
  return handle(async () => store.stageTransfer("imports", "import.zip"));
}

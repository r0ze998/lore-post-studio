import { handle } from "@/lib/server/http";
import { listProviders } from "@/lib/server/providers";
import { MODEL_PRICES, PRICING_AS_OF } from "@/lib/generation/pricing";
import { dataDir } from "@/lib/server/store";

export const dynamic = "force-dynamic";

/** 提供元の状態。API キーそのものは返さない。 */
export async function GET() {
  return handle(async () => ({
    providers: listProviders(),
    prices: MODEL_PRICES,
    pricingAsOf: PRICING_AS_OF,
    dataDir: dataDir(),
    passcode: !!process.env.APP_PASSCODE,
  }));
}

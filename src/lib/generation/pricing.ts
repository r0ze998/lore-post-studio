/**
 * 費用の概算（参考値）。
 * 料金は Anthropic の公開価格（2026-10-06 時点の資料）に基づく。実際の請求は Anthropic のコンソールで確認すること。
 * トークン数は文字数からの推定で、±50% 程度ずれることがある。
 */

export const PRICING_AS_OF = "2026-10-06";

export const MODEL_PRICES: Record<string, { label: string; inputPerMTok: number; outputPerMTok: number }> = {
  "claude-opus-5-5": { label: "Claude Opus 5.5", inputPerMTok: 4, outputPerMTok: 20 },
  "claude-sonnet-5-5": { label: "Claude Sonnet 5.5", inputPerMTok: 2, outputPerMTok: 10 },
  "claude-haiku-5-5": { label: "Claude Haiku 5.5", inputPerMTok: 0.1, outputPerMTok: 0.5 },
};

export const DEFAULT_MODEL = "claude-opus-5-5";

/** 文字数からの入力トークン推定（日本語は 1 文字 ≈ 1 トークン強、英数字は ≈ 4 文字 1 トークン）。 */
export function estimateTokens(text: string): number {
  let ascii = 0;
  let other = 0;
  for (const ch of text) {
    if (ch.charCodeAt(0) < 128) ascii++;
    else other++;
  }
  return Math.ceil(other * 1.2 + ascii / 3.5);
}

export interface CostEstimate {
  model: string;
  inputTokens: number;
  outputTokensTypical: number;
  outputTokensMax: number;
  usdTypical: number;
  usdMax: number;
  known: boolean;
}

export function estimateCost(model: string, promptText: string, task: "angles" | "draft", maxTokens: number): CostEstimate {
  const p = MODEL_PRICES[model];
  const inputTokens = estimateTokens(promptText);
  // 思考（thinking）分も出力として課金されるため、典型値は多めに見積もる
  const outputTokensTypical = task === "angles" ? 2500 : 4000;
  const usd = (i: number, o: number) => (p ? (i * p.inputPerMTok + o * p.outputPerMTok) / 1_000_000 : 0);
  return {
    model,
    inputTokens,
    outputTokensTypical,
    outputTokensMax: maxTokens,
    usdTypical: usd(inputTokens, outputTokensTypical),
    usdMax: usd(inputTokens, maxTokens),
    known: !!p,
  };
}

export function costOf(model: string, usage: { inputTokens: number; outputTokens: number }): number | undefined {
  const p = MODEL_PRICES[model];
  if (!p) return undefined;
  return (usage.inputTokens * p.inputPerMTok + usage.outputTokens * p.outputPerMTok) / 1_000_000;
}

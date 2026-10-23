/**
 * 生成の提供元（サーバー側）。ここを差し替えればモデルを交換できる。
 *
 * - template : 外部送信なし。正本から確実に言えることだけを埋めた骨組みを作る。
 * - relay    : 手動中継。プロンプトを画面でコピーし、自分で選んだチャット（Claude.ai など）に貼り、結果を貼り戻す。
 *              このツールは何も送信しない（貼り付け先の保存方針はそのサービスに従う）。
 * - anthropic: Anthropic API（従量課金）。ANTHROPIC_API_KEY をサーバーの環境変数で渡す。キーはブラウザに送らない。
 * - mock     : テスト用。ENABLE_MOCK_PROVIDER=1 のときだけ有効。外部送信なし。
 */
import Anthropic from "@anthropic-ai/sdk";
import type { ProviderId, ProviderInfo, PromptPackage } from "@/lib/generation/types";
import { DEFAULT_MODEL, MODEL_PRICES } from "@/lib/generation/pricing";

export function anthropicModel(): string {
  return process.env.ANTHROPIC_MODEL?.trim() || DEFAULT_MODEL;
}

export function listProviders(): ProviderInfo[] {
  const hasKey = !!process.env.ANTHROPIC_API_KEY?.trim();
  const model = anthropicModel();
  const list: ProviderInfo[] = [
    {
      id: "template",
      label: "テンプレート（API 不要）",
      kind: "local",
      available: true,
      reason: "",
      description: "正本から確実に言えることだけを埋め、創作が必要な部分は［穴埋め］で残します。外部には何も送りません。",
    },
    {
      id: "relay",
      label: "手動中継（コピー＆貼り戻し）",
      kind: "manual",
      available: true,
      reason: "",
      description:
        "送る内容を確認してコピーし、自分で選んだチャット（Claude.ai など）に貼り付けます。返ってきた JSON をここに貼り戻します。このツールは送信しません。貼り付け先での保存・学習の扱いはそのサービスの設定に従います。",
    },
    {
      id: "anthropic",
      label: `Anthropic API（${MODEL_PRICES[model]?.label ?? model}・従量課金）`,
      kind: "external",
      available: hasKey,
      reason: hasKey ? "" : "サーバーの環境変数 ANTHROPIC_API_KEY が未設定です（Claude.ai の契約とは別の、API の従量課金が必要です）。",
      description:
        "送信前に、送る資料・概算費用・保存方針を表示します。未公開の項目は既定で送りません。API の入力・出力は Anthropic のデータ保持方針に従って一定期間保存される場合があります（商用 API の既定では学習には使われません。最新の方針は Anthropic の Privacy / Commercial Terms で確認してください）。このツールは送信記録（日時・送った項目 ID・使用量）をローカルに保存します。",
      model,
    },
  ];
  if (process.env.ENABLE_MOCK_PROVIDER === "1") {
    list.push({ id: "mock", label: "モック（テスト用）", kind: "local", available: true, reason: "", description: "固定の結果を返すテスト用の提供元です。" });
  }
  return list;
}

export function providerInfo(id: ProviderId): ProviderInfo | undefined {
  return listProviders().find((p) => p.id === id);
}

/* JSON Schema（構造化出力）。長さ制限などは受け取った後に zod で検証する。 */
const ANGLES_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["angles"],
  properties: {
    angles: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["title", "approach", "why"],
        properties: { title: { type: "string" }, approach: { type: "string" }, why: { type: "string" } },
      },
    },
  },
};

const DRAFT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["segments", "creativeNotes"],
  properties: {
    creativeNotes: { type: "string" },
    segments: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["text", "voice", "jaGloss", "provenance"],
        properties: {
          text: { type: "string" },
          voice: { type: "string", enum: ["in_world", "developer"] },
          jaGloss: { type: "string" },
          provenance: {
            type: "array",
            items: {
              type: "object",
              additionalProperties: false,
              required: ["quote", "basis", "refIds", "note"],
              properties: {
                quote: { type: "string" },
                basis: { type: "string", enum: ["canon", "fact", "invented", "unknown"] },
                refIds: { type: "array", items: { type: "string" } },
                note: { type: "string" },
              },
            },
          },
        },
      },
    },
  },
};

export const ANTHROPIC_MAX_TOKENS = 16000;

export interface RunResult {
  rawText: string;
  json?: unknown;
  model: string;
  usage?: { inputTokens: number; outputTokens: number };
  note?: string;
}

export async function runAnthropic(pkg: PromptPackage): Promise<RunResult> {
  const apiKey = process.env.ANTHROPIC_API_KEY?.trim();
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY が未設定です。");
  const client = new Anthropic({ apiKey, timeout: 180_000, maxRetries: 1 });
  const model = anthropicModel();
  // 安全上の理由でモデルが応答を断った場合に、サーバー側で別モデルへ切り替える（fallbacks: "default"）。
  const response = await client.beta.messages.create({
    model,
    max_tokens: ANTHROPIC_MAX_TOKENS,
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    system: pkg.system,
    messages: [{ role: "user", content: pkg.user }],
    output_config: {
      effort: "medium",
      format: { type: "json_schema", schema: pkg.task === "angles" ? ANGLES_SCHEMA : DRAFT_SCHEMA },
    },
  });
  if (response.stop_reason === "refusal") {
    throw new Error("モデルが応答を断りました（refusal）。資料や指示を見直してください。");
  }
  if (response.stop_reason === "max_tokens") {
    throw new Error("出力が上限で途切れました。セグメント数を減らすか、指示を短くしてください。");
  }
  const text = response.content.flatMap((b) => (b.type === "text" ? [b.text] : [])).join("");
  return {
    rawText: text,
    model: response.model,
    usage: { inputTokens: response.usage.input_tokens, outputTokens: response.usage.output_tokens },
    note: response.model !== model ? `応答は ${response.model} が返しました（フォールバック）。` : undefined,
  };
}

/** テスト用の固定出力。 */
export function runMock(pkg: PromptPackage): RunResult {
  if (pkg.task === "angles") {
    return {
      rawText: JSON.stringify({
        angles: [
          { title: "モック：一場面", approach: "登場人物が一つの行動をする場面を書く。", why: "具体的だから。" },
          { title: "モック：用語を一つ", approach: "用語が使われる瞬間を書く。", why: "世界に入りやすい。" },
        ],
      }),
      model: "mock",
    };
  }
  const firstId = pkg.included[0]?.id ?? "";
  return {
    rawText:
      "```json\n" +
      JSON.stringify({
        segments: [
          {
            text: "モックの下書きです。\n※テスト用の出力",
            voice: "developer",
            jaGloss: "",
            provenance: [
              { quote: "モックの下書き", basis: "invented", refIds: [], note: "" },
              { quote: "存在しない参照", basis: "canon", refIds: ["ent_does_not_exist", firstId].filter(Boolean), note: "" },
            ],
          },
        ],
        creativeNotes: "モック出力",
      }) +
      "\n```",
    model: "mock",
  };
}

/**
 * モデル出力・貼り戻しテキストの読み取り。
 * コードブロックや前後の説明文が付いていても JSON 部分を取り出して検証する。
 */
import { AnglesOutput, DraftOutput, type GenerationTask } from "./types";

export class ParseError extends Error {}

export function extractJson(raw: string): unknown {
  const text = raw.trim();
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidates = [fence?.[1], text];
  const first = text.indexOf("{");
  const last = text.lastIndexOf("}");
  if (first >= 0 && last > first) candidates.push(text.slice(first, last + 1));
  for (const c of candidates) {
    if (!c) continue;
    try {
      return JSON.parse(c.trim());
    } catch {
      /* 次の候補 */
    }
  }
  throw new ParseError("JSON として読み取れませんでした。出力全体をそのまま貼り付けてください。");
}

export function parseOutput(task: "angles", raw: string, knownIds: Set<string>): AnglesOutput;
export function parseOutput(task: "draft", raw: string, knownIds: Set<string>): DraftOutput;
export function parseOutput(task: GenerationTask, raw: string, knownIds: Set<string>): AnglesOutput | DraftOutput;
export function parseOutput(task: GenerationTask, raw: string | unknown, knownIds: Set<string>): AnglesOutput | DraftOutput {
  const json = typeof raw === "string" ? extractJson(raw) : raw;
  if (task === "angles") {
    const r = AnglesOutput.safeParse(json);
    if (!r.success) throw new ParseError(`切り口の形式が違います: ${r.error.issues[0]?.path.join(".")} ${r.error.issues[0]?.message}`);
    return r.data;
  }
  const r = DraftOutput.safeParse(json);
  if (!r.success) throw new ParseError(`下書きの形式が違います: ${r.error.issues[0]?.path.join(".")} ${r.error.issues[0]?.message}`);
  // 存在しない資料 ID を参照していたら外し、注記に残す（根拠の捏造を見えるようにする）
  for (const seg of r.data.segments) {
    for (const p of seg.provenance) {
      const unknown = p.refIds.filter((id) => !knownIds.has(id));
      if (unknown.length) {
        p.refIds = p.refIds.filter((id) => knownIds.has(id));
        p.note = `${p.note}${p.note ? " / " : ""}存在しない資料IDを参照: ${unknown.join(", ")}`;
        if (!p.refIds.length && p.basis !== "invented") p.basis = "unknown";
      }
    }
  }
  return r.data;
}

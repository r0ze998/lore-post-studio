import { randomBytes } from "node:crypto";

/** 時系列で並ぶ短い ID（サーバー側専用）。 */
export function newId(prefix: string): string {
  const t = Date.now().toString(36);
  const r = randomBytes(5).toString("hex");
  return `${prefix}_${t}${r}`;
}

export function nowIso(): string {
  return new Date().toISOString();
}

import { ENTRY_KIND_LABEL } from "./labels";
import type { EntryKind } from "./schema";

/** Markdown（## 見出しごとに 1 項目）または JSON 配列を「提案」として取り込む。 */
export function parseImportText(text: string, kind: EntryKind): { title: string; body: string; kind: EntryKind; aliases?: string[] }[] {
  const t = text.trim();
  if (!t) return [];
  if (t.startsWith("[") || t.startsWith("{")) {
    const j = JSON.parse(t);
    const arr = Array.isArray(j) ? j : Array.isArray(j.entries) ? j.entries : [j];
    return arr
      .filter((x: unknown) => x && typeof x === "object" && typeof (x as { title?: unknown }).title === "string")
      .map((x: Record<string, unknown>) => ({ ...x, title: String(x.title), body: String(x.body ?? ""), kind: (x.kind as EntryKind) in ENTRY_KIND_LABEL ? (x.kind as EntryKind) : kind }));
  }
  const out: { title: string; body: string; kind: EntryKind }[] = [];
  let cur: { title: string; body: string[] } | null = null;
  for (const line of t.split("\n")) {
    const h = line.match(/^#{1,3}\s+(.+)$/);
    if (h) {
      if (cur) out.push({ title: cur.title, body: cur.body.join("\n").trim(), kind });
      cur = { title: h[1].trim(), body: [] };
    } else if (cur) cur.body.push(line);
  }
  if (cur) out.push({ title: cur.title, body: cur.body.join("\n").trim(), kind });
  if (!out.length) {
    // 見出しがなければ段落ごと（1 行目を名前に）
    for (const para of t.split(/\n\s*\n/)) {
      const [first, ...rest] = para.trim().split("\n");
      if (first) out.push({ title: first.slice(0, 200), body: rest.join("\n").trim(), kind });
    }
  }
  return out;
}


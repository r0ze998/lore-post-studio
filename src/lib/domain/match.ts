/**
 * 本文照合の基本関数（ブラウザ・サーバー共通）。
 * 位置（start/end）は元の文字列の UTF-16 インデックスで返す。
 */

export interface Range {
  start: number;
  end: number;
}

/** 照合用の正規化（NFKC + 小文字化）。長さが変わる文字があるので位置計算には使わない。 */
export function norm(s: string): string {
  return s.normalize("NFKC").toLowerCase();
}

const ASCII_WORD = /^[\x20-\x7e]+$/;

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * needle を text の中で探す。
 * - 英数字だけの語は単語境界を要求（"Rune" が "Runes" に一致しないように前側のみ厳密、後ろは英字に続かないこと）
 * - 日本語などはそのまま部分一致
 * - 全角/半角や大文字小文字の違いは区別しない
 */
export function findAll(text: string, needle: string): Range[] {
  const n = needle.trim();
  if (!n) return [];
  const out: Range[] = [];
  const flags = "giu";
  let re: RegExp;
  const folded = n.normalize("NFKC");
  if (ASCII_WORD.test(folded)) {
    re = new RegExp(`(?<![\\p{L}\\p{N}])${escapeRegExp(folded)}(?![\\p{L}\\p{N}])`, flags);
  } else {
    re = new RegExp(escapeRegExp(folded), flags);
  }
  // 全角英数を半角にした「同じ長さの」文字列で照合する（位置がずれない）。
  const hay = foldWidth(text);
  let m: RegExpExecArray | null;
  while ((m = re.exec(hay))) {
    out.push({ start: m.index, end: m.index + m[0].length });
    if (m[0].length === 0) re.lastIndex++;
  }
  return dedupeRanges(out);
}

/** 全角英数記号を半角に（長さは変わらない）。 */
export function foldWidth(s: string): string {
  return s.replace(/[！-～]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0)).replace(/　/g, " ");
}

export function findRegex(text: string, pattern: string, opts: { foldWidth?: boolean } = {}): Range[] {
  let re: RegExp;
  try {
    re = new RegExp(pattern, "giu");
  } catch {
    return [];
  }
  const out: Range[] = [];
  const hay = opts.foldWidth === false ? text : foldWidth(text);
  let m: RegExpExecArray | null;
  while ((m = re.exec(hay))) {
    out.push({ start: m.index, end: m.index + m[0].length });
    if (m[0].length === 0) re.lastIndex++;
  }
  return out;
}

export function dedupeRanges(rs: Range[]): Range[] {
  const seen = new Set<string>();
  return rs.filter((r) => {
    const k = `${r.start}:${r.end}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

export function overlaps(a: Range, b: Range): boolean {
  return a.start < b.end && b.start < a.end;
}

export interface Sentence {
  text: string;
  start: number;
  end: number;
}

/** 文に分割（。！？!? 改行で区切る）。位置付き。 */
export function splitSentences(text: string): Sentence[] {
  const out: Sentence[] = [];
  const re = /[^。！？!?\n]+[。！？!?」』）)]*|\n+/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    const raw = m[0];
    if (!raw.trim()) continue;
    const lead = raw.length - raw.trimStart().length;
    const t = raw.trim();
    out.push({ text: t, start: m.index + lead, end: m.index + lead + t.length });
  }
  return out;
}

/** 行に分割（位置付き）。 */
export function splitLines(text: string): Sentence[] {
  const out: Sentence[] = [];
  let pos = 0;
  for (const line of text.split("\n")) {
    out.push({ text: line, start: pos, end: pos + line.length });
    pos += line.length + 1;
  }
  return out;
}

export function sentenceAt(sentences: Sentence[], r: Range): Sentence | undefined {
  return sentences.find((s) => r.start >= s.start && r.start < s.end);
}

export function excerpt(text: string, r: Range, pad = 18): string {
  const s = Math.max(0, r.start - pad);
  const e = Math.min(text.length, r.end + pad);
  return `${s > 0 ? "…" : ""}${text.slice(s, r.start)}【${text.slice(r.start, r.end)}】${text.slice(r.end, e)}${e < text.length ? "…" : ""}`;
}

/** 重複判定用：記号・空白を除いた文字 n-gram の集合。 */
export function ngrams(text: string, n = 3): Set<string> {
  const t = norm(text).replace(/https?:\/\/\S+/g, "").replace(/[\s\p{P}\p{S}]/gu, "");
  const out = new Set<string>();
  if (t.length < n) {
    if (t) out.add(t);
    return out;
  }
  for (let i = 0; i <= t.length - n; i++) out.add(t.slice(i, i + n));
  return out;
}

/** 新しい文章のうち、過去の文章と共有している割合（包含度）と Jaccard の大きい方。 */
export function similarity(a: string, b: string): number {
  const A = ngrams(a);
  const B = ngrams(b);
  if (!A.size || !B.size) return 0;
  let inter = 0;
  for (const g of A) if (B.has(g)) inter++;
  const jaccard = inter / (A.size + B.size - inter);
  const containment = inter / Math.min(A.size, B.size);
  // 短い文章を長い文章に埋め込んだだけのケースも拾うため、包含度を少し割り引いて併用
  return Math.max(jaccard, containment * 0.85);
}

/** 最長共通部分文字列（重複箇所の提示用。記号・空白を除いた比較）。 */
export function longestCommonSubstring(a: string, b: string): string {
  const x = norm(a).replace(/\s+/g, "");
  const y = norm(b).replace(/\s+/g, "");
  if (!x || !y) return "";
  let best = 0;
  let bestEnd = 0;
  let prev = new Array(y.length + 1).fill(0);
  for (let i = 1; i <= x.length; i++) {
    const cur = new Array(y.length + 1).fill(0);
    for (let j = 1; j <= y.length; j++) {
      if (x[i - 1] === y[j - 1]) {
        cur[j] = prev[j - 1] + 1;
        if (cur[j] > best) {
          best = cur[j];
          bestEnd = i;
        }
      }
    }
    prev = cur;
  }
  return x.slice(bestEnd - best, bestEnd);
}

const EMOJI_RE = /\p{Extended_Pictographic}(?:️|‍\p{Extended_Pictographic}|\p{Emoji_Modifier})*/gu;
export function findEmoji(text: string): Range[] {
  const out: Range[] = [];
  let m: RegExpExecArray | null;
  EMOJI_RE.lastIndex = 0;
  while ((m = EMOJI_RE.exec(text))) out.push({ start: m.index, end: m.index + m[0].length });
  return out;
}

export function findHashtags(text: string): Range[] {
  const out: Range[] = [];
  const re = /(^|[^\p{L}\p{N}_&/])([#＃][\p{L}\p{N}_ー]+)/gu;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    const start = m.index + m[1].length;
    out.push({ start, end: start + m[2].length });
  }
  return out;
}

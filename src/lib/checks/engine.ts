/**
 * 整合性チェックエンジン（純粋関数・ブラウザ／サーバー共通）。
 *
 * 入力: プロジェクトの設定・正本・過去投稿・学び・素材と、検査する下書き。
 * 出力: 指摘の一覧。各指摘は「理由」「該当箇所（セグメントと位置）」「参照した設定」を必ず持つ。
 *
 * ここでの判定は語・パターンの照合であり、文章の意味は理解していない。
 * 見逃し得る範囲は catalog.ts に明記し、画面にも表示する。
 */
import type { Asset, DraftVersion, Entry, Learning, Post, Project, Segment, Severity } from "@/lib/domain/schema";
import { KIND_DOMAIN } from "@/lib/domain/schema";
import { namesOf } from "@/lib/domain/canon";
import { FEATURE_STATUS_LABEL } from "@/lib/domain/labels";
import {
  excerpt,
  findAll,
  findEmoji,
  findHashtags,
  findRegex,
  foldWidth,
  longestCommonSubstring,
  norm,
  overlaps,
  type Range,
  similarity,
  splitLines,
  splitSentences,
  type Sentence,
} from "@/lib/domain/match";
import { countX, extractUrlsWithIndices, type XCount } from "./xcount";
import type { RuleId } from "./catalog";
import {
  ABSTRACT_WORDS,
  ASSERT_AVAILABLE,
  CANCEL_WORDS,
  CLAIM_PATTERNS,
  CTA_PATTERN,
  DEFAULT_BANNED_PHRASES,
  DEFAULT_DEVELOPER_MARKERS,
  FRAME_LINE_PREFIX,
  HAS_JA,
  HEDGE_FUTURE,
  JA_CHAR,
  PLACEHOLDER,
  PLAYER_ANECDOTE,
  REAL_PROMISE,
  REAL_PROMISE_STRONG,
  REPUTATION_HYPE,
  TEST_WORDS,
  TESTIMONIAL_SUBJECT,
  TESTIMONIAL_VERB,
} from "./lexicon";

export interface CheckContext {
  project: Project;
  entries: Entry[];
  posts: Post[];
  learnings: Learning[];
  assets: Asset[];
}

export interface FindingRef {
  kind: "entry" | "post" | "learning" | "asset" | "setting";
  id: string;
  label: string;
  detail?: string;
}

export interface Finding {
  /** 承認時の「確認済み」記録に使う安定キー（位置ではなく内容で作る）。 */
  key: string;
  ruleId: RuleId;
  severity: Severity;
  title: string;
  /** なぜ指摘したか。 */
  message: string;
  segmentIndex: number | null;
  ranges: Range[];
  excerpt: string;
  refs: FindingRef[];
  suggestion?: string;
}

export type ProvenanceBasis = "fact" | "canon" | "unconfirmed" | "frame" | "invented";

export interface SentenceProvenance {
  segmentIndex: number;
  text: string;
  start: number;
  end: number;
  basis: ProvenanceBasis;
  refs: FindingRef[];
}

export interface SegmentStat extends XCount {
  emoji: number;
  hashtags: number;
}

export interface CheckReport {
  ranAt: string;
  draftId: string;
  findings: Finding[];
  counts: { error: number; warning: number; info: number };
  segments: SegmentStat[];
  provenance: SentenceProvenance[];
}

/* ------------------------------------------------------------------ */

const SEVERITY_ORDER: Record<Severity, number> = { error: 0, warning: 1, info: 2 };

function entryRef(e: Entry, detail?: string): FindingRef {
  return { kind: "entry", id: e.id, label: e.title, detail };
}

function srcDetail(e: Entry): string {
  const parts = [e.source.label, e.source.url].filter(Boolean);
  const d = e.updatedAt ? `更新 ${e.updatedAt.slice(0, 10)}` : "";
  return [...parts, d].filter(Boolean).join(" / ");
}

/** 漢数字を含む簡単な数の読み取り（「三」「十二」「三百」「1,200」「１２０」程度）。 */
export function parseNumber(s: string): number | null {
  const t = foldWidth(s).replace(/,/g, "");
  if (/^\d+(\.\d+)?$/.test(t)) return Number(t);
  const digits: Record<string, number> = { 〇: 0, 零: 0, 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 };
  const units: Record<string, number> = { 十: 10, 百: 100, 千: 1000 };
  if (!/^[〇零一二三四五六七八九十百千万]+$/.test(t)) return null;
  let total = 0;
  let section = 0;
  let cur = 0;
  for (const ch of t) {
    if (ch in digits) cur = digits[ch];
    else if (ch in units) {
      section += (cur || 1) * units[ch];
      cur = 0;
    } else if (ch === "万") {
      total += (section + cur || 1) * 10000;
      section = 0;
      cur = 0;
    }
  }
  return total + section + cur;
}

const NUM_UNIT_RE = /([\d０-９][\d,０-９]*(?:\.\d+)?|[〇零一二三四五六七八九十百千万]+)\s*(年前|年|日目|日|人|名|枚|個|頭|隻|km|キロ|メートル|里|歳|つ|本|軒|基)/gu;

function numberUnits(text: string): { value: number; unit: string; range: Range; raw: string }[] {
  const out: { value: number; unit: string; range: Range; raw: string }[] = [];
  let m: RegExpExecArray | null;
  NUM_UNIT_RE.lastIndex = 0;
  while ((m = NUM_UNIT_RE.exec(text))) {
    const v = parseNumber(m[1]);
    if (v === null) continue;
    out.push({ value: v, unit: m[2], range: { start: m.index, end: m.index + m[0].length }, raw: m[0] });
  }
  return out;
}

const DATE_RE = /(?:(\d{4})\s*[-/年.]\s*)?(\d{1,2})\s*[-/月.]\s*(\d{1,2})\s*日?/gu;
function extractDates(text: string): { md: string; raw: string; range: Range }[] {
  const out: { md: string; raw: string; range: Range }[] = [];
  const hay = foldWidth(text);
  let m: RegExpExecArray | null;
  DATE_RE.lastIndex = 0;
  while ((m = DATE_RE.exec(hay))) {
    const mo = Number(m[2]);
    const d = Number(m[3]);
    if (mo < 1 || mo > 12 || d < 1 || d > 31) continue;
    // 「v0.3」などのバージョン表記や小数の誤認を避ける
    if (/v\s*$/i.test(hay.slice(Math.max(0, m.index - 2), m.index))) continue;
    out.push({ md: `${mo}-${d}`, raw: m[0], range: { start: m.index, end: m.index + m[0].length } });
  }
  return out;
}

function entryFullText(e: Entry): string {
  const d = e.details;
  return [e.title, e.body, ...e.aliases, d.value, d.evidenceNote, d.period, d.howToJoin, d.conditions, d.quote].join("\n");
}

/* ------------------------------------------------------------------ */

interface SegView {
  index: number;
  seg: Segment;
  text: string;
  sentences: Sentence[];
  /** 「※」で始まる現実側の注記行の範囲。 */
  frameRanges: Range[];
}

function buildSegView(seg: Segment, index: number): SegView {
  const lines = splitLines(seg.text);
  const frameRanges = lines.filter((l) => FRAME_LINE_PREFIX.test(l.text)).map((l) => ({ start: l.start, end: l.end }));
  return { index, seg, text: seg.text, sentences: splitSentences(seg.text), frameRanges };
}

function inFrame(v: SegView, r: Range): boolean {
  return v.frameRanges.some((f) => overlaps(f, r));
}

/** 世界内の語りとして読む部分か（※行を除く）。 */
function isInWorldBody(v: SegView, r: Range): boolean {
  return v.seg.voice === "in_world" && !inFrame(v, r);
}

function stripForCompare(text: string): string {
  return splitLines(text)
    .filter((l) => !FRAME_LINE_PREFIX.test(l.text))
    .map((l) => l.text)
    .join("\n")
    .replace(/https?:\/\/\S+/g, "")
    .replace(/[#＃][\p{L}\p{N}_ー]+/gu, "");
}

export function draftPlainText(d: DraftVersion): string {
  return d.segments.map((s) => s.text).join("\n\n");
}

export function currentDraft(p: Post): DraftVersion | undefined {
  return p.drafts.find((d) => d.id === p.currentDraftId) ?? p.drafts[p.drafts.length - 1];
}

/* ------------------------------------------------------------------ */

export function runChecks(ctx: CheckContext, post: Post, draft: DraftVersion, now = new Date()): CheckReport {
  const findings: Finding[] = [];
  const { project, entries } = ctx;
  const settings = project.settings;
  const views = draft.segments.map(buildSegView);
  const allText = draftPlainText(draft);
  const byId = new Map(entries.map((e) => [e.id, e]));

  const activeEntries = entries.filter((e) => e.status !== "deprecated");
  const activeNames = new Set(activeEntries.flatMap(namesOf).map(norm));

  const add = (f: Omit<Finding, "key" | "excerpt"> & { matched?: string; keyExtra?: string }) => {
    const v = f.segmentIndex !== null ? views[f.segmentIndex] : undefined;
    const r = f.ranges[0];
    const ex = v && r ? excerpt(v.text, r) : "";
    const matched = f.matched ?? (v && r ? v.text.slice(r.start, r.end) : "");
    const key = [f.ruleId, f.segmentIndex ?? "-", norm(matched), f.refs[0]?.id ?? "", f.keyExtra ?? ""].join(":");
    if (findings.some((x) => x.key === key)) return;
    const { matched: _m, keyExtra: _k, ...rest } = f;
    void _m;
    void _k;
    findings.push({ ...rest, key, excerpt: ex });
  };

  /** 本文中の項目名の出現（位置付き）。 */
  const mentions = (e: Entry, v: SegView): { range: Range; name: string }[] => {
    const out: { range: Range; name: string }[] = [];
    for (const n of namesOf(e)) for (const r of findAll(v.text, n)) out.push({ range: r, name: n });
    return out;
  };

  /* ---------------- 形式 ---------------- */
  const segStats: SegmentStat[] = views.map((v) => {
    const c = countX(v.text);
    return { ...c, emoji: findEmoji(v.text).length, hashtags: findHashtags(v.text).length };
  });

  views.forEach((v, i) => {
    const c = segStats[i];
    if (!v.text.trim()) {
      add({ ruleId: "x-length", severity: "error", title: "本文が空です", message: "空の投稿は投稿できません。", segmentIndex: i, ranges: [], refs: [] });
    } else if (c.weightedLength > 280) {
      add({
        ruleId: "x-length",
        severity: "error",
        title: `文字数オーバー（${c.weightedLength} / 280）`,
        message: `X の加重文字数で ${c.weightedLength - 280} 超えています（日本語・絵文字は 1 文字 2、URL は 23 として計算）。`,
        segmentIndex: i,
        ranges: [{ start: Math.min(c.validRangeEnd, v.text.length), end: v.text.length }],
        refs: [],
        keyExtra: "over",
      });
    } else if (c.weightedLength > 260) {
      add({
        ruleId: "x-length",
        severity: "info",
        title: `上限に近い（${c.weightedLength} / 280）`,
        message: "投稿直前の修正で超えやすいので注意してください。",
        segmentIndex: i,
        ranges: [],
        refs: [],
        keyExtra: "near",
      });
    }

    for (const r of findRegex(v.text, PLACEHOLDER.source, { foldWidth: false })) {
      add({ ruleId: "placeholder", severity: "error", title: "未記入の穴埋めが残っています", message: "テンプレートの穴埋め・仮置きが残っています。書き換えるか削除してください。", segmentIndex: i, ranges: [r], refs: [] });
    }

    // 素材
    const segAssets = v.seg.assetIds.map((id) => ctx.assets.find((a) => a.id === id));
    const missing = v.seg.assetIds.filter((_, k) => !segAssets[k]);
    if (missing.length) {
      add({ ruleId: "media", severity: "error", title: "素材が見つかりません", message: "素材庫から削除された素材が添付されています。", segmentIndex: i, ranges: [], refs: [], keyExtra: missing.join(",") });
    }
    const found = segAssets.filter((a): a is Asset => !!a);
    const images = found.filter((a) => a.mime.startsWith("image/") && a.mime !== "image/gif");
    const videos = found.filter((a) => a.mime.startsWith("video/") || a.mime === "image/gif");
    if (images.length > 4) {
      add({ ruleId: "media", severity: "error", title: "画像が多すぎます", message: `1 投稿に添付できる画像は 4 枚までです（現在 ${images.length} 枚）。`, segmentIndex: i, ranges: [], refs: [], keyExtra: "img" });
    }
    if (videos.length > 1 || (videos.length && images.length)) {
      add({ ruleId: "media", severity: "error", title: "動画・GIF の添付方法", message: "動画・GIF は 1 投稿に 1 本で、画像と同時には添付できません。", segmentIndex: i, ranges: [], refs: [], keyExtra: "vid" });
    }
    for (const a of found) {
      const ref: FindingRef = { kind: "asset", id: a.id, label: a.title || a.filename };
      if (a.visibility === "internal") {
        add({ ruleId: "media", severity: "error", title: "未公開の素材", message: "公開区分が「未公開」の素材が添付されています。", segmentIndex: i, ranges: [], refs: [ref], keyExtra: "int" });
      }
      if (a.status === "deprecated") {
        add({ ruleId: "media", severity: "error", title: "廃止した素材", message: "「廃止」にした素材が添付されています。", segmentIndex: i, ranges: [], refs: [ref], keyExtra: "dep" });
      } else if (a.status === "proposed") {
        add({ ruleId: "media", severity: "warning", title: "未確定の素材", message: "「提案」段階の素材です。世界観に合うか確認してください。", segmentIndex: i, ranges: [], refs: [ref], keyExtra: "prop" });
      }
      if (a.rights === "unknown") {
        add({ ruleId: "media", severity: "warning", title: "権利が不明な素材", message: "素材の権利（自作・許諾済み）が確認されていません。", segmentIndex: i, ranges: [], refs: [ref], keyExtra: "rights" });
      }
      if (a.mime.startsWith("image/") && !a.altText.trim()) {
        add({ ruleId: "media", severity: "warning", title: "代替テキストがありません", message: "画像の代替テキスト（ALT）を素材庫で書いておくと、投稿時に貼り付けられます。", segmentIndex: i, ranges: [], refs: [ref], keyExtra: "alt" });
      }
    }
  });

  /* ---------------- 世界観：正本との照合 ---------------- */
  for (const e of entries) {
    for (const v of views) {
      const ms = mentions(e, v);
      if (!ms.length) continue;
      const first = ms[0];
      if (e.status === "deprecated") {
        // 有効な項目と同じ名前なら、廃止とは言い切れない
        if (activeNames.has(norm(first.name))) continue;
        const replacement = entries.find((x) => x.status !== "deprecated" && x.supersedes.includes(e.id));
        add({
          ruleId: "deprecated-canon",
          severity: "error",
          title: `廃止した設定「${first.name}」`,
          message: `「${e.title}」は廃止された設定です。${e.body ? `（${e.body.slice(0, 80)}）` : ""}`,
          segmentIndex: v.index,
          ranges: ms.map((m) => m.range),
          refs: [entryRef(e, srcDetail(e)), ...(replacement ? [entryRef(replacement, "置き換え先")] : [])],
          suggestion: replacement ? `「${replacement.title}」を使ってください。` : undefined,
        });
        continue;
      }
      if (e.visibility === "internal") {
        add({
          ruleId: "internal-info",
          severity: "error",
          title: `未公開の情報「${first.name}」`,
          message: `「${e.title}」は公開区分が「未公開」です。公開してよいか確認し、正本の公開区分を変えるまで使えません。`,
          segmentIndex: v.index,
          ranges: ms.map((m) => m.range),
          refs: [entryRef(e, srcDetail(e))],
        });
      }
      if (e.status === "proposed") {
        // 同じ名前の確定項目があれば、提案側の指摘は弱める
        const confirmedSame = entries.some((x) => x.id !== e.id && x.status === "confirmed" && namesOf(x).some((n) => norm(n) === norm(first.name)));
        add({
          ruleId: "proposed-canon",
          severity: confirmedSame ? "info" : "warning",
          title: `未確定の設定「${first.name}」`,
          message: confirmedSame
            ? `同じ名前の提案中の項目「${e.title}」もあります（内容が食い違う可能性）。どちらの内容に沿っているか確認してください。`
            : `「${e.title}」は提案段階で、まだ確定していません。使う場合は正本で確定にしてください。`,
          segmentIndex: v.index,
          ranges: ms.map((m) => m.range),
          refs: [entryRef(e, srcDetail(e))],
        });
      }
    }
    // 誤表記
    if (e.status !== "deprecated") {
      for (const variant of e.details.forbiddenVariants) {
        for (const v of views) {
          const rs = findAll(v.text, variant);
          if (!rs.length) continue;
          add({
            ruleId: "term-variant",
            severity: "error",
            title: `表記の誤り「${variant}」`,
            message: `「${e.title}」の誤表記として登録されています。`,
            segmentIndex: v.index,
            ranges: rs,
            refs: [entryRef(e, srcDetail(e))],
            suggestion: `「${e.title}」と書いてください。`,
          });
        }
      }
    }
    // 矛盾パターン（確定項目のみ）
    if (e.status === "confirmed") {
      for (const c of e.contradictions) {
        for (const v of views) {
          const rs = c.regex ? findRegex(v.text, c.pattern) : findAll(v.text, c.pattern);
          if (!rs.length) continue;
          add({
            ruleId: "contradiction",
            severity: "error",
            title: `設定と矛盾する可能性：「${e.title}」`,
            message: c.reason || `「${e.title}」に登録された矛盾パターン（${c.pattern}）に一致しました。`,
            segmentIndex: v.index,
            ranges: rs,
            refs: [entryRef(e, srcDetail(e))],
            keyExtra: c.pattern,
          });
        }
      }
    }
  }

  // 数値の食い違い（目安）
  for (const v of views) {
    for (const s of v.sentences) {
      const nums = numberUnits(s.text);
      if (!nums.length) continue;
      for (const e of activeEntries) {
        if (e.status !== "confirmed" || KIND_DOMAIN[e.kind] === "style") continue;
        const mentioned = namesOf(e).some((n) => findAll(s.text, n).length > 0);
        if (!mentioned) continue;
        const canonNums = numberUnits(entryFullText(e));
        for (const n of nums) {
          const sameUnit = canonNums.filter((c) => c.unit === n.unit);
          if (!sameUnit.length || sameUnit.some((c) => c.value === n.value)) continue;
          add({
            ruleId: "number-mismatch",
            severity: "warning",
            title: `数値が設定と違う可能性「${n.raw}」`,
            message: `「${e.title}」の設定には「${sameUnit.map((c) => c.raw).join("」「")}」とあります。同じことを指しているなら食い違っています。`,
            segmentIndex: v.index,
            ranges: [{ start: s.start + n.range.start, end: s.start + n.range.end }],
            refs: [entryRef(e, srcDetail(e))],
          });
        }
      }
    }
  }

  /* ---------------- 事実：機能・実績・声 ---------------- */
  const features = entries.filter((e) => e.kind === "feature" && e.status !== "deprecated");
  for (const v of views) {
    for (const s of v.sentences) {
      const absRange = (r: Range): Range => ({ start: s.start + r.start, end: s.start + r.end });
      const assert = s.text.match(ASSERT_AVAILABLE);
      const hedged = HEDGE_FUTURE.test(s.text);
      let featureHit = false;
      for (const f of features) {
        const hits = namesOf(f).flatMap((n) => findAll(s.text, n));
        if (!hits.length) continue;
        featureHit = true;
        const st = f.details.featureStatus;
        const label = st ? FEATURE_STATUS_LABEL[st] : "実装状況未設定";
        const ref = entryRef(f, `${label}${f.details.version ? ` / ${f.details.version}` : ""} / ${srcDetail(f)}`);
        if (st === "cancelled" && !CANCEL_WORDS.test(s.text)) {
          add({ ruleId: "feature-assertion", severity: "error", title: `中止した機能「${f.title}」`, message: "機能台帳で「中止」になっている機能に触れています。", segmentIndex: v.index, ranges: hits.map(absRange), refs: [ref] });
        } else if ((st === "in_development" || st === "planned" || st === "concept") && assert && !hedged) {
          add({
            ruleId: "feature-assertion",
            severity: "error",
            title: `未実装の機能を断定「${f.title}」`,
            message: `「${f.title}」は機能台帳で「${label}」です。「${assert[0]}」と書くと、もう使えると読まれます。`,
            segmentIndex: v.index,
            ranges: [...hits.map(absRange)],
            refs: [ref],
            suggestion: st === "concept" ? "「構想中です」「検討しています」のように書いてください。" : "「開発中です」「実装予定です」のように書いてください。",
          });
        } else if (st === "testing" && assert && !TEST_WORDS.test(s.text)) {
          add({ ruleId: "feature-assertion", severity: "warning", title: `テスト中の機能「${f.title}」`, message: "テスト中（一部のみ）の機能です。誰でも使えると読まれないよう、テスト版であることを書いてください。", segmentIndex: v.index, ranges: hits.map(absRange), refs: [ref] });
        } else if (!st) {
          add({ ruleId: "feature-assertion", severity: "warning", title: `実装状況が未設定の機能「${f.title}」`, message: "機能台帳に実装状況を設定してください。", segmentIndex: v.index, ranges: hits.map(absRange), refs: [ref] });
        } else if (f.status === "proposed" && assert) {
          add({ ruleId: "feature-assertion", severity: "warning", title: `機能情報が未確定「${f.title}」`, message: "この機能の台帳情報は提案段階です。実装状況を確認してください。", segmentIndex: v.index, ranges: hits.map(absRange), refs: [ref] });
        }
      }
      if (assert && !featureHit && v.seg.voice === "developer") {
        add({
          ruleId: "unregistered-release",
          severity: "warning",
          title: "台帳にない機能の告知",
          message: `「${assert[0]}」とありますが、同じ文に機能台帳の機能が見当たりません。機能を台帳に登録し、実装状況を確認してください。`,
          segmentIndex: v.index,
          ranges: [absRange({ start: assert.index ?? 0, end: (assert.index ?? 0) + assert[0].length })],
          refs: [],
        });
      }

      // 実績
      for (const cp of CLAIM_PATTERNS) {
        const m = s.text.match(cp.re);
        if (!m) continue;
        const r = absRange({ start: m.index ?? 0, end: (m.index ?? 0) + m[0].length });
        // 世界内の語りの本文では、作中の数値（旅人 3 人など）を実績と見なさない
        if (isInWorldBody(v, r) && cp.type !== "award" && cp.type !== "partnership") continue;
        const numbers = (m[0].match(/[\d０-９][\d,０-９.]*/g) ?? []).map((x) => foldWidth(x).replace(/,/g, ""));
        const support = entries.filter((e) => {
          if (e.status !== "confirmed") return false;
          if (e.kind === "claim") {
            const hasEvidence = !!(e.details.evidenceUrl || e.details.evidenceNote);
            if (!hasEvidence) return false;
            const textHit = namesOf(e).some((n) => findAll(s.text, n).length) || (e.details.value && s.text.includes(e.details.value));
            const numHit = numbers.length > 0 && numbers.every((n) => foldWidth(entryFullText(e)).replace(/,/g, "").includes(n));
            return textHit || numHit;
          }
          if (e.kind === "notice" && cp.type !== "award" && cp.type !== "partnership") {
            return numbers.length > 0 && numbers.every((n) => foldWidth(entryFullText(e)).replace(/,/g, "").includes(n));
          }
          return false;
        });
        if (support.length) continue;
        const weak = entries.filter((e) => e.kind === "claim" && e.status !== "deprecated" && (namesOf(e).some((n) => findAll(s.text, n).length) || (numbers.length > 0 && numbers.every((n) => foldWidth(entryFullText(e)).includes(n)))));
        add({
          ruleId: "claim-evidence",
          severity: "error",
          title: `根拠のない${cp.label}「${m[0]}」`,
          message: weak.length
            ? `関連する実績「${weak[0].title}」はありますが、${weak[0].status === "proposed" ? "提案段階（未確認）" : "根拠（URL・資料メモ）が未登録"}です。根拠を登録して確定にするまで書けません。`
            : `${cp.label}を書くには、根拠（URL か資料メモ）付きの「実績・数値」を正本に登録してください。`,
          segmentIndex: v.index,
          ranges: [r],
          refs: weak.map((w) => entryRef(w, srcDetail(w))),
          keyExtra: cp.type,
        });
      }

      // 声・評判
      // 引用（「」“”""）があるか。『』は題名に使われるので数えない。ゲーム名・設定名だけの括弧も除く。
      const knownNames = new Set([...settings.identityAnchors, ...activeEntries.flatMap(namesOf)].map(norm));
      const hasQuote = Array.from(s.text.matchAll(/「([^」]+)」|“([^”]+)”|"([^"]+)"/gu)).some((m) => !knownNames.has(norm(m[1] ?? m[2] ?? m[3] ?? "")));
      const subject = s.text.match(TESTIMONIAL_SUBJECT);
      const verb = TESTIMONIAL_VERB.test(s.text);
      const hype = s.text.match(REPUTATION_HYPE);
      const voiceLike = (subject && (verb || hasQuote)) || hype;
      if (voiceLike && !(isInWorldBody(v, s) && !hype)) {
        const consented = entries.filter((e) => e.kind === "testimonial" && e.status === "confirmed" && e.details.consent && e.details.quote.trim().length >= 4);
        const quoted = consented.find((e) => norm(s.text).includes(norm(e.details.quote.trim().slice(0, 30))));
        if (!quoted) {
          const m0 = hype ?? subject!;
          add({
            ruleId: "testimonial",
            severity: "error",
            title: hype ? `評判の誇張「${m0[0]}」` : "ユーザーの声として読める文",
            message: hype
              ? "根拠のない評判の表現です。実際の反応を書く場合は、出典と同意のある声を「実在ユーザーの声」に登録して引用してください。"
              : "実在の人の声・感想として読めます。存在しない声を書かないでください。実際の声なら本人の同意と出典を登録してください。",
            segmentIndex: v.index,
            ranges: [absRange({ start: m0.index ?? 0, end: (m0.index ?? 0) + m0[0].length })],
            refs: [],
          });
        }
      }

      // 実話風のプレイヤー行動
      const anecdote = s.text.match(PLAYER_ANECDOTE);
      if (anecdote && v.seg.voice === "developer") {
        add({
          ruleId: "player-anecdote",
          severity: "warning",
          title: "実際のプレイヤー行動として読める文",
          message: "実際に起きたことなら記録（テストログ・本人の同意）を確認してください。架空の出来事なら、世界内の物語として書き、実話のように見せないでください。",
          segmentIndex: v.index,
          ranges: [absRange({ start: anecdote.index ?? 0, end: (anecdote.index ?? 0) + anecdote[0].length })],
          refs: [],
        });
      }
    }
  }

  /* ---------------- 語り ---------------- */
  const devMarkers = [...DEFAULT_DEVELOPER_MARKERS, ...settings.developerMarkers];
  const inWorldVoices = entries.filter((e) => e.kind === "voice" && e.status === "confirmed" && e.details.voiceMode === "in_world");
  const noticeEntries = entries.filter((e) => e.kind === "notice" && e.status === "confirmed");
  const linkedNotice = noticeEntries.filter((e) => post.brief.factIds.includes(e.id) || views.some((v) => mentions(e, v).length));

  for (const v of views) {
    if (v.seg.voice === "in_world") {
      const hits: { r: Range; w: string }[] = [];
      for (const w of devMarkers) for (const r of findAll(v.text, w)) if (!inFrame(v, r)) hits.push({ r, w });
      for (const r of findRegex(v.text, "\\bv\\d+(?:\\.\\d+)+")) if (!inFrame(v, r)) hits.push({ r, w: v.text.slice(r.start, r.end) });
      for (const u of extractUrlsWithIndices(v.text)) if (!inFrame(v, u)) hits.push({ r: u, w: "URL" });
      if (hits.length) {
        add({
          ruleId: "voice-mixing",
          severity: "warning",
          title: `世界内の語りに開発者の語「${Array.from(new Set(hits.map((h) => h.w))).slice(0, 4).join("」「")}」`,
          message: "世界の中の語り手が、開発やサービスの言葉を使っています。現実側の情報は「※」で始まる注記行か、開発者の語りのセグメントに分けてください。",
          segmentIndex: v.index,
          ranges: hits.map((h) => h.r),
          refs: [],
        });
      }
      // 現実の約束
      for (const r of findRegex(v.text, REAL_PROMISE.source)) {
        if (inFrame(v, r)) continue;
        const word = v.text.slice(r.start, r.end);
        const strong = REAL_PROMISE_STRONG.test(word);
        add({
          ruleId: "real-promise",
          severity: strong ? "error" : "warning",
          title: `世界内の語りに現実の約束${strong ? "" : "と読める語"}「${word}」`,
          message: strong
            ? "無料・特典・先着などのサービス提供に関わる話は、世界内の語りと混ぜると誤解を招きます。開発者の語り（または※注記）に分け、告知情報に根拠を置いてください。"
            : "作中の出来事（キャラバンへの報酬など）なら問題ありません。現実のプレイヤーへの約束として読まれないか確認してください。現実の約束なら開発者の語りに分けてください。",
          segmentIndex: v.index,
          ranges: [r],
          refs: [],
        });
      }
    } else {
      for (const voice of inWorldVoices) {
        for (const sp of voice.details.signaturePhrases) {
          const rs = findAll(v.text, sp);
          if (!rs.length) continue;
          add({
            ruleId: "voice-mixing",
            severity: "warning",
            title: `開発者の語りに世界内の語り手の言い回し「${sp}」`,
            message: `「${voice.title}」の言い回しです。開発者の説明と世界内の語り手を混同していないか確認してください（意図的なら、そのセグメントを「世界内の語り」にしてください）。`,
            segmentIndex: v.index,
            ranges: rs,
            refs: [entryRef(voice)],
          });
        }
      }
    }
    // 開発者の語り・※行の約束は告知情報に根拠が必要
    for (const r of findRegex(v.text, REAL_PROMISE.source)) {
      if (isInWorldBody(v, r)) continue;
      const word = v.text.slice(r.start, r.end);
      const backed = linkedNotice.some((n) => norm(entryFullText(n)).includes(norm(word)));
      if (backed) continue;
      add({
        ruleId: "real-promise",
        severity: "warning",
        title: `告知情報にない約束「${word}」`,
        message: linkedNotice.length
          ? "紐付いた告知情報の本文・条件にこの約束が書かれていません。条件を正本に登録してから書いてください。"
          : "サービス提供に関わる約束です。告知情報（日程・条件）を正本に登録し、企画の「伝えたい事実」に選んでください。",
        segmentIndex: v.index,
        ranges: [r],
        refs: linkedNotice.map((n) => entryRef(n)),
      });
    }
  }

  /* ---------------- 表現 ---------------- */
  const banned = Array.from(new Set([...(settings.useDefaultBannedPhrases ? DEFAULT_BANNED_PHRASES : []), ...settings.bannedPhrases]));
  const recentPosts = ctx.posts
    .filter((p) => p.id !== post.id && (p.status === "posted" || p.status === "approved"))
    .sort((a, b) => (b.publication?.postedAt || b.updatedAt).localeCompare(a.publication?.postedAt || a.updatedAt))
    .slice(0, 10);
  const recentTexts = recentPosts.map((p) => {
    const d = currentDraft(p);
    return { post: p, text: p.publication?.postedText || (d ? draftPlainText(d) : "") };
  });
  for (const v of views) {
    for (const phrase of banned) {
      const rs = findAll(v.text, phrase);
      if (!rs.length) continue;
      // 長い語に含まれる短い語は重ねて出さない（「真の所有」と「所有」）
      const longer = banned.filter((b) => b !== phrase && b.includes(phrase) && findAll(v.text, b).length);
      if (longer.length) continue;
      const usedBefore = recentTexts.filter((t) => findAll(t.text, phrase).length);
      add({
        ruleId: "banned-phrase",
        severity: v.seg.voice === "in_world" && !usedBefore.length ? "info" : "warning",
        title: `定番の宣伝文句「${phrase}」${usedBefore.length ? `（直近 ${recentTexts.length} 件中 ${usedBefore.length} 件でも使用）` : ""}`,
        message: usedBefore.length
          ? "最近の投稿でも同じ語を使っています。具体的な出来事・仕組み・数字で言い換えられないか検討してください。"
          : "抽象的な宣伝文句に頼っていないか確認してください。何が起きる・何ができるのかを具体的に書くと伝わります。",
        segmentIndex: v.index,
        ranges: rs,
        refs: usedBefore.slice(0, 3).map((t) => ({ kind: "post" as const, id: t.post.id, label: t.post.title })),
      });
    }

    // 抽象語だけ
    const body = v.text;
    let abstractCount = 0;
    const abstractRanges: Range[] = [];
    for (const w of ABSTRACT_WORDS) {
      const rs = findAll(body, w).filter((r) => !inFrame(v, r));
      abstractCount += rs.length;
      abstractRanges.push(...rs);
    }
    let anchors = 0;
    for (const e of activeEntries) for (const n of namesOf(e)) anchors += findAll(body, n).filter((r) => !inFrame(v, r)).length;
    for (const a of settings.identityAnchors) anchors += findAll(body, a).filter((r) => !inFrame(v, r)).length;
    anchors += numberUnits(body).length;
    if (abstractCount >= 2 && anchors === 0) {
      add({
        ruleId: "abstract-only",
        severity: "warning",
        title: "抽象語ばかりで具体的な手がかりがありません",
        message: `抽象語が ${abstractCount} 個あり、設定の名前・数字が一つもありません。初見の人には意味が伝わりにくい可能性があります。誰が・どこで・何をしたかを一つ入れてください。`,
        segmentIndex: v.index,
        ranges: abstractRanges,
        refs: [],
      });
    } else if (abstractCount >= 4 && anchors <= 1) {
      add({ ruleId: "abstract-only", severity: "info", title: "抽象語が多めです", message: `抽象語が ${abstractCount} 個あります。具体的な描写と釣り合っているか確認してください。`, segmentIndex: v.index, ranges: abstractRanges, refs: [], keyExtra: "many" });
    }

    // 絵文字
    const emoji = findEmoji(v.text);
    const opt = post.options;
    const limit = opt.emoji === "none" ? 0 : opt.emoji === "few" ? Math.max(1, opt.maxEmoji) : Infinity;
    if (emoji.length > limit) {
      add({
        ruleId: "emoji",
        severity: "warning",
        title: `絵文字が設定より多い（${emoji.length} 個 / 上限 ${limit}）`,
        message: opt.emoji === "none" ? "この投稿は絵文字「なし」の設定です。" : "この投稿の絵文字の上限を超えています。",
        segmentIndex: v.index,
        ranges: emoji,
        refs: [{ kind: "setting", id: "emoji", label: "投稿の表現設定" }],
      });
    }
    // ハッシュタグ
    const tags = findHashtags(v.text);
    if (tags.length > opt.maxHashtags) {
      add({ ruleId: "hashtag", severity: "warning", title: `ハッシュタグが多い（${tags.length} 個 / 上限 ${opt.maxHashtags}）`, message: "ハッシュタグの上限を超えています。", segmentIndex: v.index, ranges: tags, refs: [{ kind: "setting", id: "hashtags", label: "投稿の表現設定" }] });
    }
    const allowedTags = new Set(opt.hashtags.map((t) => norm(t.replace(/^[#＃]/, ""))));
    const unknownTags = tags.filter((r) => !allowedTags.has(norm(v.text.slice(r.start + 1, r.end))));
    if (unknownTags.length) {
      add({ ruleId: "hashtag", severity: "info", title: "既定以外のハッシュタグ", message: `既定のハッシュタグ（${opt.hashtags.join(" ") || "未設定"}）以外を使っています。`, segmentIndex: v.index, ranges: unknownTags, refs: [], keyExtra: "unknown" });
    }
    // URL
    for (const u of extractUrlsWithIndices(v.text)) {
      let host = "";
      try {
        host = new URL(/^https?:\/\//.test(u.url) ? u.url : `https://${u.url}`).hostname.toLowerCase();
      } catch {
        /* noop */
      }
      const ok = settings.officialDomains.some((d) => host === d.toLowerCase() || host.endsWith(`.${d.toLowerCase()}`)) || /(^|\.)x\.com$|(^|\.)twitter\.com$/.test(host);
      if (!ok) {
        add({ ruleId: "url", severity: "warning", title: `公式ドメイン外の URL（${host || u.url}）`, message: "プロジェクト設定の公式ドメインに登録されていない URL です。リンク先を確認してください。", segmentIndex: v.index, ranges: [u], refs: [{ kind: "setting", id: "officialDomains", label: "公式ドメイン" }] });
      }
    }

    // 読みやすさ
    const isEn = draft.language === "en";
    for (const s of v.sentences) {
      const len = isEn ? s.text.split(/\s+/).filter(Boolean).length : Array.from(s.text).length;
      if ((isEn && len > 30) || (!isEn && len > 80)) {
        add({ ruleId: "readability", severity: "info", title: "一文が長い", message: isEn ? `${len} 語の文です。分けると読みやすくなります。` : `${len} 文字の文です。分けると読みやすくなります。`, segmentIndex: v.index, ranges: [s], refs: [], keyExtra: "long" });
      }
    }
    if (!isEn) {
      const ends = v.sentences.map((s) => s.text.replace(/[」』）)。！？!?\s]+$/u, "").slice(-1));
      let run = 1;
      for (let k = 1; k < ends.length; k++) {
        run = ends[k] && ends[k] === ends[k - 1] ? run + 1 : 1;
        if (run === 4) {
          add({ ruleId: "readability", severity: "info", title: `同じ文末「〜${ends[k]}」が続いています`, message: "同じ文末が 4 回以上続くと単調に読まれがちです。", segmentIndex: v.index, ranges: [v.sentences[k]], refs: [], keyExtra: "ending" });
        }
      }
    }
    if (!v.text.includes("\n") && Array.from(v.text).length > 110 && !isEn) {
      add({ ruleId: "readability", severity: "info", title: "改行のない長い段落", message: "スマホでは一塊に見えます。意味の切れ目で改行を入れると読みやすくなります。", segmentIndex: v.index, ranges: [], refs: [], keyExtra: "block" });
    }

    // 英語の意味確認
    if (draft.language === "en") {
      if (!v.seg.jaGloss.trim()) {
        add({ ruleId: "gloss", severity: "warning", title: "日本語の意味確認がありません", message: "英語の下書きには、意味を確認するための日本語を添えてください（自動では一致を確認できません）。", segmentIndex: v.index, ranges: [], refs: [] });
      } else if (!HAS_JA.test(v.seg.jaGloss)) {
        add({ ruleId: "gloss", severity: "warning", title: "意味確認が日本語になっていません", message: "意味確認欄に日本語が含まれていません。", segmentIndex: v.index, ranges: [], refs: [], keyExtra: "notja" });
      }
    }
    // 言語
    const jaCount = (v.text.match(JA_CHAR) ?? []).length;
    const total = Array.from(v.text.replace(/\s/g, "")).length || 1;
    if (draft.language === "en" && jaCount / total > 0.3) {
      add({ ruleId: "language", severity: "warning", title: "英語の下書きに日本語が多く含まれています", message: "言語の設定と本文が合っているか確認してください。", segmentIndex: v.index, ranges: [], refs: [] });
    } else if (draft.language === "ja" && total > 20 && jaCount / total < 0.1) {
      add({ ruleId: "language", severity: "info", title: "日本語の下書きがほぼ英語です", message: "言語の設定を「英語」にすると、英語向けの確認（意味確認）が有効になります。", segmentIndex: v.index, ranges: [], refs: [] });
    }

    // 学び
    for (const l of ctx.learnings) {
      if (!l.active || l.kind !== "dont" || !l.pattern.trim()) continue;
      const rs = findAll(v.text, l.pattern);
      if (!rs.length) continue;
      add({ ruleId: "learning", severity: "warning", title: `過去の学びに該当「${l.pattern}」`, message: l.text, segmentIndex: v.index, ranges: rs, refs: [{ kind: "learning", id: l.id, label: l.text }] });
    }

    // CTA
    const cta = findRegex(v.text, CTA_PATTERN.source);
    if (opt.cta === "none" && cta.length) {
      add({ ruleId: "cta", severity: "warning", title: `行動の呼びかけ「${v.text.slice(cta[0].start, cta[0].end)}」`, message: "この投稿は CTA「なし」の設定です。", segmentIndex: v.index, ranges: cta, refs: [{ kind: "setting", id: "cta", label: "投稿の表現設定" }] });
    }
  }
  if (post.options.cta === "explicit" && !views.some((v) => findRegex(v.text, CTA_PATTERN.source).length || (post.options.ctaText && findAll(v.text, post.options.ctaText).length))) {
    add({ ruleId: "cta", severity: "info", title: "呼びかけが見当たりません", message: "CTA「明示」の設定ですが、本文に呼びかけが見つかりません。", segmentIndex: null, ranges: [], refs: [], keyExtra: "missing" });
  }

  // 初見の人への手がかり
  const anchorsList = settings.identityAnchors.filter(Boolean);
  if (!anchorsList.length) {
    add({ ruleId: "context-anchor", severity: "info", title: "識別語が未設定です", message: "プロジェクト設定に「ゲーム名などの識別語」を登録すると、初見の人に伝わるかを確認できます。", segmentIndex: null, ranges: [], refs: [{ kind: "setting", id: "identityAnchors", label: "識別語" }] });
  } else {
    const where = views.map((v) => anchorsList.some((a) => findAll(v.text, a).length));
    const strongTypes = ["showcase", "recruit", "devlog", "gameplay"];
    if (!where.some(Boolean)) {
      add({
        ruleId: "context-anchor",
        severity: strongTypes.includes(post.type) ? "warning" : "info",
        title: "何のゲームか分かる手がかりがありません",
        message: `識別語（${anchorsList.join("・")}）が投稿にありません。${post.type === "story" || post.type === "series" ? "物語投稿なら、最後に「※開発中の〜より」のような注記行を添える方法があります。" : "初見の人に何のゲームか伝わるよう、ゲーム名と一言説明を入れてください。"}`,
        segmentIndex: null,
        ranges: [],
        refs: [{ kind: "setting", id: "identityAnchors", label: "識別語" }],
      });
    } else if (views.length > 1 && !where[0]) {
      add({ ruleId: "context-anchor", severity: "info", title: "1 投稿目に手がかりがありません", message: "スレッドの 1 投稿目だけが表示されることが多いため、1 投稿目に識別語があると伝わりやすくなります。", segmentIndex: 0, ranges: [], refs: [], keyExtra: "first" });
    }
  }

  /* ---------------- 重複 ---------------- */
  const mine = stripForCompare(allText);
  if (mine.trim()) {
    for (const t of recentTextsAll(ctx, post)) {
      const sim = similarity(mine, stripForCompare(t.text));
      if (sim < settings.duplicateWarn) continue;
      const common = longestCommonSubstring(mine, stripForCompare(t.text));
      add({
        ruleId: "duplicate",
        severity: sim >= settings.duplicateError ? "error" : "warning",
        title: `過去の投稿と似ています（類似度 ${Math.round(sim * 100)}%）`,
        message: `「${t.post.title}」（${t.post.status === "posted" ? "投稿済み" : "承認済み"}）と文字の重なりが大きいです。${common.length >= 8 ? `共通部分：「${common.slice(0, 60)}${common.length > 60 ? "…" : ""}」` : ""}`,
        segmentIndex: null,
        ranges: [],
        refs: [{ kind: "post", id: t.post.id, label: t.post.title, detail: t.post.publication?.url }],
        keyExtra: t.post.id,
      });
    }
    // 書き出しの重複
    const opening = norm(mine).replace(/[\s\p{P}]/gu, "").slice(0, 10);
    if (opening.length >= 8) {
      const same = recentTexts.find((t) => norm(stripForCompare(t.text)).replace(/[\s\p{P}]/gu, "").startsWith(opening));
      if (same && !findings.some((f) => f.ruleId === "duplicate" && f.refs[0]?.id === same.post.id)) {
        add({ ruleId: "duplicate", severity: "info", title: "書き出しが過去の投稿と同じです", message: `「${same.post.title}」と書き出しが同じです。タイムラインで同じ投稿に見えないか確認してください。`, segmentIndex: 0, ranges: [], refs: [{ kind: "post", id: same.post.id, label: same.post.title }], keyExtra: "opening" });
      }
    }
    for (const ex of entries.filter((e) => e.kind === "example" && e.status !== "deprecated" && e.details.exampleText.trim())) {
      const sim = similarity(mine, stripForCompare(ex.details.exampleText));
      if (ex.details.polarity === "bad" && sim >= 0.3) {
        add({ ruleId: "example-similarity", severity: "warning", title: `悪い例に似ています（${Math.round(sim * 100)}%）`, message: `「${ex.title}」に似ています。理由：${ex.details.exampleReason || "（未記入）"}`, segmentIndex: null, ranges: [], refs: [entryRef(ex)] });
      } else if (ex.details.polarity === "good" && sim >= 0.6) {
        add({ ruleId: "example-similarity", severity: "info", title: `良い例をほぼ写しています（${Math.round(sim * 100)}%）`, message: `「${ex.title}」とほぼ同じです。型をなぞるだけでなく、今回の出来事を書いてください。`, segmentIndex: null, ranges: [], refs: [entryRef(ex)] });
      }
    }
  }

  /* ---------------- 企画との整合 ---------------- */
  for (const fid of post.brief.factIds) {
    const e = byId.get(fid);
    if (!e) continue;
    const seen = views.some((v) => mentions(e, v).length);
    if (!seen) {
      add({ ruleId: "facts-coverage", severity: "info", title: `伝えたい事実「${e.title}」が見当たりません`, message: "企画で選んだ事実の名前が本文にありません。言い換えて書いている場合は問題ありません。", segmentIndex: null, ranges: [], refs: [entryRef(e)] });
    }
    if (e.status === "deprecated") {
      add({ ruleId: "deprecated-canon", severity: "error", title: `企画に廃止された事実「${e.title}」`, message: "企画の「伝えたい事実」に廃止された項目が選ばれています。", segmentIndex: null, ranges: [], refs: [entryRef(e)], keyExtra: "brief" });
    }
  }

  if (post.type === "recruit") {
    if (!linkedNotice.length) {
      add({ ruleId: "recruit-notice", severity: "error", title: "募集要項が紐付いていません", message: "テスト参加者の募集には、確定済みの告知情報（日程・参加方法・条件）を正本に登録し、企画の「伝えたい事実」で選んでください。", segmentIndex: null, ranges: [], refs: [] });
    } else {
      const noticeDates = new Set(linkedNotice.flatMap((n) => extractDates(entryFullText(n)).map((d) => d.md)));
      for (const v of views) {
        for (const d of extractDates(v.text)) {
          if (noticeDates.has(d.md)) continue;
          add({ ruleId: "recruit-notice", severity: "warning", title: `告知情報にない日付「${d.raw}」`, message: `紐付いた告知情報の日付（${Array.from(noticeDates).join("、") || "なし"}）と一致しません。`, segmentIndex: v.index, ranges: [d.range], refs: linkedNotice.map((n) => entryRef(n)) });
        }
      }
    }
  }

  for (const pid of post.brief.continuesPostIds) {
    const prev = ctx.posts.find((p) => p.id === pid);
    if (!prev) {
      add({ ruleId: "series", severity: "warning", title: "続き元の投稿が見つかりません", message: "続き元に指定した投稿が削除されています。", segmentIndex: null, ranges: [], refs: [], keyExtra: pid });
    } else if (prev.status !== "posted") {
      add({ ruleId: "series", severity: "info", title: `続き元「${prev.title}」はまだ投稿されていません`, message: "読者は前回の物語をまだ読んでいません。投稿の順番を確認してください。", segmentIndex: null, ranges: [], refs: [{ kind: "post", id: prev.id, label: prev.title }], keyExtra: pid });
    }
  }

  /* ---------------- 根拠マップ ---------------- */
  const provenance: SentenceProvenance[] = [];
  for (const v of views) {
    for (const s of v.sentences) {
      const tagOnly = !s.text.replace(/[#＃][\p{L}\p{N}_\u30FC]+/gu, "").replace(/https?:\/\/\S+/g, "").trim();
      if (inFrame(v, s) || tagOnly) {
        provenance.push({ segmentIndex: v.index, text: s.text, start: s.start, end: s.end, basis: "frame", refs: [] });
        continue;
      }
      const refs: FindingRef[] = [];
      let hasFact = false;
      let hasCanon = false;
      let hasProposed = false;
      for (const e of entries) {
        if (e.status === "deprecated") continue;
        if (!namesOf(e).some((n) => findAll(s.text, n).length)) continue;
        refs.push(entryRef(e, e.status === "proposed" ? "提案" : undefined));
        if (e.status === "proposed") hasProposed = true;
        else if (KIND_DOMAIN[e.kind] === "reality") hasFact = true;
        else hasCanon = true;
      }
      const basis: ProvenanceBasis = hasFact ? "fact" : hasCanon ? "canon" : hasProposed ? "unconfirmed" : "invented";
      provenance.push({ segmentIndex: v.index, text: s.text, start: s.start, end: s.end, basis, refs });
    }
  }

  // 同じ実績項目について「根拠のない実績」と「未確定の設定」が重なる場合は前者だけ残す
  const claimRefIds = new Set(findings.filter((f) => f.ruleId === "claim-evidence").flatMap((f) => f.refs.map((r) => r.id)));
  for (let i = findings.length - 1; i >= 0; i--) {
    const f = findings[i];
    if (f.ruleId === "proposed-canon" && f.refs.some((r) => claimRefIds.has(r.id))) findings.splice(i, 1);
  }

  findings.sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity] || (a.segmentIndex ?? -1) - (b.segmentIndex ?? -1));
  return {
    ranAt: now.toISOString(),
    draftId: draft.id,
    findings,
    counts: {
      error: findings.filter((f) => f.severity === "error").length,
      warning: findings.filter((f) => f.severity === "warning").length,
      info: findings.filter((f) => f.severity === "info").length,
    },
    segments: segStats,
    provenance,
  };
}

/** 重複比較の対象：同じプロジェクトの承認済み・投稿済み（自分自身を除く）。 */
function recentTextsAll(ctx: CheckContext, post: Post): { post: Post; text: string }[] {
  return ctx.posts
    .filter((p) => p.id !== post.id && (p.status === "posted" || p.status === "approved"))
    .map((p) => {
      const d = currentDraft(p);
      return { post: p, text: p.publication?.postedText || (d ? draftPlainText(d) : "") };
    })
    .filter((t) => t.text.trim());
}

/** 承認をブロックする未確認の要修正指摘。 */
export function unacknowledgedErrors(report: CheckReport, acknowledged: { findingKey: string }[]): Finding[] {
  const ack = new Set(acknowledged.map((a) => a.findingKey));
  return report.findings.filter((f) => f.severity === "error" && !ack.has(f.key));
}

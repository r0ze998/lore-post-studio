/**
 * 生成用の資料選びとプロンプト作成。
 * API でも手動中継でも同じプロンプトを使い、送信前に「何を送るか」を画面で確認できるようにする。
 *
 * 送らないもの（既定）:
 * - 他のプロジェクトのデータ（そもそも読み込まない）
 * - 公開区分が「未公開」の項目（本人が個別に選んだ場合のみ送る）
 * - 提案段階の項目（企画で明示的に選んだものだけ「未確定」と明記して送る）
 * - 廃止した項目の本文（名前だけを「使わない語」として送る。未公開なら名前も送らない）
 * - 素材のファイル本体（説明文と代替テキストのみ）
 */
import type { Asset, Entry, Learning, Post, Project } from "@/lib/domain/schema";
import { KIND_DOMAIN } from "@/lib/domain/schema";
import { CLAIM_TYPE_LABEL, ENTRY_KIND_LABEL, FEATURE_STATUS_LABEL, POST_TYPE_LABEL, STATUS_LABEL } from "@/lib/domain/labels";
import { namesOf } from "@/lib/domain/canon";
import { findAll } from "@/lib/domain/match";
import { currentDraft, draftPlainText } from "@/lib/checks/engine";
import { DEFAULT_BANNED_PHRASES } from "@/lib/checks/lexicon";
import type { ContextItem, GenerationTask, PromptPackage } from "./types";

export interface PromptInput {
  project: Project;
  entries: Entry[];
  posts: Post[];
  learnings: Learning[];
  assets: Asset[];
  post: Post;
  task: GenerationTask;
  angleId?: string;
  /** 「未公開」でも今回だけ送ると本人が選んだ項目。 */
  includeInternalIds?: string[];
  extraInstruction?: string;
}

const MAX_CONTEXT_CHARS = 40000;

export function fnv1a(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, "0") + s.length.toString(16);
}

function item(e: Entry, reason?: string): ContextItem {
  return { id: e.id, kind: ENTRY_KIND_LABEL[e.kind], title: e.title, status: STATUS_LABEL[e.status], reason, internal: e.visibility === "internal" || undefined };
}

export const REDACTED = "［未公開のため伏せ字］";

/**
 * 自由文から未公開の名前を伏せる。
 * 企画メモ・学び・過去の下書きなどは正本の公開区分では選別できないため、名前の一致で伏せる。
 * （名前を使わずに未公開の内容を書いた文までは判別できない。）
 */
export function makeRedactor(entries: Entry[], optIn: Set<string>) {
  const names = Array.from(
    new Set(entries.filter((e) => e.visibility === "internal" && !optIn.has(e.id)).flatMap(namesOf)),
  ).sort((a, b) => b.length - a.length);
  const counts = new Map<string, number>();
  const redact = (text: string, where: string): string => {
    if (!text || !names.length) return text;
    let out = text;
    let n = 0;
    for (const name of names) {
      const ranges = findAll(out, name);
      for (const r of [...ranges].reverse()) {
        out = out.slice(0, r.start) + REDACTED + out.slice(r.end);
        n++;
      }
    }
    if (n) counts.set(where, (counts.get(where) ?? 0) + n);
    return out;
  };
  return { redact, report: () => Array.from(counts, ([where, count]) => ({ where, count })) };
}

export function selectContext(input: PromptInput): { included: Entry[]; excluded: { entry: Entry; reason: string }[]; doNotUse: string[] } {
  const { entries, post } = input;
  const optIn = new Set(input.includeInternalIds ?? []);
  // 本人が個別に送ると選んだ項目は、企画で選んだものとして扱う
  const chosen = new Set([...post.brief.canonIds, ...post.brief.factIds, ...optIn]);
  const included: Entry[] = [];
  const excluded: { entry: Entry; reason: string }[] = [];
  const doNotUse: string[] = [];
  for (const e of entries) {
    if (e.status === "deprecated") {
      if (e.visibility === "internal") excluded.push({ entry: e, reason: "廃止・未公開（名前も送らない）" });
      else {
        doNotUse.push(...namesOf(e));
        excluded.push({ entry: e, reason: "廃止（名前だけを「使わない語」として送る）" });
      }
      continue;
    }
    if (e.visibility === "internal" && !optIn.has(e.id)) {
      excluded.push({ entry: e, reason: "未公開" });
      continue;
    }
    if (e.status === "proposed" && !chosen.has(e.id)) {
      excluded.push({ entry: e, reason: "提案段階（企画で選んでいない）" });
      continue;
    }
    if (e.kind === "claim" && !(e.details.evidenceUrl || e.details.evidenceNote)) {
      excluded.push({ entry: e, reason: "根拠のない実績" });
      continue;
    }
    if (e.kind === "testimonial" && !e.details.consent) {
      excluded.push({ entry: e, reason: "本人の同意がない声" });
      continue;
    }
    included.push(e);
  }
  // 大きすぎる場合は、企画で選んでいない世界設定から落とす
  let size = included.reduce((n, e) => n + e.title.length + e.body.length + 80, 0);
  if (size > MAX_CONTEXT_CHARS) {
    const droppable = included
      .filter((e) => !chosen.has(e.id) && (e.kind === "lore" || e.kind === "event" || e.kind === "example"))
      .sort((a, b) => b.body.length - a.body.length);
    for (const e of droppable) {
      if (size <= MAX_CONTEXT_CHARS) break;
      included.splice(included.indexOf(e), 1);
      excluded.push({ entry: e, reason: "分量の上限（企画で選ぶと送ります）" });
      size -= e.title.length + e.body.length + 80;
    }
  }
  return { included, excluded, doNotUse: Array.from(new Set(doNotUse)) };
}

function entryBlock(e: Entry, chosen: Set<string>): string {
  const d = e.details;
  const lines = [`- [${e.id}] ${ENTRY_KIND_LABEL[e.kind]}「${e.title}」（${STATUS_LABEL[e.status]}${chosen.has(e.id) ? "・今回使う" : ""}）`];
  if (e.aliases.length) lines.push(`  別名: ${e.aliases.join(" / ")}`);
  if (e.body) lines.push(`  内容: ${e.body}`);
  if (e.kind === "term") {
    if (d.reading) lines.push(`  読み: ${d.reading}`);
    if (d.forbiddenVariants.length) lines.push(`  誤表記（使わない）: ${d.forbiddenVariants.join(" / ")}`);
  }
  if (e.kind === "character" && d.speechStyle) lines.push(`  話し方: ${d.speechStyle}`);
  if (e.kind === "voice") {
    lines.push(`  語りの種類: ${d.voiceMode === "in_world" ? "世界内の語り" : "開発者の語り"}`);
    if (d.doList.length) lines.push(`  すること: ${d.doList.join(" / ")}`);
    if (d.dontList.length) lines.push(`  しないこと: ${d.dontList.join(" / ")}`);
    if (d.signaturePhrases.length) lines.push(`  特有の言い回し: ${d.signaturePhrases.join(" / ")}`);
  }
  if (e.kind === "visual") {
    if (d.palette) lines.push(`  色調: ${d.palette}`);
    if (d.avoid.length) lines.push(`  避ける: ${d.avoid.join(" / ")}`);
  }
  if (e.kind === "example") {
    lines.push(`  ${d.polarity === "bad" ? "悪い例" : "良い例"}: ${d.exampleText.replace(/\n/g, " / ")}`);
    if (d.exampleReason) lines.push(`  理由: ${d.exampleReason}`);
  }
  if (e.kind === "feature") lines.push(`  実装状況: ${d.featureStatus ? FEATURE_STATUS_LABEL[d.featureStatus] : "未設定"}${d.version ? `（${d.version}）` : ""}`);
  if (e.kind === "claim") lines.push(`  種類: ${d.claimType ? CLAIM_TYPE_LABEL[d.claimType] : "その他"} / 値: ${d.value || "-"} / 根拠あり`);
  if (e.kind === "notice") {
    if (d.period) lines.push(`  期間: ${d.period}`);
    if (d.howToJoin) lines.push(`  参加方法: ${d.howToJoin}`);
    if (d.conditions) lines.push(`  条件: ${d.conditions}`);
  }
  if (e.kind === "testimonial") lines.push(`  引用可（同意あり）: 「${d.quote}」— ${d.speaker}`);
  if (e.contradictions.length) lines.push(`  矛盾する書き方の例: ${e.contradictions.map((c) => c.reason || c.pattern).join(" / ")}`);
  return lines.join("\n");
}

const SYSTEM_RULES = `あなたは、あるゲームの X（旧 Twitter）向け投稿を一緒に作る編集者です。次の約束を必ず守ってください。

1. 根拠は与えられた資料（正本）だけです。資料にない設定・固有名詞・数字を作らないでください。必要なら「［ここに◯◯］」のような穴埋めにしてください。
2. 機能は「実装状況」どおりに書きます。「公開済み」以外の機能を「実装しました」「遊べます」「now live」などと断定しないでください。
3. 受賞・提携・賞金・利用者数などの実績は、資料に「根拠あり」とある実績だけを、その値のまま使います。
4. 実在のプレイヤーの行動、ユーザーの声・感想・推薦を作らないでください。物語は世界の中の出来事として書き、実話に見せないでください。
5. 世界内の語り（voice: "in_world"）と開発者の語り（voice: "developer"）を混ぜないでください。世界内の語りのセグメントに現実側の情報（ゲーム名・募集・リンクなど）を添える場合は、「※」で始まる別の行にしてください。
6. 報酬・無料・配布・先着などサービス提供の約束は、告知情報にあるものだけを、開発者の語りで書きます。
7. 「未来」「革命」「所有」「新時代」のような宣伝文句や、意味の取れない抽象的な詩に頼らないでください。誰が・どこで・何をしたか、何ができるかを具体的に書きます。
8. 初見の人にも何のゲームか分かる手がかり（ゲーム名・一言説明）を、物語の雰囲気を壊さない形で入れてください。
9. 1 セグメント = 1 投稿です。X の文字数（日本語・全角は 1 字 2、半角は 1、URL は 23、上限 280）に収めてください。日本語ならおよそ 130 字以内が目安です。
10. 「使わない語」に挙げた語（廃止した設定）は使わないでください。
11. どこを資料から取り、どこを創作したかを provenance に正直に書いてください（basis: "canon"=世界・表現の資料、"fact"=現実の事実、"invented"=今回の創作、"unknown"=判断できない）。refIds には資料の [ID] を入れます。
12. 英語で書く場合は、各セグメントに日本語の意味（jaGloss）を付けてください。
13. 出力は指定された JSON だけにしてください。`;

export function buildPrompt(input: PromptInput): PromptPackage {
  const { project, post, task } = input;
  const s = project.settings;
  const { included, excluded, doNotUse } = selectContext(input);
  const chosen = new Set([...post.brief.canonIds, ...post.brief.factIds]);
  const { redact: R, report: redactionReport } = makeRedactor(input.entries, new Set(input.includeInternalIds ?? []));

  const world = included.filter((e) => KIND_DOMAIN[e.kind] === "world");
  const style = included.filter((e) => KIND_DOMAIN[e.kind] === "style");
  const reality = included.filter((e) => KIND_DOMAIN[e.kind] === "reality");

  const recent = input.posts
    .filter((p) => p.id !== post.id && (p.status === "posted" || p.status === "approved"))
    .sort((a, b) => (b.publication?.postedAt || b.updatedAt).localeCompare(a.publication?.postedAt || a.updatedAt))
    .slice(0, 5);
  const continues = post.brief.continuesPostIds.map((id) => input.posts.find((p) => p.id === id)).filter((p): p is Post => !!p);
  const learnings = input.learnings.filter((l) => l.active);
  const assets = post.brief.assetIds
    .map((id) => input.assets.find((a) => a.id === id))
    .filter((a): a is Asset => !!a && a.visibility === "public");

  const angle = post.angles.find((a) => a.id === (input.angleId || post.chosenAngleId));
  const banned = [...(s.useDefaultBannedPhrases ? DEFAULT_BANNED_PHRASES : []), ...s.bannedPhrases];
  const opt = post.options;

  const parts: string[] = [];
  parts.push(`# ゲーム\n名前: ${project.name}\n識別語: ${s.identityAnchors.join(" / ") || "（未設定）"}\n一言説明: ${s.oneLiner || "（未設定）"}`);
  parts.push(
    `# 今回の投稿\n種類: ${POST_TYPE_LABEL[post.type]}\n目的: ${R(post.brief.purpose, "企画") || "（未記入）"}\n読者: ${R(post.brief.audience, "企画") || "（未記入）"}\n言語: ${post.brief.language === "en" ? "英語（各セグメントに日本語の意味 jaGloss を付ける）" : "日本語"}\n語り: ${
      post.brief.voice === "in_world" ? "世界内の語り" : post.brief.voice === "developer" ? "開発者の語り" : "両方（セグメントごとに分ける）"
    }\nメモ: ${R(post.brief.notes, "企画") || "なし"}${post.brief.seriesName ? `\n連載名: ${R(post.brief.seriesName, "企画")}` : ""}`,
  );
  parts.push(
    `# 表現の設定\n絵文字: ${opt.emoji === "none" ? "使わない" : opt.emoji === "few" ? `${opt.maxEmoji} 個まで` : "自由"}\nハッシュタグ: ${opt.maxHashtags} 個まで（使ってよいもの: ${opt.hashtags.join(" ") || "なし"}）\n行動の呼びかけ（CTA）: ${
      opt.cta === "none" ? "入れない" : opt.cta === "soft" ? "控えめに一言まで" : `入れる${opt.ctaText ? `（文言: ${opt.ctaText}）` : ""}`
    }\n避ける宣伝文句: ${banned.slice(0, 30).join(" / ")}`,
  );
  if (angle) parts.push(`# 選んだ切り口\n${R(angle.title, "切り口")}\n${R(angle.approach, "切り口")}`);
  const fmt = (xs: Entry[]) => xs.map((e) => entryBlock(e, chosen)).join("\n") || "（なし）";
  parts.push(`# 世界の設定（創作）\n${fmt(world)}`);
  parts.push(`# 語り口・表現・投稿例\n${fmt(style)}`);
  parts.push(`# 現実の事実（機能・実績・告知）\n${fmt(reality)}`);
  if (doNotUse.length) parts.push(`# 使わない語（廃止した設定）\n${doNotUse.join(" / ")}`);
  if (assets.length) {
    parts.push(`# 添付予定の素材（説明のみ）\n${assets.map((a) => `- ${R(a.title, "素材の説明")}: ${R(a.description, "素材の説明") || "（説明なし）"}${a.altText ? ` / ALT: ${R(a.altText, "素材の説明")}` : ""}`).join("\n")}`);
  }
  if (learnings.length) {
    parts.push(`# これまでの学び（採用・却下の理由）\n${learnings.map((l) => `- ${l.kind === "do" ? "する" : "しない"}: ${R(l.text, "学び")}`).join("\n")}`);
  }
  if (continues.length) {
    parts.push(
      `# 続き元の投稿（この続きを書く）\n${continues
        .map((p) => {
          const d = currentDraft(p);
          return `- 「${R(p.title, "続き元の投稿")}」${p.status === "posted" ? "（投稿済み）" : "（未投稿）"}:\n${d ? R(draftPlainText(d), "続き元の投稿") : ""}`;
        })
        .join("\n")}`,
    );
  }
  if (recent.length) {
    parts.push(
      `# 最近の投稿（同じ言い回し・同じ構成を繰り返さない）\n${recent
        .map((p) => {
          const d = currentDraft(p);
          return `- ${R((p.publication?.postedText || (d ? draftPlainText(d) : "")).replace(/\n/g, " / ").slice(0, 240), "最近の投稿")}`;
        })
        .join("\n")}`,
    );
  }
  if (task === "draft") {
    const cur = currentDraft(post);
    if (cur && cur.segments.some((x) => x.text.trim())) {
      parts.push(`# 現在の下書き（参考。改善してよい）\n${R(draftPlainText(cur), "現在の下書き")}`);
    }
  }
  if (input.extraInstruction?.trim()) parts.push(`# 追加の指示\n${R(input.extraInstruction.trim(), "追加の指示")}`);

  if (task === "angles") {
    parts.push(
      `# 依頼\nこの投稿の切り口を 3〜5 個提案してください。互いに違う方向にし、それぞれ「何を書くか（approach）」と「なぜ伝わるか（why）」を具体的に書いてください。宣伝文句ではなく、資料にある具体的な要素を使ってください。\n\n# 出力（JSON のみ）\n{"angles":[{"title":"短い見出し","approach":"何をどう書くか","why":"なぜ初見の人にも伝わるか"}]}`,
    );
  } else {
    parts.push(
      `# 依頼\n${angle ? "選んだ切り口で" : "企画に沿って"}下書きを 1 案書いてください。スレッドにする場合はセグメントを分けてください（必要なときだけ）。\n\n# 出力（JSON のみ）\n{"segments":[{"text":"投稿本文","voice":"in_world か developer","jaGloss":"英語の場合の日本語の意味（日本語なら空）","provenance":[{"quote":"本文の一部","basis":"canon|fact|invented|unknown","refIds":["資料のID"],"note":"補足"}]}],"creativeNotes":"資料にない創作をした点のまとめ"}`,
    );
  }

  const user = parts.join("\n\n");
  const exclusionItems = excluded.map((x) => item(x.entry, x.reason));
  return {
    task,
    system: SYSTEM_RULES,
    user,
    included: included.map((e) => item(e)),
    excluded: exclusionItems,
    redactions: redactionReport(),
    chars: SYSTEM_RULES.length + user.length,
    hash: fnv1a(SYSTEM_RULES + "\n" + user),
  };
}

/** 手動中継用：外部のチャットに貼る一つの文章。 */
export function relayText(p: PromptPackage): string {
  return `${p.system}\n\n---\n\n${p.user}`;
}

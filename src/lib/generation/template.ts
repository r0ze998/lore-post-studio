/**
 * テンプレート生成（外部送信なし・モデル不要）。
 *
 * 文章を「書いたふり」はしない。正本から確実に言えることだけを埋め、
 * 創作が必要な部分は［穴埋め］として残す（穴埋めが残ると検査で止まる）。
 */
import type { Angle, Entry, Post, Project, Segment } from "@/lib/domain/schema";
import { FEATURE_STATUS_LABEL } from "@/lib/domain/labels";
import type { AnglesOutput, DraftOutput } from "./types";

interface Ctx {
  project: Project;
  entries: Entry[];
  posts: Post[];
  post: Post;
}

const usable = (e: Entry) => e.status === "confirmed" && e.visibility === "public";

function pick(ctx: Ctx, kind: Entry["kind"]): Entry[] {
  const chosen = new Set([...ctx.post.brief.canonIds, ...ctx.post.brief.factIds]);
  const xs = ctx.entries.filter((e) => e.kind === kind && (usable(e) || (chosen.has(e.id) && e.visibility === "public" && e.status !== "deprecated")));
  // 企画で選んだものを先に
  return xs.sort((a, b) => Number(chosen.has(b.id)) - Number(chosen.has(a.id)));
}

function enName(e: Entry): string {
  return e.aliases.find((a) => /^[\x20-\x7e]+$/.test(a)) ?? e.title;
}

function anchor(p: Project): string {
  return p.settings.identityAnchors[0] ?? p.name;
}

function frameLine(ctx: Ctx, en: boolean): string {
  const a = anchor(ctx.project);
  if (en) return `※ From the world of ${a}, a game in development`;
  const one = ctx.project.settings.oneLiner.replace(/（.*?）/g, "");
  return one ? `※開発中の${one.replace(/ゲーム$/, "")}ゲーム『${a}』より` : `※開発中のゲーム『${a}』より`;
}

function signature(ctx: Ctx): string {
  const v = pick(ctx, "voice").find((e) => e.details.voiceMode === "in_world");
  return v?.details.signaturePhrases.find((s) => /^[—―-]/.test(s)) ?? "";
}

export function templateAngles(ctx: Ctx): AnglesOutput {
  const t = ctx.post.type;
  const chars = pick(ctx, "character");
  const terms = pick(ctx, "term");
  const feats = pick(ctx, "feature");
  const notices = pick(ctx, "notice");
  const c = chars[0]?.title ?? "登場人物";
  const term = terms[0]?.title ?? "用語";
  const f = feats[0];
  const list: AnglesOutput["angles"] = [];
  switch (t) {
    case "story":
    case "showcase":
      list.push(
        { title: `${c}の一場面`, approach: `${c}が一つの具体的な行動をする場面を、世界内の語り手の記録として書く。日付・場所・行動・結果を一つずつ。`, why: "一つの行動に絞ると、抽象語に頼らず世界の手触りが伝わる。" },
        { title: `「${term}」を一つだけ見せる`, approach: `${term}が実際に使われる瞬間を描き、説明はしない。最後の※行で何のゲームかを添える。`, why: "用語の意味を場面から推測させると、初見の人も世界に入りやすい。" },
        { title: "物から世界を見せる", approach: "道具・食べ物・値段など一つの物の描写から、その世界の暮らしを見せる。", why: "具体的な物は、説明より早く世界の前提を伝える。" },
      );
      if (t === "showcase") list.push({ title: "素材の一点に注目", approach: "添付する画像・動画の中の一点（人物・物・場所）を取り上げ、そこで何が起きているかを一文で書く。", why: "画像と本文が同じ点を指すと、目が止まりやすい。" });
      break;
    case "gameplay":
      list.push(
        { title: "選択の瞬間", approach: "プレイヤーが迫られる二択を一つ示し、それぞれで何が起きるかを書く（実装済みの仕組みだけ）。", why: "遊びの核心は「選ぶ」こと。仕組みの説明より選択の場面の方が伝わる。" },
        { title: "駆け引きの一手", approach: f ? `「${f.title}」（${f.details.featureStatus ? FEATURE_STATUS_LABEL[f.details.featureStatus] : "状況未設定"}）を使った相手とのやりとりを一例として示す。架空の対戦例であることを明記する。` : "相手との駆け引きが生まれる仕組みを一例で示す。", why: "具体例があると、ルールを知らない人にも面白さの形が分かる。" },
        { title: "ルールを一つだけ", approach: "開発者の語りで、ルールを一つだけ短く説明する。", why: "一投稿一ルールにすると読み切れる。" },
      );
      break;
    case "devlog":
      list.push(
        { title: "できるようになったこと", approach: f ? `「${f.title}」で何ができるかを、操作の順に短く書く。実装状況（${f.details.featureStatus ? FEATURE_STATUS_LABEL[f.details.featureStatus] : "未設定"}）どおりの言い方にする。` : "公開済みの機能で何ができるかを書く。", why: "機能名より「何ができるか」の方が伝わる。" },
        { title: "なぜこう作ったか", approach: "設計で迷った点と、選んだ理由を一つ書く。", why: "判断の理由は、開発者の語りでしか書けない固有の情報。" },
        { title: "公開済み・開発中を並べる", approach: "公開済みの機能と、開発中・構想中の機能を、状態を明記して並べる。", why: "期待のずれを防ぎつつ、進捗が見える。" },
      );
      break;
    case "recruit":
      list.push(
        { title: "要項を正確に", approach: notices[0] ? `「${notices[0].title}」の期間・参加方法・条件を、告知情報どおりに書く。` : "告知情報（期間・参加方法・条件）を正本に登録してから書く。", why: "募集は正確さが最優先。誤った条件は信頼を損なう。" },
        { title: "テストで確かめたいこと", approach: "このテストで何を確かめたいか（遊びのどこを見てほしいか）を一つ書く。", why: "参加する理由が具体的になる。" },
        { title: "世界から呼びかける＋現実の要項", approach: "1 投稿目は世界内の語りで短い場面、2 投稿目は開発者の語りで要項（スレッド）。", why: "世界観を保ちながら、約束は現実側で正確に伝えられる。" },
      );
      break;
    case "series":
      list.push(
        { title: "前回の結末から一歩", approach: "続き元の投稿の最後の状況から、一歩だけ進んだ場面を書く。前回の出来事を一言で受ける。", why: "前回を読んでいない人にも状況が分かり、読んだ人には続きになる。" },
        { title: "別の人物の視点", approach: "前回と同じ出来事を、別の登場人物の視点で短く書く。", why: "同じ出来事を別の角度で見せると、世界に奥行きが出る。" },
      );
      break;
  }
  return { angles: list };
}

function seg(text: string, voice: Segment["voice"], jaGloss = "", refs: Entry[] = []): DraftOutput["segments"][number] {
  return {
    text,
    voice,
    jaGloss,
    provenance: refs.map((e) => ({ quote: e.title, basis: e.kind === "feature" || e.kind === "notice" || e.kind === "claim" ? "fact" : "canon", refIds: [e.id], note: "テンプレートが正本から埋めた" })),
  };
}

function featurePhrase(f: Entry, en: boolean): string {
  const st = f.details.featureStatus;
  if (en) {
    return { released: "is now available", testing: "is in testing (limited)", in_development: "is in development", planned: "is planned", concept: "is an early concept", cancelled: "has been cancelled" }[st ?? "concept"];
  }
  return { released: "を実装しました", testing: "をテスト版で試しています", in_development: "を開発中です", planned: "を実装予定です", concept: "を構想中です", cancelled: "は中止しました" }[st ?? "concept"];
}

export function templateDraft(ctx: Ctx, angle?: Angle): DraftOutput {
  const en = ctx.post.brief.language === "en";
  const t = ctx.post.type;
  const chars = pick(ctx, "character");
  const terms = pick(ctx, "term");
  const feats = pick(ctx, "feature").filter((f) => f.details.featureStatus !== "cancelled");
  const notices = pick(ctx, "notice");
  const sig = signature(ctx);
  const a = anchor(ctx.project);
  const c = chars[0];
  const term = terms[0];
  const segments: DraftOutput["segments"] = [];
  const notes: string[] = ["テンプレート生成：［］の部分は創作が必要です。書き換えてから検査してください。"];

  if (t === "story" || t === "showcase" || t === "series") {
    const who = c ? (en ? enName(c) : c.title) : en ? "［who］" : "［誰が］";
    if (en) {
      segments.push(
        seg(`［Date］. ${who} ［did one concrete thing］ at ［place］. ［What happened next, in one sentence］.${sig ? ` ${sig}` : ""}\n${frameLine(ctx, true)}`, "in_world", `［日付］。${c?.title ?? "［誰が］"}が［場所］で［具体的な行動］。［その結果を一文で］。\n※開発中のゲーム『${a}』の世界から`, c ? [c] : []),
      );
    } else {
      const lead = t === "series" ? "［前回の出来事を一言で受ける］。" : "";
      segments.push(seg(`［日付］。${lead}${who}が［場所］で［具体的な行動］。［その結果を一文で］。${sig}\n${frameLine(ctx, false)}`, "in_world", "", c ? [c] : []));
    }
    if (angle?.title.includes("「") && term) notes.push(`切り口の用語「${term.title}」を場面の中に入れてください。`);
  } else if (t === "gameplay") {
    segments.push(
      en
        ? seg(`In ${a}, you ［face a choice］: ［option A］ or ［option B］. ［What each choice risks］.`, "developer", `『${a}』では、［選択］を迫られます。［A］か［B］か。［それぞれのリスク］。`)
        : seg(`『${a}』では、［選択の場面］。［A］を選ぶと［結果］、［B］を選ぶと［結果］。`, "developer"),
    );
  } else if (t === "devlog") {
    const f = feats.find((x) => ctx.post.brief.factIds.includes(x.id)) ?? feats[0];
    if (f) {
      segments.push(
        en
          ? seg(`[Devlog] ${enName(f)} ${featurePhrase(f, true)}${f.details.version ? ` (${f.details.version})` : ""}. ［What you can do with it, in one sentence］. #${a.replace(/\s+/g, "")}`, "developer", `【開発メモ】「${f.title}」は${FEATURE_STATUS_LABEL[f.details.featureStatus ?? "concept"]}です。［何ができるかを一文で］。`, [f])
          : seg(`【開発メモ】${f.details.version ? `${f.details.version} で` : ""}「${f.title}」${featurePhrase(f, false)}。［何ができるかを一文で］。［なぜ作ったかを一文で］。${ctx.post.options.hashtags[0] ? ` ${ctx.post.options.hashtags[0]}` : ""}`, "developer", "", [f]),
      );
    } else {
      segments.push(seg(en ? `[Devlog] ［feature］ ［status］.` : `【開発メモ】［機能名］［実装状況どおりの言い方］。`, "developer"));
      notes.push("機能台帳に機能が登録されていません。");
    }
  } else if (t === "recruit") {
    const n = notices.find((x) => ctx.post.brief.factIds.includes(x.id)) ?? notices[0];
    if (n) {
      const d = n.details;
      segments.push(
        en
          ? seg(`${a}: ${n.aliases.find((x) => /^[\x20-\x7e]+$/.test(x)) ?? n.title}\nPeriod: ${d.period}\nHow to join: ${d.howToJoin}\nConditions: ${d.conditions}`, "developer", `『${a}』${n.title}\n期間：${d.period}\n参加方法：${d.howToJoin}\n条件：${d.conditions}`, [n])
          : seg(`『${a}』${n.title}\n期間：${d.period}\n参加方法：${d.howToJoin}\n条件：${d.conditions}`, "developer", "", [n]),
      );
      notes.push("要項は告知情報の文面をそのまま使いました。長い場合はスレッドに分けてください。");
    } else {
      segments.push(seg(`『${a}』［募集の見出し］\n期間：［告知情報に登録］\n参加方法：［告知情報に登録］`, "developer"));
      notes.push("告知情報が正本にありません。");
    }
  }
  return { segments, creativeNotes: notes.join("\n") };
}

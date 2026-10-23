/**
 * 書き出し用の文章を作る（ブラウザ・サーバー共通）。
 */
import type { Asset, DraftVersion, Entry, Post, Project } from "./schema";
import { POST_STATUS_LABEL, POST_TYPE_LABEL } from "./labels";

export function threadPlainText(d: DraftVersion): string {
  if (d.segments.length === 1) return d.segments[0].text;
  return d.segments.map((s, i) => `---- ${i + 1}/${d.segments.length} ----\n${s.text}`).join("\n\n");
}

export function approvalOf(post: Post) {
  const last = [...post.decisions].reverse().find((x) => x.draftId === post.currentDraftId);
  return last;
}

export function postMarkdown(project: Project, post: Post, d: DraftVersion, assets: Asset[]): string {
  const ap = approvalOf(post);
  const lines: string[] = [];
  lines.push(`# ${post.title}`);
  lines.push("");
  lines.push(`- プロジェクト: ${project.name}${project.kind === "sample" ? "（架空のサンプル）" : ""}`);
  lines.push(`- 種類: ${POST_TYPE_LABEL[post.type]}`);
  lines.push(`- 状態: ${POST_STATUS_LABEL[post.status]}${post.status !== "approved" && post.status !== "posted" ? "（未承認の下書きです）" : ""}`);
  if (ap) lines.push(`- ${ap.kind === "approved" ? "承認" : "却下"}理由: ${ap.reason}（${ap.at.slice(0, 10)}）`);
  if (ap?.acknowledgements.length) lines.push(`- 確認済みとして承認した指摘: ${ap.acknowledgements.length} 件`);
  if (post.scheduleCandidate) lines.push(`- 予約候補日時: ${post.scheduleCandidate}（このツールは自動投稿しません）`);
  lines.push(`- 言語: ${d.language === "en" ? "英語" : "日本語"} / 書き出し: ${new Date().toISOString()}`);
  lines.push("");
  d.segments.forEach((s, i) => {
    lines.push(`## ${d.segments.length > 1 ? `${i + 1}/${d.segments.length} ` : ""}本文（${s.voice === "in_world" ? "世界内の語り" : "開発者の語り"}）`);
    lines.push("");
    lines.push("```");
    lines.push(s.text);
    lines.push("```");
    if (s.jaGloss) {
      lines.push("");
      lines.push(`日本語の意味確認: ${s.jaGloss}`);
    }
    const as = s.assetIds.map((id) => assets.find((a) => a.id === id)).filter((a): a is Asset => !!a);
    if (as.length) {
      lines.push("");
      lines.push("添付素材:");
      for (const a of as) lines.push(`- ${a.filename}（ALT: ${a.altText || "未記入"}）`);
    }
    lines.push("");
  });
  if (d.creativeNotes) {
    lines.push("## 創作メモ");
    lines.push("");
    lines.push(d.creativeNotes);
    lines.push("");
  }
  return lines.join("\n");
}

export function altTextFile(d: DraftVersion, assets: Asset[]): string {
  const out: string[] = [];
  d.segments.forEach((s, i) => {
    s.assetIds.forEach((id, k) => {
      const a = assets.find((x) => x.id === id);
      if (a) out.push(`[${i + 1}-${k + 1}] ${a.filename}\n${a.altText || "（ALT 未記入）"}\n`);
    });
  });
  return out.join("\n") || "（添付素材なし）\n";
}

/** 世界観に沿った画像生成用の指示文（日本語・英語）。画像生成そのものは行わない。 */
export function imagePrompt(project: Project, visuals: Entry[], subject: string, asset?: Asset): { ja: string; en: string } {
  const usable = visuals.filter((v) => v.kind === "visual" && v.status === "confirmed" && v.visibility === "public");
  const desc = usable.map((v) => v.body).filter(Boolean).join(" ");
  const palette = usable.map((v) => v.details.palette).filter(Boolean).join(" / ");
  const avoid = Array.from(new Set(usable.flatMap((v) => v.details.avoid)));
  const ref = asset ? `参考素材: ${asset.title}${asset.description ? `（${asset.description}）` : ""}` : "";
  const ja = [
    `【${project.name} の世界観に沿った画像の指示文】`,
    `主題: ${subject || "（描きたい場面を一文で）"}`,
    desc && `世界の描写: ${desc}`,
    palette && `色調: ${palette}`,
    ref,
    avoid.length ? `避けるもの: ${avoid.join("、")}` : "",
    "文字・ロゴ・実在の人物は入れない。",
  ]
    .filter(Boolean)
    .join("\n");
  const en = [
    `Image brief for the world of ${project.settings.identityAnchors.find((a) => /^[\x20-\x7e]+$/.test(a)) ?? project.name}.`,
    `Subject: ${subject || "(describe the scene in one sentence)"}`,
    desc && `World description (Japanese source, translate as needed): ${desc}`,
    palette && `Palette: ${palette}`,
    avoid.length ? `Avoid: ${avoid.join(", ")}` : "",
    "No text, logos, or real people.",
  ]
    .filter(Boolean)
    .join("\n");
  return { ja, en };
}

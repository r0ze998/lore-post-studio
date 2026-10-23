"use client";

import type { ReactNode } from "react";
import type { Asset, DraftVersion, Project } from "@/lib/domain/schema";
import { countX } from "@/lib/checks/xcount";
import type { Finding } from "@/lib/checks/engine";
import type { Range } from "@/lib/domain/match";
import { cx } from "../ui";

/** URL・ハッシュタグ・メンションを X 風に色付けする（見た目の近似）。 */
function decorate(text: string): ReactNode[] {
  const re = /(https?:\/\/[^\s]+|[#＃][\p{L}\p{N}_ー]+|@[A-Za-z0-9_]{1,15})/gu;
  const out: ReactNode[] = [];
  let last = 0;
  let m: RegExpExecArray | null;
  let k = 0;
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index));
    const t = m[0];
    const shown = t.startsWith("http") ? t.replace(/^https?:\/\//, "").slice(0, 25) + (t.replace(/^https?:\/\//, "").length > 25 ? "…" : "") : t;
    out.push(
      <span key={k++} className="text-[#1d9bf0]">
        {shown}
      </span>,
    );
    last = m.index + t.length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

function MediaGrid({ assets, projectId }: { assets: Asset[]; projectId: string }) {
  if (!assets.length) return null;
  const n = Math.min(assets.length, 4);
  return (
    <div className={cx("mt-2 grid gap-0.5 overflow-hidden rounded-xl border border-line", n === 1 ? "grid-cols-1" : "grid-cols-2")}>
      {assets.slice(0, 4).map((a) =>
        a.mime.startsWith("video/") ? (
          <video key={a.id} src={`/api/projects/${projectId}/assets/${a.id}`} className="aspect-video w-full bg-black object-cover" muted controls preload="metadata" />
        ) : (
          // eslint-disable-next-line @next/next/no-img-element
          <img key={a.id} src={`/api/projects/${projectId}/assets/${a.id}`} alt={a.altText || ""} className={cx("w-full bg-surface2 object-cover", n === 1 ? "max-h-80" : "aspect-square")} />
        ),
      )}
    </div>
  );
}

export function XPreview({ project, draft, assets }: { project: Project; draft: DraftVersion; assets: Asset[] }) {
  const name = project.settings.identityAnchors[0] || project.name;
  return (
    <div className="rounded-lg border border-line bg-surface" data-testid="x-preview">
      <div className="flex items-center justify-between border-b border-line px-3 py-2 text-[12px] text-muted">
        <span>{draft.segments.length > 1 ? `スレッドのプレビュー（${draft.segments.length} 件）` : "通常投稿のプレビュー"}</span>
        <span>見た目は近似です</span>
      </div>
      <ol>
        {draft.segments.map((s, i) => {
          const c = countX(s.text);
          const segAssets = s.assetIds.map((id) => assets.find((a) => a.id === id)).filter((a): a is Asset => !!a);
          const last = i === draft.segments.length - 1;
          return (
            <li key={s.id} className="relative flex gap-3 px-3 pt-3 pb-2">
              <div className="flex flex-col items-center">
                <div className="h-10 w-10 shrink-0 rounded-full bg-accent-soft text-center text-sm leading-10 font-bold text-accent">{name.slice(0, 1)}</div>
                {!last && <div className="mt-1 w-0.5 flex-1 bg-line" />}
              </div>
              <div className="min-w-0 flex-1 pb-2">
                <div className="flex flex-wrap items-baseline gap-1 text-sm">
                  <span className="font-bold">{name}</span>
                  <span className="text-muted">@your_account · 下書き</span>
                </div>
                <div className="text-[15px] leading-normal break-words whitespace-pre-wrap">{s.text ? decorate(s.text) : <span className="text-muted">（本文なし）</span>}</div>
                <MediaGrid assets={segAssets} projectId={project.id} />
                <div className={cx("mt-1 text-right text-[12px]", c.weightedLength > 280 ? "font-bold text-danger" : "text-muted")}>
                  {c.weightedLength} / 280
                </div>
              </div>
            </li>
          );
        })}
      </ol>
      <p className="border-t border-line px-3 py-2 text-[12px] text-muted">
        未対応：長文投稿（Premium）・投票・引用・記事・予約投稿の実行。このツールから X へは投稿されません。
      </p>
    </div>
  );
}

/** 本文の指摘箇所に印を付けて表示。 */
export function Highlighted({ text, findings, segmentIndex, overFrom }: { text: string; findings: Finding[]; segmentIndex: number; overFrom?: number }) {
  type Mark = Range & { cls: string };
  const marks: Mark[] = [];
  for (const f of findings) {
    if (f.segmentIndex !== segmentIndex) continue;
    for (const r of f.ranges) if (r.end > r.start && f.ruleId !== "x-length") marks.push({ ...r, cls: `hl-${f.severity}` });
  }
  if (overFrom !== undefined && overFrom < text.length) marks.push({ start: overFrom, end: text.length, cls: "hl-over" });
  // 境界ごとに区切って、最も重い印を付ける
  const points = Array.from(new Set([0, text.length, ...marks.flatMap((m) => [m.start, m.end])])).filter((p) => p >= 0 && p <= text.length).sort((a, b) => a - b);
  const order = ["hl-over", "hl-error", "hl-warning", "hl-info"];
  const parts: ReactNode[] = [];
  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i];
    const b = points[i + 1];
    const piece = text.slice(a, b);
    const covering = marks.filter((m) => m.start <= a && m.end >= b).sort((x, y) => order.indexOf(x.cls) - order.indexOf(y.cls));
    parts.push(covering.length ? <mark key={i} className={covering[0].cls}>{piece}</mark> : <span key={i}>{piece}</span>);
  }
  return <div className="text-[15px] leading-relaxed break-words whitespace-pre-wrap">{parts}</div>;
}

"use client";

import Link from "next/link";
import { useProject } from "@/components/project-context";
import { Badge, Empty, Notice, PageHeader } from "@/components/ui";
import { currentDraft } from "@/lib/checks/engine";
import { threadPlainText } from "@/lib/domain/exporting";
import { POST_TYPE_LABEL } from "@/lib/domain/labels";
import { fmtDate } from "@/lib/client/api";

export default function HistoryPage() {
  const { data, base } = useProject();
  const posted = data.posts.filter((p) => p.status === "posted" && p.publication).sort((a, b) => (b.publication!.postedAt || b.publication!.recordedAt).localeCompare(a.publication!.postedAt || a.publication!.recordedAt));
  return (
    <div className="flex flex-col gap-4">
      <PageHeader title="投稿履歴" description="実際に投稿した URL と反応の記録です。" />
      <Notice tone="info">ここにある「投稿済み」はすべてあなたの手動記録です。このツールは X の API で投稿の存在や数値を確認していません。</Notice>
      {posted.length === 0 ? (
        <Empty>まだ投稿の記録はありません。承認済みの投稿を開き、「7 記録」で URL を記録してください。</Empty>
      ) : (
        <ul className="flex flex-col gap-3" data-testid="history-list">
          {posted.map((p) => {
            const pub = p.publication!;
            const last = pub.metrics[pub.metrics.length - 1];
            const d = currentDraft(p);
            return (
              <li key={p.id} className="rounded-lg border border-line bg-surface p-3">
                <div className="flex flex-wrap items-center gap-2">
                  <Link href={`${base}/posts/${p.id}`} className="font-semibold underline-offset-2 hover:underline">
                    {p.title}
                  </Link>
                  <Badge>{POST_TYPE_LABEL[p.type]}</Badge>
                  <Badge tone="neutral" title="X の API では確認していません">
                    手動記録
                  </Badge>
                  <span className="ml-auto text-[12px] text-muted">投稿 {pub.postedAt ? pub.postedAt.replace("T", " ").slice(0, 16) : "日時未記入"}</span>
                </div>
                <p className="mt-1 line-clamp-3 text-sm whitespace-pre-wrap text-muted">{pub.postedText || (d ? threadPlainText(d) : "")}</p>
                <div className="mt-2 flex flex-wrap items-center gap-2 text-[13px]">
                  {pub.url && (
                    <a href={pub.url} target="_blank" rel="noreferrer noopener" className="text-accent underline">
                      X で開く
                    </a>
                  )}
                  {last ? (
                    <span className="text-muted">
                      {fmtDate(last.at, true)} 時点：表示 {last.impressions ?? "-"} · いいね {last.likes ?? "-"} · RP {last.reposts ?? "-"} · 返信 {last.replies ?? "-"} · BM {last.bookmarks ?? "-"}
                    </span>
                  ) : (
                    <span className="text-muted">反応は未記録</span>
                  )}
                </div>
                {pub.retro && <p className="mt-1 text-[13px]">振り返り：{pub.retro}</p>}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

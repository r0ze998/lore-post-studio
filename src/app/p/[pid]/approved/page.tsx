"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { useProject } from "@/components/project-context";
import { Badge, Button, Card, CopyButton, Empty, Notice, PageHeader, cx } from "@/components/ui";
import { currentDraft } from "@/lib/checks/engine";
import { approvalOf, threadPlainText } from "@/lib/domain/exporting";
import { POST_TYPE_LABEL } from "@/lib/domain/labels";
import { fmtDate } from "@/lib/client/api";

export default function ApprovedPage() {
  const { data, base } = useProject();
  const approved = data.posts.filter((p) => p.status === "approved").sort((a, b) => (a.scheduleCandidate || "9").localeCompare(b.scheduleCandidate || "9"));
  return (
    <div className="flex flex-col gap-4">
      <PageHeader title="承認済み" description="承認した投稿の本文と素材をコピー・書き出しします。投稿したら「記録」で URL を残してください。" />
      <Notice tone="warn">予約候補は自分用のメモです。このツールは X に投稿・予約しません。カレンダーに載っていても、実際には投稿されません。</Notice>
      <Calendar />
      {approved.length === 0 ? (
        <Empty>承認済みの投稿はありません。</Empty>
      ) : (
        <ul className="flex flex-col gap-3" data-testid="approved-list">
          {approved.map((p) => {
            const d = currentDraft(p)!;
            const ap = approvalOf(p);
            return (
              <li key={p.id}>
                <Card
                  title={
                    <Link href={`${base}/posts/${p.id}`} className="underline-offset-2 hover:underline">
                      {p.title}
                    </Link>
                  }
                  actions={
                    <>
                      <Badge>{POST_TYPE_LABEL[p.type]}</Badge>
                      {p.scheduleCandidate && <Badge tone="info">予約候補 {p.scheduleCandidate.replace("T", " ")}（自動投稿なし）</Badge>}
                    </>
                  }
                >
                  <p className="text-[15px] whitespace-pre-wrap">{threadPlainText(d)}</p>
                  {ap && (
                    <p className="mt-2 text-[12px] text-muted">
                      承認 {fmtDate(ap.at, true)}：{ap.reason}
                      {ap.acknowledgements.length > 0 && `（確認済みとした指摘 ${ap.acknowledgements.length} 件）`}
                    </p>
                  )}
                  <div className="mt-3 flex flex-wrap gap-2">
                    <CopyButton text={threadPlainText(d)} label="本文をコピー" />
                    <a className="inline-flex h-8 items-center rounded-md border border-line px-2.5 text-[13px]" href={`/api/projects/${data.project.id}/posts/${p.id}/export`} download>
                      zip で保存
                    </a>
                    <Link className="inline-flex h-8 items-center rounded-md border border-line px-2.5 text-[13px]" href={`${base}/posts/${p.id}`}>
                      投稿を記録する
                    </Link>
                  </div>
                </Card>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function Calendar() {
  const { data, base } = useProject();
  const [offset, setOffset] = useState(0);
  const now = new Date();
  const month = new Date(now.getFullYear(), now.getMonth() + offset, 1);
  const days = useMemo(() => {
    const first = new Date(month);
    const start = new Date(first);
    start.setDate(1 - first.getDay());
    return Array.from({ length: 42 }, (_, i) => {
      const d = new Date(start);
      d.setDate(start.getDate() + i);
      return d;
    });
  }, [month]);
  const key = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  const events = new Map<string, { id: string; title: string; kind: "candidate" | "posted" }[]>();
  for (const p of data.posts) {
    if (p.status === "approved" && p.scheduleCandidate) {
      const k = p.scheduleCandidate.slice(0, 10);
      events.set(k, [...(events.get(k) ?? []), { id: p.id, title: p.title, kind: "candidate" }]);
    }
    if (p.status === "posted" && p.publication?.postedAt) {
      const k = fmtDate(p.publication.postedAt);
      events.set(k, [...(events.get(k) ?? []), { id: p.id, title: p.title, kind: "posted" }]);
    }
  }
  return (
    <Card
      title={`${month.getFullYear()}年${month.getMonth() + 1}月`}
      actions={
        <>
          <span className="text-[12px] text-muted">
            <Badge tone="info">候補</Badge> 予約候補（未投稿） <Badge tone="accent">済</Badge> 手動記録の投稿日
          </span>
          <Button size="sm" onClick={() => setOffset(offset - 1)} aria-label="前の月">
            ←
          </Button>
          <Button size="sm" onClick={() => setOffset(0)}>
            今月
          </Button>
          <Button size="sm" onClick={() => setOffset(offset + 1)} aria-label="次の月">
            →
          </Button>
        </>
      }
    >
      <div className="grid grid-cols-7 gap-px overflow-hidden rounded border border-line bg-line text-[12px]">
        {["日", "月", "火", "水", "木", "金", "土"].map((w) => (
          <div key={w} className="bg-surface2 py-1 text-center font-semibold">
            {w}
          </div>
        ))}
        {days.map((d) => {
          const ev = events.get(key(d)) ?? [];
          const isToday = key(d) === key(now);
          return (
            <div key={key(d)} className={cx("min-h-16 bg-surface p-1", d.getMonth() !== month.getMonth() && "opacity-40")}>
              <div className={cx("text-right", isToday && "font-bold text-accent")}>{d.getDate()}</div>
              {ev.map((e) => (
                <Link key={e.id + e.kind} href={`${base}/posts/${e.id}`} className={cx("mt-0.5 block truncate rounded px-1", e.kind === "candidate" ? "bg-info-soft text-info" : "bg-accent-soft text-accent")} title={e.title}>
                  {e.kind === "candidate" ? "候補 " : "済 "}
                  {e.title}
                </Link>
              ))}
            </div>
          );
        })}
      </div>
    </Card>
  );
}

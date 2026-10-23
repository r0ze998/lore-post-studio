"use client";

import Link from "next/link";
import { useMemo } from "react";
import { useProject } from "@/components/project-context";
import { Badge, Card, Notice, PageHeader } from "@/components/ui";
import { findConflictCandidates, staleSuperseded } from "@/lib/domain/canon";
import { BOARD_COLUMNS, POST_STATUS_LABEL } from "@/lib/domain/labels";
import { KIND_DOMAIN } from "@/lib/domain/schema";
import { fmtDate } from "@/lib/client/api";

export default function Overview() {
  const { data, base } = useProject();
  const { entries, posts, project } = data;
  const conflicts = useMemo(() => findConflictCandidates(entries), [entries]);
  const stale = useMemo(() => staleSuperseded(entries), [entries]);
  const count = (d: "world" | "style" | "reality", s?: string) => entries.filter((e) => KIND_DOMAIN[e.kind] === d && (!s || e.status === s)).length;
  const upcoming = posts.filter((p) => p.status === "approved" && p.scheduleCandidate).sort((a, b) => a.scheduleCandidate.localeCompare(b.scheduleCandidate));

  return (
    <div className="flex flex-col gap-4">
      <PageHeader title="概要" description={project.description || undefined} />

      {entries.length === 0 && (
        <Notice tone="info" title="まず「設定（正本）」を登録してください">
          承認済みの世界観・用語・キャラクター・語り口・画像の参考・過去の投稿例、そして現実側の事実（機能の実装状況・実績と根拠・告知情報）を登録すると、下書きの検査と生成に使われます。過去資料を取り込む場合は「提案」として入り、確定にするまで確定設定としては扱われません。
          <div className="mt-2">
            <Link className="font-semibold text-accent underline" href={`${base}/canon`}>
              設定（正本）を開く
            </Link>
          </div>
        </Notice>
      )}

      {(conflicts.length > 0 || stale.length > 0) && (
        <Notice tone="warn" title={`設定の確認が必要な項目があります（${conflicts.length + stale.length} 件）`}>
          同じ名前を持つ項目（矛盾候補）や、置き換え済みなのに廃止されていない項目があります。自動では統合しません。
          <Link className="ml-1 font-semibold underline" href={`${base}/canon?view=conflicts`}>
            確認する
          </Link>
        </Notice>
      )}

      <div className="grid gap-3 sm:grid-cols-3">
        {(["world", "style", "reality"] as const).map((d) => (
          <Card key={d} title={{ world: "世界（創作）", style: "表現", reality: "現実の事実" }[d]}>
            <div className="text-2xl font-bold">{count(d)}</div>
            <div className="mt-1 flex flex-wrap gap-1 text-[12px]">
              <Badge tone="ok">確定 {count(d, "confirmed")}</Badge>
              <Badge tone="warn">提案 {count(d, "proposed")}</Badge>
              <Badge>廃止 {count(d, "deprecated")}</Badge>
            </div>
          </Card>
        ))}
      </div>

      <Card title="投稿" actions={<Link className="text-sm text-accent underline" href={`${base}/board`}>企画ボードへ</Link>}>
        <div className="flex flex-wrap gap-2">
          {BOARD_COLUMNS.map((s) => (
            <Badge key={s} tone={s === "approved" ? "ok" : s === "review" ? "warn" : s === "rejected" ? "danger" : "neutral"}>
              {POST_STATUS_LABEL[s]} {posts.filter((p) => p.status === s).length}
            </Badge>
          ))}
        </div>
        {upcoming.length > 0 && (
          <div className="mt-3">
            <h3 className="text-sm font-semibold">予約候補（このツールは自動投稿しません）</h3>
            <ul className="mt-1 text-sm">
              {upcoming.slice(0, 5).map((p) => (
                <li key={p.id}>
                  <span className="text-muted">{p.scheduleCandidate.replace("T", " ")}</span>{" "}
                  <Link className="underline" href={`${base}/posts/${p.id}`}>
                    {p.title}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        )}
      </Card>

      <Card title="最近更新した投稿">
        <ul className="divide-y divide-line text-sm">
          {[...posts]
            .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
            .slice(0, 6)
            .map((p) => (
              <li key={p.id} className="flex items-center justify-between gap-2 py-2">
                <Link className="truncate underline-offset-2 hover:underline" href={`${base}/posts/${p.id}`}>
                  {p.title}
                </Link>
                <span className="shrink-0 text-[12px] text-muted">
                  {POST_STATUS_LABEL[p.status]} · {fmtDate(p.updatedAt)}
                </span>
              </li>
            ))}
          {posts.length === 0 && <li className="py-2 text-muted">まだ投稿はありません。</li>}
        </ul>
      </Card>
    </div>
  );
}

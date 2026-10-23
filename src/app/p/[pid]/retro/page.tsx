"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { useProject } from "@/components/project-context";
import { Badge, Button, Card, Field, Input, Notice, PageHeader, Select, useAsyncAction } from "@/components/ui";
import { POST_TYPE_LABEL } from "@/lib/domain/labels";
import type { Learning, MetricSnapshot, Post, PostType } from "@/lib/domain/schema";
import { api, fmtDate } from "@/lib/client/api";

function latest(p: Post): MetricSnapshot | undefined {
  const ms = p.publication?.metrics ?? [];
  return ms[ms.length - 1];
}
function engagements(m: MetricSnapshot) {
  return (m.likes ?? 0) + (m.reposts ?? 0) + (m.replies ?? 0) + (m.quotes ?? 0) + (m.bookmarks ?? 0);
}
function rate(m?: MetricSnapshot): number | undefined {
  if (!m || !m.impressions) return undefined;
  return engagements(m) / m.impressions;
}
const pct = (x?: number) => (x === undefined ? "-" : `${(x * 100).toFixed(1)}%`);

export default function RetroPage() {
  const { data, base } = useProject();
  const posted = data.posts.filter((p) => p.status === "posted");
  const byType = useMemo(() => {
    const m = new Map<PostType, { n: number; rates: number[] }>();
    for (const p of posted) {
      const r = rate(latest(p));
      const cur = m.get(p.type) ?? { n: 0, rates: [] };
      cur.n++;
      if (r !== undefined) cur.rates.push(r);
      m.set(p.type, cur);
    }
    return m;
  }, [posted]);
  const top = [...posted].filter((p) => rate(latest(p)) !== undefined).sort((a, b) => rate(latest(b))! - rate(latest(a))!);
  const decisions = data.posts.flatMap((p) => p.decisions.map((d) => ({ p, d }))).sort((a, b) => b.d.at.localeCompare(a.d.at));

  return (
    <div className="flex flex-col gap-4">
      <PageHeader title="振り返り" description="手動で記録した反応と、採用・却下の理由から、次の制作に活かす学びを整理します。" />
      {posted.length < 5 && <Notice tone="info">投稿の記録が {posted.length} 件です。件数が少ないうちは、数字の差を傾向とみなさないでください。</Notice>}

      <Card title="種類別（最新の記録値。反応率＝反応数÷表示）">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-muted">
                <th className="py-1">種類</th>
                <th>投稿数</th>
                <th>平均反応率</th>
              </tr>
            </thead>
            <tbody>
              {(Object.keys(POST_TYPE_LABEL) as PostType[]).map((t) => {
                const v = byType.get(t);
                return (
                  <tr key={t} className="border-t border-line">
                    <td className="py-1.5">{POST_TYPE_LABEL[t]}</td>
                    <td>{v?.n ?? 0}</td>
                    <td>{v && v.rates.length ? pct(v.rates.reduce((a, b) => a + b, 0) / v.rates.length) : "-"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>

      <Card title="反応率の高い投稿">
        {top.length === 0 ? (
          <p className="text-sm text-muted">表示回数つきの記録がありません。</p>
        ) : (
          <ol className="flex flex-col gap-1 text-sm">
            {top.slice(0, 5).map((p) => (
              <li key={p.id} className="flex flex-wrap items-center gap-2">
                <Badge tone="accent">{pct(rate(latest(p)))}</Badge>
                <Link className="underline" href={`${base}/posts/${p.id}`}>
                  {p.title}
                </Link>
                <span className="text-muted">{POST_TYPE_LABEL[p.type]}</span>
                {p.publication?.retro && <span className="text-[12px] text-muted">— {p.publication.retro}</span>}
              </li>
            ))}
          </ol>
        )}
      </Card>

      <Learnings />

      <Card title="採用・却下の理由（新しい順）">
        {decisions.length === 0 ? (
          <p className="text-sm text-muted">まだありません。</p>
        ) : (
          <ul className="flex flex-col gap-1 text-sm">
            {decisions.slice(0, 30).map(({ p, d }, i) => (
              <li key={i} className="border-b border-line py-1">
                <Badge tone={d.kind === "approved" ? "ok" : "danger"}>{d.kind === "approved" ? "採用" : "却下"}</Badge>{" "}
                <Link className="underline" href={`${base}/posts/${p.id}`}>
                  {p.title}
                </Link>
                ：{d.reason} <span className="text-[12px] text-muted">{fmtDate(d.at)}</span>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}

function Learnings() {
  const { data, reload } = useProject();
  const [text, setText] = useState("");
  const [kind, setKind] = useState<"do" | "dont">("do");
  const [pattern, setPattern] = useState("");
  const { busy, run } = useAsyncAction();
  const patch = async (l: Learning, change: Partial<Learning>) => {
    const r = await run(() => api(`/api/projects/${data.project.id}/learnings/${l.id}`, { method: "PATCH", body: change }));
    if (r) await reload();
  };
  const origin = { approval: "採用理由", rejection: "却下理由", retro: "振り返り", manual: "手入力" };
  return (
    <Card title="学び（次の生成と検査に使われます）">
      <ul className="flex flex-col gap-2" data-testid="learning-list">
        {data.learnings.map((l) => (
          <li key={l.id} className={`rounded border border-line p-2 text-sm ${l.active ? "" : "opacity-50"}`}>
            <div className="flex flex-wrap items-center gap-2">
              <Badge tone={l.kind === "do" ? "ok" : "danger"}>{l.kind === "do" ? "する" : "しない"}</Badge>
              <span className="flex-1">{l.text}</span>
              <Badge>{origin[l.origin]}</Badge>
              {l.pattern && <Badge tone="warn">検査語句「{l.pattern}」</Badge>}
              <Button size="sm" variant="ghost" disabled={busy} onClick={() => patch(l, { active: !l.active })}>
                {l.active ? "使わない" : "使う"}
              </Button>
              <Button
                size="sm"
                variant="ghost"
                disabled={busy}
                onClick={async () => {
                  if (!confirm("この学びを削除します。")) return;
                  const r = await run(() => api(`/api/projects/${data.project.id}/learnings/${l.id}`, { method: "DELETE" }));
                  if (r) await reload();
                }}
              >
                削除
              </Button>
            </div>
          </li>
        ))}
        {data.learnings.length === 0 && <li className="text-sm text-muted">まだありません。承認・却下の理由や、ここでの追加から作られます。</li>}
      </ul>
      <div className="mt-3 grid gap-2 sm:grid-cols-[120px_1fr_200px_auto] sm:items-end">
        <Field label="種類" htmlFor="l-kind">
          <Select
            id="l-kind"
            value={kind}
            onChange={(e) => setKind(e.target.value as "do" | "dont")}
            options={[
              { value: "do", label: "する" },
              { value: "dont", label: "しない" },
            ]}
          />
        </Field>
        <Field label="学び" htmlFor="l-text">
          <Input id="l-text" value={text} onChange={(e) => setText(e.target.value)} />
        </Field>
        <Field label="検査語句（「しない」のみ）" htmlFor="l-pat">
          <Input id="l-pat" value={pattern} disabled={kind === "do"} onChange={(e) => setPattern(e.target.value)} />
        </Field>
        <Button
          disabled={busy || !text.trim()}
          onClick={async () => {
            const r = await run(() => api(`/api/projects/${data.project.id}/learnings`, { body: { kind, text, pattern: kind === "dont" ? pattern : "", origin: "manual" } }), "追加しました");
            if (r) {
              setText("");
              setPattern("");
              await reload();
            }
          }}
        >
          追加
        </Button>
      </div>
    </Card>
  );
}

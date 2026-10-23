"use client";

import { Suspense, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useProject } from "@/components/project-context";
import { blankEntry, EntryEditor } from "@/components/entry-editor";
import { Badge, Button, Card, Empty, Field, Input, Modal, Notice, PageHeader, Select, StatusBadge, Tabs, Textarea, useAsyncAction } from "@/components/ui";
import { findConflictCandidates, staleSuperseded } from "@/lib/domain/canon";
import { DOMAIN_LABEL, ENTRY_KIND_LABEL, FEATURE_STATUS_LABEL, STATUS_LABEL } from "@/lib/domain/labels";
import { KIND_DOMAIN, type Entry, type EntryDomain, type EntryKind } from "@/lib/domain/schema";
import { api, fmtDate } from "@/lib/client/api";
import { norm } from "@/lib/domain/match";
import { parseImportText } from "@/lib/domain/import-text";

type View = "all" | EntryDomain | "conflicts";
const KIND_ORDER = Object.keys(ENTRY_KIND_LABEL) as EntryKind[];
const DEFAULT_KIND: Record<EntryDomain, EntryKind> = { world: "lore", style: "voice", reality: "feature" };

function CanonInner() {
  const sp = useSearchParams();
  const { data } = useProject();
  const [view, setView] = useState<View>((sp.get("view") as View) || "all");
  const [kind, setKind] = useState<string>("");
  const [status, setStatus] = useState<string>("");
  const [q, setQ] = useState("");
  const [editing, setEditing] = useState<ReturnType<typeof blankEntry> | null>(null);
  const [importOpen, setImportOpen] = useState(false);

  const conflicts = useMemo(() => findConflictCandidates(data.entries), [data.entries]);
  const stale = useMemo(() => staleSuperseded(data.entries), [data.entries]);

  const list = useMemo(() => {
    const nq = norm(q.trim());
    return data.entries
      .filter((e) => (view === "all" || view === "conflicts" ? true : KIND_DOMAIN[e.kind] === view))
      .filter((e) => !kind || e.kind === kind)
      .filter((e) => !status || e.status === status || (status === "internal" && e.visibility === "internal"))
      .filter((e) => !nq || norm([e.title, e.body, ...e.aliases, e.source.label].join(" ")).includes(nq))
      .sort((a, b) => KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind) || a.title.localeCompare(b.title, "ja"));
  }, [data.entries, view, kind, status, q]);

  const kindsInView = (Object.keys(ENTRY_KIND_LABEL) as EntryKind[]).filter((k) => view === "all" || view === "conflicts" || KIND_DOMAIN[k] === view);

  return (
    <div>
      <PageHeader
        title="設定（正本）"
        description="承認した世界観と、現実の事実を登録します。各項目は出典・更新日・状態（確定／提案／廃止）を持ちます。矛盾する情報は自動で統合しません。"
        actions={
          <>
            <Button onClick={() => setImportOpen(true)}>資料を取り込む（提案として）</Button>
            <Button variant="primary" onClick={() => setEditing(blankEntry(view === "all" || view === "conflicts" ? "lore" : DEFAULT_KIND[view]))}>
              設定を追加
            </Button>
          </>
        }
      />

      <Tabs<View>
        value={view}
        onChange={(v) => {
          setView(v);
          setKind("");
        }}
        items={[
          { value: "all", label: `すべて（${data.entries.length}）` },
          { value: "world", label: DOMAIN_LABEL.world },
          { value: "style", label: DOMAIN_LABEL.style },
          { value: "reality", label: DOMAIN_LABEL.reality },
          { value: "conflicts", label: <span className={conflicts.length + stale.length ? "text-warn" : ""}>矛盾候補（{conflicts.length + stale.length}）</span> },
        ]}
        className="mb-3"
      />

      {view === "conflicts" ? (
        <Conflicts conflicts={conflicts} stale={stale} onEdit={(e) => setEditing({ ...e })} />
      ) : (
        <>
          <div className="mb-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
            <Select aria-label="種類で絞り込み" value={kind} onChange={(e) => setKind(e.target.value)} options={[{ value: "", label: "すべての種類" }, ...kindsInView.map((k) => ({ value: k, label: ENTRY_KIND_LABEL[k] }))]} />
            <Select
              aria-label="状態で絞り込み"
              value={status}
              onChange={(e) => setStatus(e.target.value)}
              options={[
                { value: "", label: "すべての状態" },
                { value: "confirmed", label: "確定" },
                { value: "proposed", label: "提案" },
                { value: "deprecated", label: "廃止" },
                { value: "internal", label: "未公開" },
              ]}
            />
            <Input aria-label="検索" placeholder="検索（名前・内容・出典）" value={q} onChange={(e) => setQ(e.target.value)} className="col-span-2" />
          </div>
          {view === "reality" && <Notice tone="info">ここは現実の事実です。機能の実装状況、根拠のある実績、告知情報、同意のある実在ユーザーの声を登録します。世界の中の設定とは別に扱われます。</Notice>}
          {list.length === 0 ? (
            <div className="mt-3">
              <Empty>{data.entries.length === 0 ? "まだ設定がありません。「設定を追加」から登録するか、資料を取り込んでください。" : "条件に合う項目がありません。"}</Empty>
            </div>
          ) : (
            <ul className="mt-3 divide-y divide-line rounded-lg border border-line bg-surface" data-testid="entry-list">
              {list.map((e) => (
                <li key={e.id}>
                  <button type="button" onClick={() => setEditing({ ...e })} className="flex w-full flex-col gap-1 px-3 py-2.5 text-left hover:bg-surface2 sm:flex-row sm:items-center sm:gap-3">
                    <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1.5">
                      <StatusBadge status={e.status} />
                      <Badge>{ENTRY_KIND_LABEL[e.kind]}</Badge>
                      {e.visibility === "internal" && <Badge tone="danger">未公開</Badge>}
                      {e.kind === "feature" && e.details.featureStatus && <Badge tone={e.details.featureStatus === "released" ? "ok" : "info"}>{FEATURE_STATUS_LABEL[e.details.featureStatus]}</Badge>}
                      {e.kind === "claim" && !(e.details.evidenceUrl || e.details.evidenceNote) && <Badge tone="danger">根拠なし</Badge>}
                      {e.kind === "example" && <Badge tone={e.details.polarity === "bad" ? "danger" : "ok"}>{e.details.polarity === "bad" ? "悪い例" : "良い例"}</Badge>}
                      <span className={`font-medium ${e.status === "deprecated" ? "text-muted line-through" : ""}`}>{e.title}</span>
                      {e.aliases.length > 0 && <span className="truncate text-[12px] text-muted">（{e.aliases.join("・")}）</span>}
                    </div>
                    <div className="shrink-0 text-[12px] text-muted sm:text-right">
                      {e.source.label || "出典未記入"} · 更新 {fmtDate(e.updatedAt)}
                    </div>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </>
      )}

      <EntryEditor open={!!editing} initial={editing} onClose={() => setEditing(null)} />
      <ImportDialog open={importOpen} onClose={() => setImportOpen(false)} />
    </div>
  );
}

function Conflicts({ conflicts, stale, onEdit }: { conflicts: ReturnType<typeof findConflictCandidates>; stale: ReturnType<typeof staleSuperseded>; onEdit: (e: Entry) => void }) {
  const { data, replaceEntry } = useProject();
  const { busy, run } = useAsyncAction();
  const byId = new Map(data.entries.map((e) => [e.id, e]));
  const patch = async (e: Entry, change: Partial<Entry>, note: string) => {
    const saved = await run(() => api<Entry>(`/api/projects/${data.project.id}/entries/${e.id}`, { method: "PATCH", body: { entry: change, note } }));
    if (saved) replaceEntry(saved);
    return saved;
  };

  if (!conflicts.length && !stale.length) return <Empty>矛盾候補はありません（同じ名前を持つ有効な項目がありません）。内容の矛盾は自動では判定できないため、確定前に読んで確認してください。</Empty>;
  return (
    <div className="flex flex-col gap-3">
      <Notice tone="warn">
        同じ名前を持つ項目を並べています。内容の正しさは自動では判断しません。採用する方を選ぶと、もう一方を「廃止」にします（履歴に残ります）。両方必要なら「矛盾ではない」と記録します。
      </Notice>
      {conflicts.map((c) => {
        const [a, b] = c.entryIds.map((id) => byId.get(id)!).filter(Boolean);
        if (!a || !b) return null;
        return (
          <Card key={c.key} title={`「${c.sharedName}」`} actions={<span className="text-[12px] text-muted">{c.reason}</span>}>
            <div className="grid gap-3 md:grid-cols-2">
              {[a, b].map((e, i) => {
                const other = i === 0 ? b : a;
                return (
                  <div key={e.id} className="flex flex-col gap-2 rounded-md border border-line p-3" data-testid="conflict-side">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <StatusBadge status={e.status} />
                      <Badge>{ENTRY_KIND_LABEL[e.kind]}</Badge>
                      <span className="font-medium">{e.title}</span>
                    </div>
                    <p className="whitespace-pre-wrap text-sm">{e.body || "（内容なし）"}</p>
                    <p className="text-[12px] text-muted">
                      出典：{e.source.label || "未記入"}
                      {e.source.note && `（${e.source.note}）`} · 更新 {fmtDate(e.updatedAt)}
                    </p>
                    <div className="mt-auto flex flex-wrap gap-2">
                      <Button
                        size="sm"
                        variant="primary"
                        disabled={busy}
                        onClick={async () => {
                          if (!confirm(`「${e.title}」（${e.source.label || "出典未記入"}）を採用し、もう一方を廃止にします。`)) return;
                          await patch(other, { status: "deprecated" }, `矛盾候補の整理：${e.source.label || e.id} を採用`);
                          await patch(e, { status: "confirmed", supersedes: Array.from(new Set([...e.supersedes, other.id])) }, "矛盾候補の整理で採用");
                        }}
                      >
                        こちらを採用
                      </Button>
                      <Button size="sm" onClick={() => onEdit(e)}>
                        編集
                      </Button>
                    </div>
                  </div>
                );
              })}
            </div>
            <div className="mt-3">
              <Button
                size="sm"
                variant="ghost"
                disabled={busy}
                onClick={async () => {
                  const why = prompt("両方を残す理由（例：同名の別の場所）");
                  if (!why) return;
                  await patch(a, { notConflictingWith: Array.from(new Set([...a.notConflictingWith, b.id])) }, `矛盾ではない：${why}`);
                }}
              >
                矛盾ではない（両方残す）
              </Button>
            </div>
          </Card>
        );
      })}
      {stale.map(({ entry, replacedBy }) => (
        <Card key={entry.id + replacedBy.id} title={`置き換え済みだが廃止されていない：「${entry.title}」`}>
          <p className="text-sm">
            「{replacedBy.title}」がこの項目を置き換えています（{STATUS_LABEL[entry.status]}のまま）。
          </p>
          <div className="mt-2 flex gap-2">
            <Button size="sm" variant="primary" disabled={busy} onClick={() => patch(entry, { status: "deprecated" }, `「${replacedBy.title}」に置き換え`)}>
              廃止にする
            </Button>
            <Button size="sm" onClick={() => onEdit(entry)}>
              編集
            </Button>
          </div>
        </Card>
      ))}
    </div>
  );
}

function ImportDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { data, reload } = useProject();
  const [text, setText] = useState("");
  const [kind, setKind] = useState<EntryKind>("lore");
  const [label, setLabel] = useState("");
  const [visibility, setVisibility] = useState<"internal" | "public">("internal");
  const { busy, run } = useAsyncAction();
  let parsed: ReturnType<typeof parseImportText> = [];
  let error = "";
  try {
    parsed = parseImportText(text, kind);
  } catch (e) {
    error = e instanceof Error ? e.message : String(e);
  }
  return (
    <Modal
      open={open}
      onClose={onClose}
      wide
      title="資料を取り込む"
      footer={
        <>
          <Button onClick={onClose}>キャンセル</Button>
          <Button
            variant="primary"
            disabled={busy || !parsed.length || !label.trim()}
            onClick={async () => {
              const r = await run(() => api(`/api/projects/${data.project.id}/entries`, { method: "PUT", body: { entries: parsed.map((p) => ({ ...p, visibility })), sourceLabel: label } }), `${parsed.length} 件を「提案」として取り込みました`);
              if (r) {
                await reload();
                setText("");
                onClose();
              }
            }}
          >
            {parsed.length} 件を提案として取り込む
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <Notice tone="warn">取り込んだ項目はすべて「提案」になります。過去の資料をそのまま確定設定にはしません。内容を確認してから一つずつ「確定」（必要なら「公開してよい」）にしてください。</Notice>
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="出典の名前（必須）" htmlFor="imp-label" hint="例：2025 企画書 v1">
            <Input id="imp-label" value={label} onChange={(e) => setLabel(e.target.value)} />
          </Field>
          <Field label="公開区分" htmlFor="imp-vis" hint="過去資料は未公開の情報を含みやすいため、既定は「未公開」です（投稿に書けず、外部モデルにも送りません）。">
            <Select
              id="imp-vis"
              value={visibility}
              onChange={(e) => setVisibility(e.target.value as "internal" | "public")}
              options={[
                { value: "internal", label: "未公開（既定）" },
                { value: "public", label: "公開してよい" },
              ]}
            />
          </Field>
          <Field label="種類（見出し形式のとき）" htmlFor="imp-kind">
            <Select id="imp-kind" value={kind} onChange={(e) => setKind(e.target.value as EntryKind)} options={(Object.keys(ENTRY_KIND_LABEL) as EntryKind[]).map((k) => ({ value: k, label: ENTRY_KIND_LABEL[k] }))} />
          </Field>
        </div>
        <Field label="資料の本文" htmlFor="imp-text" hint="「## 名前」の見出しごとに 1 項目として読みます。JSON 配列（title, body, kind, aliases）も使えます。">
          <Textarea id="imp-text" rows={10} value={text} onChange={(e) => setText(e.target.value)} placeholder={"## 白海\n干上がった内海。\n\n## 塩札\nキャラバンの通貨。"} />
        </Field>
        {error && <Notice tone="danger">読み取れません：{error}</Notice>}
        {parsed.length > 0 && (
          <div>
            <h3 className="text-sm font-semibold">取り込み内容の確認</h3>
            <ul className="mt-1 max-h-48 overflow-y-auto text-sm">
              {parsed.map((p, i) => (
                <li key={i} className="border-b border-line py-1">
                  <Badge>{ENTRY_KIND_LABEL[p.kind]}</Badge> <span className="font-medium">{p.title}</span> <span className="text-muted">{p.body.slice(0, 60)}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </Modal>
  );
}

export default function CanonPage() {
  return (
    <Suspense>
      <CanonInner />
    </Suspense>
  );
}

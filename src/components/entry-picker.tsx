"use client";

import { useMemo, useState } from "react";
import type { Entry, EntryKind } from "@/lib/domain/schema";
import { ENTRY_KIND_LABEL, FEATURE_STATUS_LABEL } from "@/lib/domain/labels";
import { norm } from "@/lib/domain/match";
import { Badge, Input, StatusBadge } from "./ui";

/** 正本の項目を複数選ぶ。廃止は選べない。未公開・提案は印を付ける。 */
export function EntryPicker({ entries, kinds, value, onChange, label }: { entries: Entry[]; kinds: EntryKind[]; value: string[]; onChange: (ids: string[]) => void; label: string }) {
  const [q, setQ] = useState("");
  const list = useMemo(() => {
    const nq = norm(q.trim());
    return entries
      .filter((e) => kinds.includes(e.kind) && (e.status !== "deprecated" || value.includes(e.id)))
      .filter((e) => !nq || norm([e.title, ...e.aliases, e.body].join(" ")).includes(nq));
  }, [entries, kinds, q, value]);
  const toggle = (id: string) => onChange(value.includes(id) ? value.filter((x) => x !== id) : [...value, id]);
  return (
    <div className="rounded-md border border-line">
      <div className="flex items-center gap-2 border-b border-line p-2">
        <span className="text-[13px] font-semibold">{label}</span>
        <span className="text-[12px] text-muted">{value.length} 件選択</span>
        <Input aria-label={`${label}を検索`} className="ml-auto h-8 max-w-48 text-sm" placeholder="検索" value={q} onChange={(e) => setQ(e.target.value)} />
      </div>
      <ul className="max-h-56 overflow-y-auto">
        {list.length === 0 && <li className="p-3 text-[13px] text-muted">該当する項目がありません（設定（正本）で登録できます）。</li>}
        {list.map((e) => (
          <li key={e.id}>
            <label className="flex cursor-pointer items-start gap-2 px-2 py-1.5 hover:bg-surface2">
              <input type="checkbox" className="mt-1 h-4 w-4 accent-[var(--accent)]" checked={value.includes(e.id)} onChange={() => toggle(e.id)} />
              <span className="flex min-w-0 flex-1 flex-wrap items-center gap-1 text-sm">
                <StatusBadge status={e.status} />
                <Badge>{ENTRY_KIND_LABEL[e.kind]}</Badge>
                {e.visibility === "internal" && <Badge tone="danger">未公開</Badge>}
                {e.kind === "feature" && e.details.featureStatus && <Badge tone="info">{FEATURE_STATUS_LABEL[e.details.featureStatus]}</Badge>}
                {e.kind === "claim" && !(e.details.evidenceUrl || e.details.evidenceNote) && <Badge tone="danger">根拠なし</Badge>}
                <span>{e.title}</span>
              </span>
            </label>
          </li>
        ))}
      </ul>
    </div>
  );
}

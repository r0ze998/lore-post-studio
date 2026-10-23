"use client";

import { useMemo, useRef, useState } from "react";
import { useProject } from "@/components/project-context";
import { Badge, Button, CopyButton, Empty, Field, Input, Modal, Notice, PageHeader, Select, StatusBadge, Textarea, useAsyncAction } from "@/components/ui";
import type { Asset } from "@/lib/domain/schema";
import { api, fmtDate } from "@/lib/client/api";
import { imagePrompt } from "@/lib/domain/exporting";
import { STATUS_LABEL } from "@/lib/domain/labels";

function size(n: number) {
  return n > 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)}MB` : `${Math.ceil(n / 1024)}KB`;
}

export default function AssetsPage() {
  const { data, reload } = useProject();
  const fileRef = useRef<HTMLInputElement>(null);
  const [editing, setEditing] = useState<Asset | null>(null);
  const [promptOpen, setPromptOpen] = useState(false);
  const { busy, run } = useAsyncAction();

  const usedBy = useMemo(() => {
    const m = new Map<string, string[]>();
    for (const p of data.posts) for (const d of p.drafts) for (const s of d.segments) for (const id of s.assetIds) m.set(id, Array.from(new Set([...(m.get(id) ?? []), p.title])));
    return m;
  }, [data.posts]);

  return (
    <div>
      <PageHeader
        title="素材庫"
        description="手持ちの画像・動画を管理します。代替テキスト・権利・公開区分を記録できます。アップロードした素材は「提案」として入ります。"
        actions={
          <>
            <Button onClick={() => setPromptOpen(true)}>画像生成用の指示文</Button>
            <input
              ref={fileRef}
              type="file"
              multiple
              accept="image/png,image/jpeg,image/gif,image/webp,video/mp4,video/quicktime"
              className="hidden"
              data-testid="asset-file"
              onChange={async (e) => {
                const files = Array.from(e.target.files ?? []);
                e.target.value = "";
                if (!files.length) return;
                const form = new FormData();
                files.forEach((f) => form.append("file", f));
                const r = await run(() => api(`/api/projects/${data.project.id}/assets`, { form }), `${files.length} 件を追加しました`);
                if (r) await reload();
              }}
            />
            <Button variant="primary" disabled={busy} onClick={() => fileRef.current?.click()}>
              素材を追加
            </Button>
          </>
        }
      />
      <Notice tone="info">PNG / JPEG / GIF / WebP / MP4 / MOV（200MB まで）。ファイルはこのコンピューターの data フォルダに保存され、外部モデルには送りません（説明文と代替テキストのみ、許可した場合に送ります）。</Notice>
      {data.assets.length === 0 ? (
        <div className="mt-3">
          <Empty>まだ素材がありません。</Empty>
        </div>
      ) : (
        <ul className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4" data-testid="asset-grid">
          {data.assets.map((a) => (
            <li key={a.id} className="overflow-hidden rounded-lg border border-line bg-surface">
              <button type="button" className="block w-full text-left" onClick={() => setEditing(a)}>
                {a.mime.startsWith("image/") ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={`/api/projects/${data.project.id}/assets/${a.id}`} alt={a.altText} className="aspect-video w-full bg-surface2 object-cover" />
                ) : (
                  <video src={`/api/projects/${data.project.id}/assets/${a.id}`} className="aspect-video w-full bg-black object-cover" muted preload="metadata" />
                )}
                <div className="p-2">
                  <div className="truncate text-sm font-medium">{a.title || a.filename}</div>
                  <div className="mt-1 flex flex-wrap gap-1">
                    <StatusBadge status={a.status} />
                    {a.visibility === "internal" && <Badge tone="danger">未公開</Badge>}
                    {!a.altText && a.mime.startsWith("image/") && <Badge tone="warn">ALT なし</Badge>}
                    {a.rights === "unknown" && <Badge tone="warn">権利不明</Badge>}
                  </div>
                  <div className="mt-1 text-[12px] text-muted">
                    {size(a.size)} · {fmtDate(a.updatedAt)}
                    {usedBy.get(a.id) && ` · 使用 ${usedBy.get(a.id)!.length}`}
                  </div>
                </div>
              </button>
            </li>
          ))}
        </ul>
      )}
      <AssetEditor asset={editing} onClose={() => setEditing(null)} usedBy={editing ? usedBy.get(editing.id) ?? [] : []} />
      <PromptDialog open={promptOpen} onClose={() => setPromptOpen(false)} />
    </div>
  );
}

function AssetEditor({ asset, onClose, usedBy }: { asset: Asset | null; onClose: () => void; usedBy: string[] }) {
  const { data, reload } = useProject();
  const [a, setA] = useState<Asset | null>(asset);
  const { busy, run } = useAsyncAction();
  if (asset && a?.id !== asset.id) setA(asset);
  if (!asset || !a) return null;
  return (
    <Modal
      open
      onClose={onClose}
      wide
      title={`素材：${asset.filename}`}
      footer={
        <>
          <Button
            variant="danger"
            className="mr-auto"
            disabled={busy}
            onClick={async () => {
              if (!confirm(usedBy.length ? `この素材は ${usedBy.length} 件の投稿で使われています。削除すると添付が外れます（ファイルは data/trash に退避）。` : "この素材を削除します（ファイルは data/trash に退避）。")) return;
              const r = await run(() => api(`/api/projects/${data.project.id}/assets/${asset.id}`, { method: "DELETE" }), "削除しました");
              if (r) {
                await reload();
                onClose();
              }
            }}
          >
            削除
          </Button>
          <a className="inline-flex h-10 items-center rounded-md border border-line px-4 text-sm" href={`/api/projects/${data.project.id}/assets/${asset.id}?download=1`}>
            ダウンロード
          </a>
          <Button onClick={onClose}>閉じる</Button>
          <Button
            variant="primary"
            disabled={busy}
            onClick={async () => {
              const r = await run(() => api(`/api/projects/${data.project.id}/assets/${asset.id}`, { method: "PATCH", body: a }), "保存しました");
              if (r) {
                await reload();
                onClose();
              }
            }}
          >
            保存
          </Button>
        </>
      }
    >
      <div className="grid gap-4 md:grid-cols-2">
        <div>
          {asset.mime.startsWith("image/") ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={`/api/projects/${data.project.id}/assets/${asset.id}`} alt={a.altText} className="w-full rounded border border-line" />
          ) : (
            <video src={`/api/projects/${data.project.id}/assets/${asset.id}`} controls className="w-full rounded" />
          )}
          <p className="mt-2 text-[12px] text-muted">
            {asset.mime} · {size(asset.size)} · 追加 {fmtDate(asset.createdAt, true)}
          </p>
          {usedBy.length > 0 && <p className="mt-1 text-[12px] text-muted">使用中の投稿：{usedBy.join("、")}</p>}
        </div>
        <div className="flex flex-col gap-3">
          <Field label="名前" htmlFor="a-title">
            <Input id="a-title" value={a.title} onChange={(e) => setA({ ...a, title: e.target.value })} />
          </Field>
          <Field label="説明（何が写っているか・世界のどこか）" htmlFor="a-desc">
            <Textarea id="a-desc" rows={2} value={a.description} onChange={(e) => setA({ ...a, description: e.target.value })} />
          </Field>
          <Field label="代替テキスト（ALT）" htmlFor="a-alt" hint="X に画像を付けるときに貼り付ける説明です。">
            <Textarea id="a-alt" rows={2} value={a.altText} onChange={(e) => setA({ ...a, altText: e.target.value })} />
          </Field>
          <div className="grid grid-cols-2 gap-2">
            <Field label="状態" htmlFor="a-status">
              <Select id="a-status" value={a.status} onChange={(e) => setA({ ...a, status: e.target.value as Asset["status"] })} options={(["confirmed", "proposed", "deprecated"] as const).map((s) => ({ value: s, label: STATUS_LABEL[s] }))} />
            </Field>
            <Field label="公開区分" htmlFor="a-vis">
              <Select
                id="a-vis"
                value={a.visibility}
                onChange={(e) => setA({ ...a, visibility: e.target.value as Asset["visibility"] })}
                options={[
                  { value: "public", label: "公開してよい" },
                  { value: "internal", label: "未公開" },
                ]}
              />
            </Field>
            <Field label="権利" htmlFor="a-rights">
              <Select
                id="a-rights"
                value={a.rights}
                onChange={(e) => setA({ ...a, rights: e.target.value as Asset["rights"] })}
                options={[
                  { value: "own", label: "自作" },
                  { value: "licensed", label: "許諾済み" },
                  { value: "unknown", label: "不明" },
                ]}
              />
            </Field>
            <Field label="クレジット" htmlFor="a-credit">
              <Input id="a-credit" value={a.credit} onChange={(e) => setA({ ...a, credit: e.target.value })} />
            </Field>
          </div>
          <Field label="関連する設定" htmlFor="a-links">
            <select id="a-links" multiple className="min-h-24 w-full rounded-md border border-line bg-surface p-2 text-sm" value={a.linkedEntryIds} onChange={(e) => setA({ ...a, linkedEntryIds: Array.from(e.target.selectedOptions).map((o) => o.value) })}>
              {data.entries
                .filter((e) => e.status !== "deprecated")
                .map((e) => (
                  <option key={e.id} value={e.id}>
                    {e.title}
                  </option>
                ))}
            </select>
          </Field>
        </div>
      </div>
    </Modal>
  );
}

function PromptDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { data } = useProject();
  const [subject, setSubject] = useState("");
  const [assetId, setAssetId] = useState("");
  const visuals = data.entries.filter((e) => e.kind === "visual");
  const asset = data.assets.find((a) => a.id === assetId && a.visibility === "public");
  const p = imagePrompt(data.project, visuals, subject, asset);
  return (
    <Modal open={open} onClose={onClose} wide title="画像生成用の指示文" footer={<Button onClick={onClose}>閉じる</Button>}>
      <div className="flex flex-col gap-3">
        <Notice tone="info">正本の「画像の参考」（確定・公開のもの）から、色調・描写・避ける表現を組み立てます。このツールは画像を生成しません。</Notice>
        <Field label="描きたい場面" htmlFor="pd-subject">
          <Input id="pd-subject" value={subject} onChange={(e) => setSubject(e.target.value)} />
        </Field>
        <Field label="参考にする素材（任意）" htmlFor="pd-asset">
          <Select id="pd-asset" value={assetId} onChange={(e) => setAssetId(e.target.value)} options={[{ value: "", label: "なし" }, ...data.assets.filter((a) => a.visibility === "public").map((a) => ({ value: a.id, label: a.title || a.filename }))]} />
        </Field>
        <pre className="rounded bg-surface2 p-2 text-[13px] whitespace-pre-wrap">{p.ja}</pre>
        <pre className="rounded bg-surface2 p-2 text-[13px] whitespace-pre-wrap">{p.en}</pre>
        <div className="flex gap-2">
          <CopyButton text={p.ja} label="日本語をコピー" />
          <CopyButton text={p.en} label="英語をコピー" />
        </div>
      </div>
    </Modal>
  );
}

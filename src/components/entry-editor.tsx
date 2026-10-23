"use client";

import { useEffect, useState } from "react";
import { Entry, EntryDetails, type EntryKind, type EntryRevision } from "@/lib/domain/schema";
import { CLAIM_TYPE_LABEL, ENTRY_KIND_HELP, ENTRY_KIND_LABEL, FEATURE_STATUS_LABEL, STATUS_LABEL } from "@/lib/domain/labels";
import { api, fmtDate } from "@/lib/client/api";
import { Badge, Button, Checkbox, Field, Input, ListInput, Modal, Notice, Select, StatusBadge, Textarea, useAsyncAction } from "./ui";
import { useProject } from "./project-context";

type Draft = Omit<Entry, "id" | "projectId" | "createdAt" | "updatedAt" | "history"> & { id?: string };

export function blankEntry(kind: EntryKind): Draft {
  return {
    kind,
    title: "",
    body: "",
    aliases: [],
    status: "proposed",
    visibility: "public",
    source: { label: "", url: "", note: "" },
    tags: [],
    details: EntryDetails.parse(kind === "voice" ? { voiceMode: "in_world" } : kind === "example" ? { polarity: "good" } : kind === "feature" ? { featureStatus: "in_development" } : kind === "claim" ? { claimType: "metric" } : {}),
    contradictions: [],
    supersedes: [],
    notConflictingWith: [],
  };
}

const KIND_OPTIONS = (Object.keys(ENTRY_KIND_LABEL) as EntryKind[]).map((k) => ({ value: k, label: ENTRY_KIND_LABEL[k] }));

export function EntryEditor({ open, initial, onClose }: { open: boolean; initial: Draft | null; onClose: () => void }) {
  const { data, replaceEntry, reload } = useProject();
  const [d, setD] = useState<Draft | null>(initial);
  const [note, setNote] = useState("");
  const [showHistory, setShowHistory] = useState(false);
  const { busy, run } = useAsyncAction();

  useEffect(() => {
    setD(initial);
    setNote("");
    setShowHistory(false);
  }, [initial]);

  if (!open || !d) return null;
  const existing = d.id ? data.entries.find((e) => e.id === d.id) : undefined;
  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setD({ ...d, [k]: v });
  const setDet = <K extends keyof EntryDetails>(k: K, v: EntryDetails[K]) => setD({ ...d, details: { ...d.details, [k]: v } });
  const others = data.entries.filter((e) => e.id !== d.id);

  const save = async () => {
    const payload = { ...d };
    delete (payload as { id?: string }).id;
    const saved = await run(
      () => (d.id ? api<Entry>(`/api/projects/${data.project.id}/entries/${d.id}`, { method: "PATCH", body: { entry: payload, note } }) : api<Entry>(`/api/projects/${data.project.id}/entries`, { body: payload })),
      "保存しました",
    );
    if (saved) {
      replaceEntry(saved);
      onClose();
    }
  };

  const restore = async (rev: EntryRevision) => {
    if (!d.id || !confirm(`${fmtDate(rev.at, true)} の版に戻します（今の内容は履歴に残ります）。`)) return;
    const saved = await run(() => api<Entry>(`/api/projects/${data.project.id}/entries/${d.id}`, { method: "PATCH", body: { entry: rev.snapshot, note: `${fmtDate(rev.at, true)} の版に戻した` } }), "戻しました");
    if (saved) {
      replaceEntry(saved);
      setD({ ...saved });
    }
  };

  const remove = async () => {
    if (!d.id) return;
    if (!confirm("この項目を削除します。通常は「廃止」にして残すことをおすすめします（廃止にすると本文への混入を検査できます）。削除しますか？")) return;
    const ok = await run(() => api(`/api/projects/${data.project.id}/entries/${d.id}`, { method: "DELETE" }), "削除しました");
    if (ok) {
      await reload();
      onClose();
    }
  };

  const k = d.kind;
  return (
    <Modal
      open={open}
      onClose={onClose}
      wide
      title={d.id ? `編集：${existing?.title ?? ""}` : "設定を追加"}
      footer={
        <>
          {d.id && (
            <Button variant="danger" onClick={remove} disabled={busy} className="mr-auto">
              削除
            </Button>
          )}
          <Button onClick={onClose}>キャンセル</Button>
          <Button variant="primary" onClick={save} disabled={busy || !d.title.trim()}>
            保存
          </Button>
        </>
      }
    >
      <div className="grid gap-4 md:grid-cols-2">
        <div className="flex flex-col gap-3">
          <Field label="種類" htmlFor="e-kind" hint={ENTRY_KIND_HELP[k]}>
            <Select id="e-kind" value={k} disabled={!!d.id} onChange={(e) => setD({ ...blankEntry(e.target.value as EntryKind), title: d.title, body: d.body, source: d.source })} options={KIND_OPTIONS} />
          </Field>
          <Field label="名前（タイトル）" htmlFor="e-title" hint="本文の照合に使います。">
            <Input id="e-title" value={d.title} onChange={(e) => set("title", e.target.value)} maxLength={200} />
          </Field>
          <Field label="別名・英語名" htmlFor="e-aliases" hint="改行・カンマ区切り。本文にこれらが出たときも、この項目への言及として扱います。">
            <ListInput id="e-aliases" value={d.aliases} onChange={(v) => set("aliases", v)} />
          </Field>
          <Field label="内容" htmlFor="e-body">
            <Textarea id="e-body" rows={4} value={d.body} onChange={(e) => set("body", e.target.value)} />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="状態" htmlFor="e-status" hint="確定＝承認済み。提案＝検討中。廃止＝使わない。">
              <Select
                id="e-status"
                value={d.status}
                onChange={(e) => set("status", e.target.value as Draft["status"])}
                options={(["confirmed", "proposed", "deprecated"] as const).map((s) => ({ value: s, label: STATUS_LABEL[s] }))}
              />
            </Field>
            <Field label="公開区分" htmlFor="e-vis" hint="未公開は投稿に書けず、外部モデルにも既定で送りません。">
              <Select
                id="e-vis"
                value={d.visibility}
                onChange={(e) => set("visibility", e.target.value as Draft["visibility"])}
                options={[
                  { value: "public", label: "公開してよい" },
                  { value: "internal", label: "未公開" },
                ]}
              />
            </Field>
          </div>
          <fieldset className="rounded-md border border-line p-3">
            <legend className="px-1 text-[13px] font-semibold">出典</legend>
            <div className="flex flex-col gap-2">
              <Input aria-label="出典の名前" placeholder="例：設定資料 v2（2026-08）" value={d.source.label} onChange={(e) => set("source", { ...d.source, label: e.target.value })} />
              <Input aria-label="出典の URL" placeholder="URL（任意）" value={d.source.url} onChange={(e) => set("source", { ...d.source, url: e.target.value })} />
              <Input aria-label="出典のメモ" placeholder="メモ（任意）" value={d.source.note} onChange={(e) => set("source", { ...d.source, note: e.target.value })} />
            </div>
          </fieldset>
          {existing && (
            <p className="text-[12px] text-muted">
              作成 {fmtDate(existing.createdAt, true)} / 更新 {fmtDate(existing.updatedAt, true)}
            </p>
          )}
        </div>

        <div className="flex flex-col gap-3">
          {k === "term" && (
            <>
              <Field label="読み" htmlFor="e-reading">
                <Input id="e-reading" value={d.details.reading} onChange={(e) => setDet("reading", e.target.value)} />
              </Field>
              <Field label="誤表記（使ってはいけない書き方）" htmlFor="e-variants" hint="本文にあれば正しい表記とともに止めます。">
                <ListInput id="e-variants" value={d.details.forbiddenVariants} onChange={(v) => setDet("forbiddenVariants", v)} />
              </Field>
            </>
          )}
          {k === "character" && (
            <Field label="話し方" htmlFor="e-speech">
              <Textarea id="e-speech" rows={2} value={d.details.speechStyle} onChange={(e) => setDet("speechStyle", e.target.value)} />
            </Field>
          )}
          {k === "event" && (
            <Field label="作中の時系列（並べ替え用）" htmlFor="e-order" hint="例：212-040">
              <Input id="e-order" value={d.details.inWorldOrder} onChange={(e) => setDet("inWorldOrder", e.target.value)} />
            </Field>
          )}
          {k === "voice" && (
            <>
              <Field label="語りの種類" htmlFor="e-vmode">
                <Select
                  id="e-vmode"
                  value={d.details.voiceMode ?? "in_world"}
                  onChange={(e) => setDet("voiceMode", e.target.value as "in_world" | "developer")}
                  options={[
                    { value: "in_world", label: "世界内の語り手" },
                    { value: "developer", label: "開発者の語り" },
                  ]}
                />
              </Field>
              <Field label="すること" htmlFor="e-do">
                <ListInput id="e-do" rows={3} value={d.details.doList} onChange={(v) => setDet("doList", v)} />
              </Field>
              <Field label="しないこと" htmlFor="e-dont">
                <ListInput id="e-dont" rows={3} value={d.details.dontList} onChange={(v) => setDet("dontList", v)} />
              </Field>
              <Field label="この語り手特有の言い回し" htmlFor="e-sig" hint="別の語り手（開発者の語りなど）に混ざったら知らせます。">
                <ListInput id="e-sig" value={d.details.signaturePhrases} onChange={(v) => setDet("signaturePhrases", v)} />
              </Field>
            </>
          )}
          {k === "visual" && (
            <>
              <Field label="色調" htmlFor="e-palette">
                <Input id="e-palette" value={d.details.palette} onChange={(e) => setDet("palette", e.target.value)} />
              </Field>
              <Field label="避ける表現" htmlFor="e-avoid">
                <ListInput id="e-avoid" value={d.details.avoid} onChange={(v) => setDet("avoid", v)} />
              </Field>
              <Field label="参考素材" htmlFor="e-assets" hint="素材庫の画像を紐付けます。">
                <select
                  id="e-assets"
                  multiple
                  className="min-h-24 w-full rounded-md border border-line bg-surface p-2 text-sm"
                  value={d.details.assetIds}
                  onChange={(e) => setDet("assetIds", Array.from(e.target.selectedOptions).map((o) => o.value))}
                >
                  {data.assets.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.title || a.filename}
                    </option>
                  ))}
                </select>
              </Field>
            </>
          )}
          {k === "example" && (
            <>
              <Field label="良い例／悪い例" htmlFor="e-pol">
                <Select
                  id="e-pol"
                  value={d.details.polarity ?? "good"}
                  onChange={(e) => setDet("polarity", e.target.value as "good" | "bad")}
                  options={[
                    { value: "good", label: "良い例" },
                    { value: "bad", label: "悪い例" },
                  ]}
                />
              </Field>
              <Field label="投稿の本文" htmlFor="e-ex">
                <Textarea id="e-ex" rows={4} value={d.details.exampleText} onChange={(e) => setDet("exampleText", e.target.value)} />
              </Field>
              <Field label="理由" htmlFor="e-exr">
                <Textarea id="e-exr" rows={2} value={d.details.exampleReason} onChange={(e) => setDet("exampleReason", e.target.value)} />
              </Field>
            </>
          )}
          {k === "feature" && (
            <>
              <Field label="実装状況" htmlFor="e-fs" hint="「公開済み」以外を「実装しました」等と書くと検査で止めます。">
                <Select
                  id="e-fs"
                  value={d.details.featureStatus ?? "concept"}
                  onChange={(e) => setDet("featureStatus", e.target.value as EntryDetails["featureStatus"])}
                  options={(Object.keys(FEATURE_STATUS_LABEL) as (keyof typeof FEATURE_STATUS_LABEL)[]).map((s) => ({ value: s, label: FEATURE_STATUS_LABEL[s] }))}
                />
              </Field>
              <Field label="バージョン" htmlFor="e-ver">
                <Input id="e-ver" value={d.details.version} onChange={(e) => setDet("version", e.target.value)} />
              </Field>
            </>
          )}
          {k === "claim" && (
            <>
              <Field label="種類" htmlFor="e-ct">
                <Select
                  id="e-ct"
                  value={d.details.claimType ?? "other"}
                  onChange={(e) => setDet("claimType", e.target.value as EntryDetails["claimType"])}
                  options={(Object.keys(CLAIM_TYPE_LABEL) as (keyof typeof CLAIM_TYPE_LABEL)[]).map((s) => ({ value: s, label: CLAIM_TYPE_LABEL[s] }))}
                />
              </Field>
              <Field label="値（本文に書く形）" htmlFor="e-val" hint="例：120名、最優秀賞">
                <Input id="e-val" value={d.details.value} onChange={(e) => setDet("value", e.target.value)} />
              </Field>
              <Field label="根拠の URL" htmlFor="e-evu">
                <Input id="e-evu" value={d.details.evidenceUrl} onChange={(e) => setDet("evidenceUrl", e.target.value)} />
              </Field>
              <Field label="根拠の資料メモ" htmlFor="e-evn" hint="URL か資料メモのどちらかが必要です。なければ「根拠なし」として本文に書けません。">
                <Input id="e-evn" value={d.details.evidenceNote} onChange={(e) => setDet("evidenceNote", e.target.value)} />
              </Field>
              <Field label="確認日" htmlFor="e-vat">
                <Input id="e-vat" type="date" value={d.details.verifiedAt} onChange={(e) => setDet("verifiedAt", e.target.value)} />
              </Field>
              {!d.details.evidenceUrl && !d.details.evidenceNote && <Notice tone="warn">根拠が未登録です。この実績は投稿に書けません。</Notice>}
            </>
          )}
          {k === "notice" && (
            <>
              <Field label="期間" htmlFor="e-per" hint="例：2026-11-10〜2026-11-24（本文の日付と照合します）">
                <Input id="e-per" value={d.details.period} onChange={(e) => setDet("period", e.target.value)} />
              </Field>
              <Field label="参加方法" htmlFor="e-how">
                <Textarea id="e-how" rows={2} value={d.details.howToJoin} onChange={(e) => setDet("howToJoin", e.target.value)} />
              </Field>
              <Field label="条件（無料・先着・報酬なども正確に）" htmlFor="e-cond">
                <Textarea id="e-cond" rows={3} value={d.details.conditions} onChange={(e) => setDet("conditions", e.target.value)} />
              </Field>
            </>
          )}
          {k === "testimonial" && (
            <>
              <Field label="引用（そのままの言葉）" htmlFor="e-q">
                <Textarea id="e-q" rows={2} value={d.details.quote} onChange={(e) => setDet("quote", e.target.value)} />
              </Field>
              <Field label="発言者（表記してよい名前）" htmlFor="e-sp">
                <Input id="e-sp" value={d.details.speaker} onChange={(e) => setDet("speaker", e.target.value)} />
              </Field>
              <Checkbox label="本人から引用の同意を得ている" checked={d.details.consent} onChange={(v) => setDet("consent", v)} />
            </>
          )}

          <fieldset className="rounded-md border border-line p-3">
            <legend className="px-1 text-[13px] font-semibold">矛盾パターン（任意）</legend>
            <p className="mb-2 text-[12px] text-muted">本文にこの書き方があれば、この設定と矛盾するとして止めます（確定項目のみ）。正規表現も使えます。</p>
            {d.contradictions.map((c, i) => (
              <div key={i} className="mb-2 flex flex-col gap-1 rounded border border-line p-2">
                <div className="flex gap-2">
                  <Input aria-label="パターン" value={c.pattern} placeholder="例：白海.{0,20}100年前" onChange={(e) => set("contradictions", d.contradictions.map((x, j) => (j === i ? { ...x, pattern: e.target.value } : x)))} />
                  <Button size="sm" variant="ghost" aria-label="パターンを削除" onClick={() => set("contradictions", d.contradictions.filter((_, j) => j !== i))}>
                    ✕
                  </Button>
                </div>
                <Input aria-label="理由" value={c.reason} placeholder="理由（指摘に表示）" onChange={(e) => set("contradictions", d.contradictions.map((x, j) => (j === i ? { ...x, reason: e.target.value } : x)))} />
                <Checkbox label="正規表現として扱う" checked={c.regex} onChange={(v) => set("contradictions", d.contradictions.map((x, j) => (j === i ? { ...x, regex: v } : x)))} />
              </div>
            ))}
            <Button size="sm" onClick={() => set("contradictions", [...d.contradictions, { pattern: "", regex: false, reason: "" }])}>
              パターンを追加
            </Button>
          </fieldset>

          <Field label="この項目が置き換えた項目" htmlFor="e-sup" hint="置き換え先として、廃止項目の指摘に表示されます。">
            <select
              id="e-sup"
              multiple
              className="min-h-20 w-full rounded-md border border-line bg-surface p-2 text-sm"
              value={d.supersedes}
              onChange={(e) => set("supersedes", Array.from(e.target.selectedOptions).map((o) => o.value))}
            >
              {others.map((e) => (
                <option key={e.id} value={e.id}>
                  [{STATUS_LABEL[e.status]}] {e.title}（{ENTRY_KIND_LABEL[e.kind]}）
                </option>
              ))}
            </select>
          </Field>

          {d.id && (
            <Field label="変更のメモ（履歴に残ります）" htmlFor="e-note">
              <Input id="e-note" value={note} onChange={(e) => setNote(e.target.value)} placeholder="例：2026-10 打ち合わせで確定" />
            </Field>
          )}
        </div>
      </div>

      {existing && existing.history.length > 0 && (
        <div className="mt-4 border-t border-line pt-3">
          <Button size="sm" variant="ghost" onClick={() => setShowHistory((v) => !v)}>
            {showHistory ? "▼" : "▶"} 変更履歴（{existing.history.length}）
          </Button>
          {showHistory && (
            <ol className="mt-2 flex flex-col gap-2">
              {existing.history.map((h, i) => (
                <li key={i} className="rounded border border-line p-2 text-sm">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-muted">{fmtDate(h.at, true)} 時点</span>
                    <StatusBadge status={h.snapshot.status} />
                    {h.snapshot.visibility === "internal" && <Badge tone="danger">未公開</Badge>}
                    {h.note && <span className="text-[12px] text-muted">変更メモ：{h.note}</span>}
                    <Button size="sm" className="ml-auto" onClick={() => restore(h)} disabled={busy}>
                      この版に戻す
                    </Button>
                  </div>
                  <div className="mt-1 font-medium">{h.snapshot.title}</div>
                  <p className="whitespace-pre-wrap text-muted">{h.snapshot.body}</p>
                </li>
              ))}
            </ol>
          )}
        </div>
      )}
    </Modal>
  );
}

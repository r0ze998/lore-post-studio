"use client";

import { useMemo, useState } from "react";
import type { Angle, Asset, DraftVersion, Entry, Learning, Post, PostType, Segment } from "@/lib/domain/schema";
import { POST_STATUS_LABEL, POST_TYPE_LABEL, SEVERITY_LABEL } from "@/lib/domain/labels";
import { RULES, GENERAL_LIMITS } from "@/lib/checks/catalog";
import { countX } from "@/lib/checks/xcount";
import { unacknowledgedErrors, type CheckReport, type Finding, type SentenceProvenance } from "@/lib/checks/engine";
import { altTextFile, imagePrompt, postMarkdown, threadPlainText } from "@/lib/domain/exporting";
import { api, clientId, downloadBlob, fmtDate } from "@/lib/client/api";
import { useProject } from "../project-context";
import { EntryPicker } from "../entry-picker";
import { Badge, Button, Checkbox, CopyButton, Field, Input, ListInput, Modal, Notice, Select, Textarea, cx, useAsyncAction, useToast } from "../ui";
import { GeneratePanel } from "./generate-panel";
import { Highlighted } from "./preview";

export interface StepProps {
  post: Post;
  setPost: (p: Post) => void;
  draft: DraftVersion | undefined;
  report: CheckReport | undefined;
  dirty: boolean;
  save: () => Promise<boolean>;
  onServerPost: (p: Post) => void;
  goto: (step: StepId) => void;
}

export type StepId = "brief" | "angles" | "draft" | "check" | "approve" | "export" | "record";

/* ================================================================== */
/* 1. 企画                                                             */
/* ================================================================== */

export function BriefStep({ post, setPost }: StepProps) {
  const { data } = useProject();
  const b = post.brief;
  const o = post.options;
  const setB = (patch: Partial<Post["brief"]>) => setPost({ ...post, brief: { ...b, ...patch } });
  const setO = (patch: Partial<Post["options"]>) => setPost({ ...post, options: { ...o, ...patch } });
  const others = data.posts.filter((p) => p.id !== post.id && p.status !== "rejected");

  return (
    <div className="flex flex-col gap-4">
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="管理用の見出し" htmlFor="b-title">
          <Input id="b-title" value={post.title} onChange={(e) => setPost({ ...post, title: e.target.value })} />
        </Field>
        <Field label="投稿の種類" htmlFor="b-type">
          <Select id="b-type" value={post.type} onChange={(e) => setPost({ ...post, type: e.target.value as PostType })} options={(Object.keys(POST_TYPE_LABEL) as PostType[]).map((t) => ({ value: t, label: POST_TYPE_LABEL[t] }))} />
        </Field>
        <Field label="投稿の目的" htmlFor="b-purpose">
          <Textarea id="b-purpose" rows={2} value={b.purpose} onChange={(e) => setB({ purpose: e.target.value })} />
        </Field>
        <Field label="対象読者" htmlFor="b-aud">
          <Textarea id="b-aud" rows={2} value={b.audience} onChange={(e) => setB({ audience: e.target.value })} />
        </Field>
        <Field label="語り" htmlFor="b-voice" hint="世界内の語りと開発者の説明を分けます。両方使う場合は投稿（セグメント）ごとに分けます。">
          <Select
            id="b-voice"
            value={b.voice}
            onChange={(e) => setB({ voice: e.target.value as Post["brief"]["voice"] })}
            options={[
              { value: "in_world", label: "世界内の語り手" },
              { value: "developer", label: "開発者の語り" },
              { value: "mixed", label: "両方（投稿ごとに分ける）" },
            ]}
          />
        </Field>
        <Field label="言語" htmlFor="b-lang">
          <Select
            id="b-lang"
            value={b.language}
            onChange={(e) => setB({ language: e.target.value as "ja" | "en" })}
            options={[
              { value: "ja", label: "日本語" },
              { value: "en", label: "英語（日本語の意味確認つき）" },
            ]}
          />
        </Field>
      </div>

      <div className="grid gap-3 lg:grid-cols-2">
        <div>
          <EntryPicker label="伝えたい事実（現実）" entries={data.entries} kinds={["feature", "claim", "notice", "testimonial"]} value={b.factIds} onChange={(ids) => setB({ factIds: ids })} />
          <p className="mt-1 text-[12px] text-muted">実装済みの機能・根拠のある実績・告知情報から選びます。ここにない事実は、先に正本へ登録してください。</p>
        </div>
        <div>
          <EntryPicker label="使う設定（世界・表現）" entries={data.entries} kinds={["lore", "term", "character", "event", "voice", "visual", "example"]} value={b.canonIds} onChange={(ids) => setB({ canonIds: ids })} />
          <p className="mt-1 text-[12px] text-muted">提案段階の設定は、ここで選んだ場合だけ生成に使われます（未確定と明記）。</p>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="素材" htmlFor="b-assets" hint="生成には素材の説明文だけを使います（ファイルは送りません）。投稿への添付は下書きで行います。">
          <select id="b-assets" multiple className="min-h-24 w-full rounded-md border border-line bg-surface p-2 text-sm" value={b.assetIds} onChange={(e) => setB({ assetIds: Array.from(e.target.selectedOptions).map((x) => x.value) })}>
            {data.assets.map((a) => (
              <option key={a.id} value={a.id}>
                {a.title || a.filename}
                {a.visibility === "internal" ? "（未公開）" : ""}
              </option>
            ))}
          </select>
        </Field>
        <Field label="続き元の投稿" htmlFor="b-cont" hint="連続投稿・物語の続きのとき。前回の本文を参照します。">
          <select id="b-cont" multiple className="min-h-24 w-full rounded-md border border-line bg-surface p-2 text-sm" value={b.continuesPostIds} onChange={(e) => setB({ continuesPostIds: Array.from(e.target.selectedOptions).map((x) => x.value) })}>
            {others.map((p) => (
              <option key={p.id} value={p.id}>
                [{POST_STATUS_LABEL[p.status]}] {p.title}
              </option>
            ))}
          </select>
        </Field>
        <Field label="連載名（任意）" htmlFor="b-series">
          <Input id="b-series" value={b.seriesName} onChange={(e) => setB({ seriesName: e.target.value })} />
        </Field>
        <Field label="メモ" htmlFor="b-notes">
          <Textarea id="b-notes" rows={2} value={b.notes} onChange={(e) => setB({ notes: e.target.value })} />
        </Field>
      </div>

      <fieldset className="rounded-md border border-line p-3">
        <legend className="px-1 text-[13px] font-semibold">表現の設定（既定では控えめ）</legend>
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="絵文字" htmlFor="o-emoji">
            <Select
              id="o-emoji"
              value={o.emoji}
              onChange={(e) => setO({ emoji: e.target.value as Post["options"]["emoji"] })}
              options={[
                { value: "none", label: "使わない" },
                { value: "few", label: "少しだけ" },
                { value: "free", label: "自由" },
              ]}
            />
          </Field>
          {o.emoji === "few" && (
            <Field label="絵文字の上限（1 投稿あたり）" htmlFor="o-maxemoji">
              <Input id="o-maxemoji" type="number" min={1} max={20} value={o.maxEmoji || 1} onChange={(e) => setO({ maxEmoji: Number(e.target.value) })} />
            </Field>
          )}
          <Field label="ハッシュタグの上限" htmlFor="o-maxtag">
            <Input id="o-maxtag" type="number" min={0} max={10} value={o.maxHashtags} onChange={(e) => setO({ maxHashtags: Number(e.target.value) })} />
          </Field>
          <Field label="使ってよいハッシュタグ" htmlFor="o-tags">
            <ListInput id="o-tags" value={o.hashtags} onChange={(v) => setO({ hashtags: v })} placeholder="#ゲーム名" />
          </Field>
          <Field label="行動の呼びかけ（CTA）" htmlFor="o-cta">
            <Select
              id="o-cta"
              value={o.cta}
              onChange={(e) => setO({ cta: e.target.value as Post["options"]["cta"] })}
              options={[
                { value: "none", label: "入れない" },
                { value: "soft", label: "控えめに一言" },
                { value: "explicit", label: "明示する" },
              ]}
            />
          </Field>
          {o.cta !== "none" && (
            <Field label="CTA の文言（任意）" htmlFor="o-ctatext">
              <Input id="o-ctatext" value={o.ctaText} onChange={(e) => setO({ ctaText: e.target.value })} placeholder="例：応募はこちら" />
            </Field>
          )}
        </div>
      </fieldset>
    </div>
  );
}

/* ================================================================== */
/* 2. 切り口                                                           */
/* ================================================================== */

export function AnglesStep({ post, setPost, save, onServerPost, goto }: StepProps) {
  const [title, setTitle] = useState("");
  const [approach, setApproach] = useState("");
  const origin = { template: "テンプレート", model: "モデル", manual: "手入力", relay: "手動中継" };
  return (
    <div className="flex flex-col gap-4">
      <GeneratePanel task="angles" post={post} ensureSaved={save} onDone={onServerPost} />
      {post.angles.length === 0 ? (
        <p className="text-sm text-muted">まだ切り口がありません。生成するか、自分で追加してください。</p>
      ) : (
        <ul className="flex flex-col gap-2" data-testid="angle-list">
          {post.angles.map((a: Angle) => (
            <li key={a.id}>
              <label className={cx("flex cursor-pointer gap-3 rounded-md border p-3", post.chosenAngleId === a.id ? "border-accent bg-accent-soft" : "border-line bg-surface")}>
                <input type="radio" name="angle" className="mt-1 accent-[var(--accent)]" checked={post.chosenAngleId === a.id} onChange={() => setPost({ ...post, chosenAngleId: a.id })} />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-semibold">{a.title}</span>
                    <Badge>{origin[a.origin]}</Badge>
                  </div>
                  {a.approach && <p className="mt-1 text-sm">{a.approach}</p>}
                  {a.why && <p className="mt-1 text-[13px] text-muted">なぜ伝わるか：{a.why}</p>}
                </div>
                <button
                  type="button"
                  aria-label="切り口を削除"
                  className="self-start text-muted hover:text-danger"
                  onClick={(e) => {
                    e.preventDefault();
                    setPost({ ...post, angles: post.angles.filter((x) => x.id !== a.id), chosenAngleId: post.chosenAngleId === a.id ? "" : post.chosenAngleId });
                  }}
                >
                  ✕
                </button>
              </label>
            </li>
          ))}
        </ul>
      )}
      <details className="rounded-md border border-line p-3">
        <summary className="cursor-pointer text-sm font-semibold">自分で切り口を追加</summary>
        <div className="mt-2 flex flex-col gap-2">
          <Input aria-label="切り口の見出し" placeholder="見出し" value={title} onChange={(e) => setTitle(e.target.value)} />
          <Textarea aria-label="何をどう書くか" rows={2} placeholder="何をどう書くか" value={approach} onChange={(e) => setApproach(e.target.value)} />
          <div>
            <Button
              size="sm"
              disabled={!title.trim()}
              onClick={() => {
                const a: Angle = { id: clientId("ang"), title, approach, why: "", origin: "manual" };
                setPost({ ...post, angles: [...post.angles, a], chosenAngleId: a.id });
                setTitle("");
                setApproach("");
              }}
            >
              追加して選ぶ
            </Button>
          </div>
        </div>
      </details>
      {post.chosenAngleId && (
        <div>
          <Button variant="primary" onClick={() => goto("draft")}>
            この切り口で下書きへ
          </Button>
        </div>
      )}
    </div>
  );
}

/* ================================================================== */
/* 3. 下書き                                                           */
/* ================================================================== */

function newSegment(voice: Segment["voice"]): Segment {
  return { id: clientId("seg"), text: "", voice, jaGloss: "", assetIds: [], provenance: [] };
}

export function DraftStep({ post, setPost, draft, save, onServerPost, report }: StepProps) {
  const { data } = useProject();
  const [assetPickFor, setAssetPickFor] = useState<number | null>(null);
  const origin = { template: "テンプレート", model: "モデル", manual: "手入力", relay: "手動中継" };

  const startBlank = () => {
    const d: DraftVersion = {
      id: clientId("drf"),
      createdAt: new Date().toISOString(),
      origin: "manual",
      generator: "",
      language: post.brief.language,
      creativeNotes: "",
      segments: [newSegment(post.brief.voice === "in_world" ? "in_world" : "developer")],
    };
    setPost({ ...post, drafts: [...post.drafts, d], currentDraftId: d.id, status: post.status === "idea" ? "drafting" : post.status });
  };

  if (!draft) {
    return (
      <div className="flex flex-col gap-4">
        <GeneratePanel task="draft" post={post} angleId={post.chosenAngleId} ensureSaved={save} onDone={onServerPost} />
        <div>
          <Button onClick={startBlank}>白紙から書く</Button>
        </div>
      </div>
    );
  }

  const updateDraft = (d: DraftVersion) => setPost({ ...post, drafts: post.drafts.map((x) => (x.id === d.id ? d : x)) });
  const updateSeg = (i: number, patch: Partial<Segment>) => updateDraft({ ...draft, segments: draft.segments.map((s, k) => (k === i ? { ...s, ...patch } : s)) });
  const move = (i: number, dir: -1 | 1) => {
    const segs = [...draft.segments];
    const j = i + dir;
    if (j < 0 || j >= segs.length) return;
    [segs[i], segs[j]] = [segs[j], segs[i]];
    updateDraft({ ...draft, segments: segs });
  };
  const approved = post.decisions.some((d) => d.kind === "approved" && d.draftId === draft.id);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end gap-2">
        <Field label="版" htmlFor="d-version" className="min-w-60 flex-1">
          <Select
            id="d-version"
            value={draft.id}
            onChange={(e) => setPost({ ...post, currentDraftId: e.target.value })}
            options={post.drafts.map((d, i) => ({
              value: d.id,
              label: `第${i + 1}版 · ${origin[d.origin]}${d.generator && d.origin !== "manual" ? `（${d.generator}）` : ""} · ${fmtDate(d.createdAt, true)}${post.decisions.some((x) => x.kind === "approved" && x.draftId === d.id) ? " · 承認歴あり" : ""}`,
            }))}
          />
        </Field>
        <Button
          onClick={() => {
            const copy: DraftVersion = { ...draft, id: clientId("drf"), createdAt: new Date().toISOString(), origin: "manual", generator: "", segments: draft.segments.map((s) => ({ ...s, id: clientId("seg") })) };
            setPost({ ...post, drafts: [...post.drafts, copy], currentDraftId: copy.id });
          }}
        >
          この版を複製して編集
        </Button>
        <Button variant="ghost" onClick={startBlank}>
          白紙の版を追加
        </Button>
      </div>
      {approved && post.status === "approved" && <Notice tone="info">この版は承認済みです。本文を変えて保存すると「確認待ち」に戻ります。</Notice>}

      <ol className="flex flex-col gap-3">
        {draft.segments.map((s, i) => {
          const c = countX(s.text);
          const segAssets = s.assetIds.map((id) => data.assets.find((a) => a.id === id)).filter((a): a is Asset => !!a);
          const segFindings = report?.findings.filter((f) => f.segmentIndex === i) ?? [];
          return (
            <li key={s.id} className="rounded-md border border-line bg-surface p-3" data-testid="segment">
              <div className="mb-2 flex flex-wrap items-center gap-2">
                <span className="text-[13px] font-semibold">{draft.segments.length > 1 ? `${i + 1} / ${draft.segments.length}` : "本文"}</span>
                <div role="radiogroup" aria-label="語り" className="flex overflow-hidden rounded-md border border-line text-[12px]">
                  {(["in_world", "developer"] as const).map((v) => (
                    <button
                      key={v}
                      type="button"
                      role="radio"
                      aria-checked={s.voice === v}
                      onClick={() => updateSeg(i, { voice: v })}
                      className={cx("px-2 py-1", s.voice === v ? "bg-accent text-accent-ink" : "bg-surface text-muted")}
                    >
                      {v === "in_world" ? "世界内の語り" : "開発者の語り"}
                    </button>
                  ))}
                </div>
                <span className={cx("ml-auto text-[13px] tabular-nums", c.weightedLength > 280 ? "font-bold text-danger" : c.weightedLength > 260 ? "text-warn" : "text-muted")} data-testid="char-count">
                  {c.weightedLength} / 280
                </span>
              </div>
              <Textarea
                aria-label={`本文 ${i + 1}`}
                rows={5}
                value={s.text}
                onChange={(e) => updateSeg(i, { text: e.target.value })}
                className={c.weightedLength > 280 ? "border-danger" : ""}
              />
              {s.voice === "in_world" && <p className="mt-1 text-[12px] text-muted">「※」で始まる行は、世界の外側の注記（ゲーム名・告知など）として扱います。</p>}
              {draft.language === "en" && (
                <Field label="日本語の意味確認" htmlFor={`gloss-${s.id}`} className="mt-2" hint="英文が意図どおりの意味か確認するための日本語です（投稿されません）。">
                  <Textarea id={`gloss-${s.id}`} rows={2} value={s.jaGloss} onChange={(e) => updateSeg(i, { jaGloss: e.target.value })} />
                </Field>
              )}
              {segAssets.length > 0 && (
                <div className="mt-2 flex flex-wrap gap-2">
                  {segAssets.map((a) => (
                    <div key={a.id} className="relative">
                      {a.mime.startsWith("image/") ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={`/api/projects/${data.project.id}/assets/${a.id}`} alt={a.altText} className="h-16 w-16 rounded border border-line object-cover" />
                      ) : (
                        <div className="flex h-16 w-16 items-center justify-center rounded border border-line text-[11px]">動画</div>
                      )}
                      <button type="button" aria-label="添付を外す" className="absolute -top-2 -right-2 rounded-full bg-surface px-1 text-[12px] shadow" onClick={() => updateSeg(i, { assetIds: s.assetIds.filter((x) => x !== a.id) })}>
                        ✕
                      </button>
                    </div>
                  ))}
                </div>
              )}
              {segFindings.some((f) => f.severity !== "info") && (
                <p className="mt-2 text-[12px] text-warn">この投稿に指摘が {segFindings.filter((f) => f.severity !== "info").length} 件あります（「検査」で確認）。</p>
              )}
              <div className="mt-2 flex flex-wrap gap-1">
                <Button size="sm" variant="ghost" onClick={() => setAssetPickFor(i)}>
                  素材を添付
                </Button>
                <Button size="sm" variant="ghost" onClick={() => move(i, -1)} disabled={i === 0} aria-label="上へ">
                  ↑
                </Button>
                <Button size="sm" variant="ghost" onClick={() => move(i, 1)} disabled={i === draft.segments.length - 1} aria-label="下へ">
                  ↓
                </Button>
                <Button size="sm" variant="ghost" disabled={draft.segments.length === 1} onClick={() => updateDraft({ ...draft, segments: draft.segments.filter((_, k) => k !== i) })}>
                  この投稿を削除
                </Button>
              </div>
              {s.provenance.length > 0 && (
                <details className="mt-2 text-[13px]">
                  <summary className="cursor-pointer text-muted">生成器が申告した根拠（{s.provenance.length}）</summary>
                  <ul className="mt-1">
                    {s.provenance.map((p, k) => (
                      <li key={k} className="border-b border-line py-1">
                        <BasisBadge basis={p.basis} /> {p.quote} {p.refIds.map((id) => data.entries.find((e) => e.id === id)?.title ?? id).join("・")} <span className="text-muted">{p.note}</span>
                      </li>
                    ))}
                  </ul>
                </details>
              )}
            </li>
          );
        })}
      </ol>
      <div className="flex flex-wrap gap-2">
        <Button onClick={() => updateDraft({ ...draft, segments: [...draft.segments, newSegment(post.brief.voice === "in_world" ? "in_world" : "developer")] })}>スレッドに投稿を追加</Button>
      </div>
      <Field label="創作メモ（設定にない部分・創作した部分）" htmlFor="d-notes" hint="例：井戸の数は今回の創作。承認後に「出来事」として正本に提案できます。">
        <Textarea id="d-notes" rows={3} value={draft.creativeNotes} onChange={(e) => updateDraft({ ...draft, creativeNotes: e.target.value })} />
      </Field>
      <GeneratePanel task="draft" post={post} angleId={post.chosenAngleId} ensureSaved={save} onDone={onServerPost} />

      <AssetPicker
        open={assetPickFor !== null}
        assets={data.assets}
        selected={assetPickFor !== null ? draft.segments[assetPickFor]?.assetIds ?? [] : []}
        onClose={() => setAssetPickFor(null)}
        onChange={(ids) => assetPickFor !== null && updateSeg(assetPickFor, { assetIds: ids })}
      />
    </div>
  );
}

function AssetPicker({ open, assets, selected, onClose, onChange }: { open: boolean; assets: Asset[]; selected: string[]; onClose: () => void; onChange: (ids: string[]) => void }) {
  const { data } = useProject();
  return (
    <Modal open={open} onClose={onClose} title="素材を添付" footer={<Button variant="primary" onClick={onClose}>完了</Button>}>
      {assets.length === 0 ? (
        <p className="text-sm text-muted">素材庫に素材がありません。</p>
      ) : (
        <ul className="grid grid-cols-3 gap-2 sm:grid-cols-4">
          {assets.map((a) => {
            const on = selected.includes(a.id);
            return (
              <li key={a.id}>
                <button type="button" aria-pressed={on} onClick={() => onChange(on ? selected.filter((x) => x !== a.id) : [...selected, a.id])} className={cx("w-full rounded border-2 p-1 text-left", on ? "border-accent" : "border-transparent")}>
                  {a.mime.startsWith("image/") ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={`/api/projects/${data.project.id}/assets/${a.id}`} alt={a.altText} className="aspect-square w-full rounded object-cover" />
                  ) : (
                    <div className="flex aspect-square w-full items-center justify-center rounded bg-surface2 text-[12px]">動画</div>
                  )}
                  <span className="mt-1 block truncate text-[12px]">{a.title || a.filename}</span>
                  {a.visibility === "internal" && <Badge tone="danger">未公開</Badge>}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </Modal>
  );
}

/* ================================================================== */
/* 4. 検査                                                             */
/* ================================================================== */

export function BasisBadge({ basis }: { basis: string }) {
  const m: Record<string, [string, "ok" | "info" | "warn" | "neutral" | "danger"]> = {
    fact: ["現実の事実", "ok"],
    canon: ["設定に根拠", "info"],
    unconfirmed: ["未確定の設定", "warn"],
    frame: ["注記・タグ", "neutral"],
    invented: ["創作（根拠なし）", "danger"],
    unknown: ["判断できない", "warn"],
  };
  const [label, tone] = m[basis] ?? [basis, "neutral"];
  return <Badge tone={tone}>{label}</Badge>;
}

function FindingItem({ f, ack, onAck, onUnack }: { f: Finding; ack?: string; onAck?: (reason: string) => void; onUnack?: () => void }) {
  const { data, base } = useProject();
  const [reason, setReason] = useState("");
  const rule = RULES[f.ruleId];
  return (
    <li className={cx("rounded-md border p-3", f.severity === "error" ? "border-danger/40" : f.severity === "warning" ? "border-warn/40" : "border-line")} data-testid="finding" data-rule={f.ruleId} data-severity={f.severity}>
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone={f.severity === "error" ? "danger" : f.severity === "warning" ? "warn" : "info"}>{SEVERITY_LABEL[f.severity]}</Badge>
        <span className="font-semibold">{f.title}</span>
        {f.segmentIndex !== null && <span className="text-[12px] text-muted">投稿 {f.segmentIndex + 1}</span>}
      </div>
      <p className="mt-1 text-sm">{f.message}</p>
      {f.suggestion && <p className="mt-1 text-sm text-ok">提案：{f.suggestion}</p>}
      {f.excerpt && <p className="mt-1 rounded bg-surface2 px-2 py-1 text-[13px]">{f.excerpt}</p>}
      {f.refs.length > 0 && (
        <div className="mt-1 text-[13px]">
          参照：
          {f.refs.map((r, i) => (
            <span key={i} className="mr-2">
              {r.kind === "entry" ? (
                <a className="text-accent underline" href={`${base}/canon`} title={data.entries.find((e) => e.id === r.id)?.body}>
                  {r.label}
                </a>
              ) : r.kind === "post" ? (
                <a className="text-accent underline" href={`${base}/posts/${r.id}`}>
                  {r.label}
                </a>
              ) : (
                <span>{r.label}</span>
              )}
              {r.detail && <span className="text-muted">（{r.detail}）</span>}
            </span>
          ))}
        </div>
      )}
      <details className="mt-1 text-[12px] text-muted">
        <summary className="cursor-pointer">このルールについて（{rule.name}）</summary>
        <p>見ていること：{rule.what}</p>
        <p>見逃し得る範囲：{rule.limits}</p>
      </details>
      {f.severity === "error" && onAck && (
        <div className="mt-2 border-t border-line pt-2">
          {ack ? (
            <div className="flex flex-wrap items-center gap-2 text-[13px]">
              <Badge tone="ok">確認済み</Badge> {ack}
              <Button size="sm" variant="ghost" onClick={onUnack}>
                取り消す
              </Button>
            </div>
          ) : (
            <div className="flex flex-wrap gap-2">
              <Input aria-label="確認済みとする理由" className="h-8 flex-1 text-sm" placeholder="修正しない理由（例：この数値は社内資料で確認済み）" value={reason} onChange={(e) => setReason(e.target.value)} />
              <Button size="sm" disabled={!reason.trim()} onClick={() => onAck?.(reason)}>
                理由を付けて確認済みにする
              </Button>
            </div>
          )}
        </div>
      )}
    </li>
  );
}

export function FindingsList({ report, post, setPost }: { report: CheckReport; post?: Post; setPost?: (p: Post) => void }) {
  const [show, setShow] = useState<"all" | "error" | "warning" | "info">("all");
  const list = report.findings.filter((f) => show === "all" || f.severity === show);
  const ackOf = (k: string) => post?.acknowledgements.find((a) => a.findingKey === k)?.reason;
  return (
    <div>
      <div className="mb-2 flex flex-wrap items-center gap-2 text-sm" role="group" aria-label="指摘の絞り込み">
        {(["all", "error", "warning", "info"] as const).map((s) => (
          <button key={s} type="button" onClick={() => setShow(s)} className={cx("rounded-full border px-3 py-0.5", show === s ? "border-accent bg-accent-soft" : "border-line")}>
            {s === "all" ? `すべて ${report.findings.length}` : `${SEVERITY_LABEL[s]} ${report.counts[s]}`}
          </button>
        ))}
      </div>
      {list.length === 0 ? (
        <Notice tone="ok">{report.findings.length === 0 ? "機械的に見つけられる問題はありませんでした。ただし、すべての問題を見つけられるわけではありません（下の「検査の限界」を参照）。" : "この区分の指摘はありません。"}</Notice>
      ) : (
        <ul className="flex flex-col gap-2">
          {list.map((f) => (
            <FindingItem
              key={f.key}
              f={f}
              ack={ackOf(f.key)}
              onAck={post && setPost ? (reason) => setPost({ ...post, acknowledgements: [...post.acknowledgements.filter((a) => a.findingKey !== f.key), { findingKey: f.key, reason, at: new Date().toISOString() }] }) : undefined}
              onUnack={post && setPost ? () => setPost({ ...post, acknowledgements: post.acknowledgements.filter((a) => a.findingKey !== f.key) }) : undefined}
            />
          ))}
        </ul>
      )}
    </div>
  );
}

export function ProvenanceMap({ provenance, draft }: { provenance: SentenceProvenance[]; draft: DraftVersion }) {
  return (
    <div className="flex flex-col gap-2" data-testid="provenance">
      {draft.segments.map((s, i) => (
        <div key={s.id}>
          {draft.segments.length > 1 && <div className="text-[12px] font-semibold text-muted">投稿 {i + 1}</div>}
          <ul className="flex flex-col gap-1">
            {provenance
              .filter((p) => p.segmentIndex === i)
              .map((p, k) => (
                <li key={k} className="flex flex-col gap-0.5 rounded border border-line px-2 py-1 text-sm sm:flex-row sm:items-start sm:gap-2">
                  <span className="shrink-0">
                    <BasisBadge basis={p.basis} />
                  </span>
                  <span className="flex-1">{p.text}</span>
                  {p.refs.length > 0 && <span className="text-[12px] text-muted">{p.refs.map((r) => r.label + (r.detail ? `（${r.detail}）` : "")).join("・")}</span>}
                </li>
              ))}
          </ul>
        </div>
      ))}
      <p className="text-[12px] text-muted">
        文ごとに、正本の項目名が出てくるかで分類しています。「設定に根拠」は名前が一致しただけで、内容が設定どおりかまでは保証しません。「創作（根拠なし）」は設定にない描写です（悪いとは限りません。創作した点として把握するためのものです）。
      </p>
    </div>
  );
}

export function CheckStep({ post, setPost, draft, report, goto }: StepProps) {
  if (!draft || !report) return <p className="text-sm text-muted">下書きがありません。</p>;
  const blocking = unacknowledgedErrors(report, post.acknowledgements);
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone={report.counts.error ? "danger" : "ok"}>要修正 {report.counts.error}</Badge>
        <Badge tone={report.counts.warning ? "warn" : "neutral"}>要確認 {report.counts.warning}</Badge>
        <Badge tone="info">参考 {report.counts.info}</Badge>
        <span className="text-[12px] text-muted">編集すると自動で再検査します（第{post.drafts.findIndex((d) => d.id === draft.id) + 1}版）</span>
        {blocking.length === 0 && (
          <Button size="sm" variant="primary" className="ml-auto" onClick={() => goto("approve")}>
            承認へ
          </Button>
        )}
      </div>
      <div className="rounded-md border border-line bg-surface p-3">
        <h3 className="mb-2 text-sm font-semibold">該当箇所</h3>
        <div className="flex flex-col gap-3">
          {draft.segments.map((s, i) => (
            <div key={s.id} className={draft.segments.length > 1 ? "border-l-2 border-line pl-2" : ""}>
              {draft.segments.length > 1 && <div className="text-[12px] text-muted">投稿 {i + 1}</div>}
              <Highlighted text={s.text} findings={report.findings} segmentIndex={i} overFrom={report.segments[i]?.weightedLength > 280 ? report.segments[i].validRangeEnd : undefined} />
            </div>
          ))}
        </div>
      </div>
      <FindingsList report={report} post={post} setPost={setPost} />
      <details className="rounded-md border border-line bg-surface p-3" open>
        <summary className="cursor-pointer text-sm font-semibold">根拠マップ：どこが設定・事実に基づき、どこが創作か</summary>
        <div className="mt-2">
          <ProvenanceMap provenance={report.provenance} draft={draft} />
        </div>
      </details>
      <LimitsNote />
    </div>
  );
}

export function LimitsNote() {
  return (
    <details className="rounded-md border border-line bg-surface p-3 text-sm">
      <summary className="cursor-pointer font-semibold">検査の限界（必ずお読みください）</summary>
      <ul className="mt-2 list-disc pl-5 text-muted">
        {GENERAL_LIMITS.map((l) => (
          <li key={l}>{l}</li>
        ))}
      </ul>
    </details>
  );
}

/* ================================================================== */
/* 5. 承認                                                             */
/* ================================================================== */

export function ApproveStep({ post, draft, report, dirty, save, onServerPost }: StepProps) {
  const { data, reload } = useProject();
  const toast = useToast();
  const [reason, setReason] = useState("");
  const [tags, setTags] = useState<string[]>([]);
  const [learn, setLearn] = useState(true);
  const [pattern, setPattern] = useState("");
  const { busy, run } = useAsyncAction();
  if (!draft || !report) return <p className="text-sm text-muted">下書きがありません。</p>;
  const blocking = unacknowledgedErrors(report, post.acknowledgements);
  const empty = draft.segments.every((s) => !s.text.trim());

  const decide = async (kind: "approved" | "rejected") => {
    if (dirty && !(await save())) return;
    const acks = post.acknowledgements.filter((a) => report.findings.some((f) => f.key === a.findingKey));
    const r = await run(() =>
      api<Post>(`/api/projects/${data.project.id}/posts/${post.id}/decision`, {
        body: { kind, reason, tags, draftId: draft.id, acknowledgements: acks, checkSummary: { errors: report.counts.error, warnings: report.counts.warning, infos: report.counts.info } },
      }),
    );
    if (!r) return;
    if (learn) {
      await run(() => api<Learning>(`/api/projects/${data.project.id}/learnings`, { body: { kind: kind === "approved" ? "do" : "dont", text: reason, pattern: kind === "rejected" ? pattern : "", origin: kind === "approved" ? "approval" : "rejection", postId: post.id } }));
    }
    onServerPost(r);
    if (learn) await reload();
    toast(kind === "approved" ? "承認しました" : "却下しました", "ok");
    setReason("");
    setTags([]);
    setPattern("");
  };

  return (
    <div className="flex flex-col gap-4">
      {post.status === "posted" && <Notice tone="info">投稿済みの記録があるため、承認・却下は変更できません。</Notice>}
      {blocking.length > 0 ? (
        <Notice tone="danger" title={`未確認の「要修正」が ${blocking.length} 件あります`}>
          修正するか、「検査」で理由を付けて確認済みにすると承認できます（理由は承認記録に残ります）。却下はいつでもできます。
        </Notice>
      ) : (
        <Notice tone="ok">承認を止める指摘はありません。要確認 {report.counts.warning} 件・参考 {report.counts.info} 件は、読んだうえで判断してください。</Notice>
      )}
      <Field label="理由（必須）" htmlFor="ap-reason" hint="採用・却下の理由は保存され、次の生成と検査に活かされます。">
        <Textarea id="ap-reason" rows={3} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="例：行動が具体的で、※行で何のゲームか伝わる" />
      </Field>
      <Field label="タグ（任意）" htmlFor="ap-tags">
        <ListInput id="ap-tags" value={tags} onChange={setTags} placeholder="具体的, 世界観が良い" />
      </Field>
      <Checkbox label="この理由を「学び」として保存し、次の生成に使う" checked={learn} onChange={setLearn} />
      {learn && (
        <Field label="却下の場合：この語句があれば次から知らせる（任意）" htmlFor="ap-pattern">
          <Input id="ap-pattern" value={pattern} onChange={(e) => setPattern(e.target.value)} placeholder="例：ゲームの未来" />
        </Field>
      )}
      <div className="flex flex-wrap gap-2">
        <Button variant="primary" disabled={busy || !reason.trim() || blocking.length > 0 || empty || post.status === "posted"} onClick={() => decide("approved")}>
          承認する
        </Button>
        <Button variant="danger" disabled={busy || !reason.trim() || post.status === "posted"} onClick={() => decide("rejected")}>
          却下する
        </Button>
      </div>
      {post.decisions.length > 0 && (
        <div>
          <h3 className="text-sm font-semibold">判断の記録</h3>
          <ul className="mt-1 flex flex-col gap-1 text-sm">
            {[...post.decisions].reverse().map((d, i) => (
              <li key={i} className="rounded border border-line px-2 py-1">
                <Badge tone={d.kind === "approved" ? "ok" : "danger"}>{d.kind === "approved" ? "承認" : "却下"}</Badge> 第{post.drafts.findIndex((x) => x.id === d.draftId) + 1}版 · {fmtDate(d.at, true)} · {d.reason}
                {d.acknowledgements.length > 0 && <span className="text-muted">（確認済みの指摘 {d.acknowledgements.length} 件）</span>}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

/* ================================================================== */
/* 6. 書き出し                                                         */
/* ================================================================== */

export function ExportStep({ post, setPost, draft }: StepProps) {
  const { data } = useProject();
  const [subject, setSubject] = useState("");
  const visuals = data.entries.filter((e) => e.kind === "visual");
  const firstAsset = draft?.segments.flatMap((s) => s.assetIds).map((id) => data.assets.find((a) => a.id === id)).find(Boolean);
  const prompt = useMemo(() => imagePrompt(data.project, visuals, subject, firstAsset), [data.project, visuals, subject, firstAsset]);
  if (!draft) return <p className="text-sm text-muted">下書きがありません。</p>;
  const approved = post.status === "approved" || post.status === "posted";
  const all = threadPlainText(draft);
  return (
    <div className="flex flex-col gap-4">
      {!approved && <Notice tone="warn">この投稿はまだ承認されていません。書き出しはできますが、投稿前に承認してください。</Notice>}
      <ol className="flex flex-col gap-2">
        {draft.segments.map((s, i) => (
          <li key={s.id} className="rounded-md border border-line bg-surface p-3">
            <div className="mb-1 flex items-center gap-2">
              <span className="text-[13px] font-semibold">{draft.segments.length > 1 ? `${i + 1} / ${draft.segments.length}` : "本文"}</span>
              <span className="text-[12px] text-muted">{countX(s.text).weightedLength} / 280</span>
              <span className="ml-auto">
                <CopyButton text={s.text} label="本文をコピー" />
              </span>
            </div>
            <p className="text-[15px] whitespace-pre-wrap">{s.text}</p>
            {s.assetIds.length > 0 && <p className="mt-1 text-[12px] text-muted">添付：{s.assetIds.map((id) => data.assets.find((a) => a.id === id)?.filename ?? "（削除済み）").join("、")}</p>}
          </li>
        ))}
      </ol>
      <div className="flex flex-wrap gap-2">
        <CopyButton text={all} label="すべてコピー" size="md" />
        <Button onClick={() => downloadBlob(`post-${post.id}.txt`, all)}>テキストで保存</Button>
        <Button onClick={() => downloadBlob(`post-${post.id}.md`, postMarkdown(data.project, post, draft, data.assets), "text/markdown;charset=utf-8")}>Markdown で保存</Button>
        <a className="inline-flex h-10 items-center rounded-md border border-line bg-surface px-4 text-sm font-medium hover:bg-surface2" href={`/api/projects/${data.project.id}/posts/${post.id}/export`} download>
          本文と素材を zip で保存
        </a>
        <CopyButton text={altTextFile(draft, data.assets)} label="代替テキストをコピー" size="md" />
      </div>
      <Field label="予約候補日時（任意）" htmlFor="ex-sched" hint="自分用のメモです。このツールは X に投稿しません。予約投稿は X 側で自分で設定してください。">
        <Input id="ex-sched" type="datetime-local" className="max-w-xs" value={post.scheduleCandidate} onChange={(e) => setPost({ ...post, scheduleCandidate: e.target.value })} />
      </Field>
      <details className="rounded-md border border-line bg-surface p-3">
        <summary className="cursor-pointer text-sm font-semibold">画像生成用の指示文（世界観に沿って書き出し）</summary>
        <div className="mt-2 flex flex-col gap-2">
          <Field label="描きたい場面" htmlFor="ip-subject">
            <Input id="ip-subject" value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="例：塩原で杭を打つ老人と、遠くのキャラバン" />
          </Field>
          {visuals.length === 0 && <Notice tone="info">正本に「画像の参考」を登録すると、色調や避ける表現が指示文に入ります。</Notice>}
          <pre className="rounded bg-surface2 p-2 text-[13px] whitespace-pre-wrap">{prompt.ja}</pre>
          <div className="flex gap-2">
            <CopyButton text={prompt.ja} label="日本語をコピー" />
            <CopyButton text={prompt.en} label="英語をコピー" />
          </div>
          <p className="text-[12px] text-muted">このツールは画像を生成しません。指示文を自分で選んだ画像生成サービスに貼ってください（未公開の設定は含めません）。</p>
        </div>
      </details>
    </div>
  );
}

/* ================================================================== */
/* 7. 記録                                                             */
/* ================================================================== */

export function RecordStep({ post, draft, onServerPost }: StepProps) {
  const { data, replaceEntry } = useProject();
  const pub = post.publication;
  const [url, setUrl] = useState(pub?.url ?? "");
  const [postedAt, setPostedAt] = useState(pub?.postedAt ?? "");
  const [postedText, setPostedText] = useState(pub?.postedText ?? "");
  const [retro, setRetro] = useState(pub?.retro ?? "");
  const [m, setM] = useState({ impressions: "", likes: "", reposts: "", replies: "", quotes: "", bookmarks: "", note: "" });
  const [evTitle, setEvTitle] = useState("");
  const [evBody, setEvBody] = useState("");
  const { busy, run } = useAsyncAction();

  if (post.status !== "approved" && post.status !== "posted") {
    return <Notice tone="info">承認済みの投稿に、実際に投稿した URL と反応を記録できます。</Notice>;
  }
  const savePub = async (extraMetrics?: object) => {
    const metrics = [...(pub?.metrics ?? []), ...(extraMetrics ? [extraMetrics] : [])];
    const r = await run(() => api<Post>(`/api/projects/${data.project.id}/posts/${post.id}/publication`, { method: "PUT", body: { url, postedAt, postedText, retro, metrics } }), "記録しました");
    if (r) onServerPost(r);
    return r;
  };
  const num = (s: string) => (s.trim() === "" ? undefined : Math.max(0, Math.floor(Number(s))));

  return (
    <div className="flex flex-col gap-4">
      <Notice tone="info">
        このツールは X に接続しないため、投稿済みかどうかは<strong>あなたの手動記録</strong>として保存されます（API による確認はしていません）。
      </Notice>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="投稿の URL" htmlFor="r-url" hint="スレッドの場合は 1 投稿目。">
          <Input id="r-url" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://x.com/…/status/…" />
        </Field>
        <Field label="投稿した日時" htmlFor="r-at">
          <Input id="r-at" type="datetime-local" value={postedAt} onChange={(e) => setPostedAt(e.target.value)} />
        </Field>
      </div>
      <Field label="実際に投稿した本文（承認版から変えた場合のみ）" htmlFor="r-text" hint="空なら承認版の本文を投稿したものとして扱います。重複検査に使います。">
        <Textarea id="r-text" rows={3} value={postedText} onChange={(e) => setPostedText(e.target.value)} placeholder={draft ? threadPlainText(draft).slice(0, 80) : ""} />
      </Field>
      <Field label="振り返りメモ" htmlFor="r-retro">
        <Textarea id="r-retro" rows={2} value={retro} onChange={(e) => setRetro(e.target.value)} />
      </Field>
      <div className="flex flex-wrap gap-2">
        <Button variant="primary" disabled={busy || !url.trim()} onClick={() => savePub()}>
          {pub ? "記録を更新" : "投稿済みとして記録"}
        </Button>
        {pub && (
          <Button
            variant="ghost"
            disabled={busy}
            onClick={async () => {
              if (!confirm("投稿記録を取り消して「承認済み」に戻します。")) return;
              const r = await run(() => api<Post>(`/api/projects/${data.project.id}/posts/${post.id}/publication`, { method: "DELETE" }), "取り消しました");
              if (r) onServerPost(r);
            }}
          >
            記録を取り消す
          </Button>
        )}
      </div>

      {pub && (
        <>
          <fieldset className="rounded-md border border-line p-3">
            <legend className="px-1 text-[13px] font-semibold">反応を記録（手動・その時点の値）</legend>
            <div className="grid grid-cols-3 gap-2 sm:grid-cols-6">
              {(
                [
                  ["impressions", "表示"],
                  ["likes", "いいね"],
                  ["reposts", "リポスト"],
                  ["replies", "返信"],
                  ["quotes", "引用"],
                  ["bookmarks", "ブックマーク"],
                ] as const
              ).map(([k, l]) => (
                <Field key={k} label={l} htmlFor={`m-${k}`}>
                  <Input id={`m-${k}`} inputMode="numeric" value={m[k]} onChange={(e) => setM({ ...m, [k]: e.target.value.replace(/[^\d]/g, "") })} />
                </Field>
              ))}
            </div>
            <Input aria-label="反応のメモ" className="mt-2" placeholder="メモ（任意）" value={m.note} onChange={(e) => setM({ ...m, note: e.target.value })} />
            <Button
              className="mt-2"
              size="sm"
              disabled={busy}
              onClick={async () => {
                const r = await savePub({ at: new Date().toISOString(), impressions: num(m.impressions), likes: num(m.likes), reposts: num(m.reposts), replies: num(m.replies), quotes: num(m.quotes), bookmarks: num(m.bookmarks), note: m.note, source: "manual" });
                if (r) setM({ impressions: "", likes: "", reposts: "", replies: "", quotes: "", bookmarks: "", note: "" });
              }}
            >
              この値を記録
            </Button>
            {pub.metrics.length > 0 && (
              <div className="mt-2 overflow-x-auto">
                <table className="w-full text-[13px]">
                  <thead>
                    <tr className="text-left text-muted">
                      <th className="pr-2">記録日時</th>
                      <th>表示</th>
                      <th>いいね</th>
                      <th>RP</th>
                      <th>返信</th>
                      <th>引用</th>
                      <th>BM</th>
                      <th>メモ</th>
                    </tr>
                  </thead>
                  <tbody>
                    {pub.metrics.map((x, i) => (
                      <tr key={i} className="border-t border-line">
                        <td className="pr-2">{fmtDate(x.at, true)}</td>
                        <td>{x.impressions ?? "-"}</td>
                        <td>{x.likes ?? "-"}</td>
                        <td>{x.reposts ?? "-"}</td>
                        <td>{x.replies ?? "-"}</td>
                        <td>{x.quotes ?? "-"}</td>
                        <td>{x.bookmarks ?? "-"}</td>
                        <td>{x.note}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </fieldset>

          {(post.type === "story" || post.type === "series" || post.type === "showcase") && (
            <fieldset className="rounded-md border border-line p-3">
              <legend className="px-1 text-[13px] font-semibold">この投稿で起きた出来事を正本に提案する</legend>
              <p className="mb-2 text-[12px] text-muted">続きの投稿で矛盾しないよう、物語の出来事を「物語上の出来事」として登録します（提案として入るので、確認してから確定にしてください）。</p>
              <div className="flex flex-col gap-2">
                <Input aria-label="出来事の名前" placeholder="例：七番隊、灯台町ミズハに到着" value={evTitle} onChange={(e) => setEvTitle(e.target.value)} />
                <Textarea aria-label="出来事の内容" rows={2} placeholder="内容（数や場所は具体的に）" value={evBody} onChange={(e) => setEvBody(e.target.value)} />
                <div>
                  <Button
                    size="sm"
                    disabled={busy || !evTitle.trim()}
                    onClick={async () => {
                      const e = await run(
                        () =>
                          api<Entry>(`/api/projects/${data.project.id}/entries`, {
                            body: { kind: "event", title: evTitle, body: evBody, status: "proposed", source: { label: `投稿「${post.title}」`, url: pub.url, note: "" }, details: { establishedByPostId: post.id } },
                          }),
                        "提案として登録しました",
                      );
                      if (e) {
                        replaceEntry(e);
                        setEvTitle("");
                        setEvBody("");
                      }
                    }}
                  >
                    提案として登録
                  </Button>
                </div>
              </div>
            </fieldset>
          )}
        </>
      )}
    </div>
  );
}

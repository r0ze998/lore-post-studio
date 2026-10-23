"use client";

import { useEffect, useState } from "react";
import type { Post } from "@/lib/domain/schema";
import type { GenerationTask, ProviderId, ProviderInfo, PromptPackage } from "@/lib/generation/types";
import type { CostEstimate } from "@/lib/generation/pricing";
import { api } from "@/lib/client/api";
import { useProject } from "../project-context";
import { Badge, Button, Checkbox, CopyButton, Field, Modal, Notice, Select, Textarea, useAsyncAction } from "../ui";

interface Preview {
  prompt: PromptPackage;
  relayText?: string;
  estimate?: CostEstimate;
  provider: ProviderInfo;
  allowExternal: boolean;
}

let providerCache: ProviderInfo[] | null = null;

export function useProviders() {
  const [list, setList] = useState<ProviderInfo[] | null>(providerCache);
  useEffect(() => {
    if (providerCache) return;
    api<{ providers: ProviderInfo[] }>("/api/providers").then((r) => {
      providerCache = r.providers;
      setList(r.providers);
    });
  }, []);
  return list;
}

/**
 * 生成の操作パネル。どの提供元でも、結果はこの投稿に「新しい切り口」「新しい版」として追加される（上書きしない）。
 * ensureSaved: 未保存の編集があれば先に保存する。
 */
export function GeneratePanel({ task, post, angleId, ensureSaved, onDone }: { task: GenerationTask; post: Post; angleId?: string; ensureSaved: () => Promise<boolean>; onDone: (p: Post) => void }) {
  const { data, reload } = useProject();
  const providers = useProviders();
  const [provider, setProvider] = useState<ProviderId>("template");
  const [extra, setExtra] = useState("");
  const [preview, setPreview] = useState<Preview | null>(null);
  const [includeInternal, setIncludeInternal] = useState<string[]>([]);
  const [pasted, setPasted] = useState("");
  const [showPrompt, setShowPrompt] = useState(false);
  const { busy, run } = useAsyncAction();
  const info = providers?.find((p) => p.id === provider);
  const base = `/api/projects/${data.project.id}/generate`;
  const body = (action: string, more: object = {}) => ({ action, task, provider, postId: post.id, angleId, includeInternalIds: includeInternal, extraInstruction: extra, ...more });

  const doPreview = async (internal = includeInternal) => {
    if (!(await ensureSaved())) return;
    const r = await run(() => api<Preview>(base, { body: { ...body("preview"), includeInternalIds: internal } }));
    if (r) setPreview(r);
  };

  const runLocal = async () => {
    if (!(await ensureSaved())) return;
    const r = await run(() => api<Post>(base, { body: body("run") }), task === "angles" ? "切り口を追加しました" : "新しい版として下書きを追加しました");
    if (r) onDone(r);
  };

  const label = task === "angles" ? "切り口を提案" : "下書きを作成";
  const internalEntries = data.entries.filter((e) => e.visibility === "internal" && e.status !== "deprecated");

  return (
    <div className="rounded-md border border-line bg-surface2/50 p-3" data-testid={`generate-${task}`}>
      <div className="flex flex-wrap items-end gap-2">
        <Field label="生成の方法" htmlFor={`gen-provider-${task}`} className="min-w-56 flex-1">
          <Select
            id={`gen-provider-${task}`}
            value={provider}
            onChange={(e) => {
              setProvider(e.target.value as ProviderId);
              setPreview(null);
            }}
            options={providers === null ? [{ value: "template", label: "読み込み中…" }] : providers.map((p) => ({ value: p.id, label: `${p.label}${p.available ? "" : "（使えません）"}` }))}
          />
        </Field>
        {provider === "template" || provider === "mock" ? (
          <Button variant="primary" onClick={runLocal} disabled={busy}>
            {label}
          </Button>
        ) : provider === "relay" ? (
          <Button variant="primary" onClick={() => doPreview()} disabled={busy}>
            送る内容を表示してコピー
          </Button>
        ) : (
          <Button variant="primary" onClick={() => doPreview()} disabled={busy || !info?.available}>
            送信内容を確認
          </Button>
        )}
      </div>
      {info && <p className="mt-2 text-[12px] leading-5 text-muted">{info.description}</p>}
      {info && !info.available && <Notice tone="warn">{info.reason}</Notice>}
      {provider !== "template" && provider !== "mock" && (
        <Field label="追加の指示（任意）" htmlFor={`gen-extra-${task}`} className="mt-2">
          <Textarea id={`gen-extra-${task}`} rows={2} value={extra} onChange={(e) => setExtra(e.target.value)} placeholder="例：2 投稿のスレッドにする" />
        </Field>
      )}

      <Modal
        open={!!preview}
        onClose={() => {
          // 送信中は閉じない（閉じて編集を続けると結果の取り込みと競合するため）
          if (busy) return;
          setPreview(null);
          // 「今回だけ送る」の選択は次回に持ち越さない
          setIncludeInternal([]);
        }}
        wide
        title={provider === "relay" ? "手動中継：送る内容" : "送信内容の確認"}
        footer={
          preview && provider === "anthropic" ? (
            <>
              <Button disabled={busy} onClick={() => { setPreview(null); setIncludeInternal([]); }}>やめる</Button>
              <Button
                variant="primary"
                disabled={busy || !preview.allowExternal}
                onClick={async () => {
                  const r = await run(() => api<Post>(base, { body: body("run", { confirmHash: preview.prompt.hash }) }), "生成結果を追加しました");
                  if (r) {
                    setPreview(null);
                    setIncludeInternal([]);
                    onDone(r);
                    await reload();
                  }
                }}
              >
                この内容で送信（課金されます）
              </Button>
            </>
          ) : preview ? (
            <>
              <Button onClick={() => { setPreview(null); setIncludeInternal([]); }}>閉じる</Button>
              <Button
                variant="primary"
                disabled={busy || !pasted.trim()}
                onClick={async () => {
                  const r = await run(() => api<Post>(base, { body: body("import", { raw: pasted }) }), "貼り戻した結果を追加しました");
                  if (r) {
                    setPasted("");
                    setPreview(null);
                    setIncludeInternal([]);
                    onDone(r);
                    await reload();
                  }
                }}
              >
                貼り戻した結果を取り込む
              </Button>
            </>
          ) : null
        }
      >
        {preview && (
          <div className="flex flex-col gap-3">
            {provider === "anthropic" && (
              <>
                {!preview.allowExternal && (
                  <Notice tone="danger" title="このプロジェクトは外部モデルへの送信が許可されていません">
                    プロジェクト設定の「外部モデルへの送信を許可」を有効にするまで送信できません。
                  </Notice>
                )}
                {preview.estimate && (
                  <Notice tone="info" title="費用の概算（参考値）">
                    モデル：{preview.estimate.model} / 入力 約 {preview.estimate.inputTokens.toLocaleString()} トークン / 出力（思考を含む）典型 {preview.estimate.outputTokensTypical.toLocaleString()}・最大{" "}
                    {preview.estimate.outputTokensMax.toLocaleString()} トークン
                    <br />
                    {preview.estimate.known ? (
                      <>
                        概算 <b>約 ${preview.estimate.usdTypical.toFixed(3)}</b>（最大 ${preview.estimate.usdMax.toFixed(3)}）。トークン数は文字数からの推定で ±50% ずれることがあります。実際の請求は Anthropic のコンソールで確認してください。
                      </>
                    ) : (
                      "このモデルの料金表がないため金額を計算できません。"
                    )}
                  </Notice>
                )}
                <Notice tone="info" title="フォールバックについて">
                  モデルが安全上の理由で応答を断った場合、Anthropic 側で別のモデル（例：Claude Opus 5、入力 $5 / 出力 $25 per 100 万トークン）に自動で切り替えて再実行することがあります。その場合は切り替え先の料金になり、上の概算より高くなることがあります。切り替えが起きたかは送信記録に残ります。
                </Notice>
                <Notice tone="warn" title="保存方針">
                  送信した内容は Anthropic のデータ保持方針に従って保存される場合があります。このツールは送信記録（日時・送った項目 ID・使用量）をこのコンピューターに保存し、プロジェクト設定の「送信記録」で確認できます。API キーはサーバー側だけで使い、画面には出しません。
                </Notice>
              </>
            )}
            {provider === "relay" && (
              <Notice tone="info">
                下の内容をコピーして、自分で選んだチャット（Claude.ai など）に貼り付けてください。このツールは何も送信しません。貼り付け先での保存・学習の扱いは、そのサービスの設定に従います。返ってきた JSON を下の欄に貼り戻すと、新しい{task === "angles" ? "切り口" : "版"}として追加されます。
              </Notice>
            )}

            <div className="grid gap-3 md:grid-cols-2">
              <div>
                <h3 className="text-sm font-semibold">送る設定（{preview.prompt.included.length} 件）</h3>
                <ul className="mt-1 max-h-48 overflow-y-auto text-[13px]" data-testid="included-list">
                  {preview.prompt.included.map((i) => (
                    <li key={i.id} className="border-b border-line py-0.5">
                      <Badge>{i.kind}</Badge> {i.internal && <Badge tone="danger">未公開・今回送る</Badge>} {i.title} <span className="text-muted">（{i.status}）</span>
                    </li>
                  ))}
                </ul>
              </div>
              <div>
                <h3 className="text-sm font-semibold">送らない設定（{preview.prompt.excluded.length} 件）</h3>
                <ul className="mt-1 max-h-48 overflow-y-auto text-[13px]" data-testid="excluded-list">
                  {preview.prompt.excluded.map((i) => (
                    <li key={i.id} className="border-b border-line py-0.5">
                      {i.title} <span className="text-muted">— {i.reason}</span>
                    </li>
                  ))}
                </ul>
              </div>
            </div>

            {preview.prompt.redactions.length > 0 && (
              <Notice tone="info" title="未公開の名前を伏せ字にしました" >
                {preview.prompt.redactions.map((r) => `${r.where} ${r.count} 箇所`).join("、")}。名前を出さずに未公開の内容を書いた文は判別できないので、全文を確認してください。
              </Notice>
            )}
            {internalEntries.length > 0 && (
              <details className="rounded-md border border-line p-2 text-sm">
                <summary className="cursor-pointer font-semibold">未公開の項目を今回だけ送る（既定は送らない）</summary>
                <div className="mt-2 flex flex-col gap-1">
                  {internalEntries.map((e) => (
                    <Checkbox
                      key={e.id}
                      label={`${e.title}（未公開）`}
                      checked={includeInternal.includes(e.id)}
                      onChange={(v) => {
                        const next = v ? [...includeInternal, e.id] : includeInternal.filter((x) => x !== e.id);
                        setIncludeInternal(next);
                        void doPreview(next);
                      }}
                    />
                  ))}
                </div>
              </details>
            )}

            <div>
              <div className="flex flex-wrap items-center gap-2">
                <h3 className="text-sm font-semibold">送る文章（{preview.prompt.chars.toLocaleString()} 文字）</h3>
                <Button size="sm" variant="ghost" onClick={() => setShowPrompt((v) => !v)}>
                  {showPrompt ? "隠す" : "全文を表示"}
                </Button>
                {preview.relayText && <CopyButton text={preview.relayText} label="全文をコピー" variant="primary" />}
              </div>
              {showPrompt && <pre className="mt-1 max-h-72 overflow-auto rounded-md border border-line bg-surface2 p-2 text-[12px] whitespace-pre-wrap">{preview.relayText ?? `${preview.prompt.system}\n\n---\n\n${preview.prompt.user}`}</pre>}
            </div>

            {provider === "relay" && (
              <Field label="返ってきた結果を貼り付け" htmlFor="relay-paste" hint="JSON 部分だけでも、説明文ごとでも読み取ります。">
                <Textarea id="relay-paste" rows={6} value={pasted} onChange={(e) => setPasted(e.target.value)} />
              </Field>
            )}
          </div>
        )}
      </Modal>
    </div>
  );
}

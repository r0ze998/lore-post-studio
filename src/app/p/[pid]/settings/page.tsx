"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { useProject } from "@/components/project-context";
import { Badge, Button, Card, Checkbox, Field, Input, ListInput, Notice, PageHeader, Select, Textarea, useAsyncAction } from "@/components/ui";
import { DEFAULT_BANNED_PHRASES, DEFAULT_DEVELOPER_MARKERS } from "@/lib/checks/lexicon";
import type { Project, ProjectSettings } from "@/lib/domain/schema";
import { api, fmtDate } from "@/lib/client/api";

export default function SettingsPage() {
  const { data, reload } = useProject();
  const router = useRouter();
  const [name, setName] = useState(data.project.name);
  const [desc, setDesc] = useState(data.project.description);
  const [s, setS] = useState<ProjectSettings>(data.project.settings);
  const { busy, run } = useAsyncAction();
  const set = <K extends keyof ProjectSettings>(k: K, v: ProjectSettings[K]) => setS({ ...s, [k]: v });
  const d = s.defaults;

  const save = async () => {
    const r = await run(() => api<Project>(`/api/projects/${data.project.id}`, { method: "PATCH", body: { name, description: desc, settings: s } }), "保存しました");
    if (r) await reload();
  };

  return (
    <div className="flex flex-col gap-4">
      <PageHeader title="プロジェクト設定" actions={<Button variant="primary" onClick={save} disabled={busy}>保存</Button>} />

      <Card title="基本">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="名前" htmlFor="s-name">
            <Input id="s-name" value={name} onChange={(e) => setName(e.target.value)} />
          </Field>
          <Field label="種類" htmlFor="s-kind" hint="作成後は変更できません（サンプルと実プロジェクトを取り違えないため）。">
            <Input id="s-kind" value={data.project.kind === "sample" ? "サンプル（架空）" : "実プロジェクト"} disabled />
          </Field>
          <Field label="説明" htmlFor="s-desc" className="sm:col-span-2">
            <Textarea id="s-desc" rows={2} value={desc} onChange={(e) => setDesc(e.target.value)} />
          </Field>
        </div>
      </Card>

      <Card title="初見の人に伝えるための情報">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="識別語（ゲーム名・別表記）" htmlFor="s-anchors" hint="投稿にこれが一つもないと「何のゲームか分かる手がかりがない」と知らせます。">
            <ListInput id="s-anchors" value={s.identityAnchors} onChange={(v) => set("identityAnchors", v)} />
          </Field>
          <Field label="一言説明" htmlFor="s-one" hint="例：干上がった海を渡る交易キャラバンの戦略ゲーム">
            <Textarea id="s-one" rows={2} value={s.oneLiner} onChange={(e) => set("oneLiner", e.target.value)} />
          </Field>
          <Field label="公式ドメイン" htmlFor="s-domains" hint="これ以外の URL は検査で知らせます。">
            <ListInput id="s-domains" value={s.officialDomains} onChange={(v) => set("officialDomains", v)} placeholder="example.com" />
          </Field>
        </div>
      </Card>

      <Card title="表現の既定（新しい投稿に適用）">
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="絵文字" htmlFor="s-emoji">
            <Select
              id="s-emoji"
              value={d.emoji}
              onChange={(e) => set("defaults", { ...d, emoji: e.target.value as typeof d.emoji, maxEmoji: e.target.value === "few" ? Math.max(1, d.maxEmoji) : d.maxEmoji })}
              options={[
                { value: "none", label: "使わない" },
                { value: "few", label: "少しだけ" },
                { value: "free", label: "自由" },
              ]}
            />
          </Field>
          <Field label="ハッシュタグの上限" htmlFor="s-maxtag">
            <Input id="s-maxtag" type="number" min={0} max={10} value={d.maxHashtags} onChange={(e) => set("defaults", { ...d, maxHashtags: Number(e.target.value) })} />
          </Field>
          <Field label="既定のハッシュタグ" htmlFor="s-tags">
            <ListInput id="s-tags" value={d.hashtags} onChange={(v) => set("defaults", { ...d, hashtags: v })} />
          </Field>
          <Field label="CTA" htmlFor="s-cta">
            <Select
              id="s-cta"
              value={d.cta}
              onChange={(e) => set("defaults", { ...d, cta: e.target.value as typeof d.cta })}
              options={[
                { value: "none", label: "入れない" },
                { value: "soft", label: "控えめに一言" },
                { value: "explicit", label: "明示する" },
              ]}
            />
          </Field>
        </div>
      </Card>

      <Card title="検査の語句">
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="flex flex-col gap-2">
            <Checkbox label="定番の宣伝文句の既定リストを使う" checked={s.useDefaultBannedPhrases} onChange={(v) => set("useDefaultBannedPhrases", v)} hint={DEFAULT_BANNED_PHRASES.join("、")} />
            <Field label="追加の宣伝文句（逃げ言葉）" htmlFor="s-banned">
              <ListInput id="s-banned" rows={3} value={s.bannedPhrases} onChange={(v) => set("bannedPhrases", v)} />
            </Field>
          </div>
          <div className="flex flex-col gap-2">
            <p className="text-[12px] text-muted">世界内の語りに混ざると知らせる語（既定）：{DEFAULT_DEVELOPER_MARKERS.join("、")}</p>
            <Field label="追加の開発者語" htmlFor="s-dev">
              <ListInput id="s-dev" rows={3} value={s.developerMarkers} onChange={(v) => set("developerMarkers", v)} />
            </Field>
          </div>
          <Field label="重複：要確認にする類似度" htmlFor="s-dw">
            <Input id="s-dw" type="number" step={0.05} min={0.1} max={1} value={s.duplicateWarn} onChange={(e) => set("duplicateWarn", Number(e.target.value))} />
          </Field>
          <Field label="重複：要修正にする類似度" htmlFor="s-de">
            <Input id="s-de" type="number" step={0.05} min={0.1} max={1} value={s.duplicateError} onChange={(e) => set("duplicateError", Number(e.target.value))} />
          </Field>
        </div>
      </Card>

      <Card title="外部モデルへの送信">
        <Checkbox
          label="このプロジェクトの資料を外部モデル（Anthropic API など）へ送ることを許可する"
          checked={s.allowExternalModel}
          onChange={(v) => set("allowExternalModel", v)}
          hint="既定は許可しません。許可しても、送信のたびに送る資料・概算費用・保存方針を確認してから送ります。未公開の項目は既定で送りません。テンプレート生成と手動中継は、この設定に関係なく使えます（このツールからは送信しません）。"
        />
        <h3 className="mt-4 text-sm font-semibold">送信記録</h3>
        {data.sendLog.length === 0 ? (
          <p className="text-sm text-muted">記録はありません。</p>
        ) : (
          <div className="mt-1 overflow-x-auto">
            <table className="w-full min-w-[560px] text-[13px]">
              <thead>
                <tr className="text-left text-muted">
                  <th className="py-1">日時</th>
                  <th>方法</th>
                  <th>内容</th>
                  <th>送った項目</th>
                  <th>使用量・費用</th>
                  <th>結果</th>
                </tr>
              </thead>
              <tbody>
                {data.sendLog.map((l) => (
                  <tr key={l.id} className="border-t border-line align-top">
                    <td className="py-1 pr-2 whitespace-nowrap">{fmtDate(l.at, true)}</td>
                    <td className="pr-2">{l.provider === "relay" ? "手動中継（貼り戻し）" : `${l.provider} / ${l.model}`}</td>
                    <td className="pr-2">{l.task === "angles" ? "切り口" : "下書き"}</td>
                    <td className="pr-2">
                      {l.entryIds.length} 件（除外 {l.excludedEntryIds.length}）
                    </td>
                    <td className="pr-2">
                      {l.usage ? `${l.usage.inputTokens}/${l.usage.outputTokens} tok` : "-"}
                      {l.estimatedCostUsd !== undefined && ` · 約 $${l.estimatedCostUsd.toFixed(3)}`}
                    </td>
                    <td>
                      {l.ok ? <Badge tone="ok">成功</Badge> : <Badge tone="danger" title={l.error}>失敗</Badge>}
                      {l.note && <div className="text-[12px] text-muted">{l.note}</div>}
                      {!l.ok && l.error && <div className="text-[12px] text-danger">{l.error}</div>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Card title="書き出し・削除">
        <div className="flex flex-col gap-3">
          <Notice tone="info">プロジェクト一式（正本・素材・投稿・学び・送信記録）を zip で書き出します。バックアップや別のコンピューターへの移動に使えます。</Notice>
          <div className="flex flex-wrap gap-2">
            <a className="inline-flex h-10 items-center rounded-md border border-line bg-surface px-4 text-sm font-medium hover:bg-surface2" href={`/api/projects/${data.project.id}/export`} download data-testid="export-project">
              プロジェクトを zip で書き出す
            </a>
            <Button
              variant="danger"
              disabled={busy}
              onClick={async () => {
                if (prompt(`削除するにはプロジェクト名「${data.project.name}」を入力してください。データは data/trash に移動します。`) !== data.project.name) return;
                const r = await run(() => api(`/api/projects/${data.project.id}`, { method: "DELETE" }), "削除しました");
                if (r) router.push("/");
              }}
            >
              プロジェクトを削除
            </Button>
          </div>
        </div>
      </Card>
      <div>
        <Button variant="primary" onClick={save} disabled={busy}>
          保存
        </Button>
      </div>
    </div>
  );
}

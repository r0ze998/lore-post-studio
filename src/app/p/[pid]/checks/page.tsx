"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { useProject } from "@/components/project-context";
import { Badge, Card, Field, PageHeader, Select, Textarea } from "@/components/ui";
import { FindingsList, LimitsNote, ProvenanceMap } from "@/components/editor/steps";
import { currentDraft, runChecks } from "@/lib/checks/engine";
import { RULES, RULE_IDS } from "@/lib/checks/catalog";
import { POST_STATUS_LABEL, POST_TYPE_LABEL } from "@/lib/domain/labels";
import { Post, type DraftVersion, type PostType } from "@/lib/domain/schema";

export default function ChecksPage() {
  const { data, base, checkCtx } = useProject();
  const [text, setText] = useState("");
  const [voice, setVoice] = useState<"in_world" | "developer">("developer");
  const [type, setType] = useState<PostType>("devlog");
  const [lang, setLang] = useState<"ja" | "en">("ja");

  const rows = useMemo(
    () =>
      data.posts
        .filter((p) => ["drafting", "review", "approved"].includes(p.status))
        .map((p) => {
          const d = currentDraft(p);
          return { p, r: d ? runChecks(checkCtx, p, d) : undefined };
        })
        .sort((a, b) => (b.r?.counts.error ?? 0) - (a.r?.counts.error ?? 0)),
    [data.posts, checkCtx],
  );

  const adhoc = useMemo(() => {
    if (!text.trim()) return null;
    const draft: DraftVersion = { id: "adhoc", createdAt: "", origin: "manual", generator: "", language: lang, creativeNotes: "", segments: text.split(/\n-{3,}\n/).map((t, i) => ({ id: `adhoc${i}`, text: t, voice, jaGloss: "", assetIds: [], provenance: [] })) };
    const post = Post.parse({ id: "adhoc", projectId: data.project.id, type, title: "試し検査", status: "drafting", options: data.project.settings.defaults, brief: { language: lang }, drafts: [draft], currentDraftId: "adhoc", createdAt: "", updatedAt: "" });
    return { draft, report: runChecks(checkCtx, post, draft) };
  }, [text, voice, type, lang, data.project, checkCtx]);

  return (
    <div className="flex flex-col gap-4">
      <PageHeader title="整合性チェック" description="下書きを正本・事実・過去投稿と照合します。指摘には理由と参照箇所が付きます。万能ではありません。" />

      <Card title="作業中の下書き">
        {rows.length === 0 ? (
          <p className="text-sm text-muted">下書き・確認待ち・承認済みの投稿はありません。</p>
        ) : (
          <ul className="divide-y divide-line">
            {rows.map(({ p, r }) => (
              <li key={p.id} className="flex flex-wrap items-center gap-2 py-2">
                <Link href={`${base}/posts/${p.id}`} className="min-w-0 flex-1 truncate font-medium underline-offset-2 hover:underline">
                  {p.title}
                </Link>
                <Badge>{POST_TYPE_LABEL[p.type]}</Badge>
                <Badge>{POST_STATUS_LABEL[p.status]}</Badge>
                {r && (
                  <>
                    <Badge tone={r.counts.error ? "danger" : "ok"}>要修正 {r.counts.error}</Badge>
                    <Badge tone={r.counts.warning ? "warn" : "neutral"}>要確認 {r.counts.warning}</Badge>
                  </>
                )}
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card title="文章を貼って試す（保存されません）">
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="語り" htmlFor="ad-voice">
            <Select
              id="ad-voice"
              value={voice}
              onChange={(e) => setVoice(e.target.value as "in_world" | "developer")}
              options={[
                { value: "developer", label: "開発者の語り" },
                { value: "in_world", label: "世界内の語り" },
              ]}
            />
          </Field>
          <Field label="種類" htmlFor="ad-type">
            <Select id="ad-type" value={type} onChange={(e) => setType(e.target.value as PostType)} options={(Object.keys(POST_TYPE_LABEL) as PostType[]).map((t) => ({ value: t, label: POST_TYPE_LABEL[t] }))} />
          </Field>
          <Field label="言語" htmlFor="ad-lang">
            <Select
              id="ad-lang"
              value={lang}
              onChange={(e) => setLang(e.target.value as "ja" | "en")}
              options={[
                { value: "ja", label: "日本語" },
                { value: "en", label: "英語" },
              ]}
            />
          </Field>
        </div>
        <Field label="本文" htmlFor="ad-text" hint="「---」だけの行で区切るとスレッドとして検査します。" className="mt-3">
          <Textarea id="ad-text" rows={5} value={text} onChange={(e) => setText(e.target.value)} />
        </Field>
        {adhoc && (
          <div className="mt-3 flex flex-col gap-3" data-testid="adhoc-result">
            <FindingsList report={adhoc.report} />
            <details>
              <summary className="cursor-pointer text-sm font-semibold">根拠マップ</summary>
              <div className="mt-2">
                <ProvenanceMap provenance={adhoc.report.provenance} draft={adhoc.draft} />
              </div>
            </details>
          </div>
        )}
      </Card>

      <LimitsNote />

      <Card title="検査ルールと、見逃し得る範囲">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] text-[13px]">
            <thead>
              <tr className="text-left text-muted">
                <th className="py-1 pr-2">分類</th>
                <th className="pr-2">ルール</th>
                <th className="pr-2">見ていること</th>
                <th>見逃し得る範囲</th>
              </tr>
            </thead>
            <tbody>
              {RULE_IDS.map((id) => {
                const r = RULES[id];
                return (
                  <tr key={id} className="border-t border-line align-top">
                    <td className="py-1.5 pr-2 whitespace-nowrap">{r.group}</td>
                    <td className="pr-2 font-medium whitespace-nowrap">{r.name}</td>
                    <td className="pr-2">{r.what}</td>
                    <td className="text-muted">{r.limits}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}

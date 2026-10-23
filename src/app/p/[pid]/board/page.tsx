"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { useProject } from "@/components/project-context";
import { Badge, Button, Field, Input, Modal, PageHeader, Select, Tabs, Textarea, useAsyncAction } from "@/components/ui";
import { BOARD_COLUMNS, POST_STATUS_LABEL, POST_TYPE_LABEL } from "@/lib/domain/labels";
import type { Post, PostStatus, PostType } from "@/lib/domain/schema";
import { api, fmtDate } from "@/lib/client/api";
import { currentDraft, runChecks } from "@/lib/checks/engine";

const DEFAULT_VOICE: Record<PostType, Post["brief"]["voice"]> = {
  story: "in_world",
  series: "in_world",
  showcase: "mixed",
  gameplay: "developer",
  devlog: "developer",
  recruit: "developer",
};

export default function Board() {
  const { data, base, checkCtx } = useProject();
  const [col, setCol] = useState<PostStatus>("drafting");
  const [creating, setCreating] = useState(false);

  const byStatus = useMemo(() => {
    const m = new Map<PostStatus, Post[]>();
    for (const s of BOARD_COLUMNS) m.set(s, []);
    for (const p of data.posts) m.get(p.status)?.push(p);
    for (const xs of m.values()) xs.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    return m;
  }, [data.posts]);

  const counts = useMemo(() => {
    const out = new Map<string, { error: number; warning: number }>();
    for (const p of data.posts) {
      if (!["drafting", "review", "approved"].includes(p.status)) continue;
      const d = currentDraft(p);
      if (!d) continue;
      const r = runChecks(checkCtx, p, d);
      out.set(p.id, { error: r.counts.error, warning: r.counts.warning });
    }
    return out;
  }, [data.posts, checkCtx]);

  const card = (p: Post) => {
    const c = counts.get(p.id);
    const d = currentDraft(p);
    return (
      <Link key={p.id} href={`${base}/posts/${p.id}`} data-testid="board-card" className="block rounded-md border border-line bg-surface p-3 hover:border-accent">
        <div className="flex flex-wrap items-center gap-1">
          <Badge>{POST_TYPE_LABEL[p.type]}</Badge>
          {p.brief.language === "en" && <Badge tone="info">EN</Badge>}
          {d && d.segments.length > 1 && <Badge>スレッド {d.segments.length}</Badge>}
        </div>
        <div className="mt-1 font-medium leading-snug">{p.title}</div>
        {d && <p className="mt-1 line-clamp-2 text-[13px] text-muted">{d.segments[0]?.text || "（本文なし）"}</p>}
        <div className="mt-2 flex flex-wrap items-center gap-1 text-[12px] text-muted">
          {c && c.error > 0 && <Badge tone="danger">要修正 {c.error}</Badge>}
          {c && c.warning > 0 && <Badge tone="warn">要確認 {c.warning}</Badge>}
          {p.scheduleCandidate && <Badge tone="info">候補 {p.scheduleCandidate.slice(0, 10)}</Badge>}
          <span className="ml-auto">{fmtDate(p.updatedAt)}</span>
        </div>
      </Link>
    );
  };

  return (
    <div>
      <PageHeader title="企画ボード" description="投稿を企画から投稿記録まで管理します。" actions={<Button variant="primary" onClick={() => setCreating(true)}>新しい投稿を企画</Button>} />

      {/* スマホ：列をタブで切り替え */}
      <div className="lg:hidden">
        <Tabs<PostStatus> value={col} onChange={setCol} items={BOARD_COLUMNS.map((s) => ({ value: s, label: `${POST_STATUS_LABEL[s].replace("（手動記録）", "")} ${byStatus.get(s)?.length ?? 0}` }))} className="mb-3" />
        <div className="flex flex-col gap-2">{byStatus.get(col)?.map(card)}</div>
        {!byStatus.get(col)?.length && <p className="py-6 text-center text-sm text-muted">この列には投稿がありません。</p>}
      </div>

      {/* PC：横に並べる */}
      <div className="hidden gap-3 lg:grid lg:grid-cols-6">
        {BOARD_COLUMNS.map((s) => (
          <section key={s} className="flex min-w-0 flex-col gap-2 rounded-lg bg-surface2/60 p-2">
            <h2 className="px-1 text-[13px] font-semibold">
              {POST_STATUS_LABEL[s]} <span className="text-muted">{byStatus.get(s)?.length}</span>
            </h2>
            {byStatus.get(s)?.map(card)}
          </section>
        ))}
      </div>

      <CreatePost open={creating} onClose={() => setCreating(false)} />
    </div>
  );
}

function CreatePost({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { data, base, replacePost } = useProject();
  const router = useRouter();
  const [type, setType] = useState<PostType>("story");
  const [title, setTitle] = useState("");
  const [purpose, setPurpose] = useState("");
  const [audience, setAudience] = useState("");
  const [language, setLanguage] = useState<"ja" | "en">("ja");
  const { busy, run } = useAsyncAction();
  const defaults = data.project.settings.defaults;

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="新しい投稿を企画"
      footer={
        <>
          <Button onClick={onClose}>キャンセル</Button>
          <Button
            variant="primary"
            disabled={busy || !title.trim()}
            onClick={async () => {
              const post = await run(() =>
                api<Post>(`/api/projects/${data.project.id}/posts`, {
                  body: {
                    type,
                    title,
                    brief: { purpose, audience, language, voice: DEFAULT_VOICE[type] },
                    options: { ...defaults, cta: type === "recruit" ? "explicit" : defaults.cta },
                  },
                }),
              );
              if (post) {
                replacePost(post);
                onClose();
                router.push(`${base}/posts/${post.id}`);
              }
            }}
          >
            作成して編集へ
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <Field label="投稿の種類" htmlFor="cp-type">
          <Select id="cp-type" value={type} onChange={(e) => setType(e.target.value as PostType)} options={(Object.keys(POST_TYPE_LABEL) as PostType[]).map((t) => ({ value: t, label: POST_TYPE_LABEL[t] }))} />
        </Field>
        <Field label="管理用の見出し" htmlFor="cp-title" hint="X には出ません。">
          <Input id="cp-title" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={200} />
        </Field>
        <Field label="投稿の目的" htmlFor="cp-purpose">
          <Textarea id="cp-purpose" rows={2} value={purpose} onChange={(e) => setPurpose(e.target.value)} placeholder="例：第2回テストの参加者を集める" />
        </Field>
        <Field label="対象読者" htmlFor="cp-aud">
          <Input id="cp-aud" value={audience} onChange={(e) => setAudience(e.target.value)} placeholder="例：戦略ゲーム好きで、まだゲームを知らない人" />
        </Field>
        <Field label="言語" htmlFor="cp-lang" hint="英語の場合は、各投稿に日本語の意味確認を添えます。">
          <Select
            id="cp-lang"
            value={language}
            onChange={(e) => setLanguage(e.target.value as "ja" | "en")}
            options={[
              { value: "ja", label: "日本語" },
              { value: "en", label: "英語（日本語の意味確認つき）" },
            ]}
          />
        </Field>
      </div>
    </Modal>
  );
}

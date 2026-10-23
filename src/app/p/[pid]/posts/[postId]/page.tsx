"use client";

import { use, useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useProject } from "@/components/project-context";
import { Badge, Button, Tabs, cx, useAsyncAction, useToast } from "@/components/ui";
import { XPreview } from "@/components/editor/preview";
import { AnglesStep, ApproveStep, BriefStep, CheckStep, DraftStep, ExportStep, RecordStep, type StepId, type StepProps } from "@/components/editor/steps";
import { currentDraft, runChecks } from "@/lib/checks/engine";
import { POST_STATUS_LABEL, POST_TYPE_LABEL } from "@/lib/domain/labels";
import type { Post } from "@/lib/domain/schema";
import { api, ApiError } from "@/lib/client/api";

const STEPS: { id: StepId; label: string }[] = [
  { id: "brief", label: "1 企画" },
  { id: "angles", label: "2 切り口" },
  { id: "draft", label: "3 下書き" },
  { id: "check", label: "4 検査" },
  { id: "approve", label: "5 承認" },
  { id: "export", label: "6 書き出し" },
  { id: "record", label: "7 記録" },
];

export default function PostEditorPage({ params }: { params: Promise<{ postId: string }> }) {
  const { postId } = use(params);
  const { data } = useProject();
  const server = data.posts.find((p) => p.id === postId);
  if (!server) {
    return (
      <p className="p-6 text-center text-muted">
        投稿が見つかりません。<Link href="/" className="underline">一覧へ</Link>
      </p>
    );
  }
  return <Editor key={postId} server={server} />;
}

function Editor({ server }: { server: Post }) {
  const { data, base, replacePost, checkCtx, reload } = useProject();
  const router = useRouter();
  const toast = useToast();
  const [post, setPost] = useState<Post>(server);
  const [step, setStep] = useState<StepId>(server.drafts.length ? (server.status === "approved" ? "export" : server.status === "posted" ? "record" : "draft") : "brief");
  const [showPreview, setShowPreview] = useState(false);
  const { busy, run } = useAsyncAction();
  const serverRef = useRef(server);

  const dirty = useMemo(() => JSON.stringify(post) !== JSON.stringify(server), [post, server]);

  // サーバー側の更新（生成・承認など）を、未編集なら取り込む
  useEffect(() => {
    if (serverRef.current.updatedAt !== server.updatedAt) {
      serverRef.current = server;
      setPost(server);
    }
  }, [server]);

  useEffect(() => {
    if (!dirty) return;
    const h = (e: BeforeUnloadEvent) => {
      e.preventDefault();
    };
    window.addEventListener("beforeunload", h);
    return () => window.removeEventListener("beforeunload", h);
  }, [dirty]);

  const draft = currentDraft(post);
  const report = useMemo(() => (draft ? runChecks(checkCtx, post, draft) : undefined), [checkCtx, post, draft]);

  const save = useCallback(async (): Promise<boolean> => {
    if (!dirty) return true;
    try {
      const r = await api<Post>(`/api/projects/${data.project.id}/posts/${post.id}`, { method: "PATCH", body: { post, expectedUpdatedAt: server.updatedAt } });
      serverRef.current = r;
      replacePost(r);
      setPost(r);
      toast(r.status === "review" && server.status === "approved" ? "保存しました（本文が変わったため確認待ちに戻りました）" : "保存しました", "ok");
      return true;
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), "danger");
      if (e instanceof ApiError && e.status === 409) await reload();
      return false;
    }
  }, [dirty, data.project.id, post, server.updatedAt, server.status, replacePost, toast, reload]);

  // Ctrl/Cmd + S で保存
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "s") {
        e.preventDefault();
        void save();
      }
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [save]);

  const onServerPost = useCallback(
    (p: Post) => {
      serverRef.current = p;
      replacePost(p);
      setPost(p);
    },
    [replacePost],
  );

  const props: StepProps = { post, setPost, draft, report, dirty, save, onServerPost, goto: setStep };

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <Link href={`${base}/board`} className="text-sm text-muted hover:text-ink">
          ← 企画ボード
        </Link>
        <h1 className="min-w-0 flex-1 truncate text-lg font-bold" data-testid="post-title">
          {post.title}
        </h1>
        <Badge>{POST_TYPE_LABEL[post.type]}</Badge>
        <Badge tone={post.status === "approved" ? "ok" : post.status === "review" ? "warn" : post.status === "rejected" ? "danger" : post.status === "posted" ? "accent" : "neutral"} >
          <span data-testid="post-status">{POST_STATUS_LABEL[post.status]}</span>
        </Badge>
        {report && (
          <span className="flex gap-1">
            {report.counts.error > 0 && <Badge tone="danger">要修正 {report.counts.error}</Badge>}
            {report.counts.warning > 0 && <Badge tone="warn">要確認 {report.counts.warning}</Badge>}
          </span>
        )}
      </div>

      <div className="sticky top-[84px] z-20 -mx-3 mb-3 flex items-center gap-2 border-b border-line bg-bg/95 px-3 py-2 backdrop-blur sm:-mx-6 sm:px-6 lg:top-0">
        <Tabs<StepId> value={step} onChange={setStep} items={STEPS.map((s) => ({ value: s.id, label: s.label }))} className="flex-1 border-b-0" />
        <Button size="sm" variant={dirty ? "primary" : "secondary"} disabled={!dirty || busy} onClick={() => run(save)} data-testid="save-post">
          {dirty ? "保存" : "保存済み"}
        </Button>
      </div>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_380px]">
        <div className="min-w-0">
          {step === "brief" && <BriefStep {...props} />}
          {step === "angles" && <AnglesStep {...props} />}
          {step === "draft" && <DraftStep {...props} />}
          {step === "check" && <CheckStep {...props} />}
          {step === "approve" && <ApproveStep {...props} />}
          {step === "export" && <ExportStep {...props} />}
          {step === "record" && <RecordStep {...props} />}

          <div className="mt-8 flex flex-wrap gap-2 border-t border-line pt-4">
            {post.status !== "archived" && post.status !== "posted" && (
              <Button
                size="sm"
                variant="ghost"
                onClick={async () => {
                  const r = await run(() => api<Post>(`/api/projects/${data.project.id}/posts/${post.id}`, { method: "PATCH", body: { post: { status: "archived" } } }), "保管しました");
                  if (r) onServerPost(r);
                }}
              >
                保管（ボードから外す）
              </Button>
            )}
            <Button
              size="sm"
              variant="danger"
              onClick={async () => {
                if (!confirm("この投稿を削除します。元に戻せません。")) return;
                const r = await run(() => api(`/api/projects/${data.project.id}/posts/${post.id}`, { method: "DELETE" }), "削除しました");
                if (r) {
                  await reload();
                  router.push(`${base}/board`);
                }
              }}
            >
              投稿を削除
            </Button>
          </div>
        </div>

        {/* プレビュー：PC は右に固定、スマホは折りたたみ */}
        <aside className="min-w-0">
          <div className="lg:sticky lg:top-16">
            <button type="button" className="mb-2 w-full rounded-md border border-line bg-surface px-3 py-2 text-left text-sm font-semibold lg:hidden" onClick={() => setShowPreview((v) => !v)} aria-expanded={showPreview}>
              {showPreview ? "▼" : "▶"} プレビュー
            </button>
            <div className={cx(showPreview ? "block" : "hidden", "lg:block")}>
              {draft ? <XPreview project={data.project} draft={draft} assets={data.assets} /> : <p className="text-sm text-muted">下書きを作るとプレビューが表示されます。</p>}
            </div>
          </div>
        </aside>
      </div>
    </div>
  );
}

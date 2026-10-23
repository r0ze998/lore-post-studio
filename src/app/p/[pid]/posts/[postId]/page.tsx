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

/** サーバーの結果（生成・承認など）を、手元の未保存の編集を残したまま取り込む。 */
function mergeServer(local: Post, base: Post, incoming: Post): Post {
  const localEdited = JSON.stringify(local) !== JSON.stringify(base);
  if (!localEdited) return incoming;
  const newAngles = incoming.angles.filter((a) => !local.angles.some((x) => x.id === a.id));
  const newDrafts = incoming.drafts.filter((d) => !local.drafts.some((x) => x.id === d.id));
  return {
    ...local,
    angles: [...local.angles, ...newAngles],
    drafts: [...local.drafts, ...newDrafts],
    currentDraftId: newDrafts.length ? incoming.currentDraftId : local.currentDraftId,
    status: incoming.status,
    decisions: incoming.decisions,
    publication: incoming.publication,
    updatedAt: incoming.updatedAt,
  };
}

function Editor({ server }: { server: Post }) {
  const { data, base, replacePost, checkCtx, reload } = useProject();
  const router = useRouter();
  const toast = useToast();
  const [post, setPost] = useState<Post>(server);
  // 手元の編集の元になったサーバー版
  const [basePost, setBasePost] = useState<Post>(server);
  const [conflict, setConflict] = useState(false);
  const [step, setStep] = useState<StepId>(server.drafts.length ? (server.status === "approved" ? "export" : server.status === "posted" ? "record" : "draft") : "brief");
  const [showPreview, setShowPreview] = useState(false);
  const { busy, run } = useAsyncAction();
  const postRef = useRef(post);
  postRef.current = post;

  const dirty = useMemo(() => JSON.stringify(post) !== JSON.stringify(basePost), [post, basePost]);

  // 別の画面などでサーバー側が更新された：未編集なら取り込み、編集中なら上書きせず知らせる
  useEffect(() => {
    if (server.updatedAt === basePost.updatedAt) return;
    if (JSON.stringify(postRef.current) === JSON.stringify(basePost)) {
      setPost(server);
      setBasePost(server);
      setConflict(false);
    } else {
      setConflict(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
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

  const save = useCallback(
    async (overwrite = false): Promise<boolean> => {
      if (!dirty) return true;
      const snapshot = post;
      try {
        const expected = overwrite ? server.updatedAt : basePost.updatedAt;
        const r = await api<Post>(`/api/projects/${data.project.id}/posts/${post.id}`, { method: "PATCH", body: { post: snapshot, expectedUpdatedAt: expected } });
        setBasePost(r);
        replacePost(r);
        // 保存中に入力された内容は残す
        setPost((cur) => (cur === snapshot ? r : { ...cur, updatedAt: r.updatedAt, status: r.status }));
        setConflict(false);
        toast(r.status === "review" && basePost.status === "approved" ? "保存しました（本文が変わったため確認待ちに戻りました）" : "保存しました", "ok");
        return true;
      } catch (e) {
        if (e instanceof ApiError && e.status === 409) {
          setConflict(true);
          await reload();
          toast("別の画面でこの投稿が更新されています。下の案内から選んでください（手元の編集は残っています）。", "danger");
        } else {
          toast(e instanceof Error ? e.message : String(e), "danger");
        }
        return false;
      }
    },
    [dirty, data.project.id, post, basePost, server.updatedAt, replacePost, toast, reload],
  );

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
      replacePost(p);
      setPost((cur) => mergeServer(cur, basePost, p));
      setBasePost(p);
    },
    [replacePost, basePost],
  );

  const props: StepProps = { post, setPost, draft, report, dirty, save: () => save(), onServerPost, goto: setStep };

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
        <Button size="sm" variant={dirty ? "primary" : "secondary"} disabled={!dirty || busy || conflict} onClick={() => run(() => save())} data-testid="save-post">
          {dirty ? "保存" : "保存済み"}
        </Button>
      </div>

      {conflict && (
        <div className="mb-3 rounded-md border border-warn/40 bg-warn-soft px-3 py-2 text-sm" role="alert" data-testid="conflict-banner">
          <div className="font-semibold">別の画面（または別の端末）でこの投稿が更新されました。</div>
          <p>手元の未保存の編集は残っています。どちらを残すか選んでください。</p>
          <div className="mt-2 flex flex-wrap gap-2">
            <Button size="sm" onClick={() => run(() => save(true))}>
              手元の編集で上書き保存
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                if (!confirm("手元の未保存の編集を捨てて、サーバーの内容を読み込みます。")) return;
                setPost(server);
                setBasePost(server);
                setConflict(false);
              }}
            >
              サーバーの内容を読み込む（手元の編集を捨てる）
            </Button>
          </div>
        </div>
      )}

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
        <aside className="order-first min-w-0 lg:order-none">
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

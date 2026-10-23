"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import type { Project } from "@/lib/domain/schema";
import { api, fmtDate } from "@/lib/client/api";
import { getServerInfo, uploadToSignedUrl } from "@/lib/client/server-info";
import { Badge, Button, Card, Field, Input, Notice, PageHeader, Select, Textarea, useAsyncAction } from "@/components/ui";

export default function Home() {
  const [projects, setProjects] = useState<Project[] | null>(null);
  const [broken, setBroken] = useState<{ id: string; error: string }[]>([]);
  const [loadError, setLoadError] = useState("");
  const [name, setName] = useState("");
  const [kind, setKind] = useState<"real" | "sample">("real");
  const [desc, setDesc] = useState("");
  const [mode, setMode] = useState<"new" | "replace">("new");
  const fileRef = useRef<HTMLInputElement>(null);
  const { busy, run } = useAsyncAction();

  const load = async () => {
    const r = await api<{ projects: Project[]; broken: { id: string; error: string }[] }>("/api/projects");
    setProjects(r.projects);
    setBroken(r.broken ?? []);
  };
  useEffect(() => {
    load().catch((e) => setLoadError(e instanceof Error ? e.message : String(e)));
  }, []);

  return (
    <main className="mx-auto max-w-5xl px-4 py-6 sm:py-10">
      <PageHeader
        title="Lore Post Studio"
        description="ゲームの世界観を守りながら X 投稿を企画・下書き・確認する、自分専用の制作環境です。X には接続せず、データはこのコンピューターに保存されます。"
        actions={
          <Link href="/settings" className="text-sm text-accent underline">
            生成の接続と費用
          </Link>
        }
      />

      {loadError && (
        <div className="mb-3">
          <Notice tone="danger" title="データを読み込めませんでした">
            {loadError}
          </Notice>
        </div>
      )}
      {broken.length > 0 && (
        <div className="mb-3">
          <Notice tone="danger" title="読み込めないプロジェクトがあります">
            {broken.map((b) => `${b.id}: ${b.error}`).join(" / ")}。data フォルダのファイルを確認するか、書き出した zip から取り込み直してください。
          </Notice>
        </div>
      )}
      <div className="grid gap-3 sm:grid-cols-2">
        {projects === null && !loadError && <p className="text-muted">読み込み中…</p>}
        {projects?.map((p) => (
          <Link
            key={p.id}
            href={`/p/${p.id}`}
            data-testid={`project-${p.id}`}
            className={`block rounded-lg border bg-surface p-4 transition-colors hover:border-accent ${p.kind === "sample" ? "border-sample/50" : "border-line"}`}
          >
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-lg font-semibold">{p.name}</h2>
              {p.kind === "sample" ? <Badge tone="sample">架空のサンプル</Badge> : <Badge tone="accent">実プロジェクト</Badge>}
            </div>
            {p.description && <p className="mt-1 line-clamp-3 text-sm text-muted">{p.description}</p>}
            <p className="mt-2 text-[12px] text-muted">更新 {fmtDate(p.updatedAt, true)}</p>
          </Link>
        ))}
      </div>

      <div className="mt-8 grid gap-4 lg:grid-cols-2">
        <Card title="新しいプロジェクト">
          <form
            className="flex flex-col gap-3"
            onSubmit={async (e) => {
              e.preventDefault();
              const p = await run(() => api<Project>("/api/projects", { body: { name, kind, description: desc } }), "作成しました");
              if (p) {
                setName("");
                setDesc("");
                await load();
              }
            }}
          >
            <Field label="名前" htmlFor="np-name">
              <Input id="np-name" value={name} onChange={(e) => setName(e.target.value)} required maxLength={120} />
            </Field>
            <Field label="種類" htmlFor="np-kind" hint="サンプル（架空）は検証用です。実在のゲームの設定と区別して表示されます。">
              <Select
                id="np-kind"
                value={kind}
                onChange={(e) => setKind(e.target.value as "real" | "sample")}
                options={[
                  { value: "real", label: "実プロジェクト" },
                  { value: "sample", label: "サンプル（架空）" },
                ]}
              />
            </Field>
            <Field label="説明" htmlFor="np-desc">
              <Textarea id="np-desc" rows={2} value={desc} onChange={(e) => setDesc(e.target.value)} />
            </Field>
            <div>
              <Button type="submit" variant="primary" disabled={busy || !name.trim()}>
                作成
              </Button>
            </div>
          </form>
        </Card>

        <Card title="取り込み・サンプル">
          <div className="flex flex-col gap-3">
            <Notice tone="info">書き出した zip / json をプロジェクト単位で取り込みます。既存のプロジェクトに設定を混ぜることはしません。</Notice>
            <Field label="取り込み方" htmlFor="imp-mode">
              <Select
                id="imp-mode"
                value={mode}
                onChange={(e) => setMode(e.target.value as "new" | "replace")}
                options={[
                  { value: "new", label: "新しいプロジェクトとして追加" },
                  { value: "replace", label: "同じ ID のプロジェクトを置き換える（旧データは退避）" },
                ]}
              />
            </Field>
            <div className="flex flex-wrap gap-2">
              <input
                ref={fileRef}
                type="file"
                accept=".zip,.json,application/zip,application/json"
                className="hidden"
                data-testid="import-file"
                onChange={async (e) => {
                  const f = e.target.files?.[0];
                  e.target.value = "";
                  if (!f) return;
                  if (mode === "replace" && !confirm("同じ ID のプロジェクトを置き換えます。現在のデータは data/trash に退避されます。よろしいですか？")) return;
                  const p = await run(async () => {
                    const info = await getServerInfo();
                    if (info.storage.directTransfer) {
                      // Web 版：zip を保存先へ直接送ってから取り込む（大きなファイルに対応）
                      const t = await api<{ key: string; url: string }>("/api/import/upload", { method: "POST" });
                      await uploadToSignedUrl(t.url, f);
                      return api<Project>("/api/import", { body: { transferKey: t.key, mode } });
                    }
                    const form = new FormData();
                    form.append("file", f);
                    form.append("mode", mode);
                    return api<Project>("/api/import", { form });
                  }, "取り込みました");
                  if (p) await load();
                }}
              />
              <Button onClick={() => fileRef.current?.click()} disabled={busy}>
                ファイルを選んで取り込む
              </Button>
              <Button
                variant="ghost"
                disabled={busy}
                onClick={async () => {
                  if (!confirm("サンプル（架空）プロジェクトを初期状態に戻します。Wylls などほかのプロジェクトには影響しません。")) return;
                  await run(() => api("/api/sample/reset", { method: "POST" }), "サンプルを初期化しました");
                  await load();
                }}
              >
                サンプルを初期化
              </Button>
            </div>
          </div>
        </Card>
      </div>
    </main>
  );
}

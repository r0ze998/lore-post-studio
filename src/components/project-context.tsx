"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import type { Asset, Entry, Learning, Post, Project, SendLogEntry } from "@/lib/domain/schema";
import { api } from "@/lib/client/api";
import type { CheckContext } from "@/lib/checks/engine";

export interface ProjectData {
  project: Project;
  entries: Entry[];
  assets: Asset[];
  posts: Post[];
  learnings: Learning[];
  sendLog: SendLogEntry[];
}

interface Ctx {
  data: ProjectData;
  reload: () => Promise<void>;
  /** 個別の更新結果を即座に反映（再読み込みせずに）。 */
  replacePost: (p: Post) => void;
  replaceEntry: (e: Entry) => void;
  checkCtx: CheckContext;
  entryById: Map<string, Entry>;
  base: string;
}

const ProjectCtx = createContext<Ctx | null>(null);

export function ProjectProvider({ pid, children }: { pid: string; children: ReactNode }) {
  const [data, setData] = useState<ProjectData | null>(null);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    try {
      const d = await api<ProjectData>(`/api/projects/${encodeURIComponent(pid)}`);
      setData(d);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [pid]);

  useEffect(() => {
    setData(null);
    void reload();
  }, [reload]);

  const replacePost = useCallback((p: Post) => {
    setData((d) => (d ? { ...d, posts: d.posts.some((x) => x.id === p.id) ? d.posts.map((x) => (x.id === p.id ? p : x)) : [...d.posts, p] } : d));
  }, []);
  const replaceEntry = useCallback((e: Entry) => {
    setData((d) => (d ? { ...d, entries: d.entries.some((x) => x.id === e.id) ? d.entries.map((x) => (x.id === e.id ? e : x)) : [...d.entries, e] } : d));
  }, []);

  const value = useMemo<Ctx | null>(() => {
    if (!data) return null;
    return {
      data,
      reload,
      replacePost,
      replaceEntry,
      checkCtx: { project: data.project, entries: data.entries, posts: data.posts, learnings: data.learnings, assets: data.assets },
      entryById: new Map(data.entries.map((e) => [e.id, e])),
      base: `/p/${encodeURIComponent(data.project.id)}`,
    };
  }, [data, reload, replacePost, replaceEntry]);

  if (error) {
    return (
      <div className="mx-auto max-w-lg p-8 text-center">
        <p className="text-danger">{error}</p>
        <a href="/" className="mt-4 inline-block text-accent underline">
          プロジェクト一覧へ
        </a>
      </div>
    );
  }
  if (!value) return <div className="p-8 text-center text-muted">読み込み中…</div>;
  return <ProjectCtx.Provider value={value}>{children}</ProjectCtx.Provider>;
}

export function useProject(): Ctx {
  const c = useContext(ProjectCtx);
  if (!c) throw new Error("ProjectProvider がありません");
  return c;
}

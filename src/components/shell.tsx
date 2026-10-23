"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { ProjectProvider, useProject } from "./project-context";
import { Badge, cx } from "./ui";

const NAV = [
  { href: "", label: "概要" },
  { href: "/canon", label: "設定（正本）" },
  { href: "/assets", label: "素材庫" },
  { href: "/board", label: "企画ボード" },
  { href: "/checks", label: "整合性チェック" },
  { href: "/approved", label: "承認済み" },
  { href: "/history", label: "投稿履歴" },
  { href: "/retro", label: "振り返り" },
  { href: "/settings", label: "プロジェクト設定" },
];

function Nav() {
  const { data, base } = useProject();
  const path = usePathname();
  const isActive = (href: string) => (href === "" ? path === base : path.startsWith(base + href));
  const p = data.project;
  return (
    <>
      {/* PC: 左側の固定ナビ */}
      <aside className="sticky top-0 hidden h-dvh w-56 shrink-0 flex-col border-r border-line bg-surface lg:flex">
        <div className="border-b border-line px-4 py-3">
          <Link href="/" className="text-[12px] text-muted hover:text-ink">
            ← プロジェクト一覧
          </Link>
          <div className="mt-1 font-semibold leading-snug" data-testid="project-name">
            {p.name}
          </div>
          <div className="mt-1">{p.kind === "sample" ? <Badge tone="sample">架空のサンプル</Badge> : <Badge tone="accent">実プロジェクト</Badge>}</div>
        </div>
        <nav className="flex flex-col gap-0.5 p-2" aria-label="プロジェクト内">
          {NAV.map((n) => (
            <Link
              key={n.href}
              href={base + n.href}
              className={cx("rounded-md px-3 py-2 text-sm", isActive(n.href) ? "bg-accent-soft font-semibold text-accent" : "text-ink hover:bg-surface2")}
            >
              {n.label}
            </Link>
          ))}
        </nav>
      </aside>
      {/* スマホ・タブレット: 上部の横スクロールナビ */}
      <div className="sticky top-0 z-30 border-b border-line bg-surface/95 backdrop-blur lg:hidden">
        <div className="flex items-center gap-2 px-3 pt-2">
          <Link href="/" aria-label="プロジェクト一覧" className="text-muted">
            ←
          </Link>
          <span className="truncate text-sm font-semibold" data-testid="project-name-mobile">
            {p.name}
          </span>
          {p.kind === "sample" && <Badge tone="sample">架空</Badge>}
        </div>
        <nav className="scrollbar-none flex gap-1 overflow-x-auto px-2 py-1.5" aria-label="プロジェクト内">
          {NAV.map((n) => (
            <Link
              key={n.href}
              href={base + n.href}
              className={cx("shrink-0 rounded-full px-3 py-1 text-[13px]", isActive(n.href) ? "bg-accent text-accent-ink" : "bg-surface2 text-ink")}
            >
              {n.label}
            </Link>
          ))}
        </nav>
      </div>
    </>
  );
}

function SampleBanner() {
  const { data } = useProject();
  if (data.project.kind !== "sample") return null;
  return (
    <div className="border-b border-sample/40 bg-sample-soft px-4 py-1.5 text-[13px] text-sample" role="note" data-testid="sample-banner">
      これは架空のサンプルプロジェクトです。ここの設定は実在のゲーム（Wylls など）の設定ではありません。
    </div>
  );
}

export function ProjectShell({ pid, children }: { pid: string; children: ReactNode }) {
  return (
    <ProjectProvider pid={pid}>
      <div className="lg:flex">
        <Nav />
        <div className="min-w-0 flex-1">
          <SampleBanner />
          <main className="mx-auto max-w-6xl px-3 py-4 sm:px-6 sm:py-6">{children}</main>
        </div>
      </div>
    </ProjectProvider>
  );
}

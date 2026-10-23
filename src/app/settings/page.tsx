"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import type { ProviderInfo } from "@/lib/generation/types";
import { api } from "@/lib/client/api";
import { Badge, Card, Notice, PageHeader } from "@/components/ui";

interface Info {
  providers: ProviderInfo[];
  prices: Record<string, { label: string; inputPerMTok: number; outputPerMTok: number }>;
  pricingAsOf: string;
  dataDir: string;
  passcode: boolean;
}

export default function GlobalSettings() {
  const [info, setInfo] = useState<Info | null>(null);
  useEffect(() => {
    api<Info>("/api/providers").then(setInfo);
  }, []);
  return (
    <main className="mx-auto max-w-4xl px-4 py-6 sm:py-10">
      <Link href="/" className="text-sm text-muted">
        ← プロジェクト一覧
      </Link>
      <PageHeader title="生成の接続と費用" description="文章生成の方法は交換できます。API に接続しなくても、設定管理・テンプレート・手動編集・検査・書き出しはすべて使えます。" />
      {!info ? (
        <p className="text-muted">読み込み中…</p>
      ) : (
        <div className="flex flex-col gap-4">
          <Card title="生成の方法">
            <ul className="flex flex-col gap-3">
              {info.providers.map((p) => (
                <li key={p.id} className="rounded-md border border-line p-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-semibold">{p.label}</span>
                    <Badge tone={p.kind === "external" ? "warn" : "neutral"}>{p.kind === "external" ? "外部に送信" : p.kind === "manual" ? "自分で中継" : "このコンピューター内"}</Badge>
                    <Badge tone={p.available ? "ok" : "danger"}>{p.available ? "使えます" : "未設定"}</Badge>
                  </div>
                  <p className="mt-1 text-sm text-muted">{p.description}</p>
                  {!p.available && p.reason && <p className="mt-1 text-sm text-warn">{p.reason}</p>}
                </li>
              ))}
            </ul>
          </Card>
          <Card title="Anthropic API を使う場合">
            <ol className="list-decimal pl-5 text-sm">
              <li>Anthropic Console（platform.claude.com）で API キーを発行します。API は Claude.ai のサブスクリプションとは別の従量課金です。</li>
              <li>
                ツールを起動する前に、サーバーの環境変数 <code>ANTHROPIC_API_KEY</code> を設定します（<code>.env.local</code> に書けます）。キーはサーバー側だけで使い、ブラウザには送りません。
              </li>
              <li>使うプロジェクトの「プロジェクト設定」で、外部モデルへの送信を許可します（既定は不許可）。</li>
              <li>送信のたびに、送る資料・送らない資料・概算費用・保存方針が表示されます。確認してから送ります。</li>
            </ol>
            <h3 className="mt-3 text-sm font-semibold">料金の参考値（{info.pricingAsOf} 時点の公開価格・USD / 100 万トークン）</h3>
            <table className="mt-1 text-sm">
              <tbody>
                {Object.entries(info.prices).map(([id, p]) => (
                  <tr key={id}>
                    <td className="pr-4">{p.label}</td>
                    <td className="pr-4 text-muted">{id}</td>
                    <td className="pr-4">入力 ${p.inputPerMTok}</td>
                    <td>出力 ${p.outputPerMTok}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="mt-1 text-[12px] text-muted">使うモデルは環境変数 ANTHROPIC_MODEL で変えられます（既定 claude-opus-5-5）。最新の料金は Anthropic の料金ページで確認してください。</p>
          </Card>
          <Card title="データの保存場所">
            <p className="text-sm">
              <code className="break-all">{info.dataDir}</code>
            </p>
            <p className="mt-1 text-[12px] text-muted">プロジェクトごとにフォルダが分かれています。削除・置き換えたデータは trash フォルダに退避されます。定期的にプロジェクトを zip で書き出してバックアップしてください。</p>
          </Card>
          {!info.passcode && (
            <Notice tone="warn" title="スマホから LAN 経由で使う場合">
              <code>npm run start:lan</code> で起動すると同じネットワークの端末からアクセスできます。その場合は環境変数 <code>APP_PASSCODE</code> を設定してください（Basic 認証がかかります）。
            </Notice>
          )}
        </div>
      )}
    </main>
  );
}

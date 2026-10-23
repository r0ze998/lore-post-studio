"use client";

import type { ProviderInfo } from "@/lib/generation/types";
import { api } from "./api";

export interface ServerInfo {
  providers: ProviderInfo[];
  prices: Record<string, { label: string; inputPerMTok: number; outputPerMTok: number }>;
  pricingAsOf: string;
  storage: { kind: "file" | "supabase"; description: string; maxAssetBytes: number; directTransfer: boolean };
  deployed: boolean;
  passcode: boolean;
}

let cache: Promise<ServerInfo> | null = null;

export function getServerInfo(): Promise<ServerInfo> {
  if (!cache) {
    cache = api<ServerInfo>("/api/providers");
    cache.catch(() => {
      cache = null;
    });
  }
  return cache;
}

/**
 * 保存先の署名付き URL へ、ブラウザから直接ファイルを送る（Supabase Storage の形式）。
 * Vercel の 1 リクエスト約 4.5MB の上限を避けるため、サーバーを経由しない。
 */
export async function uploadToSignedUrl(url: string, file: Blob): Promise<void> {
  const body = new FormData();
  body.append("cacheControl", "3600");
  body.append("", file);
  const res = await fetch(url, { method: "PUT", body, headers: { "x-upsert": "false" } });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`保存先へのアップロードに失敗しました（${res.status}）${text ? `: ${text.slice(0, 200)}` : ""}`);
  }
}

"use client";

export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
  }
}

/** 画面からの API 呼び出し（変更系には CSRF 対策の独自ヘッダーを付ける）。 */
export async function api<T>(path: string, init: { method?: string; body?: unknown; form?: FormData } = {}): Promise<T> {
  const method = init.method ?? (init.body !== undefined || init.form ? "POST" : "GET");
  const headers: Record<string, string> = {};
  if (method !== "GET") headers["x-lore-post-studio"] = "1";
  let body: BodyInit | undefined;
  if (init.form) body = init.form;
  else if (init.body !== undefined) {
    headers["Content-Type"] = "application/json";
    body = JSON.stringify(init.body);
  }
  const res = await fetch(path, { method, headers, body, cache: "no-store" });
  const text = await res.text();
  let data: unknown = undefined;
  try {
    data = text ? JSON.parse(text) : undefined;
  } catch {
    /* 非 JSON */
  }
  if (!res.ok) {
    const msg = (data as { error?: string } | undefined)?.error ?? `エラー（${res.status}）`;
    throw new ApiError(msg, res.status);
  }
  return data as T;
}

export function clientId(prefix: string): string {
  const r = typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID().replace(/-/g, "").slice(0, 12) : Math.random().toString(36).slice(2, 14);
  return `${prefix}_${Date.now().toString(36)}${r}`;
}

export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // 古いブラウザ・非 HTTPS の LAN 接続向け
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand("copy");
    document.body.removeChild(ta);
    return ok;
  }
}

export function downloadBlob(name: string, content: string | Blob, type = "text/plain;charset=utf-8") {
  const blob = typeof content === "string" ? new Blob([content], { type }) : content;
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function fmtDate(iso: string | undefined, withTime = false): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const pad = (n: number) => String(n).padStart(2, "0");
  const s = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  return withTime ? `${s} ${pad(d.getHours())}:${pad(d.getMinutes())}` : s;
}

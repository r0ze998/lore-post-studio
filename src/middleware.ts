/**
 * 個人用ツールのための最小限の保護。
 * - Host 検査：合言葉なし（ローカル起動）のときは localhost / 127.0.0.1 以外の Host を拒否する
 *   （DNS リバインディングで他のサイトから読み書きされるのを防ぐ）
 * - 変更系 API は独自ヘッダー必須・他サイトからの送信（Sec-Fetch-Site: cross-site）を拒否（CSRF 対策）
 * - APP_PASSCODE を設定した場合は Basic 認証（LAN でスマホから使うとき用。合言葉は日本語でもよい）
 */
import { NextResponse, type NextRequest } from "next/server";

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]", "::1"]);

function hostname(host: string): string {
  if (host.startsWith("[")) return host.slice(0, host.indexOf("]") + 1);
  return host.split(":")[0].toLowerCase();
}

function decodeBasic(header: string): string | null {
  if (!header.startsWith("Basic ")) return null;
  try {
    const bin = atob(header.slice(6).trim());
    const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
    return new TextDecoder().decode(bytes);
  } catch {
    return null;
  }
}

/** 長さに依存しにくい比較。 */
function safeEqual(a: string, b: string): boolean {
  const x = new TextEncoder().encode(a);
  const y = new TextEncoder().encode(b);
  let diff = x.length ^ y.length;
  for (let i = 0; i < Math.max(x.length, y.length); i++) diff |= (x[i] ?? 0) ^ (y[i] ?? 0);
  return diff === 0;
}

export function middleware(req: NextRequest) {
  const pass = process.env.APP_PASSCODE;
  if (pass) {
    const cred = decodeBasic(req.headers.get("authorization") ?? "");
    if (cred === null || !safeEqual(cred, `user:${pass}`)) {
      return new NextResponse("認証が必要です", { status: 401, headers: { "WWW-Authenticate": 'Basic realm="lore-post-studio", charset="UTF-8"' } });
    }
  } else {
    const host = hostname(req.headers.get("host") ?? "");
    if (!LOCAL_HOSTS.has(host)) {
      return new NextResponse("このツールはこのコンピューター（localhost）からのみ使えます。LAN で使う場合は APP_PASSCODE を設定してください。", { status: 403 });
    }
  }
  if (req.nextUrl.pathname.startsWith("/api/") && !["GET", "HEAD", "OPTIONS"].includes(req.method)) {
    const site = req.headers.get("sec-fetch-site");
    if (req.headers.get("x-lore-post-studio") !== "1" || (site && site !== "same-origin" && site !== "none")) {
      return NextResponse.json({ error: "このツールの画面以外からの変更要求は受け付けません" }, { status: 403 });
    }
  }
  return NextResponse.next();
}

export const config = { matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"] };

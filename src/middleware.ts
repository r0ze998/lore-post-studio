/**
 * 個人用ツールのための最小限の保護。
 * - 変更系 API は独自ヘッダー必須（他サイトからの送信＝CSRF を防ぐ。独自ヘッダー付きの他オリジン要求はブラウザが事前確認で止める）
 * - APP_PASSCODE を設定した場合は Basic 認証（LAN でスマホから使うとき用）
 */
import { NextResponse, type NextRequest } from "next/server";

export const CLIENT_HEADER = "x-lore-post-studio";

export function middleware(req: NextRequest) {
  const pass = process.env.APP_PASSCODE;
  if (pass) {
    const auth = req.headers.get("authorization") ?? "";
    const expected = "Basic " + btoa(`user:${pass}`);
    if (auth !== expected) {
      return new NextResponse("認証が必要です", { status: 401, headers: { "WWW-Authenticate": 'Basic realm="lore-post-studio", charset="UTF-8"' } });
    }
  }
  if (req.nextUrl.pathname.startsWith("/api/") && !["GET", "HEAD", "OPTIONS"].includes(req.method)) {
    if (req.headers.get(CLIENT_HEADER) !== "1") {
      return NextResponse.json({ error: "このツールの画面以外からの変更要求は受け付けません" }, { status: 403 });
    }
  }
  return NextResponse.next();
}

export const config = { matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"] };

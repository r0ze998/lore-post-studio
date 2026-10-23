import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { StoreError } from "./store";
import { ConfigError } from "./backend/types";

export function json(data: unknown, status = 200) {
  return NextResponse.json(data, { status, headers: { "Cache-Control": "no-store" } });
}

export function errorResponse(e: unknown) {
  if (e instanceof StoreError) return json({ error: e.message }, e.status);
  if (e instanceof ConfigError) return json({ error: `設定が足りません：${e.message}` }, 500);
  if (e instanceof ZodError) {
    const i = e.issues[0];
    return json({ error: `入力が不正です: ${i?.path.join(".")} ${i?.message ?? ""}` }, 400);
  }
  if (e instanceof SyntaxError) return json({ error: "JSON の形式が不正です" }, 400);
  console.error(e);
  return json({ error: "サーバーでエラーが発生しました" }, 500);
}

export async function handle<T>(fn: () => Promise<T>, status = 200) {
  try {
    const result = await fn();
    return json(result ?? { ok: true }, status);
  } catch (e) {
    return errorResponse(e);
  }
}

export type RouteCtx<P extends Record<string, string>> = { params: Promise<P> };

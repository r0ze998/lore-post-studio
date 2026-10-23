/**
 * X の文字数カウント。
 *
 * 公式ドキュメント（docs.x.com "Counting characters"、2026-10 確認）:
 * - 上限は加重文字数 280
 * - ラテン文字・一般的な記号は 1、CJK（日本語を含む）は 2、絵文字は 2（ZWJ 結合や肌色修飾があっても 2）
 * - URL は長さにかかわらず 23
 * - NFC 正規化した長さで数える
 * - 公式の twitter-text ライブラリの parseTweet を推奨
 *
 * ここでは公式ライブラリ（twitter-text v3 設定）をそのまま使う。
 * Premium の長文投稿（最大 25,000 字）は初期版では未対応（上限判定・プレビューしない）。
 */
import twitter from "twitter-text";

export const X_MAX_WEIGHTED = 280;
export const X_URL_LENGTH = 23;

export interface XCount {
  weightedLength: number;
  valid: boolean;
  remaining: number;
  /** 上限内に収まる最後の位置（元の文字列の UTF-16 インデックス）。超過部分の表示に使う。 */
  validRangeEnd: number;
  urls: string[];
}

export function countX(text: string): XCount {
  const r = twitter.parseTweet(text);
  const urls = twitter.extractUrls(text);
  return {
    weightedLength: r.weightedLength,
    valid: r.valid,
    remaining: X_MAX_WEIGHTED - r.weightedLength,
    validRangeEnd: r.validRangeEnd + 1,
    urls,
  };
}

export function extractUrlsWithIndices(text: string): { url: string; start: number; end: number }[] {
  return twitter.extractUrlsWithIndices(text).map((u) => ({ url: u.url, start: u.indices[0], end: u.indices[1] }));
}

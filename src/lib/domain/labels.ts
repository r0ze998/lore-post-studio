import type {
  ClaimType,
  EntryDomain,
  EntryKind,
  EntryStatus,
  FeatureStatus,
  PostStatus,
  PostType,
  Severity,
} from "./schema";

export const ENTRY_KIND_LABEL: Record<EntryKind, string> = {
  lore: "世界設定",
  term: "用語",
  character: "キャラクター",
  event: "物語上の出来事",
  voice: "語り口",
  visual: "画像の参考",
  example: "過去の投稿例",
  feature: "機能（実装状況）",
  claim: "実績・数値",
  notice: "告知情報",
  testimonial: "実在ユーザーの声",
};

export const ENTRY_KIND_HELP: Record<EntryKind, string> = {
  lore: "世界の成り立ち・地理・歴史・ルールなど。創作上の設定。",
  term: "固有名詞や用語。正しい表記・読み・誤表記を登録すると本文で照合します。",
  character: "登場人物。名前・別名・話し方。",
  event: "物語の中で起きた出来事。投稿で確立した出来事を続きの投稿に引き継ぐために使います。",
  voice: "語り手の定義。世界内の語り手と開発者の語りを分けて登録します。",
  visual: "画像の色調・モチーフ・避けたい表現。画像生成用の指示文の書き出しに使います。",
  example: "良い投稿・悪い投稿の実例と理由。",
  feature: "現実のゲームの機能と実装状況。未実装を「実装済み」と書くと検査で止めます。",
  claim: "受賞・提携・賞金・利用者数など。根拠（URL・資料）がないものは本文に書けません。",
  notice: "テスト募集などの告知。日程・参加方法・条件。",
  testimonial: "実在する人の声。本人の同意と出典があるものだけ引用できます。",
};

export const DOMAIN_LABEL: Record<EntryDomain, string> = {
  world: "世界（創作）",
  style: "表現",
  reality: "現実の事実",
};

export const STATUS_LABEL: Record<EntryStatus, string> = {
  confirmed: "確定",
  proposed: "提案",
  deprecated: "廃止",
};

export const FEATURE_STATUS_LABEL: Record<FeatureStatus, string> = {
  released: "公開済み",
  testing: "テスト中（一部のみ）",
  in_development: "開発中",
  planned: "予定",
  concept: "構想",
  cancelled: "中止",
};

export const CLAIM_TYPE_LABEL: Record<ClaimType, string> = {
  award: "受賞",
  partnership: "提携",
  prize: "賞金・報酬",
  metric: "利用者数などの数値",
  other: "その他",
};

export const POST_TYPE_LABEL: Record<PostType, string> = {
  story: "世界の中の物語・出来事",
  gameplay: "選択・駆け引き・遊び方",
  devlog: "開発進捗・実装機能",
  recruit: "テスト参加者の募集",
  showcase: "画像・動画を添えた紹介",
  series: "連続投稿・物語の続き",
};

export const POST_STATUS_LABEL: Record<PostStatus, string> = {
  idea: "企画",
  drafting: "下書き",
  review: "確認待ち",
  approved: "承認済み",
  rejected: "却下",
  posted: "投稿済み（手動記録）",
  archived: "保管",
};

export const SEVERITY_LABEL: Record<Severity, string> = {
  error: "要修正",
  warning: "要確認",
  info: "参考",
};

export const BOARD_COLUMNS: PostStatus[] = ["idea", "drafting", "review", "approved", "posted", "rejected"];

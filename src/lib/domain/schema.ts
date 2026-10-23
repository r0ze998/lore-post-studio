/**
 * ドメインモデル。保存・取り込み・API 入出力はすべてこのスキーマで検証する。
 *
 * 設計上の約束:
 * - プロジェクトごとにデータは完全に分離される（projectId は保存先ディレクトリでもある）。
 * - 正本の各項目は「出典・更新日・状態（確定／提案／廃止）」を必ず持つ。
 * - 世界の中の設定（world）と、現実の事実（reality）は別の種類として扱う。
 */
import { z } from "zod";

export const SCHEMA_VERSION = 1;

export const id = z.string().min(1).max(64);
export const isoDate = z.string().min(1);

/* ------------------------------------------------------------------ */
/* Project                                                             */
/* ------------------------------------------------------------------ */

export const ProjectKind = z.enum(["real", "sample"]);
export type ProjectKind = z.infer<typeof ProjectKind>;

export const EmojiPolicy = z.enum(["none", "few", "free"]);
export const CtaPolicy = z.enum(["none", "soft", "explicit"]);

export const PostDefaults = z.object({
  emoji: EmojiPolicy.default("none"),
  maxEmoji: z.number().int().min(0).max(20).default(0),
  maxHashtags: z.number().int().min(0).max(10).default(1),
  hashtags: z.array(z.string()).default([]),
  cta: CtaPolicy.default("none"),
  ctaText: z.string().default(""),
});
export type PostDefaults = z.infer<typeof PostDefaults>;

export const ProjectSettings = z.object({
  /** 初見の人に何のゲームか伝えるための語（ゲーム名・別表記）。 */
  identityAnchors: z.array(z.string()).default([]),
  /** 一行説明（何をするゲームか）。 */
  oneLiner: z.string().default(""),
  /** 公式リンクとして許可するドメイン。 */
  officialDomains: z.array(z.string()).default([]),
  /** 逃げの宣伝文句。既定リストに追加される。 */
  bannedPhrases: z.array(z.string()).default([]),
  /** 既定リストを使うか。 */
  useDefaultBannedPhrases: z.boolean().default(true),
  /** 世界内の語りに混ぜたくない開発者語（既定リストに追加）。 */
  developerMarkers: z.array(z.string()).default([]),
  defaults: PostDefaults.default(PostDefaults.parse({})),
  /** 外部モデルへの送信を許可するか（既定: 許可しない）。 */
  allowExternalModel: z.boolean().default(false),
  /** 重複判定のしきい値（0-1）。 */
  duplicateWarn: z.number().min(0).max(1).default(0.35),
  duplicateError: z.number().min(0).max(1).default(0.6),
});
export type ProjectSettings = z.infer<typeof ProjectSettings>;

export const Project = z.object({
  id,
  name: z.string().min(1).max(120),
  kind: ProjectKind,
  description: z.string().default(""),
  createdAt: isoDate,
  updatedAt: isoDate,
  settings: ProjectSettings.default(ProjectSettings.parse({})),
});
export type Project = z.infer<typeof Project>;

/* ------------------------------------------------------------------ */
/* Canon entries（世界観の正本 + 現実の事実台帳）                        */
/* ------------------------------------------------------------------ */

export const EntryStatus = z.enum(["confirmed", "proposed", "deprecated"]);
export type EntryStatus = z.infer<typeof EntryStatus>;

export const Visibility = z.enum(["public", "internal"]);
export type Visibility = z.infer<typeof Visibility>;

export const EntryKind = z.enum([
  // 世界（創作）
  "lore",
  "term",
  "character",
  "event",
  // 表現
  "voice",
  "visual",
  "example",
  // 現実
  "feature",
  "claim",
  "notice",
  "testimonial",
]);
export type EntryKind = z.infer<typeof EntryKind>;

export const EntryDomain = z.enum(["world", "style", "reality"]);
export type EntryDomain = z.infer<typeof EntryDomain>;

export const KIND_DOMAIN: Record<EntryKind, EntryDomain> = {
  lore: "world",
  term: "world",
  character: "world",
  event: "world",
  voice: "style",
  visual: "style",
  example: "style",
  feature: "reality",
  claim: "reality",
  notice: "reality",
  testimonial: "reality",
};

export const Source = z.object({
  /** 出典の名前（例: 「設定資料 v2」「2026-09 打ち合わせメモ」） */
  label: z.string().default(""),
  url: z.string().default(""),
  note: z.string().default(""),
});
export type Source = z.infer<typeof Source>;

export const ContradictionPattern = z.object({
  /** 本文中にこれがあれば、この項目と矛盾する。 */
  pattern: z.string().min(1),
  regex: z.boolean().default(false),
  reason: z.string().default(""),
});
export type ContradictionPattern = z.infer<typeof ContradictionPattern>;

export const FeatureStatus = z.enum([
  "released",
  "testing",
  "in_development",
  "planned",
  "concept",
  "cancelled",
]);
export type FeatureStatus = z.infer<typeof FeatureStatus>;

export const ClaimType = z.enum(["award", "partnership", "prize", "metric", "other"]);
export type ClaimType = z.infer<typeof ClaimType>;

export const VoiceMode = z.enum(["in_world", "developer"]);
export type VoiceMode = z.infer<typeof VoiceMode>;

/** 種類ごとの追加項目。使わない項目は空のまま。 */
export const EntryDetails = z.object({
  // term
  reading: z.string().default(""),
  forbiddenVariants: z.array(z.string()).default([]),
  // character
  speechStyle: z.string().default(""),
  // event
  inWorldOrder: z.string().default(""),
  establishedByPostId: z.string().default(""),
  // voice
  voiceMode: VoiceMode.optional(),
  doList: z.array(z.string()).default([]),
  dontList: z.array(z.string()).default([]),
  /** その語り手らしさを示す言い回し（別の語り手に混入したら指摘）。 */
  signaturePhrases: z.array(z.string()).default([]),
  // visual
  palette: z.string().default(""),
  avoid: z.array(z.string()).default([]),
  assetIds: z.array(z.string()).default([]),
  // example
  polarity: z.enum(["good", "bad"]).optional(),
  exampleText: z.string().default(""),
  exampleReason: z.string().default(""),
  // feature
  featureStatus: FeatureStatus.optional(),
  version: z.string().default(""),
  // claim
  claimType: ClaimType.optional(),
  value: z.string().default(""),
  evidenceUrl: z.string().default(""),
  evidenceNote: z.string().default(""),
  verifiedAt: z.string().default(""),
  // notice
  period: z.string().default(""),
  howToJoin: z.string().default(""),
  conditions: z.string().default(""),
  // testimonial
  quote: z.string().default(""),
  speaker: z.string().default(""),
  consent: z.boolean().default(false),
});
export type EntryDetails = z.infer<typeof EntryDetails>;

export const EntrySnapshot = z.object({
  title: z.string(),
  body: z.string(),
  aliases: z.array(z.string()),
  status: EntryStatus,
  visibility: Visibility,
  source: Source,
  details: EntryDetails,
  contradictions: z.array(ContradictionPattern),
});

export const EntryRevision = z.object({
  at: isoDate,
  note: z.string().default(""),
  snapshot: EntrySnapshot,
});
export type EntryRevision = z.infer<typeof EntryRevision>;

export const Entry = z.object({
  id,
  projectId: id,
  kind: EntryKind,
  title: z.string().min(1).max(200),
  body: z.string().default(""),
  /** 別名・英語名など。本文照合に使う。 */
  aliases: z.array(z.string()).default([]),
  status: EntryStatus,
  visibility: Visibility.default("public"),
  source: Source.default(Source.parse({})),
  tags: z.array(z.string()).default([]),
  details: EntryDetails.default(EntryDetails.parse({})),
  contradictions: z.array(ContradictionPattern).default([]),
  /** この項目が置き換えた項目（手動で設定）。 */
  supersedes: z.array(z.string()).default([]),
  /** 「矛盾候補ではない」と人が判断した相手。 */
  notConflictingWith: z.array(z.string()).default([]),
  createdAt: isoDate,
  updatedAt: isoDate,
  history: z.array(EntryRevision).default([]),
});
export type Entry = z.infer<typeof Entry>;

/* ------------------------------------------------------------------ */
/* Assets                                                              */
/* ------------------------------------------------------------------ */

export const AssetRights = z.enum(["own", "licensed", "unknown"]);

/** 受け付ける素材の形式（取り込みファイル経由で HTML などが紛れ込まないよう、ここで固定する）。 */
export const AssetMime = z.enum(["image/png", "image/jpeg", "image/gif", "image/webp", "video/mp4", "video/quicktime"]);

export const Asset = z.object({
  id,
  projectId: id,
  filename: z.string(),
  storedName: z.string().regex(/^[A-Za-z0-9_-]{1,64}\.[a-z0-9]{1,5}$/),
  mime: AssetMime,
  size: z.number().int().nonnegative(),
  title: z.string().default(""),
  description: z.string().default(""),
  altText: z.string().default(""),
  credit: z.string().default(""),
  rights: AssetRights.default("own"),
  visibility: Visibility.default("public"),
  status: EntryStatus.default("confirmed"),
  linkedEntryIds: z.array(z.string()).default([]),
  createdAt: isoDate,
  updatedAt: isoDate,
});
export type Asset = z.infer<typeof Asset>;

/* ------------------------------------------------------------------ */
/* Posts                                                               */
/* ------------------------------------------------------------------ */

export const PostType = z.enum([
  "story",
  "gameplay",
  "devlog",
  "recruit",
  "showcase",
  "series",
]);
export type PostType = z.infer<typeof PostType>;

export const PostStatus = z.enum([
  "idea",
  "drafting",
  "review",
  "approved",
  "rejected",
  "posted",
  "archived",
]);
export type PostStatus = z.infer<typeof PostStatus>;

export const Language = z.enum(["ja", "en"]);
export type Language = z.infer<typeof Language>;

export const SegmentVoice = z.enum(["in_world", "developer"]);
export type SegmentVoice = z.infer<typeof SegmentVoice>;

export const Basis = z.enum(["canon", "fact", "invented", "unknown"]);
export type Basis = z.infer<typeof Basis>;

export const ProvenanceNote = z.object({
  quote: z.string().default(""),
  basis: Basis,
  refIds: z.array(z.string()).default([]),
  note: z.string().default(""),
});
export type ProvenanceNote = z.infer<typeof ProvenanceNote>;

export const Segment = z.object({
  id,
  text: z.string().default(""),
  voice: SegmentVoice.default("developer"),
  /** 英語の下書きの日本語での意味確認。 */
  jaGloss: z.string().default(""),
  assetIds: z.array(z.string()).default([]),
  provenance: z.array(ProvenanceNote).default([]),
});
export type Segment = z.infer<typeof Segment>;

export const DraftOrigin = z.enum(["template", "model", "manual", "relay"]);

export const DraftVersion = z.object({
  id,
  createdAt: isoDate,
  origin: DraftOrigin,
  /** 生成に使った提供元・モデル（手動なら空）。 */
  generator: z.string().default(""),
  language: Language,
  segments: z.array(Segment).min(1),
  /** どこを創作したかのメモ（人が書く or 生成器が返す）。 */
  creativeNotes: z.string().default(""),
});
export type DraftVersion = z.infer<typeof DraftVersion>;

export const Angle = z.object({
  id,
  title: z.string(),
  approach: z.string().default(""),
  why: z.string().default(""),
  origin: z.enum(["template", "model", "manual", "relay"]),
});
export type Angle = z.infer<typeof Angle>;

export const Severity = z.enum(["error", "warning", "info"]);
export type Severity = z.infer<typeof Severity>;

export const Acknowledgement = z.object({
  findingKey: z.string(),
  reason: z.string().min(1),
  at: isoDate,
});
export type Acknowledgement = z.infer<typeof Acknowledgement>;

export const Decision = z.object({
  kind: z.enum(["approved", "rejected"]),
  reason: z.string().min(1),
  tags: z.array(z.string()).default([]),
  draftId: z.string(),
  at: isoDate,
  acknowledgements: z.array(Acknowledgement).default([]),
  /** 承認時点の検査結果の要約（後から見返すため）。 */
  checkSummary: z
    .object({ errors: z.number(), warnings: z.number(), infos: z.number() })
    .optional(),
});
export type Decision = z.infer<typeof Decision>;

export const MetricSnapshot = z.object({
  at: isoDate,
  impressions: z.number().int().nonnegative().optional(),
  likes: z.number().int().nonnegative().optional(),
  reposts: z.number().int().nonnegative().optional(),
  replies: z.number().int().nonnegative().optional(),
  quotes: z.number().int().nonnegative().optional(),
  bookmarks: z.number().int().nonnegative().optional(),
  profileVisits: z.number().int().nonnegative().optional(),
  note: z.string().default(""),
  /** 初期版は手動記録のみ。API による検証は未実装。 */
  source: z.literal("manual").default("manual"),
});
export type MetricSnapshot = z.infer<typeof MetricSnapshot>;

export const Publication = z.object({
  /** 投稿 URL（スレッドなら先頭）。 */
  url: z.string().default(""),
  segmentUrls: z.array(z.string()).default([]),
  postedAt: z.string().default(""),
  recordedAt: isoDate,
  /** 投稿済みの判定方法。初期版は manual（本人の申告）のみ。 */
  verification: z.literal("manual").default("manual"),
  /** 実際に投稿した本文（承認版から変えた場合に記録）。 */
  postedText: z.string().default(""),
  metrics: z.array(MetricSnapshot).default([]),
  retro: z.string().default(""),
});
export type Publication = z.infer<typeof Publication>;

export const Brief = z.object({
  purpose: z.string().default(""),
  audience: z.string().default(""),
  /** 伝えたい事実（現実台帳の項目）。 */
  factIds: z.array(z.string()).default([]),
  /** 使う設定（世界・表現の項目）。 */
  canonIds: z.array(z.string()).default([]),
  assetIds: z.array(z.string()).default([]),
  /** 続き元の投稿。 */
  continuesPostIds: z.array(z.string()).default([]),
  seriesName: z.string().default(""),
  language: Language.default("ja"),
  voice: z.enum(["in_world", "developer", "mixed"]).default("developer"),
  notes: z.string().default(""),
});
export type Brief = z.infer<typeof Brief>;

export const Post = z.object({
  id,
  projectId: id,
  type: PostType,
  title: z.string().min(1).max(200),
  status: PostStatus,
  brief: Brief.default(Brief.parse({})),
  options: PostDefaults.default(PostDefaults.parse({})),
  angles: z.array(Angle).default([]),
  chosenAngleId: z.string().default(""),
  drafts: z.array(DraftVersion).default([]),
  currentDraftId: z.string().default(""),
  acknowledgements: z.array(Acknowledgement).default([]),
  decisions: z.array(Decision).default([]),
  /** 予約「候補」。このツールは自動投稿しない。 */
  scheduleCandidate: z.string().default(""),
  publication: Publication.optional(),
  createdAt: isoDate,
  updatedAt: isoDate,
});
export type Post = z.infer<typeof Post>;

/* ------------------------------------------------------------------ */
/* Learnings（採用／却下理由・振り返りから得た学び）                      */
/* ------------------------------------------------------------------ */

export const Learning = z.object({
  id,
  projectId: id,
  kind: z.enum(["do", "dont"]),
  text: z.string().min(1),
  /** 指定すると、本文にこの語句があった時に検査で指摘する。 */
  pattern: z.string().default(""),
  origin: z.enum(["approval", "rejection", "retro", "manual"]),
  postId: z.string().default(""),
  active: z.boolean().default(true),
  createdAt: isoDate,
});
export type Learning = z.infer<typeof Learning>;

/* ------------------------------------------------------------------ */
/* Send log（外部モデルへ送信した記録）                                  */
/* ------------------------------------------------------------------ */

export const SendLogEntry = z.object({
  id,
  at: isoDate,
  provider: z.string(),
  model: z.string(),
  task: z.string(),
  postId: z.string().default(""),
  entryIds: z.array(z.string()),
  excludedEntryIds: z.array(z.string()),
  promptChars: z.number().int(),
  usage: z
    .object({ inputTokens: z.number().int(), outputTokens: z.number().int() })
    .optional(),
  estimatedCostUsd: z.number().optional(),
  ok: z.boolean(),
  error: z.string().default(""),
  /** フォールバックなどの補足。 */
  note: z.string().default(""),
});
export type SendLogEntry = z.infer<typeof SendLogEntry>;

/* ------------------------------------------------------------------ */
/* Bundle（エクスポート・インポート単位）                                */
/* ------------------------------------------------------------------ */

export const ProjectBundle = z.object({
  format: z.literal("lore-post-studio/project"),
  schemaVersion: z.number().int(),
  exportedAt: isoDate,
  project: Project,
  entries: z.array(Entry),
  assets: z.array(Asset),
  posts: z.array(Post),
  learnings: z.array(Learning),
  sendLog: z.array(SendLogEntry).default([]),
});
export type ProjectBundle = z.infer<typeof ProjectBundle>;

/**
 * 初期データ。
 * - サンプル「塩の街道 / Salt Road」は完全に架空のゲーム（開発・検証用）。実在の作品・人物とは無関係。
 * - Wylls は空のプロジェクトだけを作る。資料が未承認のため、設定は一切仮置きしない。
 */
import {
  Entry,
  Learning,
  Post,
  Project,
  ProjectBundle,
  ProjectSettings,
  SCHEMA_VERSION,
} from "@/lib/domain/schema";

const T0 = "2026-09-01T00:00:00.000Z";

export const SAMPLE_PROJECT_ID = "sample-saltroad";

export function buildWyllsProject(): Project {
  return Project.parse({
    id: "wylls",
    name: "Wylls",
    kind: "real",
    description:
      "設定は未登録です。承認済みの資料だけを「確定」として登録してください。過去資料を取り込むときは「提案」として入ります。",
    createdAt: T0,
    updatedAt: T0,
    settings: ProjectSettings.parse({ identityAnchors: ["Wylls"] }),
  });
}

type EntryIn = Partial<Entry> & Pick<Entry, "id" | "kind" | "title" | "status">;

function entry(e: EntryIn): Entry {
  return Entry.parse({
    projectId: SAMPLE_PROJECT_ID,
    createdAt: T0,
    updatedAt: e.updatedAt ?? T0,
    ...e,
  });
}

export function buildSampleEntries(): Entry[] {
  const v2 = { label: "【架空】設定資料 v2（2026-08）", url: "", note: "" };
  return [
    /* ---------------- 世界 ---------------- */
    entry({
      id: "ent_s_lore_dry",
      kind: "lore",
      title: "白海の干上がり",
      status: "confirmed",
      body: "白海（はっかい）は約300年前に干上がった内海。いまは白い塩原が地平線まで続き、キャラバンが渡る。水は井戸と灯台町の貯水槽にしかない。",
      source: v2,
      updatedAt: "2026-08-20T00:00:00.000Z",
      contradictions: [
        { pattern: "白海.{0,20}(百|100|１００)年前", regex: true, reason: "白海が干上がったのは約300年前（設定資料 v2）" },
        { pattern: "白海.{0,12}(波|潮が満ち|泳)", regex: true, reason: "白海には水がない。波や満ち潮は存在しない（設定資料 v2）" },
      ],
    }),
    entry({
      id: "ent_s_lore_dry_old",
      kind: "lore",
      title: "白海の干上がり",
      status: "proposed",
      body: "白海は100年前の大干ばつで干上がった。",
      source: { label: "【架空】初期企画書 v1（2025-12）", url: "", note: "v2 と年数が食い違う。未整理。" },
      updatedAt: "2026-07-01T00:00:00.000Z",
    }),
    entry({
      id: "ent_s_term_hakkai",
      kind: "term",
      title: "白海",
      aliases: ["Hakkai", "White Sea"],
      status: "confirmed",
      body: "干上がった内海の名。表記は「白海」。",
      source: v2,
      details: { reading: "はっかい", forbiddenVariants: ["ハクカイ", "白の海"] } as Entry["details"],
    }),
    entry({
      id: "ent_s_term_shiofuda",
      kind: "term",
      title: "塩札",
      aliases: ["salt note", "salt notes"],
      status: "confirmed",
      body: "キャラバンの間で使われる通貨。塩の結晶を封じた札。",
      source: v2,
      supersedes: ["ent_s_term_enka"],
      details: { reading: "しおふだ", forbiddenVariants: ["塩のお札"] } as Entry["details"],
    }),
    entry({
      id: "ent_s_term_enka",
      kind: "term",
      title: "塩貨",
      aliases: ["enka"],
      status: "deprecated",
      body: "旧称。2026-07 に「塩札」へ改称した。今後使わない。",
      source: { label: "【架空】設定資料 v1", url: "", note: "" },
      supersedes: [],
    }),
    entry({
      id: "ent_s_term_shioyomi",
      kind: "term",
      title: "潮読み",
      aliases: ["tide reader", "tide readers", "tide-reader"],
      status: "confirmed",
      body: "干上がる前の潮の跡を読み、崩れない道を見つける者。",
      source: v2,
      details: { reading: "しおよみ" } as Entry["details"],
    }),
    entry({
      id: "ent_s_term_enreki",
      kind: "term",
      title: "塩暦",
      aliases: ["Salt Year"],
      status: "confirmed",
      body: "キャラバンが使う暦。「塩暦212年40日目」のように書く。物語の現在は塩暦212年。",
      source: v2,
      details: { reading: "えんれき" } as Entry["details"],
    }),
    entry({
      id: "ent_s_term_toudai",
      kind: "term",
      title: "灯台町",
      aliases: ["lighthouse town", "lighthouse towns"],
      status: "confirmed",
      body: "かつての灯台の周りにできた町。貯水槽がある。代表例はミズハ。",
      source: v2,
    }),
    entry({
      id: "ent_s_chr_minato",
      kind: "character",
      title: "記録係ミナト",
      aliases: ["ミナト", "Minato"],
      status: "confirmed",
      body: "キャラバン「七番隊」の記録係。航海日誌の形で出来事を残す。",
      source: v2,
      details: { speechStyle: "常体。短い文。地名と数字を正確に書く。感嘆符を使わない。" } as Entry["details"],
    }),
    entry({
      id: "ent_s_chr_sen",
      kind: "character",
      title: "潮読みのセン",
      aliases: ["セン", "Sen"],
      status: "confirmed",
      body: "七番隊の老いた潮読み。生まれてから一度も、水のある海を見たことがない。",
      source: v2,
      contradictions: [{ pattern: "セン.{0,12}(海を見た|泳い|波を)", regex: true, reason: "センは水のある海を見たことがない（設定資料 v2）" }],
    }),
    entry({
      id: "ent_s_chr_luka",
      kind: "character",
      title: "交易商ルカ",
      aliases: ["ルカ", "Luka"],
      status: "proposed",
      visibility: "internal",
      body: "次のシーズンで登場予定の交易商。未公開（社内のみ）。",
      source: { label: "【架空】シーズン2 企画メモ", url: "", note: "公開日未定" },
    }),
    entry({
      id: "ent_s_evt_mizuha",
      kind: "event",
      title: "七番隊、灯台町ミズハに到着",
      aliases: ["ミズハ"],
      status: "confirmed",
      body: "塩暦212年40日目、七番隊はミズハに着いた。井戸は三つ、うち二つは塩で塞がっていた。",
      source: { label: "投稿で確立（サンプル投稿 #1）", url: "", note: "" },
      details: { inWorldOrder: "212-040", establishedByPostId: "pst_s_story1" } as Entry["details"],
    }),

    /* ---------------- 表現 ---------------- */
    entry({
      id: "ent_s_voice_minato",
      kind: "voice",
      title: "世界内の語り手：ミナトの航海日誌",
      status: "confirmed",
      body: "物語投稿の語り手。キャラバンの記録係が日誌として書く。",
      source: v2,
      details: {
        voiceMode: "in_world",
        doList: ["日付は「塩暦◯年◯日目」の形", "地名・数字・行動を具体的に書く", "一つの出来事に絞る"],
        dontList: ["開発やゲームシステムの用語を使わない", "読者への呼びかけ（フォローしてね等）をしない", "感嘆符を使わない"],
        signaturePhrases: ["——記録係ミナト", "塩暦"],
      } as Entry["details"],
    }),
    entry({
      id: "ent_s_voice_dev",
      kind: "voice",
      title: "開発者の語り：開発チーム",
      status: "confirmed",
      body: "開発進捗・募集の語り手。",
      source: v2,
      details: {
        voiceMode: "developer",
        doList: ["です・ます調", "実装済み・開発中・構想を言い分ける", "数字には出典を持つ"],
        dontList: ["誇大な宣伝文句", "世界内の語り手を名乗らない"],
      } as Entry["details"],
    }),
    entry({
      id: "ent_s_visual_tone",
      kind: "visual",
      title: "白海の色調",
      status: "confirmed",
      body: "地平線まで続く塩原、低い太陽、長い影。キャラバンは画面の中で小さく描く。",
      source: v2,
      details: { palette: "塩の白、灰青、夕方の琥珀色", avoid: ["ネオン", "サイバーパンク", "近未来的なUI", "水面"] } as Entry["details"],
    }),
    entry({
      id: "ent_s_ex_good",
      kind: "example",
      title: "良い例：杭を打つセン",
      status: "confirmed",
      source: { label: "【架空】過去の投稿", url: "", note: "" },
      details: {
        polarity: "good",
        exampleText:
          "塩暦212年41日目。潮読みのセンが、干からびた潮の跡に杭を打った。今夜はここから先へ進まない。——記録係ミナト\n※開発中の交易戦略ゲーム『塩の街道』の世界から",
        exampleReason: "一つの出来事・具体的な行動・語り手の署名。最後の※行で、初見の人にも何のゲームか伝わる。",
      } as Entry["details"],
    }),
    entry({
      id: "ent_s_ex_bad",
      kind: "example",
      title: "悪い例：抽象的な宣伝",
      status: "confirmed",
      source: { label: "【架空】却下した下書き", url: "", note: "" },
      details: {
        polarity: "bad",
        exampleText: "ブロックチェーンで未来のゲーム体験を革命！真の所有をあなたに🚀🚀 #web3 #NFT #GameFi",
        exampleReason: "宣伝文句だけで何のゲームか分からない。絵文字とハッシュタグが多い。",
      } as Entry["details"],
    }),

    /* ---------------- 現実 ---------------- */
    entry({
      id: "ent_s_feat_trade",
      kind: "feature",
      title: "取引提案",
      aliases: ["交渉機能", "交渉", "trade offer", "trade offers"],
      status: "confirmed",
      body: "他のキャラバンに、塩札と物資の交換を提案できる。v0.3（2026-09-10）でテスト版に実装。",
      source: { label: "【架空】パッチノート v0.3", url: "https://example.com/saltroad/patch-0-3", note: "" },
      details: { featureStatus: "released", version: "v0.3" } as Entry["details"],
    }),
    entry({
      id: "ent_s_feat_storm",
      kind: "feature",
      title: "砂嵐",
      aliases: ["天候システム", "砂嵐システム", "sandstorm", "sandstorms"],
      status: "confirmed",
      body: "天候で航路が変わる仕組み。開発中。公開時期は未定。",
      source: { label: "【架空】開発ボード 2026-10", url: "", note: "" },
      details: { featureStatus: "in_development" } as Entry["details"],
    }),
    entry({
      id: "ent_s_feat_guild",
      kind: "feature",
      title: "ギルド",
      aliases: ["ギルド機能", "guild", "guilds"],
      status: "confirmed",
      body: "構想段階。仕様は未定。",
      source: { label: "【架空】開発ボード 2026-10", url: "", note: "" },
      details: { featureStatus: "concept" } as Entry["details"],
    }),
    entry({
      id: "ent_s_feat_market",
      kind: "feature",
      title: "オークションハウス",
      aliases: ["旧マーケット"],
      status: "confirmed",
      body: "中止。取引提案に統合した。",
      source: { label: "【架空】開発ボード 2026-08", url: "", note: "" },
      details: { featureStatus: "cancelled" } as Entry["details"],
    }),
    entry({
      id: "ent_s_claim_testers",
      kind: "claim",
      title: "第1回クローズドテスト参加者数",
      aliases: ["参加者120名", "120名"],
      status: "confirmed",
      body: "第1回クローズドテストの参加者は120名（2026-09-30 終了時点）。",
      source: { label: "【架空】社内集計シート", url: "", note: "" },
      details: { claimType: "metric", value: "120名", evidenceNote: "社内集計シート 2026-09-30 時点", verifiedAt: "2026-09-30" } as Entry["details"],
    }),
    entry({
      id: "ent_s_claim_contest",
      kind: "claim",
      title: "インディーゲームコンテスト入賞",
      aliases: ["入賞"],
      status: "proposed",
      body: "噂レベル。結果は未発表。根拠なし。",
      source: { label: "【架空】口頭", url: "", note: "" },
      details: { claimType: "award" } as Entry["details"],
    }),
    entry({
      id: "ent_s_notice_ct2",
      kind: "notice",
      title: "第2回クローズドテスト募集",
      aliases: ["第2回クローズドテスト", "第2回テスト"],
      status: "confirmed",
      body: "第2回クローズドテストの参加者を募集する。",
      source: { label: "【架空】募集要項 2026-10", url: "https://example.com/saltroad/apply", note: "" },
      details: {
        period: "2026-11-10〜2026-11-24",
        howToJoin: "応募フォーム https://example.com/saltroad/apply から応募",
        conditions: "PCのみ。先着200名。参加無料。テスト中の成果は正式版に引き継がれません。",
      } as Entry["details"],
    }),
  ];
}

const SAMPLE_DEFAULTS = { emoji: "none", maxEmoji: 0, maxHashtags: 1, hashtags: ["#塩の街道"], cta: "none", ctaText: "" } as const;

function post(p: Partial<Post> & Pick<Post, "id" | "type" | "title" | "status">): Post {
  return Post.parse({ projectId: SAMPLE_PROJECT_ID, createdAt: T0, updatedAt: T0, options: { ...SAMPLE_DEFAULTS, hashtags: [...SAMPLE_DEFAULTS.hashtags] }, ...p });
}

export function buildSamplePosts(): Post[] {
  return [
    post({
      id: "pst_s_story1",
      type: "story",
      title: "ミズハ到着",
      status: "posted",
      brief: { purpose: "世界の空気を伝える", audience: "戦略ゲーム好き", factIds: [], canonIds: ["ent_s_chr_minato", "ent_s_term_toudai"], assetIds: [], continuesPostIds: [], seriesName: "七番隊の日誌", language: "ja", voice: "in_world", notes: "" },
      drafts: [
        {
          id: "drf_s_story1",
          createdAt: "2026-10-01T00:00:00.000Z",
          origin: "manual",
          generator: "",
          language: "ja",
          creativeNotes: "井戸の数・水の値段は投稿で新たに確立した（出来事として登録済み）。",
          segments: [
            {
              id: "seg_s_story1",
              voice: "in_world",
              text: "塩暦212年40日目。七番隊は灯台町ミズハに着いた。井戸は三つ、うち二つは塩で塞がっていた。水の値段は塩札四枚。——記録係ミナト\n※開発中の交易戦略ゲーム『塩の街道』より",
              jaGloss: "",
              assetIds: [],
              provenance: [],
            },
          ],
        },
      ],
      currentDraftId: "drf_s_story1",
      decisions: [{ kind: "approved", reason: "数字と地名が具体的。※行で文脈が伝わる。", tags: ["具体的"], draftId: "drf_s_story1", at: "2026-10-01T01:00:00.000Z", acknowledgements: [] }],
      publication: {
        url: "https://x.com/example_sample/status/1000000000000000001",
        segmentUrls: [],
        postedAt: "2026-10-01T12:00:00.000Z",
        recordedAt: "2026-10-01T12:05:00.000Z",
        verification: "manual",
        postedText: "",
        metrics: [{ at: "2026-10-03T00:00:00.000Z", impressions: 4200, likes: 96, reposts: 14, replies: 5, quotes: 2, bookmarks: 21, note: "サンプル値", source: "manual" }],
        retro: "日誌形式は反応が良い。※行からプロフィールへの流入があった（サンプル）。",
      },
    }),
    post({
      id: "pst_s_dev1",
      type: "devlog",
      title: "取引提案を実装",
      status: "posted",
      brief: { purpose: "実装した機能を伝える", audience: "テスト参加者・戦略ゲーム好き", factIds: ["ent_s_feat_trade"], canonIds: [], assetIds: [], continuesPostIds: [], seriesName: "", language: "ja", voice: "developer", notes: "" },
      drafts: [
        {
          id: "drf_s_dev1",
          createdAt: "2026-10-05T00:00:00.000Z",
          origin: "manual",
          generator: "",
          language: "ja",
          creativeNotes: "",
          segments: [
            {
              id: "seg_s_dev1",
              voice: "developer",
              text: "【開発メモ】v0.3 で「取引提案」を実装しました。他のキャラバンに、塩札と物資の交換を持ちかけられます。相手は断ることも、条件を変えて返すこともできます。#塩の街道",
              jaGloss: "",
              assetIds: [],
              provenance: [],
            },
          ],
        },
      ],
      currentDraftId: "drf_s_dev1",
      decisions: [{ kind: "approved", reason: "実装済みの事実だけを書いている。", tags: [], draftId: "drf_s_dev1", at: "2026-10-05T01:00:00.000Z", acknowledgements: [] }],
      publication: {
        url: "https://x.com/example_sample/status/1000000000000000002",
        segmentUrls: [],
        postedAt: "2026-10-06T12:00:00.000Z",
        recordedAt: "2026-10-06T12:03:00.000Z",
        verification: "manual",
        postedText: "",
        metrics: [{ at: "2026-10-08T00:00:00.000Z", impressions: 2800, likes: 41, reposts: 9, replies: 7, quotes: 0, bookmarks: 6, note: "サンプル値", source: "manual" }],
        retro: "仕組みの説明は反応が控えめ。画像があると良さそう（サンプル）。",
      },
    }),
    post({
      id: "pst_s_recruit",
      type: "recruit",
      title: "第2回クローズドテスト募集",
      status: "approved",
      brief: { purpose: "第2回テストの参加者を集める", audience: "戦略ゲーム好き", factIds: ["ent_s_notice_ct2"], canonIds: [], assetIds: [], continuesPostIds: [], seriesName: "", language: "ja", voice: "developer", notes: "" },
      options: { ...SAMPLE_DEFAULTS, hashtags: [...SAMPLE_DEFAULTS.hashtags], cta: "explicit", ctaText: "応募はこちら" },
      drafts: [
        {
          id: "drf_s_recruit",
          createdAt: "2026-10-21T00:00:00.000Z",
          origin: "manual",
          generator: "",
          language: "ja",
          creativeNotes: "",
          segments: [
            {
              id: "seg_s_recruit",
              voice: "developer",
              text: "『塩の街道』第2回クローズドテストの参加者を募集します。\n期間：11/10〜11/24\n条件：PCのみ・先着200名・参加無料（テスト中の成果は正式版に引き継がれません）\n応募はこちら https://example.com/saltroad/apply",
              jaGloss: "",
              assetIds: [],
              provenance: [],
            },
          ],
        },
      ],
      currentDraftId: "drf_s_recruit",
      decisions: [{ kind: "approved", reason: "告知情報どおりの条件だけを書いている。", tags: [], draftId: "drf_s_recruit", at: "2026-10-21T01:00:00.000Z", acknowledgements: [] }],
      scheduleCandidate: "2026-11-03T19:00",
    }),
    post({
      id: "pst_s_bad1",
      type: "devlog",
      title: "【検査デモ】問題の多い下書き",
      status: "drafting",
      brief: { purpose: "検査機能のデモ（わざと問題を含めています）", audience: "", factIds: [], canonIds: [], assetIds: [], continuesPostIds: [], seriesName: "", language: "ja", voice: "developer", notes: "" },
      drafts: [
        {
          id: "drf_s_bad1",
          createdAt: "2026-10-20T00:00:00.000Z",
          origin: "manual",
          generator: "",
          language: "ja",
          creativeNotes: "",
          segments: [
            {
              id: "seg_s_bad1",
              voice: "developer",
              text: "砂嵐システムを実装しました！コンテストで入賞し、プレイヤーからは「最高の交易ゲーム」との声も。塩貨で遊べる、ゲームの未来を革命する体験🚀🚀🚀 #web3 #GameFi #NFT",
              jaGloss: "",
              assetIds: [],
              provenance: [],
            },
          ],
        },
      ],
      currentDraftId: "drf_s_bad1",
    }),
  ];
}

export function buildSampleLearnings(): Learning[] {
  return [
    Learning.parse({
      id: "lrn_s_1",
      projectId: SAMPLE_PROJECT_ID,
      kind: "dont",
      text: "「ゲームの未来」のような抽象的な宣伝文句で締めない",
      pattern: "ゲームの未来",
      origin: "rejection",
      postId: "",
      active: true,
      createdAt: T0,
    }),
    Learning.parse({
      id: "lrn_s_2",
      projectId: SAMPLE_PROJECT_ID,
      kind: "do",
      text: "物語投稿は最後に「※開発中の〜より」の一行を添えると初見の人に伝わる",
      pattern: "",
      origin: "retro",
      postId: "pst_s_story1",
      active: true,
      createdAt: T0,
    }),
  ];
}

export function buildSampleBundle(): ProjectBundle {
  return ProjectBundle.parse({
    format: "lore-post-studio/project",
    schemaVersion: SCHEMA_VERSION,
    exportedAt: T0,
    project: {
      id: SAMPLE_PROJECT_ID,
      name: "【サンプル・架空】塩の街道 / Salt Road",
      kind: "sample",
      description:
        "開発・検証用の架空のゲームです。実在の作品とは関係ありません。Wylls の設定とは完全に別のプロジェクトとして保存されます。",
      createdAt: T0,
      updatedAt: T0,
      settings: ProjectSettings.parse({
        identityAnchors: ["塩の街道", "Salt Road"],
        oneLiner: "干上がった海を渡る交易キャラバンの戦略ゲーム（架空のサンプル）",
        officialDomains: ["example.com"],
        defaults: { ...SAMPLE_DEFAULTS, hashtags: [...SAMPLE_DEFAULTS.hashtags] },
      }),
    },
    entries: buildSampleEntries(),
    assets: [],
    posts: buildSamplePosts(),
    learnings: buildSampleLearnings(),
    sendLog: [],
  });
}

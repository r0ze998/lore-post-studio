/**
 * 検査に使う語彙。日本語・英語の代表的な言い回しだけを収録している。
 * 言い換えや婉曲表現は拾えないことがある（catalog.ts の「見逃し得る範囲」を参照）。
 */

/** 逃げの宣伝文句（既定）。プロジェクト設定で追加・無効化できる。 */
export const DEFAULT_BANNED_PHRASES = [
  "未来",
  "革命",
  "革新的",
  "所有",
  "真の所有",
  "新時代",
  "次世代",
  "ゲームチェンジャー",
  "唯一無二",
  "圧倒的",
  "史上初",
  "世界初",
  "パラダイム",
  "民主化",
  "最高の",
  "revolution",
  "revolutionary",
  "revolutionize",
  "future of gaming",
  "game-changer",
  "game changer",
  "true ownership",
  "own your",
  "unleash",
  "next-gen",
  "groundbreaking",
  "unprecedented",
  "paradigm",
  "to the moon",
];

/** 世界内の語りに混ざると世界観が壊れやすい、開発者・現実側の語（既定）。 */
export const DEFAULT_DEVELOPER_MARKERS = [
  "実装",
  "アップデート",
  "パッチ",
  "リリース",
  "バージョン",
  "テスト",
  "β版",
  "ベータ",
  "バグ",
  "不具合",
  "開発",
  "運営",
  "ウォレット",
  "ガス代",
  "トークン",
  "NFT",
  "ブロックチェーン",
  "オンチェーン",
  "コントラクト",
  "Discord",
  "フォロー",
  "リポスト",
  "応募",
  "サーバー",
  "メンテナンス",
  "プレイヤー",
  "ユーザー",
  "ログイン",
  "update",
  "patch",
  "release",
  "beta",
  "wallet",
  "gas fee",
  "token",
  "blockchain",
  "onchain",
  "on-chain",
  "smart contract",
  "devlog",
  "players",
  "follow us",
];

/** 「もう使える」と断定する言い回し。 */
export const ASSERT_AVAILABLE =
  /(実装しました|実装済み|実装されました|追加しました|追加されました|搭載しました|対応しました|遊べます|遊べるようになりました|使えます|使えるようになりました|利用できます|できるようになりました|登場しました|リリースしました|公開しました|配信開始|解禁|開放しました|now live|is live|are live|available now|now available|you can now|we (?:added|shipped|launched|released)|(?:has|have) (?:been )?(?:added|launched|released|shipped)|out now|ships? today)/iu;

/** 予定・開発中であることを示す言い回し。 */
export const HEDGE_FUTURE =
  /(開発中|予定|検討|構想|準備中|計画|試作|試験|目指|したい|するかもしれ|未定|いずれ|今後|coming soon|coming|planned|planning|in development|in progress|work in progress|wip|prototype|exploring|someday|eventually|we hope|we plan|will be)/iu;

export const TEST_WORDS = /(テスト|β|ベータ|試験|test|beta|playtest)/iu;
export const CANCEL_WORDS = /(中止|取りやめ|見送|廃止|やめ|cancel|dropped|discontinued|scrapped)/iu;

/** 実績の種類ごとの言い回し。 */
export const CLAIM_PATTERNS: { type: "award" | "partnership" | "prize" | "metric"; re: RegExp; label: string }[] = [
  { type: "award", label: "受賞・選出", re: /(受賞|入賞|優勝|ノミネート|選出|グランプリ|最優秀|awarded|award-winning|\bwon\b|\bwinner\b|finalist|nominated|selected for)/iu },
  {
    type: "partnership",
    label: "提携・出資",
    re: /(提携|パートナーシップ|協業|コラボレーション|業務提携|出資|資金調達|partnership|partnered|in partnership|backed by|supported by|funded by|raised \$)/iu,
  },
  {
    type: "prize",
    label: "賞金・報酬額",
    re: /(賞金|報酬総額|総額\s*[\d０-９]|プライズ|prize|reward pool|[$＄]\s?[\d０-９][\d,.]*|[\d][\d,.]*\s?(?:USD|USDC|ドル|万円|円|ETH|STRK))/iu,
  },
  {
    type: "metric",
    label: "利用者数などの数値",
    re: /([\d０-９][\d,.０-９]*\s*(?:万|千)?\s*(?:人|名|ユーザー|プレイヤー|DL|ダウンロード|ウォレット|users?\b|players?\b|wallets?\b|downloads?\b|testers?\b|participants?\b|signups?\b)|(?:DAU|MAU|登録者数?|利用者数?|参加者数?|プレイヤー数|ユーザー数)[^。\n]{0,8}[\d０-９])/iu,
  },
];

/** ユーザーの声・評判として書かれていそうな言い回し。 */
export const TESTIMONIAL_SUBJECT =
  /(プレイヤー|ユーザー|テスター|参加者|ファン|コミュニティ|皆さん|みなさん|お客様|players?|users?|testers?|fans?|community|reviewers?)/iu;
export const TESTIMONIAL_VERB =
  /(から(?:は|も)?[^。\n]{0,20}(?:声|感想|評価)|の声|の感想|曰く|いわく|と(?:言|い)って|と話|と絶賛|says?|said|told us|loved?|praised|called it|describe[sd]? it)/iu;
export const REPUTATION_HYPE = /(大好評|絶賛|話題沸騰|話題の|口コミで|高評価|★{3,}|☆{3,}|five[- ]star|rave reviews|fan favorite|fan-favorite|beloved by|everyone loves)/iu;

/** 実在のプレイヤー行動を語っていそうな言い回し。 */
export const PLAYER_ANECDOTE =
  /(あるプレイヤー|一人のプレイヤー|プレイヤーの(?:一人|ひとり)|あるテスター|テスターの(?:一人|ひとり)|あるユーザー|参加者の(?:一人|ひとり)|one player|a player|one of our players|one tester|a tester|one user|a user)[^。\n]{0,40}(した|ました|ていた|でした|だった|た。|did|built|found|discovered|managed|traded|made|became)/iu;

/** 現実のサービス提供に関する約束（世界内の語りと分ける）。 */
export const REAL_PROMISE =
  /(報酬|配布|エアドロップ|無料|保証|必ず(?:もらえ|手に入|稼)|稼げ|儲か|獲得できます|もらえます|当選|プレゼント|特典|先着|プレセール|ホワイトリスト|airdrop|rewards?\b|\bearn\b|guaranteed|free mint|giveaway|whitelist|allowlist|presale)/iu;

/** 行動を促す言い回し（CTA）。 */
export const CTA_PATTERN =
  /(フォロー(?:して|お願い|よろしく)|RT(?:して|お願い)|リポスト(?:して|お願い)|いいね(?:して|お願い)|今すぐ|チェックして|詳細はこちら|応募はこちら|プロフィールのリンク|リンクから|ぜひ(?:参加|遊んで|チェック|応募)|follow us|follow for|retweet|\brepost\b|like and|check (?:it )?out|join (?:now|us)|sign up|link in bio|don't miss|apply now|register now)/iu;

/** 抽象語（具体のない「詩」になっていないかの目安）。 */
export const ABSTRACT_WORDS = [
  "運命",
  "永遠",
  "希望",
  "絶望",
  "光",
  "闇",
  "魂",
  "記憶",
  "夢",
  "祈り",
  "奇跡",
  "物語",
  "世界",
  "未来",
  "真実",
  "無限",
  "静寂",
  "虚無",
  "宿命",
  "囁き",
  "彼方",
  "深淵",
  "星々",
  "終焉",
  "始まり",
  "終わり",
  "約束",
  "想い",
  "destiny",
  "eternal",
  "eternity",
  "hope",
  "light",
  "darkness",
  "soul",
  "memory",
  "memories",
  "dream",
  "dreams",
  "fate",
  "infinite",
  "whisper",
  "abyss",
  "echo",
  "echoes",
  "void",
  "truth",
  "legend",
  "journey",
  "beyond",
];

export const PLACEHOLDER = /(［[^］\n]*］|\[\[[^\]\n]*\]\]|【要[^】\n]*】|\bTODO\b|\bTBD\b|XXX|〇〇|○○)/gu;

/** 世界内の語りの中で「現実側の注記」として扱う行の接頭辞。 */
export const FRAME_LINE_PREFIX = /^\s*(※|\(注\)|（注）|\[注\]|Note:)/u;

export const JA_CHAR = /[぀-ヿ㐀-鿿]/gu;
export const HAS_JA = /[぀-ヿ㐀-鿿]/u;

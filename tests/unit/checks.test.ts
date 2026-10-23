/**
 * 架空プロジェクト「塩の街道」を使った整合性チェックのテスト。
 * 「検出できること」と「既知の見逃し（検出できないこと）」の両方を固定する。
 */
import { describe, expect, it } from "vitest";
import { check, find, has, rules, sampleCtx } from "./helpers";
import { runChecks } from "@/lib/checks/engine";

const FRAME = "\n※開発中の交易戦略ゲーム『塩の街道』より";

describe("良い投稿は止めない", () => {
  it("良い例どおりの物語投稿には要修正が出ない", () => {
    const r = check([{ voice: "in_world", text: "塩暦212年43日目。潮読みのセンが、塩原の割れ目を三つ数えた。今夜は灯台町の手前で止まる。——記録係ミナト" + FRAME }], { type: "story" });
    expect(r.counts.error, rules(r).join(",")).toBe(0);
    expect(has(r, "voice-mixing")).toBe(false);
  });

  it("実装済みの機能を事実どおりに書いた開発投稿は止めない", () => {
    const r = check([{ text: "【開発メモ】『塩の街道』v0.3 の取引提案に、条件を変えて返す操作を加えました。" }]);
    expect(find(r, "feature-assertion")).toHaveLength(0);
    expect(r.counts.error, rules(r).join(",")).toBe(0);
  });
});

describe("サンプルの承認済み投稿", () => {
  it("承認済み・投稿済みのサンプル投稿には要修正がない", () => {
    const ctx = sampleCtx();
    for (const p of ctx.posts.filter((x) => x.status === "approved" || x.status === "posted")) {
      const r = runChecks(ctx, p, p.drafts[0]);
      expect(r.counts.error, `${p.id}: ${rules(r).join(",")}`).toBe(0);
    }
  });
});

describe("設定矛盾", () => {
  it("登録した矛盾パターン（白海が100年前に干上がった）を検出し、参照設定を示す", () => {
    const r = check([{ voice: "in_world", text: "白海が干上がったのは百年前のことだ。" + FRAME }], { type: "story" });
    const f = find(r, "contradiction");
    expect(f).toHaveLength(1);
    expect(f[0].severity).toBe("error");
    expect(f[0].refs[0].id).toBe("ent_s_lore_dry");
    expect(f[0].message).toContain("300年前");
    expect(f[0].ranges[0].start).toBeGreaterThanOrEqual(0);
  });

  it("キャラクター設定の矛盾（センが海を見た）を検出する", () => {
    const r = check([{ voice: "in_world", text: "センは若いころ、水のある海を見たと言った。" + FRAME }], { type: "story" });
    expect(find(r, "contradiction")[0]?.refs[0].id).toBe("ent_s_chr_sen");
  });

  it("数値の食い違い（ミズハの井戸は三つ → 五つ）を目安として知らせる", () => {
    const r = check([{ voice: "in_world", text: "ミズハには井戸が五つある。" + FRAME }], { type: "story" });
    const f = find(r, "number-mismatch");
    expect(f).toHaveLength(1);
    expect(f[0].severity).toBe("warning");
    expect(f[0].refs[0].id).toBe("ent_s_evt_mizuha");
  });

  it("【既知の見逃し】言い換えた矛盾（『海が消えたのはつい最近』）は検出できない", () => {
    const r = check([{ voice: "in_world", text: "白海から水が消えたのは、つい最近のことだ。" + FRAME }], { type: "story" });
    expect(has(r, "contradiction")).toBe(false);
    expect(has(r, "number-mismatch")).toBe(false);
  });

  it("【既知の見逃し】名前を出さない矛盾（『老いた潮読みが泳いだ』）は検出できない", () => {
    const r = check([{ voice: "in_world", text: "七番隊の老いた潮読みは、昔は毎日泳いでいた。" + FRAME }], { type: "story" });
    expect(has(r, "contradiction")).toBe(false);
  });
});

describe("廃止設定・未確定設定・未公開情報", () => {
  it("廃止した用語（塩貨）を止め、置き換え先（塩札）を示す", () => {
    const r = check([{ voice: "in_world", text: "水は塩貨四枚で買えた。" + FRAME }], { type: "story" });
    const f = find(r, "deprecated-canon");
    expect(f).toHaveLength(1);
    expect(f[0].severity).toBe("error");
    expect(f[0].refs.map((x) => x.id)).toEqual(["ent_s_term_enka", "ent_s_term_shiofuda"]);
    expect(f[0].suggestion).toContain("塩札");
  });

  it("英語の別名（enka）でも廃止を検出する", () => {
    const r = check([{ voice: "in_world", text: "Water cost four enka at Mizuha.", jaGloss: "ミズハでは水が塩貨4枚だった。" }], { type: "story", language: "en" });
    expect(has(r, "deprecated-canon", "error")).toBe(true);
  });

  it("未公開のキャラクター（ルカ）を止める", () => {
    const r = check([{ voice: "in_world", text: "交易商ルカが灯台町に現れた。" + FRAME }], { type: "story" });
    expect(has(r, "internal-info", "error")).toBe(true);
    expect(has(r, "proposed-canon")).toBe(true);
  });

  it("用語の誤表記（ハクカイ）を正しい表記つきで止める", () => {
    const r = check([{ voice: "in_world", text: "ハクカイを渡る。" + FRAME }], { type: "story" });
    const f = find(r, "term-variant");
    expect(f[0].suggestion).toContain("白海");
  });
});

describe("未実装機能の断定", () => {
  it("開発中の機能（砂嵐）を「実装しました」と書くと止める", () => {
    const r = check([{ text: "『塩の街道』に砂嵐を実装しました。航路が天候で変わります。" }]);
    const f = find(r, "feature-assertion");
    expect(f).toHaveLength(1);
    expect(f[0].severity).toBe("error");
    expect(f[0].refs[0].id).toBe("ent_s_feat_storm");
    expect(f[0].refs[0].detail).toContain("開発中");
  });

  it("開発中と明記していれば止めない", () => {
    const r = check([{ text: "『塩の街道』では砂嵐を開発中です。公開時期は未定です。" }]);
    expect(has(r, "feature-assertion")).toBe(false);
  });

  it("構想段階の機能（ギルド）を英語で断定しても止める", () => {
    const r = check([{ text: "Guilds are now live in Salt Road.", jaGloss: "ギルドが公開された。" }], { language: "en" });
    expect(has(r, "feature-assertion", "error")).toBe(true);
  });

  it("中止した機能（オークションハウス）への言及を止める", () => {
    const r = check([{ text: "『塩の街道』のオークションハウスで交易しよう。" }]);
    expect(has(r, "feature-assertion", "error")).toBe(true);
  });

  it("台帳にない機能の実装告知は確認を促す", () => {
    const r = check([{ text: "『塩の街道』に釣りを実装しました。" }]);
    expect(has(r, "unregistered-release", "warning")).toBe(true);
  });

  it("【既知の見逃し】登録外の言い回し（『もう触れます』）での断定は検出できない", () => {
    const r = check([{ text: "『塩の街道』の砂嵐、もう触れます。" }]);
    expect(has(r, "feature-assertion")).toBe(false);
  });
});

describe("架空の実績・存在しない声", () => {
  it("根拠のない受賞（提案段階の実績）を止め、関連する実績を示す", () => {
    const r = check([{ text: "『塩の街道』がインディーゲームコンテストで入賞しました。" }]);
    const f = find(r, "claim-evidence");
    expect(f[0].severity).toBe("error");
    expect(f[0].refs[0]?.id).toBe("ent_s_claim_contest");
    expect(f[0].message).toContain("提案段階");
  });

  it("根拠のある参加者数（120名）は止めない", () => {
    const r = check([{ text: "『塩の街道』第1回クローズドテストには120名が参加しました。" }]);
    expect(has(r, "claim-evidence")).toBe(false);
  });

  it("根拠のない参加者数（5,000人）は止める", () => {
    const r = check([{ text: "『塩の街道』はすでに5,000人が遊んでいます。" }]);
    expect(has(r, "claim-evidence", "error")).toBe(true);
  });

  it("根拠のない提携・賞金を止める", () => {
    const r1 = check([{ text: "『塩の街道』は大手スタジオと提携しました。" }]);
    expect(has(r1, "claim-evidence", "error")).toBe(true);
    const r2 = check([{ text: "『塩の街道』大会の賞金は総額100万円です。" }]);
    expect(has(r2, "claim-evidence", "error")).toBe(true);
  });

  it("存在しないユーザーの声・評判の誇張を止める", () => {
    const r = check([{ text: "『塩の街道』のテスターからは「最高の交易ゲーム」との声も。" }]);
    expect(has(r, "testimonial", "error")).toBe(true);
    const r2 = check([{ text: "『塩の街道』は大好評をいただいています。" }]);
    expect(has(r2, "testimonial", "error")).toBe(true);
  });

  it("実話風のプレイヤー行動は確認を促す", () => {
    const r = check([{ text: "『塩の街道』のテストで、あるプレイヤーは塩札だけで隊を三つ雇いました。" }]);
    expect(has(r, "player-anecdote", "warning")).toBe(true);
  });

  it("題名の『』や「ゲーム名」だけの括弧は声の引用として扱わない", () => {
    const r = check([{ text: "『塩の街道』第2回クローズドテストの参加者を募集しています。「塩の街道」のテスト版です。" }], { type: "recruit", brief: { factIds: ["ent_s_notice_ct2"] } });
    expect(has(r, "testimonial")).toBe(false);
  });

  it("同じ募集の承認済み投稿があれば重複として知らせる", () => {
    const r = check([{ text: "『塩の街道』第2回クローズドテストの参加者を募集します。\n期間：11/10〜11/24\n条件：PCのみ・先着200名・参加無料\n応募はこちら https://example.com/saltroad/apply" }], { type: "recruit", brief: { factIds: ["ent_s_notice_ct2"] }, options: { cta: "explicit" } });
    expect(find(r, "duplicate")[0]?.refs[0].id).toBe("pst_s_recruit");
  });

  it("世界内の語りで作中人物が話すのは声として扱わない", () => {
    const r = check([{ voice: "in_world", text: "センは「今夜は進まない」と言った。" + FRAME }], { type: "story" });
    expect(has(r, "testimonial")).toBe(false);
  });

  it("【既知の見逃し】数字も定型句もない誇張（『多くの方に遊んでいただき』）は検出できない", () => {
    const r = check([{ text: "『塩の街道』は多くの方に遊んでいただいています。" }]);
    expect(has(r, "claim-evidence")).toBe(false);
    expect(has(r, "testimonial")).toBe(false);
  });
});

describe("重複投稿", () => {
  it("投稿済みの物語とほぼ同じ本文を止め、元の投稿と共通部分を示す", () => {
    const r = check(
      [{ voice: "in_world", text: "塩暦212年40日目。七番隊は灯台町ミズハに着いた。井戸は三つ、うち二つは塩で塞がっていた。水の値段は塩札五枚。——記録係ミナト" + FRAME }],
      { type: "story" },
    );
    const f = find(r, "duplicate");
    expect(f[0].severity).toBe("error");
    expect(f[0].refs[0].id).toBe("pst_s_story1");
    expect(f[0].message).toContain("共通部分");
  });

  it("共通の※注記行だけが同じなら重複にしない", () => {
    const r = check([{ voice: "in_world", text: "塩暦212年44日目。セン、杭を二本だけ持って先に出る。——記録係ミナト" + FRAME }], { type: "story" });
    expect(has(r, "duplicate", "error")).toBe(false);
    expect(has(r, "duplicate", "warning")).toBe(false);
  });

  it("悪い例に似た投稿を知らせる", () => {
    const r = check([{ text: "ブロックチェーンで未来のゲーム体験を革命！真の所有を🚀" }]);
    expect(has(r, "example-similarity", "warning")).toBe(true);
  });
});

describe("語り手の区別・現実の約束", () => {
  it("世界内の語りに開発者の語・URL が混ざると知らせる", () => {
    const r = check([{ voice: "in_world", text: "塩暦212年45日目。アップデートで砂嵐が来る。https://example.com/saltroad" + FRAME }], { type: "story" });
    const f = find(r, "voice-mixing");
    expect(f).toHaveLength(1);
    expect(f[0].title).toContain("アップデート");
  });

  it("※で始まる注記行の開発者語は混同にしない", () => {
    const r = check([{ voice: "in_world", text: "塩暦212年45日目。風が止んだ。——記録係ミナト\n※『塩の街道』第2回クローズドテストの応募は告知をご覧ください" }], { type: "story" });
    expect(has(r, "voice-mixing")).toBe(false);
  });

  it("世界内の語りに現実の約束（報酬・無料）が混ざると止める", () => {
    const r = check([{ voice: "in_world", text: "灯台町では、旅人に報酬が必ずもらえる。" + FRAME }], { type: "story" });
    expect(has(r, "real-promise", "error")).toBe(true);
  });

  it("作中の「報酬」は要確認にとどめる（現実の約束と断定しない）", () => {
    const r = check([{ voice: "in_world", text: "塩暦212年46日目。案内の報酬は塩札二枚だった。——記録係ミナト" + FRAME }], { type: "story" });
    expect(find(r, "real-promise").map((f) => f.severity)).toEqual(["warning"]);
  });

  it("開発者の語りで世界内の語り手の署名を使うと知らせる", () => {
    const r = check([{ text: "『塩の街道』v0.3 を公開しました。——記録係ミナト" }]);
    expect(find(r, "voice-mixing")[0]?.refs[0]?.id).toBe("ent_s_voice_minato");
  });
});

describe("募集投稿", () => {
  it("告知情報が紐付いていない募集は止める", () => {
    const r = check([{ text: "『塩の街道』テスト参加者を募集します。" }], { type: "recruit", options: { cta: "explicit" } });
    expect(has(r, "recruit-notice", "error")).toBe(true);
  });

  it("告知情報と一致する日付・条件なら止めず、違う日付は知らせる", () => {
    // サンプルには同じ募集の承認済み投稿があるため、重複にならないよう除いた状態で確かめる
    const ctx = sampleCtx();
    ctx.posts = ctx.posts.filter((p) => p.id !== "pst_s_recruit");
    const ok = check([{ text: "『塩の街道』第2回クローズドテスト：11/10〜11/24。PCのみ、先着200名、参加無料。応募はこちら https://example.com/saltroad/apply" }], {
      type: "recruit",
      brief: { factIds: ["ent_s_notice_ct2"] },
      options: { cta: "explicit" },
    }, ctx);
    expect(ok.counts.error, rules(ok).join(",")).toBe(0);
    expect(has(ok, "recruit-notice")).toBe(false);
    expect(has(ok, "real-promise")).toBe(false);
    const bad = check([{ text: "『塩の街道』第2回クローズドテスト：11/12〜11/24。" }], { type: "recruit", brief: { factIds: ["ent_s_notice_ct2"] } });
    expect(find(bad, "recruit-notice")[0]?.title).toContain("11/12");
  });

  it("告知にない約束（報酬）を知らせる", () => {
    const r = check([{ text: "『塩の街道』第2回クローズドテスト参加者には報酬があります。" }], { type: "recruit", brief: { factIds: ["ent_s_notice_ct2"] } });
    expect(has(r, "real-promise", "warning")).toBe(true);
  });
});

describe("表現の調整", () => {
  it("宣伝文句・絵文字・ハッシュタグ・学びを知らせる（サンプルの問題下書き）", () => {
    const ctx = sampleCtx();
    const bad = ctx.posts.find((p) => p.id === "pst_s_bad1")!;
    const r = runChecks(ctx, bad, bad.drafts[0]);
    const ids = new Set(r.findings.map((f) => f.ruleId));
    for (const id of ["feature-assertion", "claim-evidence", "testimonial", "deprecated-canon", "banned-phrase", "emoji", "hashtag", "learning", "context-anchor"]) {
      expect(ids.has(id as never), `${id} in ${[...ids].join(",")}`).toBe(true);
    }
  });

  it("抽象語だけの投稿を知らせる", () => {
    const r = check([{ voice: "in_world", text: "光と闇のあいだで、運命は静かに記憶を呼ぶ。" }], { type: "story" });
    expect(has(r, "abstract-only", "warning")).toBe(true);
  });

  it("絵文字「少し」の上限は設定どおり", () => {
    const r = check([{ text: "『塩の街道』v0.3 の取引提案を公開しました🧂" }], { options: { emoji: "few", maxEmoji: 1 } });
    expect(has(r, "emoji")).toBe(false);
    const r2 = check([{ text: "『塩の街道』v0.3 の取引提案を公開しました🧂🧂" }], { options: { emoji: "few", maxEmoji: 1 } });
    expect(has(r2, "emoji")).toBe(true);
  });

  it("CTA「なし」の投稿の呼びかけを知らせる", () => {
    const r = check([{ text: "『塩の街道』の取引提案、ぜひチェックしてください。フォローお願いします。" }]);
    expect(has(r, "cta", "warning")).toBe(true);
  });

  it("公式ドメイン外の URL を知らせる", () => {
    const r = check([{ text: "『塩の街道』詳細 https://bit.ly/xyz" }]);
    expect(has(r, "url", "warning")).toBe(true);
  });

  it("穴埋めが残っていれば止める", () => {
    const r = check([{ text: "『塩の街道』に［機能名］を追加します。" }]);
    expect(has(r, "placeholder", "error")).toBe(true);
  });
});

describe("文字数（X 公式の数え方）", () => {
  it("日本語 140 字は 280、141 字は超過", () => {
    const r1 = check([{ text: "あ".repeat(140) }]);
    expect(r1.segments[0].weightedLength).toBe(280);
    expect(has(r1, "x-length", "error")).toBe(false);
    const r2 = check([{ text: "あ".repeat(141) }]);
    expect(has(r2, "x-length", "error")).toBe(true);
  });

  it("URL は長さに関係なく 23、絵文字は結合されていても 2", () => {
    const r = check([{ text: "https://example.com/" + "a".repeat(100) }]);
    expect(r.segments[0].weightedLength).toBe(23);
    const r2 = check([{ text: "👨‍👩‍👧‍👦" }]);
    expect(r2.segments[0].weightedLength).toBe(2);
  });

  it("スレッドは投稿ごとに数える", () => {
    const r = check([{ text: "あ".repeat(100) }, { text: "い".repeat(150) }]);
    expect(r.segments.map((s) => s.weightedLength)).toEqual([200, 300]);
    expect(find(r, "x-length").map((f) => f.segmentIndex)).toEqual([1]);
  });
});

describe("英語の下書き", () => {
  it("日本語の意味確認がなければ知らせる", () => {
    const r = check([{ text: "Day 41. Sen drove a stake into the old tide mark. — Minato" }], { language: "en", type: "story" });
    expect(has(r, "gloss", "warning")).toBe(true);
  });
});

describe("根拠マップ", () => {
  it("設定に根拠のある文と、創作（根拠なし）の文を分けて示す", () => {
    const r = check([{ voice: "in_world", text: "潮読みのセンが杭を打った。誰も口をきかなかった。" + FRAME }], { type: "story" });
    const p = r.provenance;
    expect(p[0].basis).toBe("canon");
    expect(p[0].refs.some((x) => x.id === "ent_s_chr_sen")).toBe(true);
    expect(p[1].basis).toBe("invented");
    expect(p[2].basis).toBe("frame");
  });
});

describe("ふつうの文章での誤検出を防ぐ（独立レビューで見つかった例）", () => {
  it("「ファンタジー」「fantasy」「love to hear」はユーザーの声にしない", () => {
    expect(has(check([{ text: "ファンタジーの世界で商人の声を聞く、塩の街道の開発日記です。" }]), "testimonial")).toBe(false);
    expect(has(check([{ text: "Salt Road is a fantasy trading game. We'd love to hear from players!", jaGloss: "塩の街道は交易ゲーム。" }], { language: "en" }), "testimonial")).toBe(false);
  });

  it("価格（金額だけ）は賞金として止めない／賞金の語があれば止める", () => {
    expect(has(check([{ text: "『塩の街道』の価格は1,200円の予定です。" }]), "claim-evidence")).toBe(false);
    expect(has(check([{ text: "『塩の街道』大会の賞金は1,200円です。" }]), "claim-evidence", "error")).toBe(true);
  });

  it("作中の「保証」「井戸の開発」は要修正にしない", () => {
    const r = check([{ voice: "in_world", text: "隊長は無事を保証すると言った。灯台町では井戸の開発が進んでいる。" + FRAME }], { type: "story" });
    expect(r.counts.error, rules(r).join(",")).toBe(0);
    expect(find(r, "voice-mixing").every((f) => f.severity === "info")).toBe(true);
  });

  it("「一つ」「一人」は数値の食い違いにしない", () => {
    const r = check([{ voice: "in_world", text: "ミズハの井戸の一つは涸れていた。" + FRAME }], { type: "story" });
    expect(has(r, "number-mismatch")).toBe(false);
  });
});

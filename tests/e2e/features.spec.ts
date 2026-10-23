import { expect, test } from "@playwright/test";
import { readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import JSZip from "jszip";
import { addEntry, createProject, nav, tab } from "./helpers";

// 1x1 の PNG
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");

test("プロジェクトのエクスポートとインポート（別プロジェクトとして取り込み、元と混ざらない）", async ({ page }, info) => {
  const name = `書き出し元 ${info.project.name} ${Date.now()}`;
  await createProject(page, name);
  await nav(page, "設定（正本）");
  await addEntry(page, { kind: "character", title: "灯守のイオ", body: "港の灯を守る少女。" });
  await addEntry(page, { kind: "lore", title: "霧の港", body: "一年の半分が霧に包まれる。", status: "proposed" });

  await nav(page, "プロジェクト設定");
  const [dl] = await Promise.all([page.waitForEvent("download"), page.getByTestId("export-project").click()]);
  const file = path.join(os.tmpdir(), `export-${Date.now()}.zip`);
  writeFileSync(file, readFileSync(await dl.path()));
  const zip = await JSZip.loadAsync(readFileSync(file));
  const bundle = JSON.parse(await zip.file("project.json")!.async("string"));
  expect(bundle.format).toBe("lore-post-studio/project");
  expect(bundle.entries.map((e: { title: string }) => e.title).sort()).toEqual(["灯守のイオ", "霧の港"]);

  await page.goto("/");
  await page.locator("#imp-mode").selectOption("new");
  await page.getByTestId("import-file").setInputFiles(file);
  await expect(page.getByText("取り込みました")).toBeVisible();
  const imported = page.getByRole("link", { name: new RegExp(`${name}（取り込み）`) });
  await expect(imported).toBeVisible();
  await imported.click();
  await nav(page, "設定（正本）");
  await expect(page.getByTestId("entry-list").getByRole("listitem")).toHaveCount(2);
  // 状態（提案）も保たれる
  await expect(page.getByTestId("entry-list").getByRole("listitem").filter({ hasText: "霧の港" })).toContainText("提案");

  // 不正なファイルは取り込まない
  const bad = path.join(os.tmpdir(), `bad-${Date.now()}.json`);
  writeFileSync(bad, JSON.stringify({ format: "something-else" }));
  await page.goto("/");
  await page.getByTestId("import-file").setInputFiles(bad);
  await expect(page.getByText(/形式が不正/)).toBeVisible();
});

test("資料の一括取り込みは提案になり、矛盾候補は人が選ぶまで統合されない", async ({ page }, info) => {
  await createProject(page, `矛盾 ${info.project.name} ${Date.now()}`);
  await nav(page, "設定（正本）");
  await addEntry(page, { kind: "lore", title: "大灯台", body: "大灯台は北の岬にある。", source: "設定資料 v2" });

  await page.getByRole("button", { name: "資料を取り込む（提案として）" }).click();
  const dlg = page.getByRole("dialog");
  await dlg.locator("#imp-label").fill("旧企画書 v1");
  await dlg.locator("#imp-kind").selectOption("lore");
  await dlg.locator("#imp-text").fill("## 大灯台\n大灯台は南の岬にある。\n\n## 灯守\n灯を守る役目。");
  await dlg.getByRole("button", { name: "2 件を提案として取り込む" }).click();
  await expect(page.getByText("2 件を「提案」として取り込みました")).toBeVisible();
  await expect(page.getByTestId("entry-list").getByRole("listitem").filter({ hasText: "灯守" })).toContainText("提案");

  await page.getByRole("tab", { name: /矛盾候補（1）/ }).click();
  const sides = page.getByTestId("conflict-side");
  await expect(sides).toHaveCount(2);
  await expect(sides.filter({ hasText: "北の岬" })).toContainText("確定");
  await expect(sides.filter({ hasText: "南の岬" })).toContainText("提案");

  page.once("dialog", (d) => d.accept());
  await sides.filter({ hasText: "北の岬" }).getByRole("button", { name: "こちらを採用" }).click();
  await expect(page.getByRole("tab", { name: /矛盾候補（0）/ })).toBeVisible();

  // 廃止された側は履歴付きで残る
  await page.getByRole("tab", { name: /すべて/ }).click();
  await page.getByLabel("状態で絞り込み").selectOption("deprecated");
  const row = page.getByTestId("entry-list").getByRole("listitem");
  await expect(row).toHaveCount(1);
  await row.click();
  await page.getByRole("button", { name: /変更履歴（1）/ }).click();
  await expect(page.getByRole("dialog")).toContainText("南の岬");
  await expect(page.getByRole("dialog")).toContainText("矛盾候補の整理");
});

test("手動中継：送る内容に未公開設定が含まれず、貼り戻した結果が新しい版になる／API 未設定を明示", async ({ page }, info) => {
  await createProject(page, `中継 ${info.project.name} ${Date.now()}`);
  await nav(page, "設定（正本）");
  await addEntry(page, { kind: "character", title: "公開キャラ", body: "公開してよい人物。" });
  await addEntry(page, { kind: "character", title: "秘密キャラ", body: "まだ公開しない人物。", visibility: "internal" });

  await nav(page, "企画ボード");
  await page.getByRole("button", { name: "新しい投稿を企画" }).click();
  await page.getByRole("dialog").locator("#cp-title").fill("中継テスト");
  await page.getByRole("dialog").getByRole("button", { name: "作成して編集へ" }).click();
  await tab(page, "3 下書き");
  const panel = page.getByTestId("generate-draft");

  // Anthropic API はキー未設定なので使えないことが表示される
  await panel.locator("select").selectOption("anthropic");
  await expect(panel).toContainText("ANTHROPIC_API_KEY が未設定");
  await expect(panel.getByRole("button", { name: "送信内容を確認" })).toBeDisabled();

  await panel.locator("select").selectOption("relay");
  await panel.getByRole("button", { name: "送る内容を表示してコピー" }).click();
  const dlg = page.getByRole("dialog");
  await expect(dlg.getByTestId("included-list")).toContainText("公開キャラ");
  await expect(dlg.getByTestId("included-list")).not.toContainText("秘密キャラ");
  await expect(dlg.getByTestId("excluded-list")).toContainText("秘密キャラ — 未公開");
  await dlg.getByRole("button", { name: "全文を表示" }).click();
  await expect(dlg.locator("pre")).not.toContainText("まだ公開しない人物");

  const answer = { segments: [{ text: "公開キャラが港に灯をともした。\n※開発中のゲームより", voice: "in_world", jaGloss: "", provenance: [{ quote: "公開キャラ", basis: "canon", refIds: ["ent_fake"], note: "" }] }], creativeNotes: "灯をともす行動は創作" };
  await dlg.locator("#relay-paste").fill("結果です\n```json\n" + JSON.stringify(answer) + "\n```");
  await dlg.getByRole("button", { name: "貼り戻した結果を取り込む" }).click();
  await expect(page.getByLabel("本文 1")).toHaveValue(/公開キャラが港に灯をともした/);
  await expect(page.locator("#d-notes")).toHaveValue("灯をともす行動は創作");
  // 存在しない参照は外して注記される
  await page.getByText(/生成器が申告した根拠/).click();
  await expect(page.getByText(/存在しない資料IDを参照: ent_fake/)).toBeVisible();

  // 送信記録に手動中継が残る
  await nav(page, "プロジェクト設定");
  await expect(page.getByText("手動中継（貼り戻し）")).toBeVisible();
});

test("素材：アップロード・代替テキスト・添付・zip 書き出し", async ({ page }, info) => {
  await createProject(page, `素材 ${info.project.name} ${Date.now()}`);
  await nav(page, "素材庫");
  const img = path.join(os.tmpdir(), "harbor.png");
  writeFileSync(img, PNG);
  await page.getByTestId("asset-file").setInputFiles(img);
  await expect(page.getByText("1 件を追加しました")).toBeVisible();
  await page.getByTestId("asset-grid").getByRole("button").first().click();
  const dlg = page.getByRole("dialog");
  await dlg.locator("#a-alt").fill("霧の港を見下ろす灯台");
  await dlg.locator("#a-status").selectOption("confirmed");
  await dlg.getByRole("button", { name: "保存", exact: true }).click();
  await expect(page.getByTestId("asset-grid")).not.toContainText("ALT なし");

  await nav(page, "企画ボード");
  await page.getByRole("button", { name: "新しい投稿を企画" }).click();
  await page.getByRole("dialog").locator("#cp-type").selectOption("showcase");
  await page.getByRole("dialog").locator("#cp-title").fill("素材テスト");
  await page.getByRole("dialog").getByRole("button", { name: "作成して編集へ" }).click();
  await tab(page, "3 下書き");
  await page.getByRole("button", { name: "白紙から書く" }).click();
  await page.getByLabel("本文 1").fill("霧の港の灯台。");
  await page.getByRole("button", { name: "素材を添付" }).click();
  await page.getByRole("dialog").getByRole("button", { name: /harbor/ }).click();
  await page.getByRole("dialog").getByRole("button", { name: "完了" }).click();
  if (info.project.name === "mobile") await page.getByRole("button", { name: /プレビュー/ }).click();
  await expect(page.getByTestId("x-preview").locator("img")).toHaveAttribute("alt", "霧の港を見下ろす灯台");
  await page.getByTestId("save-post").click();
  await expect(page.getByTestId("save-post")).toHaveText("保存済み");

  await tab(page, "6 書き出し");
  const [zipDl] = await Promise.all([page.waitForEvent("download"), page.getByRole("link", { name: "本文と素材を zip で保存" }).click()]);
  const zip = await JSZip.loadAsync(readFileSync(await zipDl.path()));
  const names = Object.keys(zip.files);
  expect(names.some((n) => n.startsWith("assets/") && n.endsWith("harbor.png"))).toBe(true);
  expect(await zip.file("alt-text.txt")!.async("string")).toContain("霧の港を見下ろす灯台");
});

test("架空サンプル：問題の多い下書きで各検査が理由と参照付きで表示される", async ({ page }) => {
  await page.goto("/p/sample-saltroad");
  await expect(page.getByTestId("sample-banner")).toBeVisible();
  await page.goto("/p/sample-saltroad/posts/pst_s_bad1");
  await tab(page, "4 検査");
  for (const rule of ["feature-assertion", "claim-evidence", "testimonial", "deprecated-canon"]) {
    await expect(page.locator(`[data-rule="${rule}"][data-severity="error"]`).first()).toBeVisible();
  }
  for (const rule of ["banned-phrase", "emoji", "hashtag", "learning", "context-anchor"]) {
    await expect(page.locator(`[data-rule="${rule}"]`).first()).toBeVisible();
  }
  const f = page.locator('[data-rule="feature-assertion"]').first();
  await expect(f).toContainText("砂嵐");
  await expect(f).toContainText("開発中");
  await f.getByText(/このルールについて/).click();
  await expect(f).toContainText("見逃し得る範囲");

  // 整合性チェック画面で、貼った文章を試せる
  await page.goto("/p/sample-saltroad/checks");
  await page.locator("#ad-voice").selectOption("in_world");
  await page.locator("#ad-type").selectOption("story");
  await page.locator("#ad-text").fill("白海が干上がったのは百年前のことだ。");
  const res = page.getByTestId("adhoc-result");
  await expect(res.locator('[data-rule="contradiction"]')).toContainText("300年前");
});

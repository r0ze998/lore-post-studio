/**
 * 設定登録 → 企画 → 切り口 → 下書き → 編集 → 検査 → 承認 → 書き出し → 投稿記録 → 履歴 → 再読み込み後も保存
 * を、PC とスマホ（エミュレーション）の実ブラウザで通す。外部 API は使わない（テンプレート生成）。
 */
import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";
import JSZip from "jszip";
import { addEntry, createProject, nav, tab } from "./helpers";

test("設定登録から投稿記録まで通す", async ({ page }, info) => {
  const name = `E2E ${info.project.name} ${Date.now()}`;
  await createProject(page, name);

  // ---- プロジェクト設定：識別語
  await nav(page, "プロジェクト設定");
  await page.locator("#s-anchors").fill("霧灯の港");
  await page.getByRole("button", { name: "保存", exact: true }).first().click();
  await expect(page.getByText("保存しました")).toBeVisible();

  // ---- 設定（正本）の登録
  await nav(page, "設定（正本）");
  await addEntry(page, { kind: "term", title: "霧灯", body: "港の霧の中で灯る合図の灯。", variants: "霧の灯" });
  await addEntry(page, { kind: "term", title: "旧灯台札", status: "deprecated", body: "旧称。使わない。" });
  await addEntry(page, { kind: "feature", title: "交換所", body: "物資を交換する場所。", featureStatus: "in_development" });
  // 状態の絞り込み
  await page.getByLabel("状態で絞り込み").selectOption("deprecated");
  await expect(page.getByTestId("entry-list").getByRole("listitem")).toHaveCount(1);
  await page.getByLabel("状態で絞り込み").selectOption("");

  // ---- 企画
  await nav(page, "企画ボード");
  await page.getByRole("button", { name: "新しい投稿を企画" }).click();
  const dlg = page.getByRole("dialog");
  await dlg.locator("#cp-type").selectOption("devlog");
  await dlg.locator("#cp-title").fill("交換所の進捗");
  await dlg.locator("#cp-purpose").fill("開発中の交換所を正直に伝える");
  await dlg.getByRole("button", { name: "作成して編集へ" }).click();
  await expect(page.getByTestId("post-title")).toHaveText("交換所の進捗");
  await page.getByRole("checkbox", { name: /交換所/ }).check();

  // ---- 切り口（テンプレート・API 不要）
  await tab(page, "2 切り口");
  await page.getByTestId("generate-angles").getByRole("button", { name: "切り口を提案" }).click();
  await expect(page.getByTestId("angle-list").getByRole("listitem")).toHaveCount(3);
  await page.getByTestId("angle-list").getByRole("radio").first().check();

  // ---- 下書き（テンプレート）
  await tab(page, "3 下書き");
  await page.getByTestId("generate-draft").getByRole("button", { name: "下書きを作成" }).click();
  const body = page.getByLabel("本文 1");
  await expect(body).toHaveValue(/「交換所」を開発中です/);

  // ---- 検査：穴埋めが残っている
  await tab(page, "4 検査");
  await expect(page.locator('[data-rule="placeholder"][data-severity="error"]').first()).toBeVisible();

  // ---- 編集：わざと未実装の断定と廃止語を入れる → 検査で止まる
  await tab(page, "3 下書き");
  await body.fill("『霧灯の港』に交換所を実装しました。旧灯台札で取引できます。");
  await expect(page.getByTestId("char-count")).toContainText("/ 280");
  await tab(page, "4 検査");
  await expect(page.locator('[data-rule="feature-assertion"][data-severity="error"]')).toBeVisible();
  await expect(page.locator('[data-rule="deprecated-canon"][data-severity="error"]')).toBeVisible();
  // 承認はできない
  await tab(page, "5 承認");
  await page.locator("#ap-reason").fill("テスト");
  await expect(page.getByRole("button", { name: "承認する" })).toBeDisabled();

  // ---- 修正 → 要修正なし
  await tab(page, "3 下書き");
  await body.fill("【開発メモ】『霧灯の港』の交換所を開発中です。\n霧灯の下で、物資を持ち寄って交換できる場所を作っています。");
  await page.getByTestId("save-post").click();
  await expect(page.getByTestId("save-post")).toHaveText("保存済み");
  await tab(page, "4 検査");
  await expect(page.locator('[data-severity="error"]')).toHaveCount(0);
  await expect(page.getByTestId("provenance")).toContainText("現実の事実");

  // ---- 承認（理由を学びとして保存）
  await tab(page, "5 承認");
  await page.locator("#ap-reason").fill("開発中であることを正直に書き、場所の具体が伝わる");
  await page.getByRole("button", { name: "承認する" }).click();
  await expect(page.getByTestId("post-status")).toHaveText("承認済み");

  // ---- 書き出し：コピー・テキスト・zip
  await tab(page, "6 書き出し");
  await page.getByRole("button", { name: "すべてコピー" }).click();
  await expect(page.getByText("コピーしました")).toBeVisible();
  const clip = await page.evaluate(() => navigator.clipboard.readText());
  expect(clip).toContain("交換所を開発中です");

  const [txt] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: "テキストで保存" }).click()]);
  expect(readFileSync(await txt.path(), "utf8")).toContain("物資を持ち寄って");

  const [zipDl] = await Promise.all([page.waitForEvent("download"), page.getByRole("link", { name: "本文と素材を zip で保存" }).click()]);
  const zip = await JSZip.loadAsync(readFileSync(await zipDl.path()));
  expect(await zip.file("post.txt")!.async("string")).toContain("交換所を開発中です");
  expect(await zip.file("post.md")!.async("string")).toContain("承認理由");

  // 予約候補（自動投稿されない）
  await page.locator("#ex-sched").fill("2026-11-05T19:30");
  await page.getByTestId("save-post").click();
  await expect(page.getByTestId("save-post")).toHaveText("保存済み");

  // ---- 投稿記録（手動）
  await tab(page, "7 記録");
  await page.locator("#r-url").fill("https://x.com/e2e_account/status/1234567890");
  await page.locator("#r-at").fill("2026-11-05T19:31");
  await page.getByRole("button", { name: "投稿済みとして記録" }).click();
  await expect(page.getByTestId("post-status")).toHaveText("投稿済み（手動記録）");
  await page.locator("#m-impressions").fill("1000");
  await page.locator("#m-likes").fill("25");
  await page.getByRole("button", { name: "この値を記録" }).click();
  await expect(page.getByRole("cell", { name: "1000" })).toBeVisible();

  // ---- 履歴・振り返り
  await nav(page, "投稿履歴");
  const item = page.getByTestId("history-list").getByRole("listitem").filter({ hasText: "交換所の進捗" });
  await expect(item).toContainText("手動記録");
  await expect(item).toContainText("いいね 25");

  await nav(page, "振り返り");
  await expect(page.getByTestId("learning-list")).toContainText("開発中であることを正直に書き");

  // ---- 再読み込みしても残っている（ローカル保存）
  await page.reload();
  await nav(page, "投稿履歴");
  await expect(page.getByTestId("history-list")).toContainText("交換所の進捗");
});

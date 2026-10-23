import { expect, type Page } from "@playwright/test";

/** PC は左ナビ、スマホは上部ナビ。表示されている方をクリックする。 */
export async function nav(page: Page, label: string) {
  await page.getByRole("navigation", { name: "プロジェクト内" }).filter({ visible: true }).getByRole("link", { name: label, exact: true }).click();
}

export async function createProject(page: Page, name: string, kind: "real" | "sample" = "real") {
  await page.goto("/");
  await page.locator("#np-name").fill(name);
  await page.locator("#np-kind").selectOption(kind);
  await page.getByRole("button", { name: "作成", exact: true }).click();
  await expect(page.getByText("作成しました")).toBeVisible();
  await page.getByRole("link", { name: new RegExp(name) }).click();
  await expect(page.getByRole("heading", { name: "概要" })).toBeVisible();
}

export async function addEntry(
  page: Page,
  e: { kind: string; title: string; status?: string; body?: string; source?: string; variants?: string; featureStatus?: string; visibility?: string },
) {
  await page.getByRole("button", { name: "設定を追加" }).click();
  const dlg = page.getByRole("dialog");
  await dlg.locator("#e-kind").selectOption(e.kind);
  await dlg.locator("#e-title").fill(e.title);
  if (e.body) await dlg.locator("#e-body").fill(e.body);
  await dlg.locator("#e-status").selectOption(e.status ?? "confirmed");
  if (e.visibility) await dlg.locator("#e-vis").selectOption(e.visibility);
  await dlg.getByLabel("出典の名前").fill(e.source ?? "E2E テスト資料");
  if (e.variants) await dlg.locator("#e-variants").fill(e.variants);
  if (e.featureStatus) await dlg.locator("#e-fs").selectOption(e.featureStatus);
  await dlg.getByRole("button", { name: "保存", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.getByTestId("entry-list").getByText(e.title, { exact: true })).toBeVisible();
}

export async function tab(page: Page, name: string) {
  await page.getByRole("tab", { name, exact: true }).click();
}

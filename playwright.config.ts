import { defineConfig, devices } from "@playwright/test";

const PORT = 3200;
const WEB_PORT = 3201;

/**
 * E2E：本番ビルドを一時データディレクトリで起動し、PC（Chromium 1366x900）とスマホ（Pixel 7 のエミュレーション）で通す。
 * - desktop / mobile ……… PC 版の構成（サーバー経由でファイルを受け渡し）
 * - web-desktop / web-mobile … Web 版と同じ受け渡し（ブラウザ → 保存先へ直接送る／保存先の URL へ転送）を
 *   テスト用の受け渡し口で再現した構成
 */
const desktop = { ...devices["Desktop Chrome"], viewport: { width: 1366, height: 900 }, permissions: ["clipboard-read", "clipboard-write"] };
const mobile = { ...devices["Pixel 7"], permissions: ["clipboard-read", "clipboard-write"] };

export default defineConfig({
  testDir: "tests/e2e",
  timeout: 120_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [["list"], ["html", { open: "never" }]],
  use: {
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    acceptDownloads: true,
  },
  projects: [
    { name: "desktop", use: { ...desktop, baseURL: `http://127.0.0.1:${PORT}` } },
    { name: "mobile", use: { ...mobile, baseURL: `http://127.0.0.1:${PORT}` } },
    { name: "web-desktop", use: { ...desktop, baseURL: `http://127.0.0.1:${WEB_PORT}` } },
    { name: "web-mobile", use: { ...mobile, baseURL: `http://127.0.0.1:${WEB_PORT}` } },
  ],
  webServer: [
    {
      command: `rm -rf .data-e2e && npx next start -H 127.0.0.1 -p ${PORT}`,
      url: `http://127.0.0.1:${PORT}/api/providers`,
      reuseExistingServer: false,
      timeout: 120_000,
      env: { DATA_DIR: ".data-e2e", ENABLE_MOCK_PROVIDER: "1", ANTHROPIC_API_KEY: "" },
    },
    {
      command: `rm -rf .data-e2e-web && npx next start -H 127.0.0.1 -p ${WEB_PORT}`,
      url: `http://127.0.0.1:${WEB_PORT}/api/providers`,
      reuseExistingServer: false,
      timeout: 120_000,
      // PG_E2E_URL（空の Postgres データベース）があれば、文書を実際の Postgres に保存して通す
      env: {
        DATA_DIR: ".data-e2e-web",
        ENABLE_MOCK_PROVIDER: "1",
        ANTHROPIC_API_KEY: "",
        TEST_DIRECT_TRANSFER: "1",
        TEST_BASE_URL: `http://127.0.0.1:${WEB_PORT}`,
        ...(process.env.PG_E2E_URL ? { STORAGE_BACKEND: "postgres-test", DATABASE_URL: process.env.PG_E2E_URL } : {}),
      },
    },
  ],
});

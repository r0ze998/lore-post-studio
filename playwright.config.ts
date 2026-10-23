import { defineConfig, devices } from "@playwright/test";

const PORT = 3200;

/**
 * E2E：本番ビルドを一時データディレクトリ（.data-e2e）で起動し、
 * PC（Chromium 1366x900）とスマホ（Pixel 7 のエミュレーション）で同じ流れを通す。
 */
export default defineConfig({
  testDir: "tests/e2e",
  timeout: 120_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [["list"], ["html", { open: "never" }]],
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    acceptDownloads: true,
  },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"], viewport: { width: 1366, height: 900 }, permissions: ["clipboard-read", "clipboard-write"] } },
    { name: "mobile", use: { ...devices["Pixel 7"], permissions: ["clipboard-read", "clipboard-write"] } },
  ],
  webServer: {
    command: `rm -rf .data-e2e && npx next start -H 127.0.0.1 -p ${PORT}`,
    url: `http://127.0.0.1:${PORT}/api/providers`,
    reuseExistingServer: false,
    timeout: 120_000,
    env: { DATA_DIR: ".data-e2e", ENABLE_MOCK_PROVIDER: "1", ANTHROPIC_API_KEY: "" },
  },
});

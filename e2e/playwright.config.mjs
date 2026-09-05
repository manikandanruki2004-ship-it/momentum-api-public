import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: ".",
  timeout: 30_000,
  expect: { timeout: 10_000 },
  reporter: [["html", { outputFolder: "playwright-report", open: "never" }], ["list"]],
  use: {
    headless: true,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
});

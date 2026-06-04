import { defineConfig, devices } from "@playwright/test"

/**
 * Playwright E2E test configuration.
 *
 * Smoke tests verify that critical paths respond correctly. They do NOT
 * test AI functionality (that requires API keys and model access) — only
 * routing, auth, and structural correctness.
 *
 * Run: npx playwright test
 * CI: Add to .github/workflows/ci.yml as a separate job
 */
export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: "html",
  timeout: 30_000,
  use: {
    baseURL: process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:3000",
    trace: "on-first-retry",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
})
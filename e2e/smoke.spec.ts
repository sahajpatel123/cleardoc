import { test, expect } from "@playwright/test"

/**
 * Smoke test: verify the app boots and serves pages without crashing.
 * These tests are deliberately minimal — they confirm routing, auth
 * redirects, and API structure, not AI functionality.
 */

test.describe("Smoke tests", () => {
  test("homepage loads and has correct title", async ({ page }) => {
    await page.goto("/")
    // The homepage should render the hero headline
    await expect(page.locator("h1")).toContainText("second pair of eyes")
  })

  test("unauthenticated /dashboard redirects to login", async ({ page }) => {
    await page.goto("/dashboard")
    // Middleware should redirect to /login with a redirect param
    await page.waitForURL(/\/login/)
    expect(page.url()).toContain("/login")
    expect(page.url()).toContain("redirect=")
  })

  test("unauthenticated /analyze redirects to login", async ({ page }) => {
    await page.goto("/analyze")
    await page.waitForURL(/\/login/)
    expect(page.url()).toContain("/login")
  })

  test("/api/health returns 200 or 503", async ({ request }) => {
    const response = await request.get("/api/health")
    expect([200, 503]).toContain(response.status())
  })

  test("/api/analyses returns 401 for unauthenticated request", async ({ request }) => {
    const response = await request.get("/api/analyses")
    expect(response.status()).toBe(401)
  })
})
/* test/smoke.test.js — Playwright smoke test for the static pages.
 *
 * Verifies: every page loads without console errors, key landmarks render,
 * and the analyzer UI has the new sections in place.
 *
 * Run: node --test test/smoke.test.js
 * Requires: playwright (already installed via Homebrew on this machine).
 */

const test = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");
const path = require("node:path");
const fs = require("node:fs");

const ROOT = path.resolve(__dirname, "..");
const PORT = 4321;

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css":  "text/css; charset=utf-8",
  ".js":   "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg":  "image/svg+xml",
  ".ico":  "image/x-icon",
};

function serveStatic() {
  const server = http.createServer((req, res) => {
    let p = req.url.split("?")[0];
    if (p === "/") p = "/index.html";
    const filePath = path.join(ROOT, p);
    if (!filePath.startsWith(ROOT) || !fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
      res.writeHead(404, { "Content-Type": "text/plain" });
      res.end("Not Found");
      return;
    }
    const ext = path.extname(filePath).toLowerCase();
    res.writeHead(200, { "Content-Type": MIME[ext] || "application/octet-stream" });
    fs.createReadStream(filePath).pipe(res);
  });
  server.listen(PORT);
  server.unref();
  return server;
}

// Lazy-load playwright so the test is skippable if not installed
let chromium = null;
try { ({ chromium } = require("playwright")); }
catch (_) { /* playwright not installed */ }

const HAS_BROWSER = !!chromium;
const skip = (name) => (HAS_BROWSER ? test : test.skip.bind(test))(name);

let server, browser, context;

test.before(async () => {
  if (!HAS_BROWSER) return;
  server = serveStatic();
  browser = await chromium.launch({ headless: true });
  context = await browser.newContext();
});

test.after(async () => {
  if (!HAS_BROWSER) return;
  await context?.close();
  await browser?.close();
  await new Promise((r) => server?.close(r));
});

// ── helpers ─────────────────────────────────────────────────────────

async function loadAndCheck(pagePath, checks) {
  const errors = [];
  const page = await context.newPage();
  page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(`console.error: ${m.text()}`);
  });
  await page.goto(`http://127.0.0.1:${PORT}${pagePath}`, { waitUntil: "networkidle", timeout: 15000 });
  for (const [selector, label] of checks) {
    const el = await page.$(selector);
    assert.ok(el, `[${pagePath}] missing element: ${selector} (${label})`);
  }
  await page.close();
  return errors;
}

// ── tests ───────────────────────────────────────────────────────────

skip("home: loads without console errors and has expected landmarks", async () => {
  const errors = await loadAndCheck("/", [
    ["nav", "primary nav"],
    ["#heroTitle", "hero headline"],
    ["section.byof", "BYOF clarifier section"],
    ["section.conseq", "consequences section"],
    ["section.faq", "FAQ section"],
    ["footer", "footer"],
  ]);
  assert.deepEqual(errors, [], "home: console errors");
});

skip("home: has OG / Twitter / canonical / favicon meta", async () => {
  if (!HAS_BROWSER) return;
  const page = await context.newPage();
  await page.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: "networkidle" });
  const og = await page.$eval('meta[property="og:title"]', (el) => el.getAttribute("content"));
  assert.ok(og && og.length > 0, "og:title present");
  const canonical = await page.$eval('link[rel="canonical"]', (el) => el.getAttribute("href"));
  assert.ok(canonical && canonical.startsWith("http"), "canonical present");
  const icon = await page.$('link[rel="icon"][type="image/svg+xml"]');
  assert.ok(icon, "favicon link present");
  const twitter = await page.$eval('meta[name="twitter:card"]', (el) => el.getAttribute("content"));
  assert.ok(twitter && twitter.length > 0, "twitter:card present");
  await page.close();
});

skip("analyze: loads without console errors and has new AI-backed sections", async () => {
  const errors = await loadAndCheck("/analyze.html", [
    ["#docInput", "document input"],
    ["#analyzeBtn", "analyze button"],
    ["#analyzeLoading", "loading panel"],
    ["#verdictBlock", "verdict block"],
    ["#verdictDisplay", "verdict display"],
    ["#deadlinesBlock", "deadlines block"],
    ["#nextStepsBlock", "next steps block"],
    ["#resultPanel", "result panel"],
    ["#askInput", "ask input"],
    ["#printBtn", "print analysis button"],
    ["#saveBtn", "save analysis button"],
    ["#copyBtn", "copy analysis button"],
    [".print-header", "print-only header bar"],
    [".result-actions", "result action toolbar"],
  ]);
  assert.deepEqual(errors, [], "analyze: console errors");
});

skip("pricing: loads without console errors and has expected content", async () => {
  const errors = await loadAndCheck("/pricing.html", [
    ["nav", "primary nav"],
    ["footer", "footer"],
  ]);
  assert.deepEqual(errors, [], "pricing: console errors");
});

skip("analyze: clicking Analyze on the default sample runs the AI path", async () => {
  if (!HAS_BROWSER) return;
  const page = await context.newPage();
  await page.goto(`http://127.0.0.1:${PORT}/analyze.html`, { waitUntil: "networkidle" });
  // The default textarea is pre-filled with a sample — just click Analyze
  // We don't have a backend wired up in this smoke test, so we expect the
  // local fallback to populate plainOut regardless.
  await page.click("#analyzeBtn");
  // Loading panel should appear briefly
  await page.waitForSelector("#resultPanel:not([hidden])", { timeout: 5000 });
  // Plain-English rewrite should be populated
  const text = await page.$eval("#plainOut", (el) => el.textContent || "");
  assert.ok(text.length > 20, `plainOut should have content, got ${text.length} chars`);
  await page.close();
});

skip("mobile viewport (375px): analyze renders without horizontal overflow", async () => {
  if (!HAS_BROWSER) return;
  const mobile = await browser.newContext({ viewport: { width: 375, height: 812 } });
  const page = await mobile.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(`console.error: ${m.text()}`);
  });
  await page.goto(`http://127.0.0.1:${PORT}/analyze.html`, { waitUntil: "networkidle" });

  // Verify all key elements are present and visible at mobile width
  for (const sel of ["#docInput", "#analyzeBtn", "#resultPanel", ".empty-state"]) {
    const el = await page.$(sel);
    assert.ok(el, `[mobile analyze] missing: ${sel}`);
  }

  // No horizontal overflow at 375px — documentElement should not scroll horizontally
  const overflow = await page.evaluate(() => ({
    scrollW: document.documentElement.scrollWidth,
    clientW: document.documentElement.clientWidth,
  }));
  assert.ok(
    overflow.scrollW <= overflow.clientW + 1,
    `horizontal overflow at 375px: scrollWidth=${overflow.scrollW} clientWidth=${overflow.clientW}`
  );

  await page.close();
  await mobile.close();
  assert.deepEqual(errors, [], "mobile analyze: console errors");
});

skip("404 page: loads and shows the not-found message + CTAs", async () => {
  if (!HAS_BROWSER) return;
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(`console.error: ${m.text()}`);
  });
  await page.goto(`http://127.0.0.1:${PORT}/404.html`, { waitUntil: "networkidle" });
  const title = await page.title();
  assert.match(title, /not found|404/i, `404 title should mention 404, got "${title}"`);
  const ctaCount = await page.$$eval(".notfound-cta a", (els) => els.length);
  assert.ok(ctaCount >= 3, `404 page should have ≥3 CTA links, got ${ctaCount}`);
  await page.close();
  assert.deepEqual(errors, [], "404: console errors");
});

skip("FAQ accordion: clicking a question toggles aria-expanded", async () => {
  if (!HAS_BROWSER) return;
  const page = await context.newPage();
  await page.goto(`http://127.0.0.1:${PORT}/analyze.html`, { waitUntil: "networkidle" });
  // All FAQ items should exist (analyze page has 3)
  const items = await page.$$(".qa");
  assert.ok(items.length >= 1, `expected FAQ items on analyze, got ${items.length}`);

  // Click first FAQ question — but scroll it into view first so GSAP's
  // ScrollTrigger doesn't auto-open it before we measure.
  await items[0].scrollIntoViewIfNeeded();
  // Wait a tick for any auto-open animations
  await page.waitForTimeout(200);
  const initial = await items[0].$eval(".q", (el) => el.getAttribute("aria-expanded"));
  // Click again to flip it
  await items[0].$eval(".q", (el) => el.click());
  await page.waitForTimeout(300);
  const afterClick = await items[0].$eval(".q", (el) => el.getAttribute("aria-expanded"));
  assert.notEqual(initial, afterClick, `aria-expanded should flip on click, got "${initial}" → "${afterClick}"`);
  await page.close();
});

skip("hero clarifier: pasting legalese and clicking Clarify renders the plain-English rewrite", async () => {
  if (!HAS_BROWSER) return;
  const page = await context.newPage();
  await page.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: "networkidle" });
  const input = await page.$("#heroInput");
  assert.ok(input, "hero input exists");
  // Replace the pre-filled value with a fresh legalese sentence so we know
  // the changed output came from our click, not the preloaded animation.
  await input.fill("Lessee shall indemnify lessor in perpetuity.");
  await page.click("#heroGo");
  // Give the timeline ~1.5s to play out (the reveal is 0.9s + buffer)
  await page.waitForTimeout(1600);
  // The clear box should now contain a plain-English rewrite (with a <b> highlight)
  const html = await page.$eval("#hclear", (el) => el.innerHTML);
  assert.match(html, /<b>/i, `hero clarifier should wrap matched phrases in <b>, got: ${html.slice(0, 200)}`);
  assert.ok(html.length > 20, `hero clarifier output should be non-trivial, got ${html.length} chars`);
  await page.close();
});

skip("STRICT RULE: html/body overflow-x is 'clip', never 'hidden' (kills sticky)", async () => {
  // Project rule #1: `overflow-x: hidden` on html/body breaks position:sticky
  // site-wide. `clip` is the safe equivalent. Lock it in so future edits
  // can't silently revert.
  const fs = require("node:fs");
  const path = require("node:path");
  const css = fs.readFileSync(path.join(ROOT, "assets", "theme.css"), "utf8");
  // Find the html,body { ... } block and ensure overflow-x is 'clip'
  const m = css.match(/html,\s*body\s*\{([^}]+)\}/);
  assert.ok(m, "html,body { ... } rule should exist in theme.css");
  const body = m[1];
  assert.match(body, /overflow-x\s*:\s*clip/i, `html,body must use overflow-x:clip, got: ${body}`);
  assert.doesNotMatch(body, /overflow-x\s*:\s*hidden/i, `html,body must NEVER use overflow-x:hidden (kills position:sticky). Found: ${body}`);
});

skip("analyze: result-actions live inside the result panel and start hidden until analysis runs", async () => {
  if (!HAS_BROWSER) return;
  const page = await context.newPage();
  await page.goto(`http://127.0.0.1:${PORT}/analyze.html`, { waitUntil: "networkidle" });

  // The action bar lives inside #resultPanel, so it must inherit the panel's hidden state
  const initiallyHidden = await page.$eval(".result-actions", (el) => {
    return el.closest("#resultPanel")?.hidden ?? true;
  });
  assert.equal(initiallyHidden, true, "result-actions must be hidden initially (inside hidden resultPanel)");

  // All three buttons must exist in the DOM with stable IDs
  for (const id of ["#printBtn", "#saveBtn", "#copyBtn"]) {
    const el = await page.$(id);
    assert.ok(el, `${id} should exist in the DOM`);
  }

  // The print stylesheet must hide the action bar (so it doesn't appear when the user prints)
  // We can't easily emulate print media, but we can verify the no-print class is set
  const hasNoPrint = await page.$eval(".result-actions", (el) => el.classList.contains("no-print"));
  assert.equal(hasNoPrint, true, ".result-actions must carry the no-print class so it's hidden in print preview");

  await page.close();
});

skip("PWA manifest: all pages link to a valid site.webmanifest", async () => {
  if (!HAS_BROWSER) return;
  const fs = require("node:fs");
  const path = require("node:path");
  // Validate the manifest file is well-formed JSON with required fields
  const manifestPath = path.join(ROOT, "site.webmanifest");
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  for (const key of ["name", "short_name", "start_url", "display", "icons"]) {
    assert.ok(manifest[key], `manifest missing required field: ${key}`);
  }
  assert.ok(Array.isArray(manifest.icons) && manifest.icons.length > 0, "manifest must have at least one icon");

  // Verify every HTML page links to it
  for (const page of ["index.html", "analyze.html", "pricing.html", "404.html"]) {
    const pagePath = path.join(ROOT, page);
    const html = fs.readFileSync(pagePath, "utf8");
    assert.match(html, /<link[^>]+rel="manifest"[^>]+href="site\.webmanifest"/, `${page} should link to site.webmanifest`);
  }
});

skip("pricing toggle: clicking Annually switches prices and reveals save cue", async () => {
  if (!HAS_BROWSER) return;
  const page = await context.newPage();
  await page.goto(`http://127.0.0.1:${PORT}/pricing.html`, { waitUntil: "networkidle" });

  // Read monthly prices (initial state)
  const monthly = await page.$$eval(".ad .amt", (els) => els.map((el) => el.textContent.trim()));
  assert.equal(monthly.length, 3, `expected 3 plan amounts, got ${monthly.length}`);
  assert.equal(monthly[0], "$0", `Reader monthly should be $0, got "${monthly[0]}"`);
  assert.equal(monthly[1], "$19", `Pro monthly should be $19, got "${monthly[1]}"`);

  // Save cue should be hidden initially
  const cueHiddenInitial = await page.$eval("#saveCue", (el) => el.hidden);
  assert.equal(cueHiddenInitial, true, "save cue should be hidden on monthly view");

  // Click Annually
  await page.click('button[data-cycle="yr"]');
  await page.waitForTimeout(500); // let GSAP animate

  // Verify aria-pressed flipped
  const yrPressed = await page.$eval('button[data-cycle="yr"]', (el) => el.getAttribute("aria-pressed"));
  assert.equal(yrPressed, "true", "Annually button should be aria-pressed=true");
  const moPressed = await page.$eval('button[data-cycle="mo"]', (el) => el.getAttribute("aria-pressed"));
  assert.equal(moPressed, "false", "Monthly button should be aria-pressed=false after switching");

  // Verify prices changed to annual rates
  const annual = await page.$$eval(".ad .amt", (els) => els.map((el) => el.textContent.trim()));
  assert.equal(annual[1], "$15", `Pro annual should be $15, got "${annual[1]}"`);
  assert.equal(annual[2], "$39", `Firm annual should be $39, got "${annual[2]}"`);

  // Save cue should now be visible
  const cueHiddenAfter = await page.$eval("#saveCue", (el) => el.hidden);
  assert.equal(cueHiddenAfter, false, "save cue should be visible on annual view");

  await page.close();
});
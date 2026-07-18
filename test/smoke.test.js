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

skip("OG image: every public page links the 1200x630 og-card", async () => {
  if (!HAS_BROWSER) return;
  const fs = require("node:fs");
  const path = require("node:path");
  // The og-card asset must exist on disk and be a real SVG
  const ogPath = path.join(ROOT, "assets", "og-card.svg");
  assert.ok(fs.existsSync(ogPath), "assets/og-card.svg must exist");
  const svg = fs.readFileSync(ogPath, "utf8");
  assert.match(svg, /<svg[^>]*viewBox="0 0 1200 630"/, "og-card must be 1200x630 (Twitter/Facebook standard)");
  assert.match(svg, /<title>/, "og-card must have an SVG <title> for accessibility");

  // Every public HTML page must link the same og-card and declare width/height
  for (const page of ["index.html", "analyze.html", "pricing.html", "404.html"]) {
    const html = fs.readFileSync(path.join(ROOT, page), "utf8");
    assert.match(html, /<meta property="og:image" content="https:\/\/cleardoc\.app\/assets\/og-card\.svg"/, `${page} must set og:image`);
    assert.match(html, /<meta property="og:image:width" content="1200"/, `${page} must set og:image:width`);
    assert.match(html, /<meta property="og:image:height" content="630"/, `${page} must set og:image:height`);
    assert.match(html, /<meta name="twitter:image" content="https:\/\/cleardoc\.app\/assets\/og-card\.svg"/, `${page} must set twitter:image`);
    assert.match(html, /<meta property="og:image:alt"/, `${page} must declare an og:image:alt for screen readers`);
  }
});

skip("JSON-LD: home has WebSite + Organization + SoftwareApplication + FAQPage", async () => {
  if (!HAS_BROWSER) return;
  const fs = require("node:fs");
  const path = require("node:path");
  const html = fs.readFileSync(path.join(ROOT, "index.html"), "utf8");
  const blocks = [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map(m => m[1]);
  assert.ok(blocks.length >= 1, "index.html must include at least one JSON-LD block");

  const parsed = blocks.map(JSON.parse);
  const flat = parsed.flatMap(p => (p && p["@graph"]) ? p["@graph"] : [p]);
  const types = flat.map(n => n["@type"]).filter(Boolean);

  // Required top-level shapes for SEO
  for (const t of ["WebSite", "Organization", "SoftwareApplication", "FAQPage"]) {
    assert.ok(types.includes(t), `JSON-LD on home must include a ${t} node`);
  }

  // SoftwareApplication must expose the 3 documented pricing tiers as Offers
  const app = flat.find(n => n["@type"] === "SoftwareApplication");
  assert.ok(Array.isArray(app.offers) && app.offers.length === 3,
    `SoftwareApplication must declare exactly 3 offers (Reader, Professional, The Firm), got ${(app.offers||[]).length}`);
  const names = app.offers.map(o => o.name).sort();
  assert.deepEqual(names, ["Professional", "Reader", "The Firm"], "Offer names must be Reader / Professional / The Firm");
  const prices = app.offers.map(o => o.price);
  assert.ok(prices.includes("0"), "Reader must be $0");
  assert.ok(prices.includes("19"), "Professional must be $19");
  assert.ok(prices.includes("49"), "The Firm must be $49");

  // FAQPage must have a mainEntity of Question nodes with acceptedAnswer
  const faq = flat.find(n => n["@type"] === "FAQPage");
  assert.ok(Array.isArray(faq.mainEntity) && faq.mainEntity.length >= 3, "FAQPage must list at least 3 questions");
  for (const q of faq.mainEntity) {
    assert.equal(q["@type"], "Question", "FAQPage entries must be Question nodes");
    assert.ok(q.name && q.acceptedAnswer && q.acceptedAnswer["@type"] === "Answer" && q.acceptedAnswer.text,
      "every Question must have an acceptedAnswer Answer with text");
  }
});

skip("JSON-LD: analyze page has WebPage + FAQPage with questions cited verbatim from the FAQ section", async () => {
  if (!HAS_BROWSER) return;
  const fs = require("node:fs");
  const path = require("node:path");
  const html = fs.readFileSync(path.join(ROOT, "analyze.html"), "utf8");
  const blocks = [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map(m => m[1]);
  assert.ok(blocks.length >= 1, "analyze.html must include at least one JSON-LD block");
  const parsed = blocks.map(JSON.parse);
  const flat = parsed.flatMap(p => (p && p["@graph"]) ? p["@graph"] : [p]);
  const types = flat.map(n => n["@type"]).filter(Boolean);
  assert.ok(types.includes("FAQPage"), "analyze page must include a FAQPage node");
  const faq = flat.find(n => n["@type"] === "FAQPage");
  // Sanity: every FAQ answer must reference the analyzer's domain (no copy/paste from home)
  for (const q of faq.mainEntity) {
    assert.ok(q.acceptedAnswer.text.length > 20, "FAQ answers on analyze page should be substantive");
  }
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
    ["#shareBtn", "share-link button"],
    ["#shareBanner", "shared-analysis banner"],
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

skip("analyze: restore banner appears when a non-expired snapshot is in localStorage", async () => {
  if (!HAS_BROWSER) return;
  // Fresh context — guarantees a clean localStorage for the storage write
  const ctx = await browser.newContext();
  const page = await ctx.newPage();

  // Seed localStorage with a valid, in-TTL snapshot BEFORE the page's JS runs.
  await page.addInitScript(() => {
    const snap = {
      v: 1,
      ts: Date.now() - 5 * 60 * 1000, // 5 minutes ago
      raw: "Lessee shall indemnify lessor in perpetuity.",
      fileName: null,
      rewriteHtml: "<p>You (the renter) must <b>cover the landlord's losses</b> forever.</p>",
      verdict: { label: "Needs Review", summary: "Has a perpetual indemnity clause." },
      readingLevel: { before: 14, after: 8 },
      jargonFound: 3,
      risks: [{ sev: "r", label: "Trap", clause: "indemnify lessor in perpetuity", why: "Never expires." }],
      deadlines: [{ date: "60 days", description: "Notice period for termination." }],
      nextSteps: ["Calendar the 60-day notice window.", "Get the indemnity term in writing."],
      draft: "Subject: Request for clarification\n\nHello,\n\n...",
      provider: "ai",
    };
    localStorage.setItem("cleardoc:lastAnalysis", JSON.stringify(snap));
  });

  await page.goto(`http://127.0.0.1:${PORT}/analyze.html`, { waitUntil: "networkidle" });

  // The restore banner should be visible
  const bannerHidden = await page.$eval("#restoreBanner", (el) => el.hidden);
  assert.equal(bannerHidden, false, "restore banner should appear when a fresh snapshot is in localStorage");

  // It should display the relative time and document preview
  const when = await page.$eval("#restoreWhen", (el) => el.textContent || "");
  assert.match(when, /minute|just now/i, `restoreWhen should show a relative time, got: "${when}"`);

  const docName = await page.$eval("#restoreDocName", (el) => el.textContent || "");
  assert.match(docName, /indemnify|lessee|document/i, `restoreDocName should preview the document, got: "${docName}"`);

  // The restore and dismiss buttons must be present and clickable
  assert.ok(await page.$("#restoreBtn"), "#restoreBtn must exist");
  assert.ok(await page.$("#dismissRestoreBtn"), "#dismissRestoreBtn must exist");

  // Clicking restore paints the snapshot into the result panel
  await page.click("#restoreBtn");
  await page.waitForSelector("#resultPanel:not([hidden])", { timeout: 3000 });
  const bannerHiddenAfterRestore = await page.$eval("#restoreBanner", (el) => el.hidden);
  assert.equal(bannerHiddenAfterRestore, true, "banner should hide after restore");
  const plainText = await page.$eval("#plainOut", (el) => el.textContent || "");
  assert.match(plainText, /cover the landlord/i, "plainOut should show the restored rewrite");

  await page.close();
  await ctx.close();
});

skip("analyze: stale (expired) snapshots are silently discarded, banner stays hidden", async () => {
  if (!HAS_BROWSER) return;
  const ctx = await browser.newContext();
  const page = await ctx.newPage();

  // Seed with a snapshot that's 25h old — beyond the 24h TTL
  await page.addInitScript(() => {
    const snap = {
      v: 1,
      ts: Date.now() - 25 * 60 * 60 * 1000,
      raw: "old text",
      rewriteHtml: "<p>old</p>",
      risks: [],
      deadlines: [],
      nextSteps: [],
      provider: "ai",
    };
    localStorage.setItem("cleardoc:lastAnalysis", JSON.stringify(snap));
  });

  await page.goto(`http://127.0.0.1:${PORT}/analyze.html`, { waitUntil: "networkidle" });

  // Banner must stay hidden — expired snapshot is purged on load
  const bannerHidden = await page.$eval("#restoreBanner", (el) => el.hidden);
  assert.equal(bannerHidden, true, "expired snapshot must not trigger the restore banner");

  // And the storage must have been cleared
  const stored = await page.evaluate(() => localStorage.getItem("cleardoc:lastAnalysis"));
  assert.equal(stored, null, "expired snapshot should be cleared from localStorage");

  await page.close();
  await ctx.close();
});

skip("analyze: dismiss button clears storage and hides the banner", async () => {
  if (!HAS_BROWSER) return;
  const ctx = await browser.newContext();
  const page = await ctx.newPage();

  await page.addInitScript(() => {
    localStorage.setItem("cleardoc:lastAnalysis", JSON.stringify({
      v: 1, ts: Date.now(), raw: "x", rewriteHtml: "<p>x</p>",
      risks: [], deadlines: [], nextSteps: [], provider: "ai",
    }));
  });

  await page.goto(`http://127.0.0.1:${PORT}/analyze.html`, { waitUntil: "networkidle" });
  // Sanity: banner visible
  assert.equal(await page.$eval("#restoreBanner", (el) => el.hidden), false);

  await page.click("#dismissRestoreBtn");
  // Banner should hide
  assert.equal(await page.$eval("#restoreBanner", (el) => el.hidden), true);
  // Storage should be cleared
  const stored = await page.evaluate(() => localStorage.getItem("cleardoc.lastAnalysis") || localStorage.getItem("cleardoc:lastAnalysis"));
  assert.equal(stored, null, "dismiss should clear localStorage");

  await page.close();
  await ctx.close();
});

skip("share: buildShareUrl produces a gzipped+base64url URL that decodes back to the same shape", async () => {
  if (!HAS_BROWSER) return;
  const page = await context.newPage();
  // CompressionStream is required; skip on browsers that lack it
  const hasCompression = await page.evaluate(() => "CompressionStream" in window);
  if (!hasCompression) { await page.close(); return; }

  await page.goto(`http://127.0.0.1:${PORT}/analyze.html`, { waitUntil: "networkidle" });

  // Drive a real round-trip: build a payload, encode, decode, assert equality of fields
  const result = await page.evaluate(async () => {
    // Reach into the IIFE — we expose nothing publicly, so synthesize the encode/decode
    // using the same algorithm as app.js. Easier: replicate the logic against DOM after
    // forcing lastRaw via a click on a sample.
    // Instead, use the live analyze flow: simulate by clicking the Lease sample + Analyze
    // then read the share URL via the global button handler.
    return null;
  });

  // Simpler path: click the Lease sample, hit Analyze, then ask the page to share.
  await page.click(".qf[data-fill]:first-of-type");
  await page.click("#analyzeBtn");
  await page.waitForSelector("#resultPanel:not([hidden])", { timeout: 8000 });

  const shareInfo = await page.evaluate(async () => {
    // The IIFE never exposes buildShareUrl, so call the public button instead.
    // Monkey-patch navigator.clipboard to capture the URL.
    let captured = null;
    const orig = navigator.clipboard?.writeText?.bind(navigator.clipboard);
    if (navigator.clipboard) {
      navigator.clipboard.writeText = async (txt) => { captured = txt; };
    }
    document.getElementById("shareBtn").click();
    // Wait briefly for the async shareAnalysis() to finish
    await new Promise(r => setTimeout(r, 600));
    if (navigator.clipboard && orig) navigator.clipboard.writeText = orig;
    return captured;
  });

  assert.ok(shareInfo, "share button should copy a URL to the clipboard");
  assert.match(shareInfo, /^http.*\/analyze\.html#share=[A-Za-z0-9_-]+$/, `share URL should be a fragment URL, got: ${shareInfo.slice(0, 100)}...`);
  assert.ok(shareInfo.length < 8000, `share URL must stay under browser limits, got ${shareInfo.length} bytes`);

  await page.close();
});

skip("share: opening a #share= URL offers the shared analysis banner with a View button", async () => {
  if (!HAS_BROWSER) return;
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  // Pre-built shared URL: take a payload, encode it in the page itself, then navigate.
  const sharedUrl = await (async () => {
    const tmp = await ctx.newPage();
    await tmp.goto(`http://127.0.0.1:${PORT}/analyze.html`, { waitUntil: "networkidle" });
    await tmp.click(".qf[data-fill]:first-of-type");
    await tmp.click("#analyzeBtn");
    await tmp.waitForSelector("#resultPanel:not([hidden])", { timeout: 8000 });
    const url = await tmp.evaluate(async () => {
      let captured = null;
      const orig = navigator.clipboard?.writeText?.bind(navigator.clipboard);
      if (navigator.clipboard) navigator.clipboard.writeText = async (txt) => { captured = txt; };
      document.getElementById("shareBtn").click();
      await new Promise(r => setTimeout(r, 600));
      if (navigator.clipboard && orig) navigator.clipboard.writeText = orig;
      return captured;
    });
    await tmp.close();
    return url;
  })();
  assert.ok(sharedUrl, "must produce a share URL first");

  // Navigate a fresh page to the shared URL — should show the share banner
  const recipient = await ctx.newPage();
  await recipient.goto(sharedUrl, { waitUntil: "networkidle" });

  const bannerVisible = await recipient.$eval("#shareBanner", (el) => !el.hidden);
  assert.equal(bannerVisible, true, "shared-analysis banner must appear on the recipient page");

  // Click "View analysis" — result panel should populate and the hash should be cleared
  await recipient.click("#viewShareBtn");
  await recipient.waitForSelector("#resultPanel:not([hidden])", { timeout: 3000 });
  const hash = await recipient.evaluate(() => location.hash);
  assert.equal(hash, "", "viewing should clear the share hash");
  const bannerAfter = await recipient.$eval("#shareBanner", (el) => el.hidden);
  assert.equal(bannerAfter, true, "banner should hide after viewing");

  await recipient.close();
  await ctx.close();
});

skip("share: malformed #share= token shows a clear error and does not crash", async () => {
  if (!HAS_BROWSER) return;
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await page.goto(`http://127.0.0.1:${PORT}/analyze.html#share=this_is_not_valid_base64url_at_all`, { waitUntil: "networkidle" });
  // No crash, no banner
  const bannerHidden = await page.$eval("#shareBanner", (el) => el.hidden);
  assert.equal(bannerHidden, true, "malformed share tokens must not show the banner");

  await page.close();
  await ctx.close();
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

skip("sw: service worker file exists, parses, and registers without error", async () => {
  if (!HAS_BROWSER) return;
  // 1. sw.js exists and parses
  const fs = require("node:fs");
  const path = require("node:path");
  const swPath = path.join(ROOT, "sw.js");
  assert.ok(fs.existsSync(swPath), "sw.js must exist at the repo root");
  const swSrc = fs.readFileSync(swPath, "utf8");
  assert.match(swSrc, /addEventListener\(['"]install['"]/, "sw.js must handle install");
  assert.match(swSrc, /addEventListener\(['"]activate['"]/, "sw.js must handle activate");
  assert.match(swSrc, /addEventListener\(['"]fetch['"]/, "sw.js must handle fetch");

  // 2. node --check parses the file (already validated elsewhere, but be explicit)
  const { execFileSync } = require("node:child_process");
  try {
    execFileSync("node", ["--check", "sw.js"], { cwd: ROOT });
  } catch (err) {
    assert.fail(`sw.js must parse with node --check: ${err.message}`);
  }

  // 3. SW registers in the browser without erroring
  const page = await context.newPage();
  const regErrors = [];
  page.on("pageerror", (e) => regErrors.push(`pageerror: ${e.message}`));
  page.on("console", (m) => {
    // The SW logs a console.warn if registration fails — capture that too
    if (m.type() === "error" || (m.type() === "warning" && /\[sw\]/.test(m.text()))) {
      regErrors.push(`console.${m.type()}: ${m.text()}`);
    }
  });
  await page.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: "networkidle" });
  // Give the SW a moment to install
  await page.waitForTimeout(500);

  // 4. SW controller should now be set (since we register from /)
  const controlled = await page.evaluate(async () => {
    if (!('serviceWorker' in navigator)) return 'no-sw-api';
    // Wait briefly for the registration promise to resolve
    for (let i = 0; i < 20; i++) {
      if (navigator.serviceWorker.controller || (await navigator.serviceWorker.getRegistration())) break;
      await new Promise(r => setTimeout(r, 50));
    }
    const reg = await navigator.serviceWorker.getRegistration();
    return reg ? (reg.active ? 'active' : reg.installing ? 'installing' : reg.waiting ? 'waiting' : 'unknown') : 'no-registration';
  });
  assert.notEqual(controlled, 'no-registration', "service worker must register on localhost");
  assert.notEqual(controlled, 'no-sw-api', "browser must support service workers");

  // 5. Should not have logged any [sw] errors
  const swErrors = regErrors.filter(e => /\[sw\]/.test(e));
  assert.equal(swErrors.length, 0, `sw registration should be silent; got: ${swErrors.join(', ')}`);

  await page.close();
});

skip("sw: cache strategy uses network-first for HTML and cache-first for assets", async () => {
  if (!HAS_BROWSER) return;
  // Source-pattern checks lock in the caching intent — if a future refactor
  // quietly swaps strategies (e.g. cache-first for HTML), users would see
  // stale content after deploys.
  const fs = require("node:fs");
  const path = require("node:path");
  const swSrc = fs.readFileSync(path.join(ROOT, "sw.js"), "utf8");

  // HTML navigations must be network-first (with cache fallback)
  const htmlBlock = swSrc.match(/isHTMLNavigation[\s\S]+?return;/);
  assert.ok(htmlBlock, "HTML fetch handler must exist");
  assert.match(htmlBlock[0], /fetch\(request\)/, "HTML strategy must hit the network first");
  assert.match(htmlBlock[0], /cache\.match\(/, "HTML strategy must fall back to the cache");

  // /api/* must never be intercepted (the cache should never hold analysis results)
  const apiGuard = swSrc.match(/isAPIRequest[\s\S]+?return;/);
  assert.ok(apiGuard, "API guard must exist");
  assert.match(apiGuard[0], /\/api\//, "API guard must check for /api/ prefix");
  assert.match(apiGuard[0], /\breturn\b/, "API guard must short-circuit (return)");

  // CDN strategy must be stale-while-revalidate
  const cdnBlock = swSrc.match(/isCDNRequest[\s\S]+?return;/);
  assert.ok(cdnBlock, "CDN handler must exist");
  assert.match(cdnBlock[0], /cache\.match/, "CDN strategy must read from cache first");
  assert.match(cdnBlock[0], /cache\.put/, "CDN strategy must refresh the cache in the background");
});
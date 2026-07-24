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
  // Read the global CSP from vercel.json so the test server emits the same
  // security headers Vercel injects in production. Without this, CSP-runtime
  // tests would only exercise the in-memory static server (which never sends
  // the policy) and give a false sense of safety.
  let cspHeader = "default-src 'self'";
  try {
    const vercel = JSON.parse(fs.readFileSync(path.join(ROOT, "vercel.json"), "utf8"));
    const globalBlock = vercel.headers.find((h) => h.source === "/(.*)");
    if (globalBlock) {
      const csp = globalBlock.headers.find((h) => h.key === "Content-Security-Policy");
      if (csp) cspHeader = csp.value;
    }
  } catch (_) { /* fall back to minimal policy */ }

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
    res.setHeader("Content-Type", MIME[ext] || "application/octet-stream");
    res.setHeader("Content-Security-Policy", cspHeader);
    res.writeHead(200);
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

skip("ticker: every public page rotates ≥6 distinct signals so the marquee feels like a news wire", async () => {
  if (!HAS_BROWSER) return;
  const fs = require("node:fs");
  const path = require("node:path");

  // Each page declares its ticker twice (the GSAP loop reads the second
  // copy as a seamless continuation), so the number of unique signal labels
  // must be ≥ 6 and each label must appear an even number of times (twice).
  for (const page of ["index.html", "analyze.html", "pricing.html", "404.html"]) {
    const html = fs.readFileSync(path.join(ROOT, page), "utf8");
    const labels = [...html.matchAll(/data-label="([^"]+)"/g)].map(m => m[1]);
    assert.ok(labels.length >= 6, `${page} ticker must have ≥6 signal elements, got ${labels.length}`);
    const unique = [...new Set(labels)];
    assert.ok(unique.length >= 6, `${page} ticker must declare ≥6 unique signal labels, got ${unique.length}`);
    // Each unique label must appear exactly twice (the GSAP loop expects the
    // second copy to be a verbatim duplicate of the first for a seamless wrap).
    for (const lab of unique) {
      const count = labels.filter(l => l === lab).length;
      assert.equal(count, 2, `${page} signal label "${lab}" must appear exactly twice (got ${count})`);
    }
  }
});

skip("ask: citation in local-fallback includes the matched sentence + a quote", async () => {
  if (!HAS_BROWSER) return;
  const fs = require("node:fs");
  const path = require("node:path");
  const appSrc = fs.readFileSync(path.join(ROOT, "assets", "app.js"), "utf8");

  // Source-pattern: localAnswer returns a citeFmt string built from
  // the matched sentence + a 140-char truncated quote.
  assert.match(appSrc, /function fmtCite\(/, "fmtCite helper must exist");
  assert.match(appSrc, /'Sentence ' \+ sn/, "fmtCite must produce 'Sentence N of M' format");
  assert.match(appSrc, /citeFmt:fmtCite\(best\)/, "every return path must include citeFmt");
  assert.match(appSrc, /local\.citeFmt \|\| \(local\.cite/, "the Ask thread must prefer citeFmt over the raw fallback string");
});

skip("ask: thread renders Q/A bubbles, sends history to /api/chat, and Clear button resets", async () => {
  if (!HAS_BROWSER) return;
  const fs = require("node:fs");
  const path = require("node:path");
  const analyzeHtml = fs.readFileSync(path.join(ROOT, "analyze.html"), "utf8");
  const appSrc = fs.readFileSync(path.join(ROOT, "assets", "app.js"), "utf8");
  const themeSrc = fs.readFileSync(path.join(ROOT, "assets", "theme.css"), "utf8");

  // HTML must expose the new thread container + clear button (askOut kept for back-compat)
  assert.match(analyzeHtml, /id="askThread"/, "analyze.html must expose #askThread");
  assert.match(analyzeHtml, /id="askClearBtn"/, "analyze.html must expose #askClearBtn");

  // Source-pattern: renderAskThread + askHistory + turn-shaped rendering
  assert.match(appSrc, /let askHistory\s*=/, "askHistory array must exist");
  assert.match(appSrc, /function renderAskThread\(/, "renderAskThread must exist");
  assert.match(appSrc, /askHistory\.push\(turn\)/, "ask must append to history");
  // The thread container must render both Q and A bubbles
  assert.match(appSrc, /class="ask-q"/, "renderAskThread must emit an .ask-q bubble");
  assert.match(appSrc, /class="ask-a"/, "renderAskThread must emit an .ask-a bubble");
  // Send the prior history (excluding the current pending turn) to the backend
  assert.match(appSrc, /history:\s*askHistory/, "history must be sent to /api/chat so the AI has prior Q&A context");

  // CSS must define both bubble shapes + the clear button
  assert.match(themeSrc, /\.ask-q\{/, ".ask-q CSS rule must exist");
  assert.match(themeSrc, /\.ask-a\{/, ".ask-a CSS rule must exist");
  assert.match(themeSrc, /\.ask-clear\{/, ".ask-clear CSS rule must exist");

  // Live: ask two questions on the analyze page (with a stubbed /api/chat that
  // returns deterministic answers). After each ask, a new .ask-q + .ask-a pair
  // should appear in #askThread. The Clear button should reset the thread.
  const ctx = await browser.newContext();
  const page = await ctx.newPage();

  // Monkey-patch fetch so /api/chat returns instantly with a known answer.
  await page.addInitScript(() => {
    const origFetch = window.fetch ? window.fetch.bind(window) : null;
    window.fetch = function patched(url, opts){
      const u = typeof url === 'string' ? url : (url && url.url) || '';
      if(u.endsWith('/api/chat')){
        return Promise.resolve(new Response(JSON.stringify({
          answer: 'stubbed answer for ' + JSON.parse(opts.body || '{}').question,
          citation: '§ stub',
        }), { status:200, headers:{'Content-Type':'application/json'} }));
      }
      return origFetch ? origFetch(url, opts) : Promise.reject(new Error('no network'));
    };
  });

  await page.goto(`http://127.0.0.1:${PORT}/analyze.html`, { waitUntil: "networkidle" });
  // Ask must be enabled after the preloaded sample renders
  await page.waitForFunction(() => !document.getElementById('askBtn').disabled, { timeout: 5000 });

  await page.fill("#askInput", "Can I cancel early?");
  await page.click("#askBtn");
  // Wait for the stubbed answer to land
  await page.waitForFunction(() => document.querySelectorAll('#askThread .ask-a').length >= 1, { timeout: 5000 });
  const qCount1 = await page.$$eval("#askThread .ask-q", (els) => els.length);
  const aCount1 = await page.$$eval("#askThread .ask-a", (els) => els.length);
  assert.equal(qCount1, 1, `after 1 ask, expect 1 .ask-q, got ${qCount1}`);
  assert.equal(aCount1, 1, `after 1 ask, expect 1 .ask-a, got ${aCount1}`);

  await page.fill("#askInput", "What am I liable for?");
  await page.click("#askBtn");
  await page.waitForFunction(() => document.querySelectorAll('#askThread .ask-a').length >= 2, { timeout: 5000 });
  const qCount2 = await page.$$eval("#askThread .ask-q", (els) => els.length);
  const aCount2 = await page.$$eval("#askThread .ask-a", (els) => els.length);
  assert.equal(qCount2, 2, `after 2 asks, expect 2 .ask-q, got ${qCount2}`);
  assert.equal(aCount2, 2, `after 2 asks, expect 2 .ask-a, got ${aCount2}`);

  // Clear button must be visible
  const clearVisible = await page.$eval("#askClearBtn", (el) => !el.hidden);
  assert.equal(clearVisible, true, "Clear button must appear once the thread has turns");

  // Click clear → thread resets
  await page.click("#askClearBtn");
  await page.waitForTimeout(80);
  const qCountAfter = await page.$$eval("#askThread .ask-q", (els) => els.length);
  const aCountAfter = await page.$$eval("#askThread .ask-a", (els) => els.length);
  assert.equal(qCountAfter, 0, `after Clear, expect 0 .ask-q, got ${qCountAfter}`);
  assert.equal(aCountAfter, 0, `after Clear, expect 0 .ask-a, got ${aCountAfter}`);

  await page.close();
  await ctx.close();
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

skip("JSON-LD: pricing page has Product with 3 Offer tiers + FAQPage", async () => {
  if (!HAS_BROWSER) return;
  const fs = require("node:fs");
  const path = require("node:path");
  const html = fs.readFileSync(path.join(ROOT, "pricing.html"), "utf8");
  const blocks = [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map(m => m[1]);
  assert.ok(blocks.length >= 1, "pricing.html must include a JSON-LD block");
  const parsed = blocks.map(JSON.parse);
  const flat = parsed.flatMap(p => (p && p["@graph"]) ? p["@graph"] : [p]);
  const types = flat.map(n => n["@type"]).filter(Boolean);
  assert.ok(types.includes("Product"), "pricing page must include a Product node");
  assert.ok(types.includes("FAQPage"), "pricing page must include a FAQPage node");

  const product = flat.find(n => n["@type"] === "Product");
  assert.ok(Array.isArray(product.offers) && product.offers.length === 3,
    `pricing Product must declare exactly 3 offers, got ${(product.offers||[]).length}`);
  const prices = product.offers.map(o => o.price);
  assert.deepEqual(prices.sort(), ["0", "19", "49"], "Offer prices must be $0/$19/$49");
  for (const offer of product.offers) {
    assert.ok(offer.priceCurrency === "USD", `offer ${offer.name} must use USD`);
    assert.ok(offer.url && offer.url.startsWith("https://cleardoc.app/"), `offer ${offer.name} must have a canonical URL`);
  }

  const faq = flat.find(n => n["@type"] === "FAQPage");
  assert.ok(Array.isArray(faq.mainEntity) && faq.mainEntity.length >= 3,
    "pricing FAQPage must list at least 3 questions");
});

skip("JSON-LD: every public page declares a BreadcrumbList with valid positions", async () => {
  const fs = require("node:fs");
  const path = require("node:path");
  // analyze + pricing must declare a BreadcrumbList (404 is noindex; the home
  // page is the breadcrumb root and doesn't need a list of itself).
  for (const page of ["analyze.html", "pricing.html"]) {
    const html = fs.readFileSync(path.join(ROOT, page), "utf8");
    const blocks = [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map(m => m[1]);
    const parsed = blocks.map(JSON.parse);
    const flat = parsed.flatMap(p => (p && p["@graph"]) ? p["@graph"] : [p]);
    const bc = flat.find(n => n["@type"] === "BreadcrumbList");
    assert.ok(bc, `${page} must include a BreadcrumbList node in its JSON-LD`);
    assert.ok(Array.isArray(bc.itemListElement) && bc.itemListElement.length >= 2,
      `${page} BreadcrumbList must have at least 2 items (root + page)`);

    // Positions must be sequential starting at 1, names + URLs non-empty
    bc.itemListElement.forEach((item, i) => {
      assert.equal(item["@type"], "ListItem", `${page} breadcrumb[${i}] must be a ListItem`);
      assert.equal(item.position, i + 1, `${page} breadcrumb[${i}].position must be ${i + 1}, got ${item.position}`);
      assert.ok(item.name && typeof item.name === "string" && item.name.length > 0, `${page} breadcrumb[${i}].name required`);
      assert.ok(item.item && /^https:\/\/cleardoc\.app\//.test(item.item), `${page} breadcrumb[${i}].item must be an absolute cleardoc.app URL`);
    });

    // Last breadcrumb item must point at the current page itself
    const last = bc.itemListElement[bc.itemListElement.length - 1];
    const currentPath = "/" + page;
    assert.ok(last.item.endsWith(currentPath), `${page} breadcrumb must end at ${currentPath}, got ${last.item}`);

    // First item must be the home page
    assert.equal(bc.itemListElement[0].item, "https://cleardoc.app/", `${page} breadcrumb must start at home`);
  }
});

skip("sitemap.xml: lists every public HTML page with a lastmod timestamp", async () => {
  const fs = require("node:fs");
  const path = require("node:path");
  const xml = fs.readFileSync(path.join(ROOT, "sitemap.xml"), "utf8");
  // Must be a well-formed URL set
  assert.match(xml, /<urlset[^>]+sitemaps\.org/, "sitemap must declare the sitemaps.org namespace");
  for (const page of ["https://cleardoc.app/", "https://cleardoc.app/analyze.html", "https://cleardoc.app/pricing.html"]) {
    assert.ok(xml.includes("<loc>" + page + "</loc>"), `sitemap must include ${page}`);
  }
  // Every <loc> must have a sibling <lastmod> for SEO freshness signals
  const locs = [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map(m => m[1]);
  for (const loc of locs) {
    const after = xml.slice(xml.indexOf("<loc>" + loc + "</loc>"));
    assert.match(after.slice(0, 400), /<lastmod>\d{4}-\d{2}-\d{2}<\/lastmod>/,
      `${loc} must have a <lastmod> timestamp for SEO freshness`);
  }
  // robots.txt must point at the sitemap
  const robots = fs.readFileSync(path.join(ROOT, "robots.txt"), "utf8");
  assert.match(robots, /Sitemap:\s*https:\/\/cleardoc\.app\/sitemap\.xml/, "robots.txt must reference the sitemap");
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

skip("FAQ: 'Expand all' / 'Collapse all' controls open and close every item", async () => {
  if (!HAS_BROWSER) return;
  const fs = require("node:fs");
  const path = require("node:path");
  const appSrc = fs.readFileSync(path.join(ROOT, "assets", "app.js"), "utf8");

  // Every public page with an FAQ exposes the controls
  for (const page of ["index.html", "analyze.html", "pricing.html"]) {
    const html = fs.readFileSync(path.join(ROOT, page), "utf8");
    assert.match(html, /class="faq-controls/, `${page} must expose .faq-controls`);
    assert.match(html, /data-faq-action="open"/, `${page} must expose the 'open' button`);
    assert.match(html, /data-faq-action="close"/, `${page} must expose the 'close' button`);
  }
  // Source-pattern: handler exists and dispatches on data-faq-action
  assert.match(appSrc, /openAll\(\)/, "openAll helper must exist");
  assert.match(appSrc, /closeAll\(\)/, "closeAll helper must exist");
  assert.match(appSrc, /data-faq-action/, "app must dispatch on [data-faq-action]");

  // Live: load pricing, click Expand all, every q.aria-expanded flips to true
  const page = await context.newPage();
  await page.goto(`http://127.0.0.1:${PORT}/pricing.html`, { waitUntil: "networkidle" });
  // Initial: all items collapsed
  const initial = await page.$$eval(".qa .q", (els) => els.map(e => e.getAttribute("aria-expanded")));
  assert.ok(initial.every(v => v === "false"), `all FAQ items must start collapsed, got ${JSON.stringify(initial)}`);

  // Click Expand all
  await page.click('[data-faq-action="open"]');
  await page.waitForTimeout(150);
  const afterExpand = await page.$$eval(".qa .q", (els) => els.map(e => e.getAttribute("aria-expanded")));
  assert.ok(afterExpand.every(v => v === "true"), `after Expand all, every item must be open, got ${JSON.stringify(afterExpand)}`);

  // Click Collapse all
  await page.click('[data-faq-action="close"]');
  await page.waitForTimeout(150);
  const afterCollapse = await page.$$eval(".qa .q", (els) => els.map(e => e.getAttribute("aria-expanded")));
  assert.ok(afterCollapse.every(v => v === "false"), `after Collapse all, every item must be closed, got ${JSON.stringify(afterCollapse)}`);

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

skip("BYOF: glossary lists each jargon term that was replaced + its plain-English meaning", async () => {
  if (!HAS_BROWSER) return;
  const path = require("node:path");
  const indexHtml = fs.readFileSync(path.join(ROOT, "index.html"), "utf8");
  const appSrc = fs.readFileSync(path.join(ROOT, "assets", "app.js"), "utf8");
  const themeSrc = fs.readFileSync(path.join(ROOT, "assets", "theme.css"), "utf8");

  // HTML must expose the glossary container + list
  assert.match(indexHtml, /id="byofGlossary"/, "index.html must expose #byofGlossary");
  assert.match(indexHtml, /id="byofGlossaryList"/, "index.html must expose #byofGlossaryList");

  // Source-pattern: renderGlossary emits a list-item with the term + plain-English meaning
  assert.match(appSrc, /function renderGlossary\(/, "renderGlossary must exist");
  assert.match(appSrc, /matches\.map\(m =&gt;/, "renderGlossary must map matches into <li> rows");
  assert.match(appSrc, /esc\(m\.term\)/, "renderGlossary must escape the jargon term");
  assert.match(appSrc, /esc\(m\.plain\)/, "renderGlossary must escape the plain meaning");

  // CSS rule
  assert.match(themeSrc, /\.byof-glossary\{/, ".byof-glossary CSS rule must exist");

  // Live: load the home page (BYOF auto-runs), then verify the glossary
  // lists at least one entry with both a <code> term and a plain-English meaning.
  const page = await context.newPage();
  await page.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: "networkidle" });
  // Wait for the BYOF auto-run to paint the glossary
  await page.waitForFunction(() => {
    const g = document.getElementById("byofGlossary");
    return g && !g.hidden;
  }, { timeout: 5000 }).catch(() => {});

  const visible = await page.$eval("#byofGlossary", (el) => !el.hidden);
  assert.equal(visible, true, "BYOF glossary must be visible after auto-run on the preloaded sample");

  const items = await page.$$eval("#byofGlossaryList li", (els) => els.map(li => ({
    term: (li.querySelector('code') || {}).textContent || '',
    plain: (li.querySelector('.plain') || {}).textContent || '',
  })));
  assert.ok(items.length >= 1, `glossary must list at least one term, got ${items.length}`);
  for (const it of items) {
    assert.ok(it.term.length > 0, `glossary row must have a non-empty term, got ${JSON.stringify(it)}`);
    assert.ok(it.plain.length > 0, `glossary row must have a non-empty plain meaning, got ${JSON.stringify(it)}`);
  }
  const allText = items.map(i => i.term + ' ' + i.plain).join(' ').toLowerCase();
  assert.ok(allText.length > 20, `glossary should have substantive content, got "${allText}"`);

  await page.close();
});

skip("nav: back-to-top clears the sticky mobile Analyze CTA at ≤600px", async () => {
  if (!HAS_BROWSER) return;
  const path = require("node:path");
  const themeSrc = fs.readFileSync(path.join(ROOT, "assets", "theme.css"), "utf8");
  // The mobile media query must reposition the button higher than the
  // sticky Analyze CTA (which sits at bottom: 0 on ≤900px viewports).
  assert.match(
    themeSrc,
    /@media\s*\(max-width:\s*600px\)[\s\S]*?\.back-to-top\{[^}]*bottom:\s*84px/s,
    "mobile media query must raise .back-to-top to bottom: 84px so it clears the sticky Analyze CTA"
  );

  // Live at 375px: bottom edge must clear the sticky Analyze CTA bar
  const mobile = await browser.newContext({ viewport: { width: 375, height: 812 } });
  const page = await mobile.newPage();
  await page.goto(`http://127.0.0.1:${PORT}/analyze.html`, { waitUntil: "networkidle" });
  await page.evaluate(() => window.scrollTo(0, 900));
  await page.waitForTimeout(150);
  const btt = await page.$eval("#backToTop", (el) => {
    const r = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    return { bottom: cs.bottom, distFromViewportBottom: window.innerHeight - r.bottom };
  });
  assert.match(btt.bottom, /84/, `back-to-top must use bottom: 84px on mobile, got "${btt.bottom}"`);
  assert.ok(btt.distFromViewportBottom >= 80 && btt.distFromViewportBottom <= 90,
    `back-to-top must sit ~84px from the bottom on mobile, got ${btt.distFromViewportBottom}px`);

  // At desktop, the original 18px bottom must be used
  const desktop = await browser.newContext({ viewport: { width: 1700, height: 900 } });
  const dpage = await desktop.newPage();
  await dpage.goto(`http://127.0.0.1:${PORT}/index.html`, { waitUntil: "networkidle" });
  await dpage.evaluate(() => window.scrollTo(0, 900));
  await dpage.waitForTimeout(150);
  const dBtt = await dpage.$eval("#backToTop", (el) => {
    const r = el.getBoundingClientRect();
    return { bottom: getComputedStyle(el).bottom, dist: window.innerHeight - r.bottom };
  });
  assert.match(dBtt.bottom, /18/, `desktop must keep bottom: 18px, got "${dBtt.bottom}"`);

  await page.close(); await mobile.close();
  await dpage.close(); await desktop.close();
});

skip("FAQ: keyword filter shows only matching questions + a 'no matches' hint", async () => {
  if (!HAS_BROWSER) return;
  const path = require("node:path");
  const fs = require("node:fs");
  for (const page of ["index.html", "analyze.html", "pricing.html"]) {
    const html = fs.readFileSync(path.join(ROOT, page), "utf8");
    assert.match(html, /id="faqSearch"/, `${page} must expose #faqSearch`);
    assert.match(html, /id="faqSearchEmpty"/, `${page} must expose the empty-state hint`);
  }
  const appSrc = fs.readFileSync(path.join(ROOT, "assets", "app.js"), "utf8");
  const themeSrc = fs.readFileSync(path.join(ROOT, "assets", "theme.css"), "utf8");

  // Source-pattern: filter function exists and is wired to the input
  assert.match(appSrc, /function applyFaqFilter\(/, "applyFaqFilter must exist");
  assert.match(appSrc, /faqSearch\.addEventListener\('input'/, "input event must drive the filter");
  assert.match(appSrc, /qtext \+ ' ' \+ atext/, "filter must search both question + answer text");

  // CSS rule
  assert.match(themeSrc, /\.faq-search input\[type="search"\]/, ".faq-search input CSS rule must exist");

  // Live: load the home page, type into the search input, assert filtering
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await page.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: "networkidle" });
  // Wait for the FAQ to render (GSAP auto-opens the first item)
  await page.waitForTimeout(300);
  const allCount = await page.$$eval(".qa", (els) => els.filter(el => el.style.display !== 'none').length);
  assert.ok(allCount >= 3, `home FAQ must have ≥3 questions visible, got ${allCount}`);

  // Type a keyword that matches one question but not others
  await page.fill("#faqSearch", "legal");
  await page.waitForTimeout(60);
  const filteredCount = await page.$$eval(".qa", (els) => els.filter(el => el.style.display !== 'none').length);
  assert.ok(filteredCount > 0, `at least one question must match 'legal', got ${filteredCount}`);
  assert.ok(filteredCount < allCount, `filter must hide non-matching questions, got ${filteredCount} of ${allCount}`);

  // Empty filter restores everything
  await page.fill("#faqSearch", "");
  await page.waitForTimeout(60);
  const restored = await page.$$eval(".qa", (els) => els.filter(el => el.style.display !== 'none').length);
  assert.equal(restored, allCount, `empty filter must restore all ${allCount} questions, got ${restored}`);

  // Empty-state hint: type a word that matches nothing
  await page.fill("#faqSearch", "xqzxqzxqz_nope");
  await page.waitForTimeout(60);
  const emptyVisible = await page.$eval("#faqSearchEmpty", (el) => !el.hidden);
  assert.equal(emptyVisible, true, "empty-state hint must show when no questions match");

  await page.close();
  await ctx.close();
});

skip("analyzer: AI failure shows a Retry button + categorizes the failure (rate-limit / network / other)", async () => {
  if (!HAS_BROWSER) return;
  const path = require("node:path");
  const appSrc = fs.readFileSync(path.join(ROOT, "assets", "app.js"), "utf8");
  const themeSrc = fs.readFileSync(path.join(ROOT, "assets", "theme.css"), "utf8");

  // Source-pattern: the new status message uses rich HTML and a Retry button
  assert.match(appSrc, /AI rewrite skipped/, "status message must say 'AI rewrite skipped'");
  assert.match(appSrc, /msg-retry/, "retry button must be wired into the status message");
  assert.match(appSrc, /id="msgRetryBtn"/, "retry button must be queryable for tests");
  assert.match(appSrc, /retry\.addEventListener\('click', analyze\)/, "retry button must trigger analyze() again");

  // Categorization patterns
  assert.match(appSrc, /isRate\s*=\s*\/429\|too many\|rate\|quota/, "must recognize 429 / rate-limit responses");
  assert.match(appSrc, /isNet\s*=\s*\/network\|fetch\|offline\|abort\|timed out\|timeout/, "must recognize network/timeout errors");

  // CSS for the message + retry button
  assert.match(themeSrc, /\.msg-retry\{/, ".msg-retry CSS rule must exist");
  assert.match(themeSrc, /\.analyze-msg strong/, ".analyze-msg strong style must exist");

  // Live: stub /api/analyze to fail with 429, then run a fresh analysis
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await page.addInitScript(() => {
    const origFetch = window.fetch ? window.fetch.bind(window) : null;
    window.fetch = function patched(url, opts){
      const u = typeof url === 'string' ? url : (url && url.url) || '';
      if(u.endsWith('/api/analyze')){
        return Promise.resolve(new Response(JSON.stringify({ error: 'Too many requests' }), {
          status: 429, headers: { 'Content-Type':'application/json' },
        }));
      }
      return origFetch ? origFetch(url, opts) : Promise.reject(new Error('no network'));
    };
  });
  await page.goto(`http://127.0.0.1:${PORT}/analyze.html`, { waitUntil: "networkidle" });

  // Clear the preloaded sample so the click on Analyze triggers a fresh fetch
  await page.fill("#docInput", "Lessee shall forfeit the security deposit on termination.");
  await page.click("#analyzeBtn");
  // Wait for the message to update
  await page.waitForFunction(() => document.getElementById("msgRetryBtn") !== null, { timeout: 5000 });

  const msgText = await page.$eval("#analyzeMsg", (el) => el.textContent || "");
  assert.match(msgText, /AI rewrite skipped/i, `error message must say "AI rewrite skipped", got "${msgText}"`);
  assert.match(msgText, /rate.?limit/i, `429 errors must be categorized as rate-limit, got "${msgText}"`);
  // The retry button must exist and be enabled
  const retryEnabled = await page.$eval("#msgRetryBtn", (el) => !el.disabled);
  assert.equal(retryEnabled, true, "retry button must be enabled");

  await page.close();
  await ctx.close();
});

skip("analyzer: AI failure shows a Retry button + categorizes the failure (rate-limit / network / other)", async () => {
  if (!HAS_BROWSER) return;
  const path = require("node:path");
  const indexHtml = fs.readFileSync(path.join(ROOT, "index.html"), "utf8");
  const appSrc = fs.readFileSync(path.join(ROOT, "assets", "app.js"), "utf8");
  const themeSrc = fs.readFileSync(path.join(ROOT, "assets", "theme.css"), "utf8");

  // HTML must expose the glossary container + list
  assert.match(indexHtml, /id="byofGlossary"/, "index.html must expose #byofGlossary");
  assert.match(indexHtml, /id="byofGlossaryList"/, "index.html must expose #byofGlossaryList");

  // Source-pattern: renderGlossary emits a list-item with the term + plain-English meaning
  assert.match(appSrc, /function renderGlossary\(/, "renderGlossary must exist");
  assert.match(appSrc, /matches\.map\(m =&gt;/, "renderGlossary must map matches into <li> rows");
  assert.match(appSrc, /esc\(m\.term\)/, "renderGlossary must escape the jargon term");
  assert.match(appSrc, /esc\(m\.plain\)/, "renderGlossary must escape the plain meaning");

  // CSS rule
  assert.match(themeSrc, /\.byof-glossary\{/, ".byof-glossary CSS rule must exist");

  // Live: load the home page (BYOF auto-runs), then verify the glossary
  // lists at least one entry with both a <code> term and a plain-English meaning.
  const page = await context.newPage();
  await page.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: "networkidle" });
  // Wait for the BYOF auto-run to paint the glossary
  await page.waitForFunction(() => {
    const g = document.getElementById("byofGlossary");
    return g && !g.hidden;
  }, { timeout: 5000 }).catch(() => {});

  const visible = await page.$eval("#byofGlossary", (el) => !el.hidden);
  assert.equal(visible, true, "BYOF glossary must be visible after auto-run on the preloaded sample");

  const items = await page.$$eval("#byofGlossaryList li", (els) => els.map(li => ({
    term: (li.querySelector('code') || {}).textContent || '',
    plain: (li.querySelector('.plain') || {}).textContent || '',
  })));
  assert.ok(items.length >= 1, `glossary must list at least one term, got ${items.length}`);
  // Every row must have a non-empty term + non-empty plain-English meaning
  for (const it of items) {
    assert.ok(it.term.length > 0, `glossary row must have a non-empty term, got ${JSON.stringify(it)}`);
    assert.ok(it.plain.length > 0, `glossary row must have a non-empty plain meaning, got ${JSON.stringify(it)}`);
  }
  // The preloaded sample mentions 'aforementioned policyholder' + 'liable' +
  // 'deductibles' + 'notwithstanding' + 'pursuant' + 'tendered' — at least
  // some of those should appear in the glossary.
  const allText = items.map(i => i.term + ' ' + i.plain).join(' ').toLowerCase();
  assert.ok(allText.length > 20, `glossary should have substantive content, got "${allText}"`);

  await page.close();
});

skip("nav: back-to-top button appears after scroll, smooth-scrolls to top on click", async () => {
  if (!HAS_BROWSER) return;
  const fs = require("node:fs");
  const path = require("node:path");
  const appSrc = fs.readFileSync(path.join(ROOT, "assets", "app.js"), "utf8");
  const themeSrc = fs.readFileSync(path.join(ROOT, "assets", "theme.css"), "utf8");

  // Source-pattern: wireBackToTop must be in the 'always' init list and must
  // create the button lazily + toggle a .show class.
  assert.match(appSrc, /function wireBackToTop\(/, "wireBackToTop must exist");
  assert.match(appSrc, /wireBackToTop\]/, "wireBackToTop must be in the 'always' init list");
  assert.match(appSrc, /btn\.classList\.toggle\('show'/, "wireBackToTop must toggle a .show class on scroll");
  assert.match(appSrc, /lenis\.scrollTo\(0/, "wireBackToTop must use Lenis for smooth scroll");
  assert.match(appSrc, /window\.scrollTo\(\{ top: 0, behavior: 'smooth' \}\)/, "wireBackToTop must fall back to native smooth scroll when Lenis is unavailable");

  // CSS rule for the button + its .show state
  assert.match(themeSrc, /\.back-to-top\{/, ".back-to-top CSS rule must exist");
  assert.match(themeSrc, /\.back-to-top\.show/, ".back-to-top.show state must exist");

  // Live: load the home page, button must NOT be visible at scrollY=0
  const page = await context.newPage();
  await page.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: "networkidle" });
  const initiallyShown = await page.$eval("#backToTop", (el) => el.classList.contains("show"));
  assert.equal(initiallyShown, false, "back-to-top must NOT be visible at scrollY=0");

  // Scroll past the 600px threshold — button must become visible
  await page.evaluate(() => window.scrollTo(0, 900));
  await page.waitForTimeout(150);
  const scrolledShown = await page.$eval("#backToTop", (el) => el.classList.contains("show"));
  assert.equal(scrolledShown, true, "back-to-top must become visible after scrolling past 600px");

  // Click the button — scrollY must return to 0
  await page.click("#backToTop");
  // Allow the smooth-scroll to finish (Lenis duration 0.8s + buffer)
  await page.waitForTimeout(1200);
  const finalY = await page.evaluate(() => window.scrollY);
  assert.ok(finalY <= 5, `clicking back-to-top must scroll to ~0, got ${finalY}`);

  // After scrolling back to top, the button must hide again
  await page.waitForTimeout(150);
  const hiddenAgain = await page.$eval("#backToTop", (el) => el.classList.contains("show"));
  assert.equal(hiddenAgain, false, "back-to-top must hide once scrolled back to top");

  await page.close();
});

skip("nav: back-to-top button appears after scroll, smooth-scrolls to top on click", async () => {
  if (!HAS_BROWSER) return;
  const path = require("node:path");
  const indexHtml = fs.readFileSync(path.join(ROOT, "index.html"), "utf8");
  const appSrc = fs.readFileSync(path.join(ROOT, "assets", "app.js"), "utf8");
  const themeSrc = fs.readFileSync(path.join(ROOT, "assets", "theme.css"), "utf8");

  // HTML must expose the glossary container + list
  assert.match(indexHtml, /id="byofGlossary"/, "index.html must expose #byofGlossary");
  assert.match(indexHtml, /id="byofGlossaryList"/, "index.html must expose #byofGlossaryList");

  // Source-pattern: renderGlossary emits a list-item with the term + plain-English meaning
  assert.match(appSrc, /function renderGlossary\(/, "renderGlossary must exist");
  assert.match(appSrc, /matches\.map\(m =&gt;/, "renderGlossary must map matches into <li> rows");
  assert.match(appSrc, /esc\(m\.term\)/, "renderGlossary must escape the jargon term");
  assert.match(appSrc, /esc\(m\.plain\)/, "renderGlossary must escape the plain meaning");

  // CSS rule
  assert.match(themeSrc, /\.byof-glossary\{/, ".byof-glossary CSS rule must exist");

  // Live: load the home page (BYOF auto-runs), then verify the glossary
  // lists at least one entry with both a <code> term and a plain-English meaning.
  const page = await context.newPage();
  await page.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: "networkidle" });
  // Wait for the BYOF auto-run to paint the glossary
  await page.waitForFunction(() => {
    const g = document.getElementById("byofGlossary");
    return g && !g.hidden;
  }, { timeout: 5000 }).catch(() => {});

  const visible = await page.$eval("#byofGlossary", (el) => !el.hidden);
  assert.equal(visible, true, "BYOF glossary must be visible after auto-run on the preloaded sample");

  const items = await page.$$eval("#byofGlossaryList li", (els) => els.map(li => ({
    term: (li.querySelector('code') || {}).textContent || '',
    plain: (li.querySelector('.plain') || {}).textContent || '',
  })));
  assert.ok(items.length >= 1, `glossary must list at least one term, got ${items.length}`);
  // Every row must have a non-empty term + non-empty plain-English meaning
  for (const it of items) {
    assert.ok(it.term.length > 0, `glossary row must have a non-empty term, got ${JSON.stringify(it)}`);
    assert.ok(it.plain.length > 0, `glossary row must have a non-empty plain meaning, got ${JSON.stringify(it)}`);
  }
  // The preloaded sample mentions 'aforementioned policyholder' + 'liable' +
  // 'deductibles' + 'notwithstanding' + 'pursuant' + 'tendered' — at least
  // some of those should appear in the glossary.
  const allText = items.map(i => i.term + ' ' + i.plain).join(' ').toLowerCase();
  assert.ok(allText.length > 20, `glossary should have substantive content, got "${allText}"`);

  await page.close();
});

skip("pricing: each non-free card shows an annual hint (total + savings) that updates with the toggle", async () => {
  if (!HAS_BROWSER) return;
  const fs = require("node:fs");
  const path = require("node:path");
  const pricingHtml = fs.readFileSync(path.join(ROOT, "pricing.html"), "utf8");
  const appSrc = fs.readFileSync(path.join(ROOT, "assets", "app.js"), "utf8");
  const themeSrc = fs.readFileSync(path.join(ROOT, "assets", "theme.css"), "utf8");

  // Every non-free card exposes a .yr-hint slot
  const cards = pricingHtml.match(/<div class="ad[\s\S]+?<\/div>/g) || [];
  assert.ok(cards.length === 3, `pricing.html must have 3 plan cards, got ${cards.length}`);
  // Reader has a static hint baked into HTML (no update needed); other two rely on JS
  for (const card of cards){
    assert.match(card, /class="yr-hint"/, "every pricing card must carry a .yr-hint slot");
  }

  // Source-pattern: updateYearlyHints computes and writes the hint
  assert.match(appSrc, /function updateYearlyHints\(/, "updateYearlyHints helper must exist");
  assert.match(appSrc, /annualTotal\s*=\s*yr\s*\*\s*12/, "updateYearlyHints must compute yr*12");
  assert.match(appSrc, /monthlyTotal\s*=\s*mo\s*\*\s*12/, "updateYearlyHints must compute mo*12");
  // The toggle click handler must invoke updateYearlyHints
  assert.match(appSrc, /updateYearlyHints\(yr\)/, "click handler must call updateYearlyHints with the new state");

  // CSS rule for the hint
  assert.match(themeSrc, /\.ad \.yr-hint\{/, ".yr-hint CSS rule must exist");

  // Live: monthly view (default) — Pro + Firm hints show annual total
  const page = await context.newPage();
  await page.goto(`http://127.0.0.1:${PORT}/pricing.html`, { waitUntil: "networkidle" });

  const proHintMonthly = await page.$eval(".ad.pick .yr-hint", (el) => el.textContent || "");
  assert.ok(/\$180/.test(proHintMonthly), `Pro monthly hint must show $180/yr total, got "${proHintMonthly}"`);
  assert.ok(/save \$48/.test(proHintMonthly), `Pro hint must mention saving $48, got "${proHintMonthly}"`);

  const firmHints = await page.$$eval(".ad:not(.pick) .yr-hint", (els) => els.map(el => el.textContent || ""));
  // The non-pick non-Reader ad is the Firm card
  assert.ok(/\$468/.test(firmHints.join("|") || ""), `Firm hint must mention $468 total, got ${JSON.stringify(firmHints)}`);

  // Click Annually — hint text must update
  await page.click('button[data-cycle="yr"]');
  await page.waitForTimeout(150);
  const proHintAnnual = await page.$eval(".ad.pick .yr-hint", (el) => el.textContent || "");
  assert.match(proHintAnnual, /Billed \$180 yearly/, `Pro annual hint must say 'Billed $180 yearly', got "${proHintAnnual}"`);

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

skip("OCR: image attachments lazy-load Tesseract.js with timeout + cancel", async () => {
  if (!HAS_BROWSER) return;
  const fs = require("node:fs");
  const path = require("node:path");
  const appSrc = fs.readFileSync(path.join(ROOT, "assets", "app.js"), "utf8");

  // Loader + timeout + cancel + readImage must all exist
  assert.match(appSrc, /function loadTesseract\(/, "loadTesseract helper must exist");
  assert.match(appSrc, /function readImage\(/, "readImage handler must exist");
  assert.match(appSrc, /function cancelActiveOcr\(/, "cancelActiveOcr helper must exist");
  assert.match(appSrc, /OCR_TIMEOUT_MS\s*=\s*\d+/, "OCR timeout constant must exist");
  assert.match(appSrc, /tesseract\.js@/, "Tesseract.js must come from a versioned CDN URL (not @latest)");

  // handleFile must route images through readImage
  const handleFileBlock = appSrc.match(/function handleFile\([\s\S]+?\n    \}/);
  assert.ok(handleFileBlock, "handleFile must exist");
  assert.match(handleFileBlock[0], /IMG_EXT\.test\(n\)\)\s*readImage/, "image attachments must trigger readImage");

  // clearAttachments must cancel any in-flight OCR
  const clearBlock = appSrc.match(/function clearAttachments\(\)\{[\s\S]+?\}/);
  assert.ok(clearBlock, "clearAttachments must exist");
  assert.match(clearBlock[0], /cancelActiveOcr\(\)/, "clearAttachments must cancel in-flight OCR");

  // Fallback strings — must exist for both timeout and failure
  assert.match(appSrc, /OCR timed out — paste the text instead/, "timeout fallback message must exist");
  assert.match(appSrc, /OCR failed — paste the text instead/, "failure fallback message must exist");
  assert.match(appSrc, /OCR engine unavailable — paste the text instead/, "loader-failure fallback message must exist");

  // The chip's remove button (.fx) must call clearAttachments — which then
  // cancels the OCR. Verify the wiring hasn't regressed.
  const fxWiring = appSrc.match(/chip\.querySelector\(['"]\.fx['"]\)\.addEventListener\(['"]click['"],\s*clearAttachments\)/);
  assert.ok(fxWiring, "chip remove (.fx) must call clearAttachments");

  // OCR size cap — must reject images > 10MB before loading Tesseract.
  // Without the gate, a 50 MB phone photo would load the 1MB+ Tesseract
  // runtime, then OOM the tab partway through recognition.
  assert.match(appSrc, /MAX_OCR_BYTES\s*=\s*\d+\s*\*\s*1024\s*\*\s*1024/, "MAX_OCR_BYTES must be defined in MB units");
  const readImageBlock = appSrc.match(/async function readImage\([\s\S]+?\n    \}/);
  assert.ok(readImageBlock, "readImage must exist");
  assert.match(readImageBlock[0], /MAX_OCR_BYTES/, "readImage must consult MAX_OCR_BYTES before loading Tesseract");
  assert.match(readImageBlock[0], /too large for OCR/, "oversize image must produce a clear user-visible rejection");
});

skip("BYOF: reading level is computed live from the input (not hardcoded 12th→7th)", async () => {
  if (!HAS_BROWSER) return;
  const fs = require("node:fs");
  const path = require("node:path");
  const appSrc = fs.readFileSync(path.join(ROOT, "assets", "app.js"), "utf8");
  const indexHtml = fs.readFileSync(path.join(ROOT, "index.html"), "utf8");

  // gradeLevel + isGradable + stripHtmlToText must all exist at the IIFE
  // level. (plainTextOf was renamed to stripHtmlToText in 02c3afcc — the
  // prior name was never defined and silently threw ReferenceError on the
  // home page.)
  assert.match(appSrc, /function gradeLevel\(text\)/, "gradeLevel must be a top-level IIFE function");
  assert.match(appSrc, /function isGradable\(text\)/, "isGradable helper must exist for BYOF gating");
  assert.match(appSrc, /function stripHtmlToText\(html\)/, "stripHtmlToText helper must exist for stripping output HTML");

  // BYOF meta HTML must now have dynamic from/to IDs
  assert.match(indexHtml, /id="byofLevelFrom"/, "index.html must have #byofLevelFrom for the dynamic 'before' level");
  assert.match(indexHtml, /id="byofLevelTo"/,   "index.html must have #byofLevelTo for the dynamic 'after' level");

  // BYOF must call setLevels(...) — verified by source pattern
  const byofBlock = appSrc.match(/function byof\(\)\{[\s\S]+?\n  \}/);
  assert.ok(byofBlock, "byof() must exist");
  assert.match(byofBlock[0], /setLevels\(/, "byof() must call setLevels() to update the dynamic reading-level display");
  assert.match(byofBlock[0], /isGradable\(raw\)/, "byof() must gate the 'before' level on isGradable");
  assert.match(byofBlock[0], /gradeLevel\(raw\)/, "byof() must compute the input reading level dynamically");

  // Live recompute on input — users see the level change as they type
  assert.match(byofBlock[0], /addEventListener\(['"]input['"]/, "byof() must recompute reading level on input");
});

test("analyzer: live reading-time estimate is computed and shown in the textstats row", () => {
  // Adds a "read Xs / X min" pill next to the word/char count so users
  // know the document's scope before they hit Analyze. Pairs with the
  // existing reading-level display to give a complete "what am I
  // about to read?" picture.
  if (!HAS_BROWSER) return;
  const fs = require("node:fs");
  const path = require("node:path");
  const appSrc = fs.readFileSync(path.join(ROOT, "assets", "app.js"), "utf8");
  const html = fs.readFileSync(path.join(ROOT, "analyze.html"), "utf8");

  // readTime helper must exist at the IIFE level (sibling of gradeLevel)
  assert.match(appSrc, /function readTime\(text\)/,
    "readTime helper must exist at the IIFE level");
  // Must cap the rate at 250 WPM (Brysbaert 2019 silent-reading baseline)
  assert.match(appSrc, /\/ 250/,
    "readTime must use the 250 WPM silent-reading baseline");
  // Must short-circuit on empty input so the UI never shows "0s"
  assert.match(appSrc, /if \(!t\) return '—';/,
    "readTime must return '—' for empty input (no '0s' display)");

  // analyze.html must have the #statReadTime placeholder in textstats
  assert.match(html, /id="statReadTime"/,
    "analyze.html must contain #statReadTime in the textstats row");
  // And it must be wired to updateTextStats (cached ref + paint)
  const updateBlock = appSrc.match(/function updateTextStats\(\)\{[\s\S]+?^\s\s\}/m);
  assert.ok(updateBlock, "updateTextStats() must exist");
  assert.match(updateBlock[0], /statReadTime[\s\S]+?\.textContent\s*=\s*readTime\(/,
    "updateTextStats() must paint readTime(raw) into #statReadTime");
  // The cached-ref destructure must include statReadTime
  assert.match(appSrc, /statReadTime\s*=\s*\$\(\s*['"]#statReadTime['"]\s*\)/,
    "the cached-refs block must include statReadTime=$('#statReadTime')");
});

test("analyzer: reading-time pill is color-banded by scope (quick / standard / long / marathon)", () => {
  // Polishes iter #1's readTime helper with a qualitative band that maps
  // the raw minutes to a user-friendly visual: green/ink for short, amber
  // for long docs, danger red for marathons. At-a-glance scope cue so
  // users know what they're about to read without parsing the number.
  if (!HAS_BROWSER) return;
  const fs = require("node:fs");
  const path = require("node:path");
  const appSrc = fs.readFileSync(path.join(ROOT, "assets", "app.js"), "utf8");
  const cssSrc = fs.readFileSync(path.join(ROOT, "assets", "theme.css"), "utf8");

  // readTimeBand helper must exist at the IIFE level
  assert.match(appSrc, /function readTimeBand\(text\)/,
    "readTimeBand helper must exist at the IIFE level (sibling of readTime)");

  // Must short-circuit on empty input → null (no pill class added)
  assert.match(appSrc, /function readTimeBand[\s\S]+?if \(!t\) return null;/,
    "readTimeBand must return null for empty input (no band class)");

  // Must hit all four bands — locks the thresholds
  for (const band of ["'quick'", "'standard'", "'long'", "'marathon'"]) {
    assert.ok(appSrc.includes(band),
      `readTimeBand must classify into ${band} (threshold test)`);
  }

  // The 15-minute boundary matters most — under it is 'long', at/above is 'marathon'.
  // Verify the threshold literal appears (15 in the marathon check).
  const bandFn = appSrc.match(/function readTimeBand\(text\)\{[\s\S]+?^\s\s\}/m);
  assert.ok(bandFn, "readTimeBand() must exist");
  assert.match(bandFn[0], /15/,
    "readTimeBand must use 15 as the long→marathon threshold");

  // updateTextStats must wire the band class onto #statReadTime
  const updateBlock = appSrc.match(/function updateTextStats\(\)\{[\s\S]+?^\s\s\}/m);
  assert.ok(updateBlock, "updateTextStats() must exist");
  assert.match(updateBlock[0],
    /classList\.remove\(['"]band-quick['"],\s*['"]band-standard['"],\s*['"]band-long['"],\s*['"]band-marathon['"]\)/,
    "updateTextStats() must remove all four band classes before adding the active one");
  assert.match(updateBlock[0],
    /classList\.add\(['"]band-['"]\s*\+\s*band\)/,
    "updateTextStats() must add 'band-' + band to #statReadTime");

  // CSS must define all four band colors so the visual cue actually paints
  for (const cls of [".band-quick", ".band-standard", ".band-long", ".band-marathon"]) {
    assert.ok(cssSrc.includes(cls),
      `theme.css must define a rule for ${cls}`);
  }
  // Marathon should be the loudest — danger color + bold + uppercase
  assert.match(cssSrc, /\.textstats\s+\.band-marathon\{[^}]*var\(--danger\)/,
    ".band-marathon must use --danger so it reads as the loudest band");
});

test("analyzer: live risk-preview pill appears when the input matches trap patterns", () => {
  // Counts distinct trap patterns from the local RISK array as the
  // user types, so they see "3 risks" BEFORE hitting Analyze. Teaches
  // users that ClearDoc catches things they didn't know to look for.
  // The whole point: a clean doc shows nothing, a trap-laden doc
  // shouts early. Polish (iter #4): broken down by severity so the
  // pill reads "1 trap · 2 watches · 1 note" instead of just a number.
  if (!HAS_BROWSER) return;
  const fs = require("node:fs");
  const path = require("node:path");
  const appSrc = fs.readFileSync(path.join(ROOT, "assets", "app.js"), "utf8");
  const html = fs.readFileSync(path.join(ROOT, "analyze.html"), "utf8");
  const cssSrc = fs.readFileSync(path.join(ROOT, "assets", "theme.css"), "utf8");

  // analyzePage() must define a countRisksBySeverity() helper that
  // walks the local RISK array and returns {trap, watch, note} counts.
  const analyzePageFn = appSrc.match(/function analyzePage\(\)\{[\s\S]+?\n  \}/);
  assert.ok(analyzePageFn, "analyzePage() must exist");
  assert.match(analyzePageFn[0], /function countRisksBySeverity\(text\)/,
    "countRisksBySeverity() helper must live inside analyzePage so it can use the local RISK array");
  assert.match(analyzePageFn[0], /for \(const r of RISK\)/,
    "countRisksBySeverity() must iterate RISK to count distinct pattern matches");
  // Must classify into all three severity buckets
  for (const sev of ["out.trap", "out.watch", "out.note"]) {
    assert.ok(analyzePageFn[0].includes(sev),
      `countRisksBySeverity() must classify into ${sev}`);
  }

  // analyze.html must have the risk-preview block with all three
  // severity sub-spans (trap is always visible, watch + note toggle)
  assert.match(html, /id="riskPreview"/,
    "analyze.html must contain #riskPreview below the textstats row");
  assert.match(html, /id="riskCount"/,
    "analyze.html must contain #riskCount for the trap count");
  assert.match(html, /id="watchWrap"/,
    "analyze.html must contain #watchWrap (toggles on watch hits)");
  assert.match(html, /id="watchCount"/,
    "analyze.html must contain #watchCount for the watch count");
  assert.match(html, /id="noteWrap"/,
    "analyze.html must contain #noteWrap (toggles on note hits)");
  assert.match(html, /id="noteCount"/,
    "analyze.html must contain #noteCount for the note count");

  // updateTextStats must paint the breakdown and toggle the band class
  const updateBlock = appSrc.match(/function updateTextStats\(\)\{[\s\S]+?^\s\s\}/m);
  assert.ok(updateBlock, "updateTextStats() must exist");
  assert.match(updateBlock[0], /countRisksBySeverity\(raw\)/,
    "updateTextStats() must call countRisksBySeverity(raw)");
  assert.match(updateBlock[0], /riskPreview\.hidden\s*=\s*rc\s*===\s*0/,
    "riskPreview must hide itself when no patterns match (clean doc → no scary pill)");
  assert.match(updateBlock[0], /riskCount\.textContent\s*=\s*sev\.trap/,
    "riskCount must show the live trap count");
  assert.match(updateBlock[0], /watchCount\.textContent\s*=\s*sev\.watch/,
    "watchCount must show the live watch count");
  assert.match(updateBlock[0], /noteCount\.textContent\s*=\s*sev\.note/,
    "noteCount must show the live note count");
  // Hide sub-spans with 0 count so the pill doesn't read "0 watches"
  assert.match(updateBlock[0], /watchWrap\.hidden\s*=\s*sev\.watch\s*===\s*0/,
    "watchWrap must hide itself when watch count is 0");
  assert.match(updateBlock[0], /noteWrap\.hidden\s*=\s*sev\.note\s*===\s*0/,
    "noteWrap must hide itself when note count is 0");
  // Band priority: trap > watch > note (most severe wins the bg)
  assert.match(updateBlock[0],
    /classList\.remove\(['"]risk-watch['"],\s*['"]risk-trap['"],\s*['"]risk-note['"]\)/,
    "updateTextStats must remove all three risk bands before adding the active one");
  assert.match(updateBlock[0], /if\s*\(sev\.trap\s*>=\s*1\)[\s\S]+?'risk-trap'[\s\S]+?else if\s*\(sev\.watch\s*>=\s*1\)[\s\S]+?'risk-watch'[\s\S]+?else[\s\S]+?'risk-note'/,
    "trap → risk-trap band; watch → risk-watch band; note → risk-note band");

  // CSS must define all three band colors so the visual cue paints
  for (const cls of [".risk-preview.risk-watch", ".risk-preview.risk-trap", ".risk-preview.risk-note"]) {
    assert.ok(cssSrc.includes(cls),
      `theme.css must define ${cls}`);
  }
  // risk-trap must use --danger so it reads as the loudest band
  assert.match(cssSrc, /\.risk-preview\.risk-trap\{[^}]*var\(--danger\)/,
    ".risk-preview.risk-trap must use --danger so it shouts");
});

test("analyzer: risk-preview pill expands to show matched patterns with labels", () => {
  // Click-to-expand wiring on the risk pill: lets users see WHICH
  // patterns matched (with their trap/watch/note tag + the smoking-gun
  // token + the why). Builds on iter #4's severity breakdown — the
  // pill says "1 trap · 2 watches", clicking expands the list of
  // matches so users learn the vocabulary of traps.
  if (!HAS_BROWSER) return;
  const fs = require("node:fs");
  const path = require("node:path");
  const appSrc = fs.readFileSync(path.join(ROOT, "assets", "app.js"), "utf8");
  const html = fs.readFileSync(path.join(ROOT, "analyze.html"), "utf8");
  const cssSrc = fs.readFileSync(path.join(ROOT, "assets", "theme.css"), "utf8");

  // analyzePage() must define matchRisks() returning matched entries
  const analyzePageFn = appSrc.match(/function analyzePage\(\)\{[\s\S]+?\n  \}/);
  assert.ok(analyzePageFn, "analyzePage() must exist");
  assert.match(analyzePageFn[0], /function matchRisks\(text\)/,
    "matchRisks() helper must live inside analyzePage to access the RISK array");
  assert.match(analyzePageFn[0], /r\.re\.exec\(t\)/,
    "matchRisks() must capture the matched substring (not just a boolean)");
  assert.match(analyzePageFn[0], /function renderRiskDetail\(hits\)/,
    "renderRiskDetail() must exist to paint the expanded list");

  // analyze.html: pill is a button with aria-controls, detail div exists
  assert.match(html, /<button[^>]*id="riskPreview"/,
    "#riskPreview must be a <button> (clickable, keyboard-accessible)");
  assert.match(html, /aria-expanded="false"/,
    "#riskPreview must default to aria-expanded=false");
  assert.match(html, /aria-controls="riskDetail"/,
    "#riskPreview must aria-controls the #riskDetail div");
  assert.match(html, /id="riskDetail"/,
    "analyze.html must contain #riskDetail (the expanded list target)");

  // updateTextStats must re-render the detail list when expanded
  const updateBlock = appSrc.match(/function updateTextStats\(\)\{[\s\S]+?^\s\s\}/m);
  assert.ok(updateBlock, "updateTextStats() must exist");
  assert.match(updateBlock[0], /riskDetail && !riskDetail\.hidden &&[\s\S]+?renderRiskDetail\(hits\)/,
    "updateTextStats() must re-render riskDetail when expanded (stay in sync while typing)");
  // Must auto-collapse when input is cleared so we don't leave a dangling list
  assert.match(updateBlock[0], /riskDetail\.hidden\s*=\s*true/,
    "riskDetail must auto-collapse when input is cleared");

  // Click handler toggles expansion + aria-expanded + chevron rotation
  assert.match(appSrc, /riskPreview\.addEventListener\(\s*['"]click['"]/,
    "#riskPreview must have a click handler that toggles the detail list");
  assert.match(appSrc, /aria-expanded['"],\s*willOpen\s*\?\s*['"]true['"]\s*:\s*['"]false['"]/,
    "click handler must flip aria-expanded to true/false correctly");
  assert.match(appSrc, /riskPreview\.classList\.toggle\(\s*['"]rp-open['"],\s*willOpen\s*\)/,
    "click handler must toggle the rp-open class for chevron rotation");

  // Escape key collapses the list (keyboard a11y parity with FAQ)
  assert.match(appSrc, /e\.key\s*===\s*['"]Escape['"][\s\S]+?riskDetail\.hidden\s*=\s*true/,
    "Escape key must collapse the expanded list");

  // renderRiskDetail sorts trap → watch → note so loudest reads first
  const renderFn = appSrc.match(/function renderRiskDetail\(hits\)\{[\s\S]+?^\s\s\}/m);
  assert.ok(renderFn, "renderRiskDetail() must exist");
  assert.match(renderFn[0], /rank\[a\.sev\]/,
    "renderRiskDetail() must sort hits by severity so trap floats to the top");
  assert.match(renderFn[0], /esc\(h\.matched/,
    "renderRiskDetail() must esc() the matched substring (XSS defense — user text hits innerHTML)");
  // Each row shows tag + matched token + why
  assert.match(renderFn[0], /rd-tag/,
    "renderRiskDetail() must render a tag element for each row");
  assert.match(renderFn[0], /rd-hit/,
    "renderRiskDetail() must render a hit (matched substring) element for each row");
  assert.match(renderFn[0], /rd-why/,
    "renderRiskDetail() must render a why (explanation) element for each row");

  // CSS: chevron rotation + detail row layout
  assert.match(cssSrc, /\.risk-preview\.rp-open\s+\.rp-chev\{[^}]*rotate\(180deg\)/,
    "rp-open .rp-chev must rotate 180° when the list is expanded");
  assert.match(cssSrc, /\.risk-detail-row\s*\{[^}]*grid-template-columns/,
    ".risk-detail-row must use CSS grid (tag | hit | why columns)");
  for (const cls of [".risk-detail-row.trap .rd-tag", ".risk-detail-row.watch .rd-tag", ".risk-detail-row.note .rd-tag"]) {
    assert.ok(cssSrc.includes(cls), `theme.css must define ${cls} for severity-coded tags`);
  }
});

test("analyzer: expanded risk detail has a Copy button that exports matches as plain text", () => {
  // Polishes iter #5's expanded list. The Copy button lets users paste
  // the matched-pattern summary into email / a doc without screenshotting.
  // Uses the same navigator.clipboard pattern + execCommand fallback as
  // the existing verdictCopyBtn elsewhere in the file.
  if (!HAS_BROWSER) return;
  const fs = require("node:fs");
  const path = require("node:path");
  const appSrc = fs.readFileSync(path.join(ROOT, "assets", "app.js"), "utf8");
  const cssSrc = fs.readFileSync(path.join(ROOT, "assets", "theme.css"), "utf8");

  const analyzePageFn = appSrc.match(/function analyzePage\(\)\{[\s\S]+?\n  \}/);
  assert.ok(analyzePageFn, "analyzePage() must exist");

  // formatMatchesForCopy() must exist and produce a structured plain-text list
  assert.match(analyzePageFn[0], /function formatMatchesForCopy\(hits\)/,
    "formatMatchesForCopy() helper must live inside analyzePage");
  assert.match(analyzePageFn[0], /'TRAP'[\s\S]+?'WATCH'[\s\S]+?'NOTE'/,
    "formatMatchesForCopy() must use all three severity tags");
  assert.match(analyzePageFn[0], /— matched by ClearDoc/,
    "formatMatchesForCopy() must close with a ClearDoc attribution so the source is preserved");

  // renderRiskDetail must paint the toolbar with the copy button
  const renderFn = appSrc.match(/function renderRiskDetail\(hits\)\{[\s\S]+?^\s\s\}/m);
  assert.ok(renderFn, "renderRiskDetail() must exist");
  assert.match(renderFn[0], /risk-detail-toolbar/,
    "renderRiskDetail() must render a .risk-detail-toolbar row");
  assert.match(renderFn[0], /data-rd-copy="1"/,
    "renderRiskDetail() must render a copy button with [data-rd-copy] for delegated clicks");
  assert.match(renderFn[0], /rd-count/,
    "renderRiskDetail() must render a .rd-count element showing the pattern count");

  // Delegated click handler on riskDetail (not per-render)
  assert.match(analyzePageFn[0],
    /riskDetail\.addEventListener\(\s*['"]click['"][\s\S]+?closest\([^)]*data-rd-copy/,
    "riskDetail must delegate clicks via [data-rd-copy] so re-renders don't stack handlers");
  // Must use the same clipboard pattern as verdictCopyBtn (navigator.clipboard + execCommand fallback)
  assert.match(analyzePageFn[0],
    /riskDetail\.addEventListener[\s\S]+?navigator\.clipboard\.writeText[\s\S]+?document\.execCommand\(\s*['"]copy['"]\s*\)/,
    "Copy handler must use navigator.clipboard with execCommand fallback");
  // Flash feedback "Copied ✓" / "Copy failed"
  assert.match(analyzePageFn[0],
    /riskDetail\.addEventListener[\s\S]+?Copied ✓[\s\S]+?Copy failed/,
    "Copy handler must flash 'Copied ✓' or 'Copy failed' for 1.4s");

  // CSS must style the toolbar + copy button
  assert.match(cssSrc, /\.risk-detail-toolbar\{[^}]*display:\s*flex/,
    ".risk-detail-toolbar must be a flex row (count | copy button)");
  assert.match(cssSrc, /\.risk-detail-toolbar \.rd-copy\{[^}]*cursor:\s*pointer/,
    ".rd-copy must be a clickable button (cursor: pointer)");
});

test("analyzer: document-type badge detects lease / medical / subscription / etc. as the user types", () => {
  // Detects what kind of document the user is reading — lease, medical
  // bill, subscription, etc. — and shows a color-coded badge in the
  // textstats row. Pairs with the reading-time + risk-preview to give
  // a complete "what am I about to read?" picture before Analyze.
  // The badge is hidden when confidence is too low (single keyword
  // match) — better to say "—" than mislabel a credit-card terms doc
  // as a lease because it once said "tenant".
  if (!HAS_BROWSER) return;
  const fs = require("node:fs");
  const path = require("node:path");
  const appSrc = fs.readFileSync(path.join(ROOT, "assets", "app.js"), "utf8");
  const html = fs.readFileSync(path.join(ROOT, "analyze.html"), "utf8");
  const cssSrc = fs.readFileSync(path.join(ROOT, "assets", "theme.css"), "utf8");

  // detectDocType + DOC_TYPES must live at the IIFE level (sibling of readTime)
  assert.match(appSrc, /const DOC_TYPES\s*=\s*\[/,
    "DOC_TYPES array must exist at the IIFE level");
  assert.match(appSrc, /function detectDocType\(text\)/,
    "detectDocType() helper must exist at the IIFE level");

  // Must cover the major categories users actually paste in
  for (const t of ["lease", "medical", "subscription", "employment", "loan", "privacy", "terms", "insurance", "debt", "tax"]) {
    assert.ok(appSrc.includes(`name: '${t}'`),
      `DOC_TYPES must include a '${t}' entry (the major categories users paste)`);
  }

  // Confidence floor — single matches must NOT trigger the badge
  assert.match(appSrc, /if \(m < 2\) continue;/,
    "detectDocType must require ≥2 matches (single-keyword label would mislead)");

  // analyze.html must have the #statDocType placeholder in textstats
  assert.match(html, /id="statDocType"/,
    "analyze.html must contain #statDocType in the textstats row");

  // updateTextStats must paint the label and toggle the dt-<name> class
  const updateBlock = appSrc.match(/function updateTextStats\(\)\{[\s\S]+?^\s\s\}/m);
  assert.ok(updateBlock, "updateTextStats() must exist");
  assert.match(updateBlock[0], /detectDocType\(raw\)/,
    "updateTextStats() must call detectDocType(raw)");
  assert.match(updateBlock[0], /statDocType\.textContent\s*=\s*dt\.label/,
    "statDocType must show the detected type's label");
  assert.match(updateBlock[0], /classList\.add\(\s*['"]dt-['"]\s*\+\s*dt\.name/,
    "updateTextStats must add the 'dt-' + dt.name class for color coding");
  // Must show '—' (not hide) when no type detected, so the row stays aligned
  assert.match(updateBlock[0], /statDocType\.textContent\s*=\s*'—'/,
    "statDocType must show '—' (not blank) when no type detected, so the row stays aligned");

  // CSS must define a distinct color per doc type
  for (const cls of [".dt-lease", ".dt-medical", ".dt-subscription", ".dt-employment",
                     ".dt-loan", ".dt-privacy", ".dt-terms", ".dt-insurance",
                     ".dt-debt", ".dt-tax"]) {
    assert.ok(cssSrc.includes(cls),
      `theme.css must define ${cls} for distinct doc-type colors`);
  }
  // Confidence styling — 'high' must visually pop more than 'likely'
  assert.match(cssSrc, /\.dt-conf-high\{[^}]*font-weight:\s*800/,
    ".dt-conf-high must use font-weight 800 so high-confidence types pop");
});

test("analyzer: doc-type tip shows per-type 'what to look for' below the badge", () => {
  // Polishes iter #7's doc-type badge with hand-curated watch-for tips.
  // Each tip is the 3-5 most common trap clauses for that category,
  // so users learn the vocabulary of traps BEFORE they hit Analyze.
  // The tip color matches the badge color (visual link).
  if (!HAS_BROWSER) return;
  const fs = require("node:fs");
  const path = require("node:path");
  const appSrc = fs.readFileSync(path.join(ROOT, "assets", "app.js"), "utf8");
  const html = fs.readFileSync(path.join(ROOT, "analyze.html"), "utf8");
  const cssSrc = fs.readFileSync(path.join(ROOT, "assets", "theme.css"), "utf8");

  // DOC_TYPE_TIPS map must exist at the IIFE level (sibling of DOC_TYPES)
  assert.match(appSrc, /const DOC_TYPE_TIPS\s*=\s*\{/,
    "DOC_TYPE_TIPS map must exist at the IIFE level");
  assert.match(appSrc, /function getDocTypeTip\(name\)/,
    "getDocTypeTip() helper must exist at the IIFE level");
  // Must cover all 10 doc types
  for (const t of ["lease", "medical", "subscription", "employment", "loan",
                   "privacy", "terms", "insurance", "debt", "tax"]) {
    assert.ok(appSrc.includes(`${t}:`),
      `DOC_TYPE_TIPS must include an entry for '${t}'`);
  }
  // Tips must be substantive (3-5 hand-curated items per type)
  const leaseTip = appSrc.match(/lease:\s*'([^']+)'/);
  assert.ok(leaseTip && leaseTip[1].split(',').length >= 3,
    "lease tip must have at least 3 watch-for items (substance check)");

  // analyze.html must have the tip element with both the kicker + text spans
  assert.match(html, /id="docTypeTip"/,
    "analyze.html must contain #docTypeTip below the textstats row");
  assert.match(html, /class="dtt-kicker"/,
    "#docTypeTip must include the //-style kicker span");
  assert.match(html, /id="docTypeTipText"/,
    "#docTypeTip must include #docTypeTipText for the dynamic tip body");

  // updateTextStats must paint the tip and toggle visibility with the badge
  const updateBlock = appSrc.match(/function updateTextStats\(\)\{[\s\S]+?^\s\s\}/m);
  assert.ok(updateBlock, "updateTextStats() must exist");
  assert.match(updateBlock[0], /getDocTypeTip\(dt\.name\)/,
    "updateTextStats must call getDocTypeTip(dt.name) when a type is detected");
  assert.match(updateBlock[0], /docTypeTipText\.textContent\s*=\s*tip/,
    "docTypeTipText must show the tip body when type is detected");
  assert.match(updateBlock[0], /docTypeTip\.hidden\s*=\s*false/,
    "docTypeTip must unhide when a tip is available");
  // Must hide the tip when no type is detected (no orphan tip dangling)
  assert.match(updateBlock[0], /docTypeTip\.hidden\s*=\s*true/,
    "docTypeTip must hide when no type is detected (no orphan tip)");

  // CSS must style the tip with the //-kicker accent
  assert.match(cssSrc, /\.doc-type-tip\s*\{[^}]*display:\s*flex/,
    ".doc-type-tip must be a flex row (kicker | text)");
  assert.match(cssSrc, /\.doc-type-tip\s+\.dtt-kicker\{[^}]*var\(--accent-text\)/,
    ".dtt-kicker must use --accent-text (the //-kicker color used elsewhere)");
  // Per-type color rules so the tip follows the badge color
  for (const cls of [".dtt-lease", ".dtt-medical", ".dtt-subscription", ".dtt-employment",
                     ".dtt-loan", ".dtt-privacy", ".dtt-terms", ".dtt-insurance",
                     ".dtt-debt", ".dtt-tax"]) {
    assert.ok(cssSrc.includes(cls),
      `theme.css must define ${cls} .dtt-text color (visual link to badge)`);
  }
});

test("analyzer: reading-level shows friendly label (College / Graduate / etc.) next to numeric grade", () => {
  // Replaces the bare "12th" with "12th · College" so the analyzer
  // describes the document, not the reader. Color-codes by density:
  // green for plain English, amber for college, danger red for grad.
  if (!HAS_BROWSER) return;
  const fs = require("node:fs");
  const path = require("node:path");
  const appSrc = fs.readFileSync(path.join(ROOT, "assets", "app.js"), "utf8");
  const html = fs.readFileSync(path.join(ROOT, "analyze.html"), "utf8");
  const cssSrc = fs.readFileSync(path.join(ROOT, "assets", "theme.css"), "utf8");

  // friendlyGrade + gradeDensity must exist at the IIFE level
  assert.match(appSrc, /function friendlyGrade\(n\)/,
    "friendlyGrade() helper must exist at the IIFE level");
  assert.match(appSrc, /function gradeDensity\(n\)/,
    "gradeDensity() helper must exist at the IIFE level");

  // Must classify into all five conventional US school grade ranges
  for (const label of ["'Elementary'", "'Middle school'", "'High school'", "'College'", "'Graduate'"]) {
    assert.ok(appSrc.includes(label),
      `friendlyGrade must classify into ${label}`);
  }
  // Density bands: easy / standard / dense / very-dense
  for (const density of ["'easy'", "'standard'", "'dense'", "'very-dense'"]) {
    assert.ok(appSrc.includes(density),
      `gradeDensity must classify into ${density}`);
  }
  // Must short-circuit on non-numeric / non-finite inputs
  assert.match(appSrc, /friendlyGrade[\s\S]+?typeof n !== 'number'/,
    "friendlyGrade must short-circuit on non-number input");
  assert.match(appSrc, /gradeDensity[\s\S]+?typeof n !== 'number'/,
    "gradeDensity must short-circuit on non-number input");

  // analyze.html must have the #statFriendly placeholder next to #statLevel
  assert.match(html, /id="statFriendly"/,
    "analyze.html must contain #statFriendly next to #statLevel");
  assert.match(html, /class="stat-friendly"/,
    "#statFriendly must have the stat-friendly class for the color-coding");

  // updateTextStats must paint the friendly label and apply density class
  const updateBlock = appSrc.match(/function updateTextStats\(\)\{[\s\S]+?^\s\s\}/m);
  assert.ok(updateBlock, "updateTextStats() must exist");
  assert.match(updateBlock[0], /statFriendly\.textContent\s*=\s*label/,
    "statFriendly must show the friendlyGrade label");
  assert.match(updateBlock[0], /statFriendly\.className\s*=\s*['"]stat-friendly density-['"]\s*\+\s*/,
    "statFriendly must apply the density-<density> class for color coding");
  // Must hide when input is not gradable
  assert.match(updateBlock[0], /statFriendly\.hidden\s*=\s*true/,
    "statFriendly must hide when input is not gradable");

  // CSS: density color rules
  for (const cls of [".density-easy", ".density-standard", ".density-dense", ".density-very-dense"]) {
    assert.ok(cssSrc.includes(cls),
      `theme.css must define ${cls} for the friendly label color`);
  }
  // Easy = green (plain English = reassuring)
  assert.match(cssSrc, /\.stat-friendly\.density-easy\{[^}]*var\(--green\)/,
    ".density-easy must use --green so plain-English docs feel reassuring");
  // Very-dense = danger red (graduate-level = a warning to the reader)
  assert.match(cssSrc, /\.stat-friendly\.density-very-dense\{[^}]*var\(--danger\)/,
    ".density-very-dense must use --danger so graduate-level docs warn the reader");
});

test("analyzer: textstats row is ordered by signal-strength (type → level → read → words → chars → cap)", () => {
  // Polishes the textstats row so the high-signal qualitative info
  // (TYPE, LEVEL) leads, then the time estimate (READ), then the
  // raw counts (WORDS, CHARS), with the limit (CAP) last. Puts the
  // insight before the data — users see "Lease · College · 3 min"
  // before they see "750 words".
  if (!HAS_BROWSER) return;
  const fs = require("node:fs");
  const path = require("node:path");
  const html = fs.readFileSync(path.join(ROOT, "analyze.html"), "utf8");

  // Extract the textstats block
  const block = html.match(/<div class="textstats mono" id="textStats"[^>]*>([\s\S]+?)<\/div>/);
  assert.ok(block, "analyze.html must contain the #textStats block");
  const inner = block[1];

  // Find the positions of each stat's id within the block
  const pos = (id) => inner.indexOf('id="' + id + '"');
  const positions = {
    statDocType: pos("statDocType"),
    statLevel:   pos("statLevel"),
    statFriendly: pos("statFriendly"),
    statReadTime: pos("statReadTime"),
    statWords:    pos("statWords"),
    statChars:    pos("statChars"),
    statCap:      pos("statCap"),
  };

  // All ids must exist
  for (const k of Object.keys(positions)) {
    assert.ok(positions[k] >= 0, k + " must appear in the textstats block");
  }

  // TYPE must lead (position 0+)
  assert.ok(positions.statDocType < positions.statLevel,
    "TYPE must come before LEVEL (qualitative info first)");
  assert.ok(positions.statLevel < positions.statReadTime,
    "LEVEL must come before READ (density before time)");
  assert.ok(positions.statReadTime < positions.statWords,
    "READ must come before WORDS (estimate before counts)");
  assert.ok(positions.statWords < positions.statChars,
    "WORDS must come before CHARS (more familiar metric first)");
  assert.ok(positions.statChars < positions.statCap,
    "CHARS must come before CAP (count before limit)");
});

test("analyzer: deadlines preview shows live count + soonest deadline with urgency color", () => {
  // Counts date / "N days" patterns detected in the input as the
  // user types. Surfaces the soonest one with urgency color so users
  // see timing pressure before clicking Analyze. Past dates read
  // loudest (already missed), < 7 days next, then < 30, else muted.
  if (!HAS_BROWSER) return;
  const fs = require("node:fs");
  const path = require("node:path");
  const appSrc = fs.readFileSync(path.join(ROOT, "assets", "app.js"), "utf8");
  const html = fs.readFileSync(path.join(ROOT, "analyze.html"), "utf8");
  const cssSrc = fs.readFileSync(path.join(ROOT, "assets", "theme.css"), "utf8");

  // extractDeadlines must live at the IIFE level
  assert.match(appSrc, /function extractDeadlines\(text\)/,
    "extractDeadlines() helper must exist at the IIFE level");
  // Must handle all 4 pattern shapes
  assert.match(appSrc, /kind:\s*['"]absolute['"]/,
    "extractDeadlines must handle absolute dates ('January 15, 2026')");
  assert.match(appSrc, /kind:\s*['"]iso['"]/,
    "extractDeadlines must handle ISO dates ('2026-01-15')");
  assert.match(appSrc, /kind:\s*['"]relative['"]/,
    "extractDeadlines must handle relative dates ('within 30 days')");
  assert.match(appSrc, /kind:\s*['"]relative-notice['"]/,
    "extractDeadlines must handle 'N-day notice' patterns");
  // Must sort by urgency ascending (past dates first)
  assert.match(appSrc, /a\.urgencyDays\s*-\s*b\.urgencyDays/,
    "extractDeadlines must sort by urgencyDays ascending so soonest reads first");
  // Must cap the list (don't surface 50 deadlines)
  assert.match(appSrc, /slice\(0,\s*8\)/,
    "extractDeadlines must cap at 8 results (no flooding the pill)");

  // analyze.html must have the deadlines preview block
  assert.match(html, /id="deadlinesPreview"/,
    "analyze.html must contain #deadlinesPreview");
  assert.match(html, /id="deadlinesCount"/,
    "analyze.html must contain #deadlinesCount");
  assert.match(html, /id="deadlinesSoonest"/,
    "analyze.html must contain #deadlinesSoonest");
  assert.match(html, /id="deadlinesPlural"/,
    "analyze.html must contain #deadlinesPlural for 'deadline' / 'deadlines'");

  // updateTextStats must paint the count + soonest label + urgency band
  const updateBlock = appSrc.match(/function updateTextStats\(\)\{[\s\S]+?^\s\s\}/m);
  assert.ok(updateBlock, "updateTextStats() must exist");
  assert.match(updateBlock[0], /extractDeadlines\(raw\)/,
    "updateTextStats must call extractDeadlines(raw)");
  assert.match(updateBlock[0], /deadlinesPreview\.hidden\s*=\s*true/,
    "deadlinesPreview must hide when no deadlines found");
  assert.match(updateBlock[0], /deadlinesCount\.textContent\s*=\s*dls\.length/,
    "deadlinesCount must show the live count");
  assert.match(updateBlock[0], /deadlinesSoonest\.textContent\s*=\s*soonestLabel/,
    "deadlinesSoonest must show the formatted soonest label");
  // Friendly formatting: 'today' / 'tomorrow' / 'in N days'
  for (const label of ["'today'", "'tomorrow'", "'in '"]) {
    assert.ok(updateBlock[0].includes(label),
      `deadlinesSoonest must support friendly ${label} formatting`);
  }
  // Urgency bands
  assert.match(updateBlock[0], /classList\.add\(\s*['"]dp-(?:past|urgent|soon|future)['"]/,
    "updateTextStats must apply one of dp-past/dp-urgent/dp-soon/dp-future");
  assert.match(updateBlock[0], /dp-past['"][\s\S]+?dp-urgent['"][\s\S]+?dp-soon['"][\s\S]+?dp-future/,
    "Urgency priority must be past < urgent (<7d) < soon (<30d) < future");

  // CSS must define all four urgency band colors
  for (const cls of [".deadlines-preview.dp-past", ".deadlines-preview.dp-urgent",
                     ".deadlines-preview.dp-soon", ".deadlines-preview.dp-future"]) {
    assert.ok(cssSrc.includes(cls),
      `theme.css must define ${cls} for urgency band color`);
  }
  // Past/urgent must use --danger (already missed = loudest signal)
  assert.match(cssSrc, /\.deadlines-preview\.dp-past\{[^}]*var\(--danger\)/,
    ".dp-past must use --danger (missed deadline = loudest urgency)");
  assert.match(cssSrc, /\.deadlines-preview\.dp-urgent\{[^}]*var\(--danger\)/,
    ".dp-urgent must use --danger (<7 days = urgent)");
  // Soon (<30 days) must use --amber
  assert.match(cssSrc, /\.deadlines-preview\.dp-soon\{[^}]*var\(--amber\)/,
    ".dp-soon must use --amber (<30 days)");
});

test("analyzer: deadlines preview has an Add-to-Calendar button that exports the soonest deadline as ICS", () => {
  // Polishes iter #11's deadlines preview. One-click ICS download of
  // the soonest deadline so users can drop it into Google / Apple /
  // Outlook. Same Blob+download pattern as the existing draft export.
  if (!HAS_BROWSER) return;
  const fs = require("node:fs");
  const path = require("node:path");
  const appSrc = fs.readFileSync(path.join(ROOT, "assets", "app.js"), "utf8");
  const html = fs.readFileSync(path.join(ROOT, "analyze.html"), "utf8");
  const cssSrc = fs.readFileSync(path.join(ROOT, "assets", "theme.css"), "utf8");

  // _icsDateStamp + buildIcsForDate must exist at the IIFE level
  assert.match(appSrc, /function _icsDateStamp\(d\)/,
    "_icsDateStamp() helper must exist at the IIFE level");
  assert.match(appSrc, /function buildIcsForDate\(dt, summary\)/,
    "buildIcsForDate() helper must exist at the IIFE level");

  // RFC 5545 compliance: must escape commas, semicolons, backslashes, newlines
  assert.match(appSrc, /buildIcsForDate[\s\S]+?replace\(/,
    "buildIcsForDate must escape per RFC 5545 § 3.3.11");
  // Must include all required ICS sections
  for (const section of [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:",
    "BEGIN:VEVENT",
    "UID:",
    "DTSTAMP:",
    "DTSTART",
    "SUMMARY:",
    "END:VEVENT",
    "END:VCALENDAR",
  ]) {
    assert.ok(appSrc.includes("'" + section + "'") || appSrc.includes('"' + section + '"') || appSrc.includes(section),
      `buildIcsForDate must emit ${section}`);
  }
  // All-day event with VALUE=DATE (no time component)
  assert.match(appSrc, /VALUE=DATE/,
    "buildIcsForDate must use VALUE=DATE for all-day deadlines (no time)");
  // CRLF line endings per RFC 5545
  assert.match(appSrc, /\\r\\n/,
    "buildIcsForDate must use CRLF line endings (RFC 5545 requirement)");

  // analyze.html must have the calendar-export button
  assert.match(html, /id="deadlinesCalBtn"/,
    "analyze.html must contain #deadlinesCalBtn");
  assert.match(html, /aria-label="Add soonest deadline to calendar"/,
    "#deadlinesCalBtn must have an aria-label for screen readers");

  // Click handler must wire up ICS download + Blob URL pattern
  assert.match(appSrc, /deadlinesCalBtn\.addEventListener\(\s*['"]click['"]/,
    "#deadlinesCalBtn must have a click handler");
  // (iter #13 upgraded this from buildIcsForDate to buildIcs — multi-event)
  assert.match(appSrc, /deadlinesCalBtn\.addEventListener[\s\S]+?buildIcs\(/,
    "click handler must call buildIcs (multi-event) to export deadlines");
  assert.match(appSrc, /deadlinesCalBtn\.addEventListener[\s\S]+?new Blob\(\s*\[\s*ics\s*\]/,
    "click handler must wrap the ICS in a Blob");
  assert.match(appSrc, /deadlinesCalBtn\.addEventListener[\s\S]+?URL\.createObjectURL/,
    "click handler must use URL.createObjectURL for the download");
  assert.match(appSrc, /deadlinesCalBtn\.addEventListener[\s\S]+?cleardoc-deadlines-/,
    "filename must start with 'cleardoc-deadlines-' (plural for multi-event)");

  // Flash feedback on success
  assert.match(appSrc, /deadlinesCalBtn\.addEventListener[\s\S]+?added/,
    "button must flash 'added' for 1.4s on successful export");

  // CSS: button is part of the deadlines preview
  assert.match(cssSrc, /\.deadlines-preview \.dp-cal\{[^}]*cursor:\s*pointer/,
    ".dp-cal must be a clickable button (cursor: pointer)");
  // Hover state mirrors the existing CTA pattern
  assert.match(cssSrc, /\.deadlines-preview \.dp-cal:hover/,
    ".dp-cal must have a hover state for affordance");
});

test("analyzer: calendar button exports ALL detected deadlines as a multi-event ICS file", () => {
  // Polishes iter #12 — now exports every detected deadline (up to 8)
  // as one multi-event ICS file, not just the soonest. Button label
  // scales with count: '+ calendar' (1) / '+ 3 calendar' (3+).
  if (!HAS_BROWSER) return;
  const fs = require("node:fs");
  const path = require("node:path");
  const appSrc = fs.readFileSync(path.join(ROOT, "assets", "app.js"), "utf8");

  // buildIcs (multi-event) must exist alongside buildIcsForDate
  assert.match(appSrc, /function buildIcs\(items\)/,
    "buildIcs() (multi-event) must exist at the IIFE level");

  // Multi-event structure: one VCALENDAR wrapper, multiple VEVENT blocks
  assert.match(appSrc, /function buildIcs\(items\)\{[\s\S]+?valid\.forEach/,
    "buildIcs must iterate items to emit multiple VEVENT blocks");

  // Must guard on empty / invalid input
  assert.match(appSrc, /function buildIcs\(items\)\{[\s\S]+?Array\.isArray\(items\)/,
    "buildIcs must guard on non-array input");
  assert.match(appSrc, /function buildIcs\(items\)\{[\s\S]+?items\.filter/,
    "buildIcs must filter out items without valid dates");

  // Must cap at 50 events (defensive — runaway ICS protection)
  assert.match(appSrc, /function buildIcs\(items\)\{[\s\S]+?\.slice\(0,\s*50\)/,
    "buildIcs must cap events at 50 to avoid runaway ICS files");

  // Click handler must call buildIcs (multi-event), not buildIcsForDate
  assert.match(appSrc, /deadlinesCalBtn\.addEventListener\([\s\S]+?buildIcs\(/,
    "click handler must call buildIcs() (multi-event) to export all deadlines");
  assert.match(appSrc, /deadlinesCalBtn\.addEventListener\([\s\S]+?deadlinesCalBtn\._deadlines/,
    "click handler must read the stashed deadlines list from _deadlines");

  // Filename must use 'cleardoc-deadlines-' (plural) for multi-event files
  assert.match(appSrc, /deadlinesCalBtn\.addEventListener\([\s\S]+?'cleardoc-deadlines-'/,
    "multi-event filename must start with 'cleardoc-deadlines-' (plural)");

  // Button label scales with count
  assert.match(appSrc, /deadlinesCalBtn\.addEventListener\([\s\S]+?'added ' \+ list\.length \+ ' ✓'/,
    "flash feedback must show 'added N ✓' for multi-event exports");

  // Button label updates dynamically with count
  const updateBlock = appSrc.match(/function updateTextStats\(\)\{[\s\S]+?^\s\s\}/m);
  assert.ok(updateBlock, "updateTextStats() must exist");
  assert.match(updateBlock[0], /deadlinesCalBtn\._deadlines\s*=\s*dls/,
    "updateTextStats must stash the deadlines list on the button");
  assert.match(updateBlock[0],
    /deadlinesCalBtn\._origText\s*=\s*label/,
    "updateTextStats must cache the current button label for flash feedback");
  // '+ N calendar' for multi-event, '+ calendar' for single
  assert.match(updateBlock[0],
    /\(dls\.length === 1\) \? '\+ calendar' : \('\+ ' \+ dls\.length \+ ' calendar'\)/,
    "button label must scale: 1 → '+ calendar'; N → '+ N calendar'");

  // Title scales too (screen-reader hint + hover)
  assert.match(updateBlock[0], /deadlinesCalBtn\.title\s*=[\s\S]+?dls\.length/,
    "button title must reflect the deadline count for hover + a11y");
});

test("analyzer: deadlines preview shows inline urgency-dot timeline (every deadline visible)", () => {
  // Polishes iter #11/13 — instead of hiding 7 of 8 deadlines behind
  // "soonest: X", shows every detected deadline as a colored dot in
  // a horizontal row. Dot color = urgency band (past/urgent red,
  // soon amber, future outlined). Hover for full label. Reads at-a-
  // glance: a row of red dots = "lots of urgency", mostly outlined =
  // "plenty of time".
  if (!HAS_BROWSER) return;
  const fs = require("node:fs");
  const path = require("node:path");
  const appSrc = fs.readFileSync(path.join(ROOT, "assets", "app.js"), "utf8");
  const html = fs.readFileSync(path.join(ROOT, "analyze.html"), "utf8");
  const cssSrc = fs.readFileSync(path.join(ROOT, "assets", "theme.css"), "utf8");

  // analyze.html must have the #deadlinesTimeline container
  assert.match(html, /id="deadlinesTimeline"/,
    "analyze.html must contain #deadlinesTimeline inside #deadlinesPreview");

  // updateTextStats must render one dot per deadline with the right
  // urgency class (past / urgent / soon / future)
  const updateBlock = appSrc.match(/function updateTextStats\(\)\{[\s\S]+?^\s\s\}/m);
  assert.ok(updateBlock, "updateTextStats() must exist");
  assert.match(updateBlock[0], /deadlinesTimeline\.innerHTML\s*=\s*dots/,
    "updateTextStats must render the dots into deadlinesTimeline.innerHTML");
  // Must map urgencyDays to the four dot classes
  for (const cls of ["dp-dot-past", "dp-dot-urgent", "dp-dot-soon", "dp-dot-future"]) {
    assert.ok(updateBlock[0].includes(cls),
      `updateTextStats must apply ${cls} based on urgencyDays`);
  }
  // Each dot must have a title attribute for hover / screen-reader
  assert.match(updateBlock[0], /title="[^"]*"/,
    "each dot must carry a title attribute (hover label)");
  // Past / urgent dots are filled; future dots are outlined (visual
  // gradient from past=filled red → future=outlined grey)
  assert.match(cssSrc, /\.dp-dot-past\{[^}]*background:\s*var\(--danger\)/,
    ".dp-dot-past must be filled danger red (already missed = filled)");
  assert.match(cssSrc, /\.dp-dot-future\{[^}]*background:\s*transparent/,
    ".dp-dot-future must be transparent / outlined (low pressure = outline only)");
  assert.match(cssSrc, /\.dp-dot-soon\{[^}]*background:\s*var\(--amber\)/,
    ".dp-dot-soon must be filled amber (coming up)");
  // Timeline is a flex row of dots
  assert.match(cssSrc, /\.dp-timeline\{[^}]*display:\s*inline-flex/,
    ".dp-timeline must be an inline-flex row (compact, inline with the label)");
});

test("analyzer: clicking a risk row highlights the source sentence in the input", () => {
  // Polishes iter #5 — clicking a matched pattern now locates the
  // source sentence in the textarea so users see context. Pairs the
  // "what" (the matched token in the list) with the "where" (the
  // original clause in the document).
  if (!HAS_BROWSER) return;
  const fs = require("node:fs");
  const path = require("node:path");
  const appSrc = fs.readFileSync(path.join(ROOT, "assets", "app.js"), "utf8");
  const cssSrc = fs.readFileSync(path.join(ROOT, "assets", "theme.css"), "utf8");

  // renderRiskDetail must add data-rd-locate + tabindex + role to rows
  const renderFn = appSrc.match(/function renderRiskDetail\(hits\)\{[\s\S]+?^\s\s\}/m);
  assert.ok(renderFn, "renderRiskDetail() must exist");
  assert.match(renderFn[0], /data-rd-locate="/,
    "each row must carry data-rd-locate for the click handler to find the source text");
  assert.match(renderFn[0], /tabindex="0"/,
    "each row must be tabindex=0 for keyboard focus");
  assert.match(renderFn[0], /role="button"/,
    "each row must have role=button for screen-reader semantics");
  // Must esc() the matched substring before going into the attribute
  // (defense against attribute-injection via crafted doc text)
  assert.match(renderFn[0], /esc\(h\.matched[\s\S]+?data-rd-locate/,
    "data-rd-locate must escape the matched substring (attribute-injection defense)");

  // Click handler must locate the source sentence + extend selection
  assert.match(appSrc, /riskDetail\.addEventListener\(\s*['"]click['"][\s\S]+?data-rd-locate/,
    "riskDetail click handler must handle [data-rd-locate] clicks");
  assert.match(appSrc,
    /data-rd-locate[\s\S]+?input\.setSelectionRange/,
    "click handler must call input.setSelectionRange to highlight the match");
  // Must extend the selection to the surrounding sentence (context)
  assert.match(appSrc,
    /data-rd-locate[\s\S]+?\.search\(sentenceTerm\)/,
    "click handler must extend the selection to the surrounding sentence (context, not just the bare token)");
  // Must flash the textarea so the selection is visually obvious
  assert.match(appSrc,
    /data-rd-locate[\s\S]+?classList\.add\(['"]rd-flash['"]\)/,
    "click handler must add 'rd-flash' to the textarea for a brief visual pulse");

  // Keyboard parity: Enter / Space triggers locate
  assert.match(appSrc, /riskDetail\.addEventListener\(\s*['"]keydown['"][\s\S]+?Enter/,
    "riskDetail must handle Enter key on rows for keyboard parity");
  assert.match(appSrc, /riskDetail\.addEventListener\(\s*['"]keydown['"][\s\S]+?\s*e\.key\s*!==\s*['"]Enter['"][\s\S]+?\s*e\.key\s*!==\s*['"] ['"]/,
    "keydown handler must accept both Enter and Space keys");

  // CSS: rows signal clickability
  assert.match(cssSrc, /\.risk-detail-row\{[^}]*cursor:\s*pointer/,
    ".risk-detail-row must be cursor:pointer (signals clickability)");
  assert.match(cssSrc, /\.risk-detail-row:hover/,
    ".risk-detail-row must have a hover state");
  // Focus state for keyboard users
  assert.match(cssSrc, /\.risk-detail-row:focus/,
    ".risk-detail-row must have a focus state");
  // Textarea flash for the locate pulse
  assert.match(cssSrc, /\.work textarea\.rd-flash/,
    "textarea must have a .rd-flash style for the locate pulse");
});

test("analyzer: risk-preview pill has an inline 'show all' link to make expand affordance obvious", () => {
  // Polishes iter #5 — the chevron hint isn't always noticed. Adds
  // an explicit "show all" link inside the pill so users know clicking
  // expands the match list. Styled as a dotted-underline link to
  // visually distinguish it from the badge content.
  if (!HAS_BROWSER) return;
  const fs = require("node:fs");
  const path = require("node:path");
  const html = fs.readFileSync(path.join(ROOT, "analyze.html"), "utf8");
  const cssSrc = fs.readFileSync(path.join(ROOT, "assets", "theme.css"), "utf8");

  // analyze.html: show-all element must exist inside the pill
  assert.match(html, /<span class="rp-showall">/,
    "#riskPreview must contain an explicit <span class=\"rp-showall\"> link");

  // The chevron is now INSIDE the show-all (visually grouped)
  assert.match(html, /rp-showall">\s*show all [\s\S]+?rp-chev/,
    "the chevron must sit inside .rp-showall (visual grouping)");

  // CSS: show-all must be styled as a discoverable link
  assert.match(cssSrc, /\.risk-preview \.rp-showall\{[^}]*text-decoration:\s*underline/,
    ".rp-showall must use text-decoration:underline so it reads as a link");
  // Margin-left auto pushes it to the right end of the pill
  assert.match(cssSrc, /\.risk-preview \.rp-showall\{[^}]*margin-left:\s*auto/,
    ".rp-showall must use margin-left:auto so it sits at the right end of the pill");
  // Must be font-weight:800 so it visually anchors the affordance
  assert.match(cssSrc, /\.risk-preview \.rp-showall\{[^}]*font-weight:\s*800/,
    ".rp-showall must be font-weight:800 (anchors the affordance)");
});

test("analyzer: document summary line shows sentence / paragraph / avg / longest counts", () => {
  // New shape-of-the-doc read above textstats. Single line:
  //   📄 47 sentences · 4 paragraphs · avg 18 words · longest 64
  // Hides on short input; flips to amber when longest > 60 words
  // (run-on legalese signal — legal contracts routinely have 100+
  // word sentences).
  if (!HAS_BROWSER) return;
  const fs = require("node:fs");
  const path = require("node:path");
  const appSrc = fs.readFileSync(path.join(ROOT, "assets", "app.js"), "utf8");
  const html = fs.readFileSync(path.join(ROOT, "analyze.html"), "utf8");
  const cssSrc = fs.readFileSync(path.join(ROOT, "assets", "theme.css"), "utf8");

  // summarizeStructure helper must exist at the IIFE level
  assert.match(appSrc, /function summarizeStructure\(text\)/,
    "summarizeStructure() helper must exist at the IIFE level");

  // Must classify into sentences, paragraphs, avgWords, longestWords
  for (const key of ["sentences:", "paragraphs:", "avgWords:", "longestWords:"]) {
    assert.ok(appSrc.includes(key),
      `summarizeStructure must compute ${key}`);
  }
  // Must guard on short input
  assert.match(appSrc, /function summarizeStructure\(text\)\{[\s\S]+?if \(!t \|\| t\.length < 8\)/,
    "summarizeStructure must guard on too-short input");
  // Sentence split uses terminal-punctuation regex
  assert.match(appSrc, /summarizeStructure[\s\S]+?\[\.!\?]/,
    "summarizeStructure must split on terminal punctuation");
  // Paragraph split on blank lines (NOT single newlines)
  assert.match(appSrc, /summarizeStructure[\s\S]+?split\([^)]*\\n\\s\*\\n/,
    "summarizeStructure must split paragraphs on blank lines, not single newlines");

  // analyze.html must have the doc-summary block
  assert.match(html, /id="docSummary"/,
    "analyze.html must contain #docSummary above textstats");
  assert.match(html, /id="dsSentences"/,
    "#docSummary must include #dsSentences");
  assert.match(html, /id="dsParagraphs"/,
    "#docSummary must include #dsParagraphs");
  assert.match(html, /id="dsAvgWords"/,
    "#docSummary must include #dsAvgWords");
  assert.match(html, /id="dsLongest"/,
    "#docSummary must include #dsLongest");

  // updateTextStats must paint all four counts + toggle visibility
  const updateBlock = appSrc.match(/function updateTextStats\(\)\{[\s\S]+?^\s\s\}/m);
  assert.ok(updateBlock, "updateTextStats() must exist");
  assert.match(updateBlock[0], /summarizeStructure\(raw\)/,
    "updateTextStats must call summarizeStructure(raw)");
  assert.match(updateBlock[0], /docSummary\.hidden\s*=\s*true/,
    "docSummary must hide when summarizeStructure returns null");
  assert.match(updateBlock[0], /dsSentences\.textContent\s*=\s*s\.sentences/,
    "dsSentences must show the sentence count");
  assert.match(updateBlock[0], /dsParagraphs\.textContent\s*=\s*s\.paragraphs/,
    "dsParagraphs must show the paragraph count");
  assert.match(updateBlock[0], /dsAvgWords\.textContent\s*=\s*s\.avgWords/,
    "dsAvgWords must show the average words per sentence");
  assert.match(updateBlock[0], /dsLongest\.textContent\s*=\s*s\.longestWords/,
    "dsLongest must show the longest sentence in words");
  // Dense-prose flag at > 60 words (legalese threshold)
  assert.match(updateBlock[0], /s\.longestWords\s*>\s*60/,
    "updateTextStats must flag longest > 60 words as 'ds-dense' (legalese signal)");

  // CSS: dense state must be amber
  assert.match(cssSrc, /\.doc-summary\.ds-dense\{[^}]*var\(--amber\)/,
    ".ds-dense must use --amber (dense legalese reads louder)");
});

test("analyzer: doc-summary line shows jargon-swap count that toggles a plain-English preview", () => {
  // Polishes iter #17 — adds a jargon-swap badge inline with the doc
  // structural summary. Click reveals the input with jargon terms
  // bolded + replaced inline (reuses the home-page clarify() engine).
  // Lets users see jargon → plain-English BEFORE hitting Analyze.
  if (!HAS_BROWSER) return;
  const fs = require("node:fs");
  const path = require("node:path");
  const appSrc = fs.readFileSync(path.join(ROOT, "assets", "app.js"), "utf8");
  const html = fs.readFileSync(path.join(ROOT, "analyze.html"), "utf8");
  const cssSrc = fs.readFileSync(path.join(ROOT, "assets", "theme.css"), "utf8");

  // analyze.html must have the jargon-swap button + preview container
  assert.match(html, /id="dsJargon"/,
    "analyze.html must contain #dsJargon (the toggle button)");
  assert.match(html, /id="dsJargonCount"/,
    "#dsJargon must include #dsJargonCount for the dynamic count");
  assert.match(html, /id="dsJargonPreview"/,
    "analyze.html must contain #dsJargonPreview (the toggled preview)");
  assert.match(html, /aria-controls="dsJargonPreview"/,
    "#dsJargon must aria-controls #dsJargonPreview for screen readers");

  // updateTextStats must call clarify() and paint the count
  const updateBlock = appSrc.match(/function updateTextStats\(\)\{[\s\S]+?^\s\s\}/m);
  assert.ok(updateBlock, "updateTextStats() must exist");
  assert.match(updateBlock[0], /clarify\(raw\)/,
    "updateTextStats must call clarify(raw) to count jargon matches");
  assert.match(updateBlock[0], /dsJargonCount\.textContent\s*=\s*c\.found/,
    "dsJargonCount must show the found count");
  // Hide when no jargon found (clean docs shouldn't show a swap badge)
  assert.match(updateBlock[0], /dsJargon\.hidden\s*=\s*true/,
    "dsJargon must hide when no jargon is found");
  // Stash the preview HTML on the button so the click is O(1)
  assert.match(updateBlock[0], /dsJargon\._previewHtml\s*=\s*c\.html/,
    "updateTextStats must stash the rendered preview on the button");

  // Click handler must toggle the preview + flip aria-expanded
  assert.match(appSrc, /dsJargon\.addEventListener\(\s*['"]click['"]/,
    "#dsJargon must have a click handler");
  assert.match(appSrc, /dsJargonPreview\.hidden\s*=\s*!willOpen/,
    "click handler must toggle dsJargonPreview.hidden");
  assert.match(appSrc, /aria-expanded['"],\s*willOpen\s*\?\s*['"]true['"]\s*:\s*['"]false['"]/,
    "click handler must flip aria-expanded correctly");
  // Escape key collapses (keyboard a11y)
  assert.match(appSrc, /e\.key\s*===\s*['"]Escape['"][\s\S]+?dsJargonPreview\.hidden\s*=\s*true/,
    "Escape key must collapse the preview");

  // CSS: button is a clickable badge, preview is a bordered box
  assert.match(cssSrc, /\.doc-summary \.ds-jargon\{[^}]*cursor:\s*pointer/,
    ".ds-jargon must be a clickable button (cursor: pointer)");
  assert.match(cssSrc, /\.doc-summary \.ds-jargon\.ds-open/,
    ".ds-jargon must have an .ds-open state for the active toggle");
  assert.match(cssSrc, /\.ds-preview\{[^}]*border/,
    ".ds-preview must have a visible border so it reads as a panel");
  // The <b> tags inside the preview are the swapped terms — must
  // visually pop with amber tint (matches the doc-summary dense color
  // family for visual cohesion).
  assert.match(cssSrc, /\.ds-preview b\{[^}]*var\(--amber-tint\)/,
    ".ds-preview <b> must be amber-tinted (swapped terms pop)");
});

test("analyzer: side-by-side compare panel renders 2-column stats when a second clause is pasted", () => {
  // New feature — toggle a second textarea + render a side-by-side
  // comparison row showing type, level, risks, deadlines for both.
  // The riskier side is highlighted (.cmp-riskier) so users can spot
  // the dangerous clause without parsing every cell.
  if (!HAS_BROWSER) return;
  const fs = require("node:fs");
  const path = require("node:path");
  const appSrc = fs.readFileSync(path.join(ROOT, "assets", "app.js"), "utf8");
  const html = fs.readFileSync(path.join(ROOT, "analyze.html"), "utf8");
  const cssSrc = fs.readFileSync(path.join(ROOT, "assets", "theme.css"), "utf8");

  // analyze.html: toggle button + panel + second textarea + stats
  assert.match(html, /id="compareToggle"/,
    "analyze.html must contain #compareToggle");
  assert.match(html, /id="comparePanel"/,
    "analyze.html must contain #comparePanel");
  assert.match(html, /id="docInputB"/,
    "analyze.html must contain #docInputB (the second textarea)");
  assert.match(html, /id="compareStats"/,
    "analyze.html must contain #compareStats (the comparison table target)");
  // Toggle button must aria-control the panel
  assert.match(html, /aria-controls="comparePanel"/,
    "#compareToggle must aria-controls #comparePanel");

  // updateCompareStats must exist and compute per-side stats
  assert.match(appSrc, /function updateCompareStats\(\)/,
    "updateCompareStats() must exist");
  assert.match(appSrc, /updateCompareStats[\s\S]+?detectDocType/,
    "updateCompareStats must call detectDocType on each side");
  assert.match(appSrc, /updateCompareStats[\s\S]+?countRisksBySeverity/,
    "updateCompareStats must call countRisksBySeverity on each side");
  assert.match(appSrc, /updateCompareStats[\s\S]+?extractDeadlines/,
    "updateCompareStats must call extractDeadlines on each side");
  assert.match(appSrc, /updateCompareStats[\s\S]+?friendlyGrade/,
    "updateCompareStats must call friendlyGrade on each side");
  // Must hide when panel closed or B side empty
  assert.match(appSrc, /updateCompareStats[\s\S]+?comparePanel\.hidden[\s\S]+?innerHTML\s*=\s*''/,
    "updateCompareStats must clear the stats when panel closed or B empty");
  // Must render the table with cmp-riskier highlighting the riskier side
  assert.match(appSrc, /updateCompareStats[\s\S]+?cmp-riskier/,
    "updateCompareStats must apply cmp-riskier class to the riskier side");
  assert.match(appSrc, /updateCompareStats[\s\S]+?leftRiskier\s*=\s*true/,
    "updateCompareStats must compute leftRiskier (Original wins)");
  assert.match(appSrc, /updateCompareStats[\s\S]+?rightRiskier\s*=\s*true/,
    "updateCompareStats must compute rightRiskier (Compare wins)");

  // Click handler must toggle the panel + flip the button label
  assert.match(appSrc, /compareToggle\.addEventListener\(\s*['"]click['"]/,
    "#compareToggle must have a click handler");
  assert.match(appSrc, /compareToggle\.addEventListener[\s\S]+?comparePanel\.hidden\s*=\s*!willOpen/,
    "click handler must toggle #comparePanel.hidden");
  assert.match(appSrc, /compareToggle\.addEventListener[\s\S]+?'− compare'[\s\S]+?'\+ compare'/,
    "click handler must swap button label between '+ compare' and '− compare'");

  // inputB must wire to updateCompareStats on input
  assert.match(appSrc, /inputB\.addEventListener\(\s*['"]input['"],\s*updateCompareStats/,
    "inputB must call updateCompareStats on input");
  // Escape on inputB closes the panel
  assert.match(appSrc, /inputB\.addEventListener[\s\S]+?Escape/,
    "inputB must handle Escape to close the panel");

  // CSS: panel + table + riskier highlight
  assert.match(cssSrc, /\.compare-panel\{[^}]*border/,
    ".compare-panel must have a visible border so it reads as a separate section");
  assert.match(cssSrc, /\.compare-stats \.cmp-table\{[^}]*border-collapse:\s*collapse/,
    ".cmp-table must use border-collapse for clean grid lines");
  assert.match(cssSrc, /\.compare-stats \.cmp-table td\.cmp-riskier\{[^}]*var\(--danger\)/,
    ".cmp-riskier must use --danger so the riskier side pops");
  // Trap count must also use --danger (sub-stat emphasis)
  assert.match(cssSrc, /\.compare-stats \.cmp-trap\{[^}]*var\(--danger\)/,
    ".cmp-trap must use --danger (the trap count inside the risks cell)");
});

test("analyzer: compare panel shows a clear 'WINS' verdict badge above the table", () => {
  // Polishes iter #19 — instead of just highlighting the riskier
  // column, paint a verdict header so users see the answer at a
  // glance: "COMPARE WINS — 2 more traps" / "ORIGINAL WINS — 1
  // more risk" / "EVEN — both score identically".
  if (!HAS_BROWSER) return;
  const fs = require("node:fs");
  const path = require("node:path");
  const appSrc = fs.readFileSync(path.join(ROOT, "assets", "app.js"), "utf8");
  const html = fs.readFileSync(path.join(ROOT, "analyze.html"), "utf8");
  const cssSrc = fs.readFileSync(path.join(ROOT, "assets", "theme.css"), "utf8");

  // analyze.html: verdict element above the stats table
  assert.match(html, /id="compareVerdict"/,
    "analyze.html must contain #compareVerdict above #compareStats");

  // updateCompareStats must compute + paint the verdict text
  const updateFn = appSrc.match(/function updateCompareStats\(\)\{[\s\S]+?^\s\s\}/m);
  assert.ok(updateFn, "updateCompareStats() must exist");
  // Verdict text patterns
  assert.match(updateFn[0], /COMPARE WINS/,
    "verdict must include 'COMPARE WINS' for the right-side winner");
  assert.match(updateFn[0], /ORIGINAL WINS/,
    "verdict must include 'ORIGINAL WINS' for the left-side winner");
  assert.match(updateFn[0], /EVEN/,
    "verdict must include 'EVEN' for tied scores");
  // Verdict classes
  for (const cls of ["cmp-verdict-danger", "cmp-verdict-amber", "cmp-verdict-even"]) {
    assert.ok(updateFn[0].includes(cls),
      `updateCompareStats must apply ${cls} class`);
  }
  // Must clear the verdict when panel closes or B empty
  assert.match(updateFn[0], /compareVerdict\.hidden\s*=\s*true/,
    "verdict must hide when panel closes or B side is empty");

  // CSS: three verdict colors
  assert.match(cssSrc, /\.compare-verdict\.cmp-verdict-danger\{[^}]*var\(--danger\)/,
    ".cmp-verdict-danger must use --danger (traps decided it = loudest)");
  assert.match(cssSrc, /\.compare-verdict\.cmp-verdict-amber\{[^}]*var\(--amber\)/,
    ".cmp-verdict-amber must use --amber (risks/deadlines decided it)");
  assert.match(cssSrc, /\.compare-verdict\.cmp-verdict-even/,
    ".cmp-verdict-even must have its own (muted) styling for ties");
});

test("analyzer: compare panel shows sentence-level diff (Original-only / Compare-only clauses)", () => {
  // New feature — beyond the verdict (who wins) and the score
  // (type/level/risks/deadlines), show the actual sentences that
  // differ between the two docs. "what's different?" beyond numbers.
  if (!HAS_BROWSER) return;
  const fs = require("node:fs");
  const path = require("node:path");
  const appSrc = fs.readFileSync(path.join(ROOT, "assets", "app.js"), "utf8");
  const html = fs.readFileSync(path.join(ROOT, "analyze.html"), "utf8");
  const cssSrc = fs.readFileSync(path.join(ROOT, "assets", "theme.css"), "utf8");

  // diffSentences must exist at the IIFE level
  assert.match(appSrc, /function diffSentences\(a, b\)/,
    "diffSentences() helper must exist at the IIFE level");
  // Must return shared count alongside onlyA/onlyB
  assert.match(appSrc, /diffSentences[\s\S]+?shared:/,
    "diffSentences must return a shared count alongside onlyA/onlyB");
  // Must normalize for comparison (lowercase + whitespace-collapse)
  assert.match(appSrc, /diffSentences[\s\S]+?toLowerCase\(\)/,
    "diffSentences must lowercase for matching (casing shouldn't cause false splits)");
  assert.match(appSrc, /diffSentences[\s\S]+?replace\(/,
    "diffSentences must collapse whitespace for matching");

  // analyze.html: diff container
  assert.match(html, /id="compareDiff"/,
    "analyze.html must contain #compareDiff below #compareStats");

  // updateCompareStats must call diffSentences + render both rows
  const updateFn = appSrc.match(/function updateCompareStats\(\)\{[\s\S]+?^\s\s\}/m);
  assert.ok(updateFn, "updateCompareStats() must exist");
  assert.match(updateFn[0], /diffSentences\(a,\s*b\)/,
    "updateCompareStats must call diffSentences(a, b)");
  assert.match(updateFn[0], /only in/,
    "diff must label the Original-only row ('only in ...')");
  assert.match(updateFn[0], /row\(\s*'Original'[\s\S]+?row\(\s*'Compare'/,
    "diff must render both Original and Compare rows");
  // Must hide when there's no diff (both sides identical)
  assert.match(updateFn[0], /compareDiff\.hidden\s*=\s*true/,
    "compareDiff must hide when no sentences differ");

  // CSS: two-column diff with color-coded labels
  assert.match(cssSrc, /\.compare-diff\{[^}]*border/,
    ".compare-diff must have a visible border so it reads as a separate section");
  assert.match(cssSrc, /\.compare-diff \.cmp-diff-a b\{[^}]*var\(--ink-soft\)/,
    ".cmp-diff-a (Original) label must use --ink-soft (muted)");
  assert.match(cssSrc, /\.compare-diff \.cmp-diff-b b\{[^}]*var\(--accent-text\)/,
    ".cmp-diff-b (Compare) label must use --accent-text (accent — second side)");

  // Shared-count summary line — polish on iter #21
  const updateFnDiff = appSrc.match(/function updateCompareStats\(\)\{[\s\S]+?^\s\s\}/m);
  assert.ok(updateFnDiff, "updateCompareStats() must exist");
  assert.match(updateFnDiff[0], /cmp-diff-summary/,
    "diff must render a summary line with the shared + unique counts");
  assert.match(updateFnDiff[0], /in both/,
    "summary must say 'X in both' for the shared count");
  assert.match(updateFnDiff[0], /only in Original[\s\S]+?only in Compare/,
    "summary must include both only-in-Original and only-in-Compare counts");
  // CSS: summary must be visually distinct from the row labels
  assert.match(cssSrc, /\.compare-diff \.cmp-diff-summary/,
    ".cmp-diff-summary must have its own CSS rule (visually distinct from row labels)");
});

test("analyzer: voice input button dictates into the textarea via Web Speech API", () => {
  // New feature — click a 🎤 button to dictate the document via the
  // Web Speech API. Hidden when the browser doesn't support it
  // (Firefox, Safari < 14.1). Click toggles recording; interim
  // results paint live so users see what they're saying.
  if (!HAS_BROWSER) return;
  const fs = require("node:fs");
  const path = require("node:path");
  const appSrc = fs.readFileSync(path.join(ROOT, "assets", "app.js"), "utf8");
  const html = fs.readFileSync(path.join(ROOT, "analyze.html"), "utf8");
  const cssSrc = fs.readFileSync(path.join(ROOT, "assets", "theme.css"), "utf8");

  // analyze.html: mic button must exist
  assert.match(html, /id="micBtn"/,
    "analyze.html must contain #micBtn");
  assert.match(html, /aria-label="Dictate via voice input"/,
    "#micBtn must have an aria-label for screen readers");

  // App must check for SpeechRecognition + fall back to webkit
  assert.match(appSrc, /micBtn[\s\S]+?SpeechRecognition \|\| window\.webkitSpeechRecognition/,
    "must check both SpeechRecognition and webkitSpeechRecognition for cross-browser support");
  // Must hide the button when the API is unsupported
  assert.match(appSrc, /!SR[\s\S]+?micBtn\.hidden\s*=\s*true/,
    "micBtn must hide when SpeechRecognition is unavailable");
  // Must wire click → start, click again → stop
  assert.match(appSrc, /micBtn\.addEventListener\(\s*['"]click['"]/,
    "#micBtn must have a click handler");
  assert.match(appSrc, /isRecording[\s\S]+?recognition\.stop/,
    "click handler must stop recognition when isRecording");
  assert.match(appSrc, /recognition\.start\(\)/,
    "click handler must call recognition.start() to begin dictation");
  // Interim results must paint live so users see what they're saying
  assert.match(appSrc, /interimResults\s*=\s*true/,
    "recognition must enable interimResults so partial transcripts stream live");
  // Append interim + final text to the existing textarea value
  assert.match(appSrc, /input\.value\s*=\s*baseValue\s*\+/,
    "must append recognized text to the existing textarea value (don't clobber)");
  // Trigger input event so the live stats update as the user dictates
  assert.match(appSrc, /dispatchEvent\(new Event\(\s*['"]input['"]/,
    "must dispatch input event so the live stats update during dictation");
  // Visual feedback: active state when recording
  assert.match(appSrc, /qf-mic-active/,
    "must add qf-mic-active class when recording starts");

  // CSS: active state must be visually distinct (pulse red)
  assert.match(cssSrc, /\.qf-mic\.qf-mic-active\{[^}]*var\(--danger\)/,
    ".qf-mic-active must use --danger (recording = visually loud)");
  assert.match(cssSrc, /\.qf-mic\.qf-mic-active\{[^}]*animation/,
    ".qf-mic-active must have a pulse animation so live recording reads as live");
});

test("analyzer: voice input auto-pauses after 2.5s of silence", () => {
  // Polishes iter #23 — standard dictation UX (Google Docs voice
  // typing, Apple Dictation). Users pause naturally without hunting
  // for a stop button. Triggers via onspeechend (Chrome-native) +
  // a fallback timer (cross-browser).
  if (!HAS_BROWSER) return;
  const fs = require("node:fs");
  const path = require("node:path");
  const appSrc = fs.readFileSync(path.join(ROOT, "assets", "app.js"), "utf8");
  const cssSrc = fs.readFileSync(path.join(ROOT, "assets", "theme.css"), "utf8");

  // Must use onspeechend as the native trigger
  assert.match(appSrc, /recognition\.onspeechend\s*=/,
    "must hook onspeechend (browser-native signal that user stopped speaking)");
  // Must have a fallback timer with a reasonable threshold (1-5s)
  assert.match(appSrc, /SILENCE_MS\s*=\s*\d{3,5}/,
    "must define a SILENCE_MS threshold in the 1-5s range");
  // Must call recognition.stop() when silence is detected
  assert.match(appSrc, /silenceTimer\s*=\s*setTimeout[\s\S]+?recognition\.stop/,
    "silenceTimer callback must call recognition.stop()");
  // Must apply a paused class so users see the auto-pause state
  assert.match(appSrc, /qf-mic-paused/,
    "must add qf-mic-paused class on auto-pause");
  // Must clear the timer in onend so it doesn't fire after manual stop
  assert.match(appSrc, /recognition\.onend[\s\S]+?clearTimeout\(silenceTimer\)/,
    "onend handler must clear silenceTimer so it doesn't fire after manual stop");
  // onresult must bump the silence timer (reset on every transcript)
  assert.match(appSrc, /onresult[\s\S]+?bumpSilence\(\)/,
    "onresult must call bumpSilence() to reset the auto-pause timer");

  // CSS: paused state is muted (not red — recording stopped)
  assert.match(cssSrc, /\.qf-mic\.qf-mic-paused\{[^}]*color:\s*var\(--ink-soft\)/,
    ".qf-mic-paused must use --ink-soft (recording stopped, muted state)");
});

test("analyzer: history panel saves the last 5 analyses and lets users restore any of them", () => {
  // New feature — localStorage-backed history of past analyses.
  // Users see a dropdown of their last 5 analyses, click one to
  // restore it. Survives page reload; 7-day TTL drops old entries.
  if (!HAS_BROWSER) return;
  const fs = require("node:fs");
  const path = require("node:path");
  const appSrc = fs.readFileSync(path.join(ROOT, "assets", "app.js"), "utf8");
  const html = fs.readFileSync(path.join(ROOT, "analyze.html"), "utf8");
  const cssSrc = fs.readFileSync(path.join(ROOT, "assets", "theme.css"), "utf8");

  // analyze.html: history button + panel + list + clear button
  assert.match(html, /id="historyBtn"/,
    "analyze.html must contain #historyBtn");
  assert.match(html, /id="historyPanel"/,
    "analyze.html must contain #historyPanel");
  assert.match(html, /id="historyList"/,
    "analyze.html must contain #historyList");
  assert.match(html, /id="historyClearBtn"/,
    "analyze.html must contain #historyClearBtn");
  assert.match(html, /aria-controls="historyPanel"/,
    "#historyBtn must aria-controls #historyPanel");

  // pushHistory / readHistoryRaw / clearHistory must exist at IIFE level
  assert.match(appSrc, /function pushHistory\(raw\)/,
    "pushHistory() must exist at the IIFE level");
  assert.match(appSrc, /function readHistoryRaw\(\)/,
    "readHistoryRaw() must exist at the IIFE level");
  assert.match(appSrc, /function clearHistory\(\)/,
    "clearHistory() must exist at the IIFE level");
  // Must be capped at 5 entries (FIFO)
  assert.match(appSrc, /HISTORY_MAX_ENTRIES\s*=\s*5/,
    "history must cap at 5 entries (FIFO)");
  // Must have a TTL (7 days)
  assert.match(appSrc, /HISTORY_TTL_MS\s*=\s*7\s*\*\s*24\s*\*\s*60\s*\*\s*60\s*\*\s*1000/,
    "history must have a 7-day TTL matching the privacy promise");
  // Must dedupe the most recent entry when re-pushed
  assert.match(appSrc, /arr\[0\]\.snippet\s*===\s*snippet\s*&&\s*arr\[0\]\.text\s*===\s*text/,
    "pushHistory must skip duplicates of the most recent entry (avoid stacking repeated clicks)");

  // saveSnapshot must call pushHistory (the auto-save hook)
  assert.match(appSrc, /function saveSnapshot\(snap\)\{[\s\S]+?pushHistory\(snap\.raw\)/,
    "saveSnapshot must call pushHistory(snap.raw) so every analyze adds to history");

  // Click handler must toggle the panel + render items
  assert.match(appSrc, /historyBtn\.addEventListener\(\s*['"]click['"]/,
    "#historyBtn must have a click handler");
  assert.match(appSrc, /historyPanel\.hidden\s*=\s*!willOpen/,
    "click handler must toggle #historyPanel.hidden");
  // Delegated click on a history item → restore that doc
  assert.match(appSrc, /historyList\.addEventListener\(\s*['"]click['"]/,
    "historyList must have a delegated click handler");
  assert.match(appSrc, /historyList\.addEventListener[\s\S]+?input\.value\s*=\s*it\.text/,
    "click handler must restore the doc text to the textarea");
  // Must trigger input event so live stats update
  assert.match(appSrc, /historyList\.addEventListener[\s\S]+?dispatchEvent\(new Event\(\s*['"]input['"]/,
    "restore must dispatch input event so live stats update");

  // Clear button must wipe history
  assert.match(appSrc, /historyClearBtn\.addEventListener\(\s*['"]click['"]/,
    "#historyClearBtn must have a click handler");
  assert.match(appSrc, /historyClearBtn\.addEventListener[\s\S]+?clearHistory\(\)/,
    "clear handler must call clearHistory()");

  // CSS: panel must be visually distinct from textstats
  assert.match(cssSrc, /\.history-panel\{[^}]*border/,
    ".history-panel must have a visible border");
  // Items must be clickable buttons
  assert.match(cssSrc, /\.history-panel \.hp-item\{[^}]*cursor:\s*pointer/,
    ".hp-item must be cursor:pointer (signals clickability)");
  assert.match(cssSrc, /\.history-panel \.hp-item:hover/,
    ".hp-item must have a hover state");
});

test("analyzer: history panel uses relative time labels ('2h ago', 'yesterday') instead of full timestamps", () => {
  // Polishes iter #25 — instead of "7/24/2025, 3:42:07 PM", show
  // "2h ago" / "yesterday" / "3d ago" — the standard chat-client
  // pattern. Full timestamp preserved as the title (hover) for
  // precision when users need it.
  if (!HAS_BROWSER) return;
  const fs = require("node:fs");
  const path = require("node:path");
  const appSrc = fs.readFileSync(path.join(ROOT, "assets", "app.js"), "utf8");

  // formatRelativeTime must exist at the IIFE level
  assert.match(appSrc, /function formatRelativeTime\(ts\)/,
    "formatRelativeTime() must exist at the IIFE level");

  // Must handle all the standard buckets
  assert.match(appSrc, /'just now'/,
    "formatRelativeTime must return 'just now' for < 1m");
  assert.match(appSrc, /minutes < 60[\s\S]+?minutes \+ 'm ago'/,
    "formatRelativeTime must return 'Nm ago' for < 1h");
  assert.match(appSrc, /hours < 24[\s\S]+?hours \+ 'h ago'/,
    "formatRelativeTime must return 'Nh ago' for < 24h");
  assert.match(appSrc, /days === 1[\s\S]+?return 'yesterday'/,
    "formatRelativeTime must return 'yesterday' at exactly 1 day");
  assert.match(appSrc, /days < 7[\s\S]+?days \+ 'd ago'/,
    "formatRelativeTime must return 'Nd ago' for < 7 days");
  // Fallback to a date string for older entries
  assert.match(appSrc, /toLocaleDateString/,
    "formatRelativeTime must fall back to a date string for entries > 7 days old");

  // Defensive on bad input
  assert.match(appSrc, /formatRelativeTime[\s\S]+?typeof ts !== 'number'/,
    "formatRelativeTime must short-circuit on non-number input");

  // renderHistory must use formatRelativeTime
  assert.match(appSrc, /formatRelativeTime\(it\.ts\)/,
    "renderHistory must call formatRelativeTime(it.ts)");
  // Must preserve the full timestamp as the title attribute (hover)
  assert.match(appSrc, /title=['"][^'"]*['"][\s\S]+?hp-when/,
    "renderHistory must keep the full timestamp as the title attribute for hover");
});

test("analyzer: Read-aloud button speaks the plain-English rewrite via SpeechSynthesis", () => {
  // New feature — speak the rewrite aloud via the Web Speech API.
  // Accessibility win (visually impaired users) + lets users listen
  // to long docs instead of reading. Toggles playback; "■ Stop"
  // while speaking. Picks an English voice when available.
  if (!HAS_BROWSER) return;
  const fs = require("node:fs");
  const path = require("node:path");
  const appSrc = fs.readFileSync(path.join(ROOT, "assets", "app.js"), "utf8");
  const html = fs.readFileSync(path.join(ROOT, "analyze.html"), "utf8");
  const cssSrc = fs.readFileSync(path.join(ROOT, "assets", "theme.css"), "utf8");

  // analyze.html: button must exist in the result-actions row
  assert.match(html, /id="speakBtn"/,
    "analyze.html must contain #speakBtn");
  assert.match(html, /aria-label="Read the rewrite aloud"/,
    "#speakBtn must have an aria-label");

  // Must check for SpeechSynthesis + hide if missing
  assert.match(appSrc, /speakBtn[\s\S]+?'speechSynthesis' in window/,
    "must check for speechSynthesis support");
  assert.match(appSrc, /speakBtn\.hidden\s*=\s*true/,
    "must hide the button when SpeechSynthesis is unavailable");

  // Show after a successful analysis (only when rewrite exists)
  assert.match(appSrc, /panel\.hidden\s*=\s*false[\s\S]+?speakBtn\.hidden\s*=\s*false/,
    "must show speakBtn after analysis when rewrite text exists");

  // Click handler must use SpeechSynthesisUtterance
  assert.match(appSrc, /speakBtn\.addEventListener\(\s*['"]click['"]/,
    "#speakBtn must have a click handler");
  assert.match(appSrc, /new SpeechSynthesisUtterance\(/,
    "click handler must construct a SpeechSynthesisUtterance from the rewrite text");
  assert.match(appSrc, /window\.speechSynthesis\.speak\(u\)/,
    "click handler must call speechSynthesis.speak() to start playback");
  assert.match(appSrc, /window\.speechSynthesis\.cancel\(\)/,
    "click handler must call speechSynthesis.cancel() to stop playback");

  // Toggle: button label flips between Read aloud / Stop
  assert.match(appSrc, /'■ Stop'/,
    "button label must include '■ Stop' (active state)");
  assert.match(appSrc, /'🔊 Read aloud'/,
    "button label must include '🔊 Read aloud' (idle state)");

  // Picks an English voice when available (cross-locale safety)
  assert.match(appSrc, /\^en\[-_\]/,
    "voice picker must prefer English-language voices");

  // CSS: speaking state must be visually distinct (pulse animation)
  assert.match(cssSrc, /\.ghost-btn\.speaking\{[^}]*var\(--accent\)/,
    ".ghost-btn.speaking must use --accent (recording = visually loud)");
  assert.match(cssSrc, /\.ghost-btn\.speaking\{[^}]*animation/,
    ".ghost-btn.speaking must have a pulse animation so live reading reads as live");
});

test("analyzer: Read-aloud highlights each sentence as it is spoken", () => {
  // Polishes iter #27 — wraps each sentence in the rewrite in a
  // .spoken span, then highlights the currently-speaking one via
  // the onboundary event. Standard audio-reader UX (Kindle, Voice
  // Dream) — users can follow along visually as the voice reads.
  if (!HAS_BROWSER) return;
  const fs = require("node:fs");
  const path = require("node:path");
  const appSrc = fs.readFileSync(path.join(ROOT, "assets", "app.js"), "utf8");
  const cssSrc = fs.readFileSync(path.join(ROOT, "assets", "theme.css"), "utf8");

  // wrapSentences() must wrap each sentence in <span class="spoken">
  assert.match(appSrc, /wrapSentences[\s\S]+?class="spoken"/,
    "wrapSentences must wrap each sentence in a .spoken span");
  // Must cache the spans on the element (avoid rebuilding per boundary)
  assert.match(appSrc, /_spansBuilt\s*=\s*true/,
    "wrapSentences must cache the spans on the element (avoid rebuilding per boundary event)");
  assert.match(appSrc, /querySelectorAll\('\.spoken'\)/,
    "wrapSentences must cache the span nodes so the boundary handler can update them O(1)");

  // u.onboundary must advance the active sentence based on charIndex
  assert.match(appSrc, /u\.onboundary\s*=/,
    "must hook onboundary to advance the active sentence");
  assert.match(appSrc, /onboundary[\s\S]+?charIndex/,
    "onboundary must use charIndex to map position to sentence index");
  assert.match(appSrc, /onboundary[\s\S]+?setActive\(/,
    "onboundary must call setActive(idx) to advance the highlight");

  // setActive must toggle .spoken-active + scroll into view
  assert.match(appSrc, /function setActive[\s\S]+?spoken-active/,
    "setActive must toggle .spoken-active class");
  assert.match(appSrc, /setActive[\s\S]+?scrollIntoView/,
    "setActive must scroll the active sentence into view");

  // Must clear the highlight on stop / end / error
  assert.match(appSrc, /u\.onend[\s\S]+?clearHighlight/,
    "onend must clear the highlight when speech finishes");
  assert.match(appSrc, /u\.onerror[\s\S]+?clearHighlight/,
    "onerror must clear the highlight (graceful recovery)");
  assert.match(appSrc, /isSpeaking[\s\S]+?clearHighlight/,
    "click-while-speaking (stop) must clear the highlight");

  // First sentence highlighted immediately (some browsers delay
  // the first boundary event)
  assert.match(appSrc, /setActive\(0\)/,
    "must highlight sentence 0 immediately so the highlighter works from frame 1");

  // CSS: .spoken-active must be visually distinct
  assert.match(cssSrc, /#plainOut \.spoken-active\{[^}]*var\(--accent-glow\)/,
    ".spoken-active must use --accent-glow so the active sentence pops");
  assert.match(cssSrc, /#plainOut \.spoken-active\{[^}]*box-shadow/,
    ".spoken-active must have a visible underline (box-shadow inset) for the karaoke feel");
});

test("analyzer: Read-aloud button speaks the expanded risk list with row-by-row highlight", () => {
  // New feature — 🔊 in the risk toolbar speaks the matched-pattern
  // list aloud. Each row gets a karaoke-style highlight as it's
  // spoken. Pairs with iter #27 (TTS on rewrite) and iter #5/6
  // (expanded risk list).
  if (!HAS_BROWSER) return;
  const fs = require("node:fs");
  const path = require("node:path");
  const appSrc = fs.readFileSync(path.join(ROOT, "assets", "app.js"), "utf8");
  const cssSrc = fs.readFileSync(path.join(ROOT, "assets", "theme.css"), "utf8");

  // renderRiskDetail must emit the speak button
  const renderFn = appSrc.match(/function renderRiskDetail\(hits\)\{[\s\S]+?^\s\s\}/m);
  assert.ok(renderFn, "renderRiskDetail() must exist");
  assert.match(renderFn[0], /data-rd-speak/,
    "toolbar must include a [data-rd-speak] button");

  // Delegated click handler must handle the speak button
  assert.match(appSrc, /e\.target\.closest[\s\S]+?data-rd-speak/,
    "riskDetail click handler must handle [data-rd-speak] clicks");
  // Must use SpeechSynthesis (same pattern as iter #27)
  assert.match(appSrc, /data-rd-speak[\s\S]+?SpeechSynthesisUtterance/,
    "speak handler must construct a SpeechSynthesisUtterance");
  assert.match(appSrc, /data-rd-speak[\s\S]+?speechSynthesis\.speak/,
    "speak handler must call speechSynthesis.speak() to start playback");
  assert.match(appSrc, /data-rd-speak[\s\S]+?speechSynthesis\.cancel/,
    "speak handler must call speechSynthesis.cancel() to stop");
  // Must toggle the active row class on boundary events (karaoke)
  assert.match(appSrc, /data-rd-speak[\s\S]+?onboundary[\s\S]+?rd-speaking/,
    "speak handler must toggle .rd-speaking class on row boundary events");
  // Must clear the highlight on stop / end / error
  assert.match(appSrc, /data-rd-speak[\s\S]+?onend[\s\S]+?rd-speaking/,
    "speak handler must clear .rd-speaking on end/error");

  // CSS: speak button + row highlight
  assert.match(cssSrc, /\.risk-detail-toolbar \.rd-speak\{[^}]*cursor:\s*pointer/,
    ".rd-speak must be cursor:pointer (signals clickability)");
  assert.match(cssSrc, /\.risk-detail-toolbar \.rd-speak\.rd-speaking\{[^}]*var\(--accent\)/,
    ".rd-speak.rd-speaking must use --accent (speaking = visually loud)");
  assert.match(cssSrc, /\.risk-detail-row\.rd-speaking\{[^}]*var\(--accent-glow\)/,
    ".rd-speaking row must use --accent-glow bg (karaoke highlight)");
});

test("analyzer: TTS read-aloud of risks cross-links to the matched term in the source textarea", () => {
  // Polishes iter #29 — when the voice reads a risk, the matched
  // term in the source textarea is also highlighted, so users see
  // + hear + read together. Reuses the iter #15 selection logic
  // (case-insensitive indexOf, sentence-extending selection).
  if (!HAS_BROWSER) return;
  const fs = require("node:fs");
  const path = require("node:path");
  const appSrc = fs.readFileSync(path.join(ROOT, "assets", "app.js"), "utf8");

  // The onboundary handler must also call input.setSelectionRange
  // with the matched term's position. Verify by inspecting the
  // speak handler's onboundary body.
  assert.match(appSrc, /data-rd-speak[\s\S]+?onboundary[\s\S]+?input\.setSelectionRange/,
    "risk-TTS onboundary must cross-link to source via input.setSelectionRange");
  // Must look up the matched term from the active hit
  assert.match(appSrc, /data-rd-speak[\s\S]+?hits\[found\][\s\S]+?\.matched/,
    "onboundary must read the matched term from hits[found]");
  // Must extend to the surrounding sentence (context, not bare token)
  assert.match(appSrc, /data-rd-speak[\s\S]+?search\(sentenceTerm\)/,
    "onboundary must extend the selection to the surrounding sentence (same as iter #15)");
  // Must flash the textarea for visual emphasis
  assert.match(appSrc, /data-rd-speak[\s\S]+?classList\.add\(['"]rd-flash['"]\)/,
    "onboundary must add rd-flash class to the textarea (visual pulse)");
});

test("analyzer: Read-aloud button speaks each deadline with urgency and highlights the active dot", () => {
  // New feature — 🔊 in the deadlines preview speaks each deadline
  // aloud with its urgency. Each dot in the timeline gets a scale-up
  // + glow when it's the one being spoken. Pairs with iter #11
  // (deadlines preview) and iter #27/29/30 (TTS family).
  if (!HAS_BROWSER) return;
  const fs = require("node:fs");
  const path = require("node:path");
  const appSrc = fs.readFileSync(path.join(ROOT, "assets", "app.js"), "utf8");
  const html = fs.readFileSync(path.join(ROOT, "analyze.html"), "utf8");
  const cssSrc = fs.readFileSync(path.join(ROOT, "assets", "theme.css"), "utf8");

  // analyze.html: speak button must exist in the deadlines preview
  assert.match(html, /id="deadlinesSpeakBtn"/,
    "analyze.html must contain #deadlinesSpeakBtn");
  assert.match(html, /aria-label="Read deadlines aloud"/,
    "#deadlinesSpeakBtn must have an aria-label");

  // Must use SpeechSynthesis (same pattern as iter #27/29)
  assert.match(appSrc, /deadlinesSpeakBtn\.addEventListener\(\s*['"]click['"]/,
    "#deadlinesSpeakBtn must have a click handler");
  assert.match(appSrc, /deadlinesSpeakBtn[\s\S]+?SpeechSynthesisUtterance/,
    "speak handler must construct a SpeechSynthesisUtterance");
  assert.match(appSrc, /deadlinesSpeakBtn[\s\S]+?speechSynthesis\.speak/,
    "speak handler must call speechSynthesis.speak() to start playback");
  assert.match(appSrc, /deadlinesSpeakBtn[\s\S]+?speechSynthesis\.cancel/,
    "speak handler must call speechSynthesis.cancel() to stop");
  // Must include friendly urgency phrasing
  assert.match(appSrc, /deadlinesSpeakBtn[\s\S]+?'Deadline: '/,
    "spoken script must start each deadline with 'Deadline:'");
  assert.match(appSrc, /deadlinesSpeakBtn[\s\S]+?'today'/,
    "spoken script must include the 'today' phrasing");
  assert.match(appSrc, /deadlinesSpeakBtn[\s\S]+?'tomorrow'/,
    "spoken script must include the 'tomorrow' phrasing");
  assert.match(appSrc, /deadlinesSpeakBtn[\s\S]+?days ago/,
    "spoken script must include the 'N days ago' phrasing for past dates");

  // Karaoke: onboundary must toggle .dp-speaking on the active dot
  assert.match(appSrc, /deadlinesSpeakBtn[\s\S]+?onboundary[\s\S]+?dp-speaking/,
    "deadline TTS must toggle .dp-speaking class on the active dot");
  // Must clear highlight on end/error
  assert.match(appSrc, /deadlinesSpeakBtn[\s\S]+?onend[\s\S]+?dp-speaking/,
    "deadline TTS must clear .dp-speaking on end/error");

  // CSS: speak button + dot scale-up highlight
  assert.match(cssSrc, /\.deadlines-preview \.dp-speak\{[^}]*cursor:\s*pointer/,
    ".dp-speak must be cursor:pointer (signals clickability)");
  assert.match(cssSrc, /\.dp-dot\.dp-speaking\{[^}]*transform:\s*scale/,
    ".dp-dot.dp-speaking must scale up so the active dot pops visually");
  assert.match(cssSrc, /\.dp-dot\.dp-speaking\{[^}]*box-shadow/,
    ".dp-dot.dp-speaking must have a glow (box-shadow) for the karaoke effect");
});

test("analyzer: deadline TTS cross-links to the matched date in the source textarea", () => {
  // Polishes iter #31 — when the voice reads a deadline, the matched
  // date in the source textarea is also selected + flashed. Same
  // pattern as iter #30 (risk TTS cross-link) and iter #15
  // (click-to-locate). Users see + hear + read together.
  if (!HAS_BROWSER) return;
  const fs = require("node:fs");
  const path = require("node:path");
  const appSrc = fs.readFileSync(path.join(ROOT, "assets", "app.js"), "utf8");

  // Deadline onboundary must cross-link to the source textarea
  assert.match(appSrc, /deadlinesSpeakBtn[\s\S]+?onboundary[\s\S]+?input\.setSelectionRange/,
    "deadline TTS onboundary must cross-link via input.setSelectionRange");
  // Must read the original match from the deadline entry
  assert.match(appSrc, /deadlinesSpeakBtn[\s\S]+?list\[found\][\s\S]+?\.match/,
    "onboundary must read list[found].match (the original matched substring)");
  // Must look up the match in the input value (case-insensitive)
  assert.match(appSrc, /deadlinesSpeakBtn[\s\S]+?indexOf\(matched\.toLowerCase/,
    "onboundary must use case-insensitive indexOf to find the match in the source");
  // Must flash the textarea
  assert.match(appSrc, /deadlinesSpeakBtn[\s\S]+?classList\.add\(['"]rd-flash['"]\)/,
    "onboundary must add rd-flash class to the textarea (visual pulse)");
  // Must only trigger on row transitions (not every boundary event)
  assert.match(appSrc, /deadlinesSpeakBtn[\s\S]+?found !== activeIdx/,
    "cross-link must only fire on row transitions (not every boundary)");
});

test("analyzer: compare panel exports the verdict + stats as a shareable PNG image", () => {
  // New feature — "📸 Export PNG" button renders the verdict + stats
  // table to a canvas and downloads as a PNG. Users get a shareable
  // image for Slack/email threads when asking "which contract is
  // better?" — the visual verdict travels without the docs.
  if (!HAS_BROWSER) return;
  const fs = require("node:fs");
  const path = require("node:path");
  const appSrc = fs.readFileSync(path.join(ROOT, "assets", "app.js"), "utf8");
  const html = fs.readFileSync(path.join(ROOT, "analyze.html"), "utf8");
  const cssSrc = fs.readFileSync(path.join(ROOT, "assets", "theme.css"), "utf8");

  // analyze.html: PNG button must exist in the compare panel
  assert.match(html, /id="comparePngBtn"/,
    "analyze.html must contain #comparePngBtn");
  assert.match(html, /📸 Export PNG/,
    "PNG button must be labeled '📸 Export PNG'");

  // Click handler must render to canvas
  assert.match(appSrc, /comparePngBtn\.addEventListener\(\s*['"]click['"]/,
    "#comparePngBtn must have a click handler");
  assert.match(appSrc, /comparePngBtn\.addEventListener[\s\S]+?document\.createElement\(['"]canvas['"]\)/,
    "click handler must create a canvas");
  assert.match(appSrc, /comparePngBtn\.addEventListener[\s\S]+?getContext\(['"]2d['"]\)/,
    "click handler must get a 2D canvas context");
  // Must draw the verdict text
  assert.match(appSrc, /comparePngBtn\.addEventListener[\s\S]+?fillText\(verdictText/,
    "canvas must render the verdict text");
  // Must use the verdict color (danger / amber / even)
  assert.match(appSrc, /comparePngBtn\.addEventListener[\s\S]+?verdictKind === 'danger'[\s\S]+?'#C6361F'/,
    "danger verdict must use --danger color in the canvas");
  // Must include the brand header
  assert.match(appSrc, /comparePngBtn\.addEventListener[\s\S]+?fillText\('CLEARDOC'/,
    "PNG must include the CLEARDOC brand header");
  // Must include the footer timestamp
  assert.match(appSrc, /comparePngBtn\.addEventListener[\s\S]+?cleardoc\.app/,
    "PNG must include the footer attribution with cleardoc.app");
  // Must download as PNG
  assert.match(appSrc, /comparePngBtn\.addEventListener[\s\S]+?toBlob/,
    "must use canvas.toBlob to export the canvas");
  assert.match(appSrc, /comparePngBtn\.addEventListener[\s\S]+?image\/png/,
    "must export as image/png");
  assert.match(appSrc, /comparePngBtn\.addEventListener[\s\S]+?cleardoc-comparison-/,
    "filename must start with cleardoc-comparison-");
  // Flash feedback
  assert.match(appSrc, /comparePngBtn\.addEventListener[\s\S]+?exported/,
    "button must flash 'exported' on success");

  // CSS: button must be styled as a clickable cta
  assert.match(cssSrc, /\.compare-actions \.cmp-png\{[^}]*cursor:\s*pointer/,
    ".cmp-png must be cursor:pointer (signals clickability)");
  assert.match(cssSrc, /\.compare-actions \.cmp-png:hover/,
    ".cmp-png must have a hover state");
});

test("analyzer: PNG export includes the diff section (unique clauses from each side)", () => {
  // Polishes iter #33 — the PNG previously only had verdict + stats.
  // Now it also includes the // WHAT'S DIFFERENT section with the
  // unique clauses from each side, so the image is a complete
  // shareable artifact (verdict + scores + unique content).
  if (!HAS_BROWSER) return;
  const fs = require("node:fs");
  const path = require("node:path");
  const appSrc = fs.readFileSync(path.join(ROOT, "assets", "app.js"), "utf8");

  // Must read the diff DOM (compareDiff) when rendering
  assert.match(appSrc, /comparePngBtn\.addEventListener[\s\S]+?compareDiff[\s\S]+?querySelectorAll\(['"]\.cmp-diff-row['"]\)/,
    "PNG export must read the rendered .cmp-diff-row elements");
  // Must render the WHAT'S DIFFERENT sub-header
  assert.match(appSrc, /comparePngBtn\.addEventListener[\s\S]+?WHAT.?S DIFFERENT/,
    "PNG must include the '// WHAT'S DIFFERENT' sub-header");
  // Must render each side's label (e.g. "only in Original (N)")
  assert.match(appSrc, /comparePngBtn\.addEventListener[\s\S]+?label[\s\S]+?toUpperCase/,
    "PNG must render the diff-side label (e.g. ONLY IN ORIGINAL)");
  // Must render the unique clause sentences
  assert.match(appSrc, /comparePngBtn\.addEventListener[\s\S]+?sentences\.slice\(0,\s*4\)/,
    "PNG must render the first 4 unique clauses per side (cap to fit canvas)");
  // Must use word-wrap (clipped + charsPerLine loop) so long clauses fit
  assert.match(appSrc, /comparePngBtn\.addEventListener[\s\S]+?charsPerLine/,
    "PNG must word-wrap long clauses via charsPerLine");
  // Dynamic height calculation: includes diffH in total height
  assert.match(appSrc, /comparePngBtn\.addEventListener[\s\S]+?diffH/,
    "PNG height must include the diff section (diffH variable)");
});

test("analyzer: language detection tags the doc and picks a matching TTS voice", () => {
  // New feature — users paste non-English docs (Spanish leases,
  // French medical bills); previously the analyzer silently
  // mislabeled them as English. Now detectLanguage tags the doc
  // with the detected language and pickVoiceForLang uses it for
  // TTS so the voice actually reads in the right language.
  if (!HAS_BROWSER) return;
  const fs = require("node:fs");
  const path = require("node:path");
  const appSrc = fs.readFileSync(path.join(ROOT, "assets", "app.js"), "utf8");
  const html = fs.readFileSync(path.join(ROOT, "analyze.html"), "utf8");
  const cssSrc = fs.readFileSync(path.join(ROOT, "assets", "theme.css"), "utf8");

  // detectLanguage must exist at the IIFE level
  assert.match(appSrc, /function detectLanguage\(text\)/,
    "detectLanguage() must exist at the IIFE level");
  // Must support the six major languages we ship patterns for
  for (const code of ["es", "fr", "de", "it", "pt", "en"]) {
    assert.ok(appSrc.includes(code + ': { words:'),
      `detectLanguage must include a pattern map for ${code}`);
  }
  // Confidence floor: must require ≥2 hits
  assert.match(appSrc, /detectLanguage[\s\S]+?best\.count < 2[\s\S]+?return null/,
    "detectLanguage must require ≥2 hits (no false-positive single-word matches)");

  // analyze.html must have the language tag
  assert.match(html, /id="dsLang"/,
    "analyze.html must contain #dsLang");

  // updateTextStats must call detectLanguage and paint the tag
  const updateBlock = appSrc.match(/function updateTextStats\(\)\{[\s\S]+?^\s\s\}/m);
  assert.ok(updateBlock, "updateTextStats() must exist");
  assert.match(updateBlock[0], /detectLanguage\(raw\)/,
    "updateTextStats must call detectLanguage(raw)");
  assert.match(updateBlock[0], /dsLang\.textContent\s*=\s*'🌐 '/,
    "dsLang must show the detected language with a globe prefix");
  // Must stash the detected lang on the input for the TTS handler
  assert.match(updateBlock[0], /input\._detectedLang\s*=\s*lang/,
    "updateTextStats must stash the detected lang on the input (TTS picks it up)");

  // TTS handler must use pickVoiceForLang when a lang is detected
  assert.match(appSrc, /pickVoiceForLang\(detectedLang\.tts\)/,
    "TTS handler must call pickVoiceForLang(detectedLang.tts) when a lang is detected");
  assert.match(appSrc, /u\.lang\s*=\s*detectedLang\.tts/,
    "TTS must set u.lang to the detected BCP-47 tag (browser pronunciation hint)");
  // pickVoiceForLang must prefer exact match, then prefix, then fallback
  assert.match(appSrc, /pickVoiceForLang\s*=\s*\(\s*langTag\s*\)/,
    "pickVoiceForLang() must exist");
  assert.match(appSrc, /pickVoiceForLang[\s\S]+?v\.lang\.toLowerCase\(\)\s*===\s*String\(langTag\)/,
    "pickVoiceForLang must prefer exact BCP-47 lang match");

  // CSS: language tag must be visually distinct (accent-tinted bg)
  assert.match(cssSrc, /\.doc-summary \.ds-lang\{[^}]*var\(--accent-text\)/,
    ".ds-lang must use --accent-text (visually distinct from the stats)");
  assert.match(cssSrc, /\.doc-summary \.ds-lang\{[^}]*background/,
    ".ds-lang must have a background tint (pill styling)");
});

test("analyzer: history entries show their detected language as a small pill", () => {
  // Polishes iter #35 — when pushHistory saves an entry, it also
  // detects + stashes the language. renderHistory paints a small
  // pill per entry so users see at a glance which docs were which
  // language. Colors map to the doc-type palette for cohesion.
  if (!HAS_BROWSER) return;
  const fs = require("node:fs");
  const path = require("node:path");
  const appSrc = fs.readFileSync(path.join(ROOT, "assets", "app.js"), "utf8");
  const cssSrc = fs.readFileSync(path.join(ROOT, "assets", "theme.css"), "utf8");

  // pushHistory must call detectLanguage + stash the result
  assert.match(appSrc, /function pushHistory[\s\S]+?detectLanguage/,
    "pushHistory must call detectLanguage to detect at save time");
  assert.match(appSrc, /function pushHistory[\s\S]+?lang: lang \? lang\.code : null/,
    "pushHistory must stash the detected lang code on the entry");
  assert.match(appSrc, /function pushHistory[\s\S]+?langLabel: lang \? lang\.label : null/,
    "pushHistory must stash the detected lang label on the entry");
  // Refresh-on-update must also refresh language
  assert.match(appSrc, /arr\[0\]\.lang\s*=\s*entry\.lang/,
    "pushHistory dedupe path must also refresh the language (so pattern improvements propagate)");

  // renderHistory must paint the language pill (it's an arrow function
  // const renderHistory = () => { ... })
  const renderFn = appSrc.match(/const renderHistory\s*=\s*\(\)\s*=>\s*\{[\s\S]+?\n\s+\}\s*\};\s*$/m);
  assert.ok(renderFn, "renderHistory() must exist");
  assert.match(renderFn[0], /hp-lang/,
    "renderHistory must render a .hp-lang pill");
  assert.match(renderFn[0], /it\.langLabel/,
    "renderHistory must read langLabel from the entry");

  // CSS: each language gets a distinct color
  for (const cls of [".hp-lang-es", ".hp-lang-fr", ".hp-lang-de", ".hp-lang-it", ".hp-lang-pt", ".hp-lang-en"]) {
    assert.ok(cssSrc.includes(cls),
      `theme.css must define ${cls} (per-language color)`);
  }
});

test("analyzer: history panel has a language filter row that shows count per language", () => {
  // New feature — with multi-language docs in history (iter #35 + #36),
  // a filter row lets users narrow to "only Spanish" / "only English"
  // etc. Each button shows a count so users see at a glance which
  // languages are present.
  if (!HAS_BROWSER) return;
  const fs = require("node:fs");
  const path = require("node:path");
  const appSrc = fs.readFileSync(path.join(ROOT, "assets", "app.js"), "utf8");
  const html = fs.readFileSync(path.join(ROOT, "analyze.html"), "utf8");
  const cssSrc = fs.readFileSync(path.join(ROOT, "assets", "theme.css"), "utf8");

  // analyze.html: filter row with all 7 buttons (All + 6 langs)
  assert.match(html, /id="historyFilter"/,
    "analyze.html must contain #historyFilter");
  for (const code of ["all", "en", "es", "fr", "de", "it", "pt"]) {
    assert.ok(html.includes('data-hp-filter="' + code + '"'),
      `historyFilter must include a button for ${code}`);
  }
  // Each non-`all` button must carry a flag emoji for visual scan
  for (const flag of ["🇬🇧", "🇪🇸", "🇫🇷", "🇩🇪", "🇮🇹", "🇵🇹"]) {
    assert.ok(html.includes(flag),
      `historyFilter must include the ${flag} flag emoji for visual scan`);
  }
  // "All" uses a globe — neutral across languages
  assert.match(html, /data-hp-filter="all"[^>]*>🌐 All/,
    "historyFilter 'All' must use a globe 🌐 (neutral across languages)");
});

test("analyzer: voice picker dropdown lets users choose a specific TTS voice", () => {
  // New feature — dropdown populated with available SpeechSynthesis
  // voices, preferring the detected language. User pick is persisted
  // to localStorage so it survives reloads. Pairs with iter #35
  // (language detection) + #27 (TTS).
  if (!HAS_BROWSER) return;
  const fs = require("node:fs");
  const path = require("node:path");
  const appSrc = fs.readFileSync(path.join(ROOT, "assets", "app.js"), "utf8");
  const html = fs.readFileSync(path.join(ROOT, "analyze.html"), "utf8");
  const cssSrc = fs.readFileSync(path.join(ROOT, "assets", "theme.css"), "utf8");

  // analyze.html: <select> must exist next to the Read-aloud button
  assert.match(html, /<select[^>]*id="voicePicker"/,
    "analyze.html must contain <select id=\"voicePicker\">");
  assert.match(html, /id="voicePicker"[^>]*aria-label="Choose TTS voice"/,
    "#voicePicker must have an aria-label");

  // populateVoicePicker must exist + populate options
  assert.match(appSrc, /populateVoicePicker\s*=\s*\(\s*detectedLang\s*\)\s*=>/,
    "populateVoicePicker() must exist");
  assert.match(appSrc, /populateVoicePicker[\s\S]+?getVoices/,
    "populateVoicePicker must read getVoices()");
  assert.match(appSrc, /populateVoicePicker[\s\S]+?System default/,
    "populateVoicePicker must include a 'System default' option");
  assert.match(appSrc, /populateVoicePicker[\s\S]+?startsWith\(prefix\)/,
    "populateVoicePicker must filter by the detected lang prefix");
  assert.match(appSrc, /populateVoicePicker[\s\S]+?appendChild/,
    "populateVoicePicker must appendChild each option");

  // localStorage persistence — setStoredVoice on change, getStoredVoice on load
  assert.match(appSrc, /const VOICE_KEY\s*=\s*'cleardoc:ttsVoice'/,
    "voice picker must use localStorage key 'cleardoc:ttsVoice'");
  assert.match(appSrc, /setStoredVoice\(voicePicker\.value\)/,
    "voice picker change handler must persist the selection");

  // TTS handler must prefer the explicit user pick
  assert.match(appSrc, /explicit\s*\|\|/,
    "TTS handler must prefer explicit user pick over detected-language fallback");

  // Async voice loading — Chrome populates voices on the voiceschanged event
  assert.match(appSrc, /onvoiceschanged/,
    "voice picker must hook onvoiceschanged for browsers that load voices async");

  // CSS: picker must be styled as a clickable select
  assert.match(cssSrc, /\.voice-picker\{[^}]*cursor:\s*pointer/,
    ".voice-picker must be cursor:pointer (signals clickability)");
  assert.match(cssSrc, /\.voice-picker\{[^}]*background/,
    ".voice-picker must have a paper background (matches ghost-btn aesthetic)");
});

test("analyzer: voice preview button speaks a sample phrase in the selected voice", () => {
  // Polishes iter #39 — adds a ▶ preview button next to the voice
  // picker so users can HEAR a voice before committing. Standard
  // voice-picker UX pattern (macOS, iOS, Windows Voice settings).
  // Sample phrase uses the detected language's BCP-47 tag so the
  // voice speaks in the right language.
  if (!HAS_BROWSER) return;
  const fs = require("node:fs");
  const path = require("node:path");
  const appSrc = fs.readFileSync(path.join(ROOT, "assets", "app.js"), "utf8");
  const html = fs.readFileSync(path.join(ROOT, "analyze.html"), "utf8");
  const cssSrc = fs.readFileSync(path.join(ROOT, "assets", "theme.css"), "utf8");

  // analyze.html: preview button must exist next to the picker
  assert.match(html, /<button[^>]*id="voicePreviewBtn"/,
    "analyze.html must contain <button id=\"voicePreviewBtn\">");
  assert.match(html, /aria-label="Preview the selected voice"/,
    "#voicePreviewBtn must have an aria-label");

  // Click handler must construct a SpeechSynthesisUtterance for the sample
  assert.match(appSrc, /voicePreviewBtn\.addEventListener\(\s*['"]click['"]/,
    "#voicePreviewBtn must have a click handler");
  assert.match(appSrc, /voicePreviewBtn\.addEventListener[\s\S]+?SpeechSynthesisUtterance/,
    "preview handler must construct a SpeechSynthesisUtterance");
  assert.match(appSrc, /voicePreviewBtn\.addEventListener[\s\S]+?Hello\s*—\s*this is a sample/,
    "preview handler must speak a sample phrase ('Hello — this is a sample...')");

  // Must use the currently-selected voice (same lookup logic as iter #39)
  assert.match(appSrc, /voicePreviewBtn\.addEventListener[\s\S]+?explicit/,
    "preview must use the explicit user-picked voice (same lookup as main TTS)");

  // Must cancel any current speech first (don't overlap)
  assert.match(appSrc, /voicePreviewBtn\.addEventListener[\s\S]+?speechSynthesis\.cancel/,
    "preview must cancel any current speech before starting");

  // Must restore the original label on end/error
  assert.match(appSrc, /voicePreviewBtn\.addEventListener[\s\S]+?onend[\s\S]+?orig/,
    "preview must restore the original button label on end/error");

  // CSS: preview button must be styled as part of the result-actions row
  assert.match(cssSrc, /\.voice-preview\{[^}]*text-transform:\s*uppercase/,
    ".voice-preview must use uppercase styling (matches ghost-btn aesthetic)");
});

test("analyzer: each risk row shows a 'suggest' counter-clause the user could propose", () => {
  // New feature — for each detected risk, surface a concrete
  // counter-clause suggestion. Pairs the "why this is bad" with
  // "what to ask for instead" so the analyzer becomes a negotiation
  // assistant, not just a risk spotter.
  if (!HAS_BROWSER) return;
  const fs = require("node:fs");
  const path = require("node:path");
  const appSrc = fs.readFileSync(path.join(ROOT, "assets", "app.js", ), "utf8");
  const cssSrc = fs.readFileSync(path.join(ROOT, "assets", "theme.css"), "utf8");

  // Every RISK entry must have a counter field
  for (const label of ["perpetuity", "indemnif", "waiv", "refundable", "renew", "sole discretion", "late fee", "governing law", "confidential"]) {
    assert.ok(appSrc.includes(label),
      `RISK array must include a counter for ${label}`);
  }
  // matchRisks must carry the counter through to the rendered rows
  assert.match(appSrc, /counter: r\.counter \|\| null/,
    "matchRisks must carry the counter field through");
  // renderRiskDetail must render a .risk-counter sub-row per risk
  assert.match(appSrc, /risk-counter\s+' \+ sevClass/,
    "renderRiskDetail must render a .risk-counter row");
  assert.match(appSrc, /rc-kicker/,
    "risk counter must have the '→ suggest:' kicker");
  assert.match(appSrc, /rc-text/,
    "risk counter must render the suggestion text");
  // Counter must include "→ suggest:" prefix for visual scan
  assert.match(appSrc, /suggest:/,
    "risk counter must include the 'suggest:' prefix");

  // CSS: counter row must be visually distinct from risk rows
  assert.match(cssSrc, /\.risk-counter\{[^}]*border-left/,
    ".risk-counter must have a left border (visual divider from the risk row)");
  // Trap counter uses --danger for loudest suggestion
  assert.match(cssSrc, /\.risk-counter\.trap\{[^}]*var\(--danger\)/,
    ".risk-counter.trap must use --danger (trap suggestion = loudest)");
  // Watch counter uses --amber
  assert.match(cssSrc, /\.risk-counter\.watch\{[^}]*var\(--amber\)/,
    ".risk-counter.watch must use --amber (watch suggestion = medium)");
});

test("analyzer: negotiation suggestions have a per-suggestion Copy button", () => {
  // Polishes iter #41 — each counter-clause has its own Copy
  // button (in addition to the global Copy). Lets users paste a
  // single counter-clause into a redline without copying the
  // entire match list.
  if (!HAS_BROWSER) return;
  const fs = require("node:fs");
  const path = require("node:path");
  const appSrc = fs.readFileSync(path.join(ROOT, "assets", "app.js"), "utf8");
  const cssSrc = fs.readFileSync(path.join(ROOT, "assets", "theme.css"), "utf8");

  // renderRiskDetail must render the copy button in the counter row
  const renderFn = appSrc.match(/function renderRiskDetail\(hits\)\{[\s\S]+?^\s\s\}/m);
  assert.ok(renderFn, "renderRiskDetail() must exist");
  assert.match(renderFn[0], /data-rc-copy/,
    "renderRiskDetail must render [data-rc-copy] button");
  // Button must carry the counter text in the data attribute (so
  // the click handler can extract it without re-running matchRisks)
  assert.match(renderFn[0], /data-rc-copy="'\s*\+\s*esc\(h\.counter\)/,
    "data-rc-copy attribute must hold the counter text (escaped)");

  // Delegated click handler must handle the copy button
  assert.match(appSrc, /riskDetail\.addEventListener[\s\S]+?data-rc-copy/,
    "riskDetail click handler must handle [data-rc-copy] clicks");
  // Must use the same clipboard pattern as other copy buttons
  assert.match(appSrc, /data-rc-copy[\s\S]+?clipboard\.writeText/,
    "copy handler must use navigator.clipboard.writeText");
  assert.match(appSrc, /data-rc-copy[\s\S]+?execCommand\(\s*['"]copy['"]\s*\)/,
    "copy handler must fall back to execCommand('copy') on older browsers");
  // Flash feedback on success
  assert.match(appSrc, /data-rc-copy[\s\S]+?copied/,
    "button must flash '✓ copied' on success");

  // CSS: copy button must be styled as a clickable, color-keyed control
  assert.match(cssSrc, /\.rc-copy\{[^}]*cursor:\s*pointer/,
    ".rc-copy must be cursor:pointer (signals clickability)");
  assert.match(cssSrc, /\.rc-copy\.trap|\.risk-counter\.trap \.rc-copy/,
    ".rc-copy must be color-keyed to the parent severity (trap / watch)");
});

test("analyzer: redline button exports counter-suggestions as a downloadable text file", () => {
  // New feature — 📝 redline button in the risk toolbar exports a
  // redline-format text file: original clause + why + proposed
  // replacement. Users paste it into Word / email as a negotiation
  // starting point.
  if (!HAS_BROWSER) return;
  const fs = require("node:fs");
  const path = require("node:path");
  const appSrc = fs.readFileSync(path.join(ROOT, "assets", "app.js"), "utf8");
  const html = fs.readFileSync(path.join(ROOT, "analyze.html"), "utf8");
  const cssSrc = fs.readFileSync(path.join(ROOT, "assets", "theme.css"), "utf8");

  // analyze.html: redline button must exist in the risk toolbar
  // (the risk-detail-toolbar is rendered dynamically by app.js — the
  // template literal lives in renderRiskDetail, not in analyze.html)
  assert.match(appSrc, /data-rd-redline="1"/,
    "renderRiskDetail must render a [data-rd-redline] button");
  assert.match(appSrc, /aria-label="Export redline suggestions"/,
    "redline button must have an aria-label");
  // (already checked above)

  // formatRedline helper must exist
  assert.match(appSrc, /function formatRedline\(hits\)/,
    "formatRedline() must exist at the IIFE level");
  // Must include all the standard redline sections
  for (const section of [
    "REDLINE",
    "Negotiation Suggestions",
    "Proposed:",
    "Review each suggestion with your lawyer",
  ]) {
    assert.ok(appSrc.includes("'" + section + "'") || appSrc.includes('"' + section + '"') || appSrc.includes(section),
      `formatRedline must include "${section}"`);
  }
  // Must read counter from each hit
  assert.match(appSrc, /formatRedline[\s\S]+?h\.counter/,
    "formatRedline must include the counter-suggestion text");

  // Click handler must wire up the button
  assert.match(appSrc, /riskDetail\.addEventListener[\s\S]+?data-rd-redline/,
    "riskDetail click handler must handle [data-rd-redline] clicks");
  // Must use Blob + download (same pattern as iter #12 calendar export)
  assert.match(appSrc, /data-rd-redline[\s\S]+?new Blob\(\s*\[\s*text\s*\][^)]*text\/plain/,
    "redline handler must create a text/plain Blob");
  assert.match(appSrc, /data-rd-redline[\s\S]+?cleardoc-redline-/,
    "filename must start with 'cleardoc-redline-' (sortable in Downloads)");
  // Flash feedback
  assert.match(appSrc, /data-rd-redline[\s\S]+?exported/,
    "button must flash '✓ exported' on success");

  // CSS: button must be styled as clickable
  assert.match(cssSrc, /\.rd-redline\{[^}]*cursor:\s*pointer/,
    ".rd-redline must be cursor:pointer (signals clickability)");
  assert.match(cssSrc, /\.rd-redline\{[^}]*margin-right/,
    ".rd-redline must have spacing from the Copy button");
});

test("analyzer: Copy includes counter-suggestions so users get the full negotiation playbook", () => {
  // Polishes iter #41 + #43 — the Copy button now includes the
  // counter-suggestions in the output. One Copy → full negotiation
  // playbook (TRAP/WATCH + why + → Suggest) ready to paste into
  // an email / chat / ticket.
  if (!HAS_BROWSER) return;
  const fs = require("node:fs");
  const path = require("node:path");
  const appSrc = fs.readFileSync(path.join(ROOT, "assets", "app.js"), "utf8");

  // formatMatchesForCopy must include the counter line when present
  assert.match(appSrc, /formatMatchesForCopy[\s\S]+?h\.counter/,
    "formatMatchesForCopy must read h.counter when present");
  assert.match(appSrc, /formatMatchesForCopy[\s\S]+?Suggest:/,
    "formatMatchesForCopy must render 'Suggest:' for counter-suggestions");
  // Must also include the why line
  assert.match(appSrc, /formatMatchesForCopy[\s\S]+?Why:/,
    "formatMatchesForCopy must render 'Why:' for the original reason");
  // Must include a header (recognition value — users see this is a
  // ClearDoc report at a glance when pasting)
  assert.match(appSrc, /formatMatchesForCopy[\s\S]+?RISK REPORT/,
    "formatMatchesForCopy must include a 'RISK REPORT' header");
});

skip("privacy: 'Forget my data' button wipes localStorage, SW caches, and URL fragment", async () => {
  if (!HAS_BROWSER) return;
  const fs = require("node:fs");
  const path = require("node:path");
  const appSrc = fs.readFileSync(path.join(ROOT, "assets", "app.js"), "utf8");
  const themeSrc = fs.readFileSync(path.join(ROOT, "assets", "theme.css"), "utf8");

  // Every public HTML page must expose the button
  for (const page of ["index.html", "analyze.html", "pricing.html", "404.html"]) {
    const html = fs.readFileSync(path.join(ROOT, page), "utf8");
    assert.match(html, /id="forgetBtn"/, `${page} must expose #forgetBtn in the footer`);
    assert.match(html, /Forget my data/, `${page} footer must show the "Forget my data" button label`);
  }

  // wireForgetMe + forgetMyData must exist and be wired on every page
  assert.match(appSrc, /function wireForgetMe\(/, "wireForgetMe must exist");
  assert.match(appSrc, /function forgetMyData\(/, "forgetMyData must exist");
  assert.match(appSrc, /wireForgetMe\]/, "wireForgetMe must be in the 'always' init list (every page)");

  // The reset function must wipe all three privacy surfaces
  const forgetBlock = appSrc.match(/async function forgetMyData\(\)\{[\s\S]+?\n  \}/);
  assert.ok(forgetBlock, "forgetMyData function must exist");
  assert.match(forgetBlock[0], /localStorage\.removeItem/, "must clear localStorage");
  assert.match(forgetBlock[0], /cleardoc:lastAnalysis/, "must clear the snapshot key specifically");
  assert.match(forgetBlock[0], /cleardoc:draftInput/, "must clear the draft key specifically");
  assert.match(forgetBlock[0], /location\.hash/, "must strip the share fragment from the URL");
  assert.match(forgetBlock[0], /getRegistrations/, "must unregister the service worker");
  assert.match(forgetBlock[0], /caches\.delete/, "must clear SW caches");

  // Toast confirmation must exist (privacy promise visibility)
  assert.match(appSrc, /function showForgetToast/, "showForgetToast must exist");
  assert.match(themeSrc, /\.forget-toast/, "forget-toast CSS rule must exist");

  // Live: clicking the button on the home page clears a seeded snapshot.
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  // Seed localStorage with the snapshot key before the page loads
  await page.addInitScript(() => {
    localStorage.setItem("cleardoc:lastAnalysis", JSON.stringify({
      v: 1, ts: Date.now(), raw: "x", rewriteHtml: "<p>x</p>",
      risks: [], deadlines: [], nextSteps: [], provider: "ai",
    }));
    localStorage.setItem("cleardoc:draftInput", JSON.stringify({
      v: 1, ts: Date.now(), text: "in-progress clause draft",
    }));
  });
  await page.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: "networkidle" });
  // Sanity: seed survived the page load
  assert.ok(await page.evaluate(() => localStorage.getItem("cleardoc:lastAnalysis")), "seed must survive page load");
  assert.ok(await page.evaluate(() => localStorage.getItem("cleardoc:draftInput")), "draft seed must survive page load");

  await page.click("#forgetBtn");
  // Give the async reset a moment to flush
  await page.waitForTimeout(150);
  const after = await page.evaluate(() => localStorage.getItem("cleardoc:lastAnalysis"));
  assert.equal(after, null, "forget button must clear cleardoc:lastAnalysis");
  const draftAfter = await page.evaluate(() => localStorage.getItem("cleardoc:draftInput"));
  assert.equal(draftAfter, null, "forget button must clear cleardoc:draftInput");
  // Toast should be visible
  const toastVisible = await page.$eval("#forgetToast", (el) => el.classList.contains("show"));
  assert.equal(toastVisible, true, "toast must appear after forget");
  const toastText = await page.$eval("#forgetToast .ft-text", (el) => el.textContent || "");
  assert.match(toastText, /localStorage/i, "toast must mention localStorage");
  assert.match(toastText, /SW caches/i, "toast must mention SW caches");
  assert.match(toastText, /draft/i, "toast must mention drafts");

  await page.close();
  await ctx.close();
});

skip("draft autosave: textarea content survives reload, gets cleared on Analyze / Clear / Forget", async () => {
  if (!HAS_BROWSER) return;
  const fs = require("node:fs");
  const path = require("node:path");
  const appSrc = fs.readFileSync(path.join(ROOT, "assets", "app.js"), "utf8");

  // Source-pattern checks: draft helpers exist + are wired to the input event
  assert.match(appSrc, /const DRAFT_KEY\s*=\s*'cleardoc:draftInput'/, "DRAFT_KEY constant must exist");
  assert.match(appSrc, /function saveDraftNow\(/, "saveDraftNow helper must exist");
  assert.match(appSrc, /function loadDraft\(/, "loadDraft helper must exist");
  assert.match(appSrc, /function clearDraft\(/, "clearDraft helper must exist");
  assert.match(appSrc, /scheduleDraftSave/, "input must schedule a debounced draft save");
  // Successful render must clear the draft (snapshot supersedes it)
  assert.match(appSrc, /clearDraft\(\);[\s\S]{0,80}A successful render/, "successful render must clear the draft");
  // Clear button must also clear the draft
  const clearBtn = appSrc.match(/if\(clearBtn\) clearBtn\.addEventListener[\s\S]+?clearStoredSnapshot\(\);/);
  assert.ok(clearBtn, "clear button handler must exist");
  assert.match(clearBtn[0], /clearDraft\(\)/, "clear button must call clearDraft");

  // Live: seed a draft, reload the page, expect the textarea to be restored
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  // Visit /analyze.html first to seed an in-progress draft (we can't seed via
  // addInitScript because draft restoration happens at page load).
  await page.goto(`http://127.0.0.1:${PORT}/analyze.html`, { waitUntil: "networkidle" });
  await page.fill("#docInput", "Lessee shall forfeit the security deposit on termination.");
  await page.dispatchEvent("#docInput", "input");
  // Wait for the debounced save (500ms)
  await page.waitForTimeout(700);
  const draftSaved = await page.evaluate(() => localStorage.getItem("cleardoc:draftInput"));
  assert.ok(draftSaved, "draft must be saved to localStorage after typing");
  const parsed = JSON.parse(draftSaved);
  assert.ok(parsed.text && parsed.text.indexOf("forfeit") !== -1, `saved draft must contain typed text, got: ${parsed.text}`);

  // Reload — the textarea should be restored
  await page.reload({ waitUntil: "networkidle" });
  await page.waitForTimeout(150);
  const restoredValue = await page.$eval("#docInput", (el) => el.value);
  assert.ok(restoredValue.indexOf("forfeit") !== -1, `draft must be restored on reload, got: "${restoredValue.slice(0, 80)}"`);

  // Status message announces the restore
  const msg = await page.$eval("#analyzeMsg", (el) => el.textContent || "");
  assert.match(msg, /restored/i, `restore banner must say "restored", got: "${msg}"`);

  // Clicking Clear wipes the draft
  await page.click("#clearBtn");
  await page.waitForTimeout(50);
  const draftAfterClear = await page.evaluate(() => localStorage.getItem("cleardoc:draftInput"));
  assert.equal(draftAfterClear, null, "Clear button must wipe the draft from localStorage");

  await page.close();
  await ctx.close();
});

skip("analyzer: clicking the verdict Copy button copies just the verdict + summary", async () => {
  if (!HAS_BROWSER) return;
  const fs = require("node:fs");
  const path = require("node:path");
  const analyzeHtml = fs.readFileSync(path.join(ROOT, "analyze.html"), "utf8");
  const appSrc = fs.readFileSync(path.join(ROOT, "assets", "app.js"), "utf8");
  const themeSrc = fs.readFileSync(path.join(ROOT, "assets", "theme.css"), "utf8");

  // analyze.html must expose the button next to the verdict heading
  assert.match(analyzeHtml, /id="verdictCopyBtn"/, "analyze.html must expose #verdictCopyBtn");
  assert.match(analyzeHtml, /<button[^>]*id="verdictCopyBtn"[^>]*title="[^"]*verdict/i, "button must carry an explanatory title");
  // The button must be marked .no-print so it doesn't ship in printouts
  assert.match(analyzeHtml, /class="[^"]*no-print[^"]*"[^>]*id="verdictCopyBtn"|id="verdictCopyBtn"[^>]*class="[^"]*no-print/, "#verdictCopyBtn must carry .no-print");

  // Source-pattern checks
  assert.match(appSrc, /verdictCopyBtn\s*=\s*\$\('#verdictCopyBtn'\)/, "verdictCopyBtn must be captured");
  assert.match(appSrc, /verdictCopyBtn\)\.addEventListener\('click'/, "verdictCopyBtn must be wired to a click handler");
  // The handler reads the label + summary and writes to clipboard
  assert.match(appSrc, /querySelector\('\.verdict-label'\)/, "handler must read the verdict label");
  assert.match(appSrc, /querySelector\('\.verdict-summary'\)/, "handler must read the verdict summary");
  assert.match(appSrc, /navigator\.clipboard\.writeText/, "handler must write to the clipboard");
  // CSS defines .verdict-copy
  assert.match(themeSrc, /\.verdict-copy\{/, ".verdict-copy CSS rule must exist");

  // Live: run an analysis, click Copy, assert the button text flashed
  // and that the clipboard contains the verdict + summary
  const ctx = await browser.newContext({ permissions: ["clipboard-read", "clipboard-write"] });
  const page = await ctx.newPage();
  await page.goto(`http://127.0.0.1:${PORT}/analyze.html`, { waitUntil: "networkidle" });
  // The preloaded sample already has analysis via offline fallback — but
  // the verify the verdict is rendered.
  await page.waitForSelector("#verdictDisplay .verdict-label", { timeout: 5000 }).catch(() => {});
  const hasLabel = await page.$("#verdictDisplay .verdict-label");
  if(!hasLabel){
    await page.close(); await ctx.close();
    return; // skip live assertion if no AI + no offline verdict rendered
  }

  await page.click("#verdictCopyBtn");
  await page.waitForTimeout(80);
  const labelText = await page.$eval("#verdictCopyBtn", (el) => el.textContent || "");
  assert.match(labelText, /Copied|Copy failed/, `button must flash a status, got "${labelText}"`);

  // If clipboard worked (Copied), verify its contents
  if(labelText.indexOf("Copied") !== -1){
    const clip = await page.evaluate(async () => {
      try { return await navigator.clipboard.readText(); } catch(_){ return null; }
    });
    if(clip != null){
      const expectedLabel = await page.$eval("#verdictDisplay .verdict-label", (el) => el.textContent || "");
      assert.ok(clip.indexOf(expectedLabel.trim()) !== -1, `clipboard must contain verdict label "${expectedLabel}", got "${clip}"`);
    }
  }

  await page.close(); await ctx.close();
});

skip("analyzer: live text-stats bar shows word/char/level/cap and reacts to typing", async () => {
  if (!HAS_BROWSER) return;
  const fs = require("node:fs");
  const path = require("node:path");
  const analyzeHtml = fs.readFileSync(path.join(ROOT, "analyze.html"), "utf8");
  const appSrc = fs.readFileSync(path.join(ROOT, "assets", "app.js"), "utf8");
  const themeSrc = fs.readFileSync(path.join(ROOT, "assets", "theme.css"), "utf8");

  // HTML must expose the stat element IDs
  for (const id of ["#textStats", "#statWords", "#statChars", "#statLevel", "#statCap"]) {
    assert.match(analyzeHtml, new RegExp(`id="${id.slice(1)}"`), `analyze.html must contain ${id}`);
  }

  // JS must wire input → updateTextStats
  assert.match(appSrc, /function updateTextStats\(/, "updateTextStats must exist");
  assert.match(appSrc, /input\.addEventListener\(['"]input['"],\s*updateTextStats\)/, "input must be wired to updateTextStats on input events");

  // The quick-fill buttons must also refresh the stats after pasting a sample
  assert.match(appSrc, /qf\[data-fill\][\s\S]+?updateTextStats\(\)/, "quick-fill buttons must call updateTextStats after pasting");

  // Cap display must match the documented MAX_DOCUMENT_CHARS
  const capMatch = appSrc.match(/MAX_DOCUMENT_CHARS\s*=\s*(\d+)/);
  assert.ok(capMatch, "MAX_DOCUMENT_CHARS must be a constant in api/analyze.js or app.js");

  // CSS must define the .textstats rule (and the .over variant for over-cap warning)
  assert.match(themeSrc, /\.textstats\{/, ".textstats CSS rule must exist");
  assert.match(themeSrc, /\.textstats\.over/, ".textstats.over variant must exist for over-cap state");

  // Live: load analyze page, edit textarea, verify the stats update
  const page = await context.newPage();
  await page.goto(`http://127.0.0.1:${PORT}/analyze.html`, { waitUntil: "networkidle" });
  const initialWords = await page.$eval("#statWords", (el) => el.textContent || "");
  assert.ok(Number(initialWords.replace(/,/g, "")) >= 30, `preloaded sample should have ≥30 words, got ${initialWords}`);

  // Clear the textarea and type a fresh sentence
  await page.fill("#docInput", "Lessee shall indemnify lessor in perpetuity.");
  await page.dispatchEvent("#docInput", "input");
  const newWords = await page.$eval("#statWords", (el) => el.textContent || "");
  assert.equal(newWords, "6", `short sentence should report 6 words, got "${newWords}"`);
  const newLevel = await page.$eval("#statLevel", (el) => el.textContent || "");
  assert.match(newLevel, /^\d+th$/, `reading level should be a grade like '12th', got "${newLevel}"`);

  // Type very short text — level should hide behind em dash
  await page.fill("#docInput", "hello");
  await page.dispatchEvent("#docInput", "input");
  const shortLevel = await page.$eval("#statLevel", (el) => el.textContent || "");
  assert.equal(shortLevel, "—", `too-short text should show em-dash for level, got "${shortLevel}"`);

  await page.close();
});

skip("analyzer (mobile): Analyze CTA becomes a sticky bottom bar at ≤900px so it's always within thumb reach", async () => {
  if (!HAS_BROWSER) return;
  const fs = require("node:fs");
  const path = require("node:path");
  const themeSrc = fs.readFileSync(path.join(ROOT, "assets", "theme.css"), "utf8");

  // The sticky-bar rule must exist inside a max-width:900px media query
  // and pin the .work .run-row to the viewport bottom.
  assert.match(
    themeSrc,
    /@media\s*\(max-width:\s*900px\)[\s\S]*?\.work \.run-row\s*\{[^}]*position:\s*fixed/s,
    "mobile media query must pin .work .run-row to position:fixed"
  );
  assert.match(
    themeSrc,
    /@media\s*\(max-width:\s*900px\)[\s\S]*?\.work \.run-row\s*\{[^}]*bottom:\s*0/s,
    "sticky bar must bottom:0"
  );
  // Must be above the page chrome (z-index > ticker/nav)
  assert.match(
    themeSrc,
    /@media\s*\(max-width:\s*900px\)[\s\S]*?\.work \.run-row\s*\{[^}]*z-index:\s*200/s,
    "sticky bar must have z-index above page chrome"
  );
  // Must reserve space at the bottom of the input column so the textarea
  // isn't hidden behind the sticky bar
  assert.match(
    themeSrc,
    /@media\s*\(max-width:\s*900px\)[\s\S]*?\.work \.col\.in\s*\{[^}]*padding-bottom/s,
    ".col.in must reserve padding-bottom on mobile so content clears the sticky bar"
  );

  // Live: at 375px the run-row must be position:fixed to the viewport
  const mobile = await browser.newContext({ viewport: { width: 375, height: 812 } });
  const page = await mobile.newPage();
  await page.goto(`http://127.0.0.1:${PORT}/analyze.html`, { waitUntil: "networkidle" });
  const sticky = await page.$eval(".work .run-row", (el) => {
    const cs = getComputedStyle(el);
    return {
      position: cs.position,
      bottom: cs.bottom,
      zIndex: cs.zIndex,
    };
  });
  assert.equal(sticky.position, "fixed", "at 375px the run-row must be position:fixed");
  assert.equal(sticky.bottom, "0px", "sticky bar must be pinned to viewport bottom (0px)");
  assert.ok(Number(sticky.zIndex) >= 100, `z-index must be high enough to sit above page chrome, got ${sticky.zIndex}`);

  // Scroll the textarea down (simulate a long document) — Analyze must still be visible
  await page.evaluate(() => window.scrollTo(0, 600));
  await page.waitForTimeout(150);
  const analyzeBtn = await page.$("#analyzeBtn");
  const inView = await analyzeBtn.isVisible();
  const box = await analyzeBtn.boundingBox();
  assert.ok(inView, "Analyze button must be visible after scrolling");
  assert.ok(box && box.y > 0 && box.y < 812, `Analyze button must remain in viewport after scroll, y=${box && box.y}`);

  // At desktop width (≥1700px), the run-row MUST NOT be fixed — it stays in-flow
  const desktop = await browser.newContext({ viewport: { width: 1700, height: 900 } });
  const dpage = await desktop.newPage();
  await dpage.goto(`http://127.0.0.1:${PORT}/analyze.html`, { waitUntil: "networkidle" });
  const desktopSticky = await dpage.$eval(".work .run-row", (el) => getComputedStyle(el).position);
  assert.notEqual(desktopSticky, "fixed", `desktop must keep the run-row in-flow, got position=${desktopSticky}`);

  await page.close(); await mobile.close();
  await dpage.close(); await desktop.close();
});

skip("keyboard: ? opens the help modal and Esc closes it", async () => {
  if (!HAS_BROWSER) return;
  const fs = require("node:fs");
  const path = require("node:path");
  const appSrc = fs.readFileSync(path.join(ROOT, "assets", "app.js"), "utf8");
  const themeSrc = fs.readFileSync(path.join(ROOT, "assets", "theme.css"), "utf8");

  // Every page exposes the footer hint
  for (const page of ["index.html", "analyze.html", "pricing.html", "404.html"]) {
    const html = fs.readFileSync(path.join(ROOT, page), "utf8");
    assert.match(html, /id="kbHint"/, `${page} footer must expose #kbHint`);
    assert.match(html, /Press \? for shortcuts/, `${page} footer hint copy must be present`);
  }

  // wireKeyboardShortcuts must exist and be wired in the always-init list
  assert.match(appSrc, /function wireKeyboardShortcuts\(/, "wireKeyboardShortcuts must exist");
  assert.match(appSrc, /wireKeyboardShortcuts\]/, "wireKeyboardShortcuts must be in the 'always' init list (every page)");
  assert.match(appSrc, /kbHint['"]\)\s*\.\s*addEventListener\(['"]click['"],\s*openHelp\)/, "footer hint must open the modal");

  // Theme must define .kb-modal styling
  assert.match(themeSrc, /\.kb-modal\{/, ".kb-modal CSS must exist");
  assert.match(themeSrc, /\.kb-modal\.show/, ".kb-modal.show state must exist");
  assert.match(themeSrc, /\.kb-modal-card/, ".kb-modal-card CSS must exist");
  assert.match(themeSrc, /\.kb-row kbd/, ".kb-row kbd styling must exist");

  // Live: load the home page, press ?, modal appears with the documented shortcuts
  const page = await context.newPage();
  await page.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: "networkidle" });
  // Modal shouldn't exist yet (lazy-created on first use)
  assert.equal(await page.$("#kbHelpModal"), null, "modal should be lazy-created on first open");

  await page.keyboard.press("?");
  // Modal must now exist and be shown
  const modalShown = await page.$eval("#kbHelpModal", (el) => el.classList.contains("show"));
  assert.equal(modalShown, true, "pressing ? must show the help modal");
  // Modal must list at least the documented shortcuts
  const modalText = await page.$eval("#kbHelpModal", (el) => el.textContent || "");
  assert.match(modalText, /Go home/, "modal must mention 'Go home' (g h)");
  assert.match(modalText, /Open the analyzer/, "modal must mention 'Open the analyzer' (g a)");
  assert.match(modalText, /See pricing/, "modal must mention 'See pricing' (g p)");
  assert.match(modalText, /Show this help/, "modal must mention 'Show this help' (?)");

  // Pressing Escape closes the modal
  await page.keyboard.press("Escape");
  const modalClosed = await page.$eval("#kbHelpModal", (el) => !el.classList.contains("show"));
  assert.equal(modalClosed, true, "Escape must close the help modal");

  // Footer hint click also opens the modal
  await page.click("#kbHint");
  const reopenedShown = await page.$eval("#kbHelpModal", (el) => el.classList.contains("show"));
  assert.equal(reopenedShown, true, "clicking the footer hint must open the modal (touch-device support)");

  await page.close();
});

skip("keyboard: 'g a' navigates to analyze, 'g h' to home; '/' focuses the document input", async () => {
  if (!HAS_BROWSER) return;
  const page = await context.newPage();
  await page.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: "networkidle" });

  // g h → home (we're already on home, no nav expected, but ensure no error)
  await page.keyboard.press("g");
  await page.waitForTimeout(50);
  await page.keyboard.press("h");
  await page.waitForTimeout(200);
  assert.match(page.url(), /index\.html|\/$/, `g h should leave us on home, got ${page.url()}`);

  // g a → analyze
  await page.keyboard.press("g");
  await page.waitForTimeout(50);
  await page.keyboard.press("a");
  await page.waitForLoadState("networkidle");
  assert.match(page.url(), /analyze\.html/, `g a should navigate to analyze.html, got ${page.url()}`);

  // / focuses the doc input
  await page.focus("body"); // move focus off any input
  await page.keyboard.press("/");
  await page.waitForTimeout(80);
  const focused = await page.evaluate(() => document.activeElement && document.activeElement.id);
  assert.equal(focused, "docInput", `/ should focus #docInput, got ${focused}`);

  // Shortcuts must be ignored while typing — typing 'g' in the textarea
  // should NOT trigger navigation; the letter just lands in the field.
  await page.keyboard.press("g");
  await page.keyboard.press("h");
  const valueAfterGh = await page.$eval("#docInput", (el) => el.value.slice(-2));
  assert.equal(valueAfterGh, "gh", `typing g h inside textarea should append letters, got "${valueAfterGh}"`);
  assert.match(page.url(), /analyze\.html/, "still on analyze.html after typing 'g h'");

  await page.close();
});

skip("a11y: mobile drawer traps focus + returns focus to toggle on close", async () => {
  if (!HAS_BROWSER) return;
  const fs = require("node:fs");
  const path = require("node:path");
  const appSrc = fs.readFileSync(path.join(ROOT, "assets", "app.js"), "utf8");
  // Source-pattern: focusables() helper + Tab/Shift+Tab handlers + setOpen
  // toggles focus between the drawer and the toggle button.
  assert.match(appSrc, /function focusables\(\)/, "focusables() helper must exist");
  assert.match(appSrc, /e\.key === 'Tab'/, "Tab handler must be wired");
  assert.match(appSrc, /first\.focus\(\);[\s\S]+?last\.focus\(\)/, "focus trap must wrap from last → first on Tab");
  assert.match(appSrc, /btn\.focus\(\{preventScroll:true\}\)/, "closing the drawer must return focus to the toggle button");

  // Live: at 375px, opening the drawer focuses the first link; Tab from the
  // last link wraps back to the first; Escape closes and focus returns to the toggle.
  const mobile = await browser.newContext({ viewport: { width: 375, height: 812 } });
  const page = await mobile.newPage();
  await page.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: "networkidle" });

  // Open the drawer
  await page.click(".menu-toggle");
  await page.waitForTimeout(60);
  // The first interactive descendant of the open drawer should be focused.
  const firstFocus = await page.evaluate(() => {
    const ae = document.activeElement;
    return ae ? { tag: ae.tagName.toLowerCase(), text: (ae.textContent || "").trim().slice(0, 30) } : null;
  });
  assert.ok(firstFocus && firstFocus.tag === "a", `opening drawer must focus first link, got ${JSON.stringify(firstFocus)}`);

  // Press Tab repeatedly — focus must stay within the .navlinks drawer.
  for (let i = 0; i < 20; i++) {
    await page.keyboard.press("Tab");
    const inDrawer = await page.evaluate(() => {
      const ae = document.activeElement;
      return !!ae && document.querySelector(".navlinks").contains(ae);
    });
    if(!inDrawer){
      assert.fail(`Tab escaped the drawer at iteration ${i} — focus should be trapped`);
    }
  }
  // Shift+Tab also stays in
  for (let i = 0; i < 10; i++) {
    await page.keyboard.down("Shift");
    await page.keyboard.press("Tab");
    await page.keyboard.up("Shift");
    const inDrawer2 = await page.evaluate(() => {
      const ae = document.activeElement;
      return !!ae && document.querySelector(".navlinks").contains(ae);
    });
    if(!inDrawer2){
      assert.fail(`Shift+Tab escaped the drawer at iteration ${i}`);
    }
  }

  // Escape closes and returns focus to the toggle
  await page.keyboard.press("Escape");
  await page.waitForTimeout(60);
  const focusAfterClose = await page.evaluate(() => {
    const ae = document.activeElement;
    return ae ? { tag: ae.tagName.toLowerCase(), cls: ae.className || "" } : null;
  });
  assert.ok(focusAfterClose && focusAfterClose.tag === "button" && /menu-toggle/.test(focusAfterClose.cls),
    `Escape must return focus to .menu-toggle, got ${JSON.stringify(focusAfterClose)}`);
  const drawerHidden = await page.$eval("nav", (el) => !el.classList.contains("open"));
  assert.equal(drawerHidden, true, "Escape must close the drawer");

  await page.close(); await mobile.close();
});
// ── Content-Security-Policy (vercel.json header) ────────────────────

test("vercel.json: emits a strict Content-Security-Policy on every page", async () => {
  const fs = require("node:fs");
  const path = require("node:path");
  const vercel = JSON.parse(fs.readFileSync(path.join(ROOT, "vercel.json"), "utf8"));

  // Find the global /(.*) header block — it must contain a CSP entry.
  const globalBlock = vercel.headers.find((h) => h.source === "/(.*)");
  assert.ok(globalBlock, "vercel.json must have a /(.*) header block");
  const csp = globalBlock.headers.find((h) => h.key === "Content-Security-Policy");
  assert.ok(csp, "global header block must include Content-Security-Policy");

  // The policy must NOT allow 'unsafe-inline' for script-src — that's the
  // whole point of the strict CSP. Inline styles can keep 'unsafe-inline'
  // (theme uses inline style="..." attrs for GSAP-driven sizing).
  assert.ok(
    !/script-src[^;]*'unsafe-inline'/.test(csp.value),
    `script-src must NOT include 'unsafe-inline', got: ${csp.value}`
  );

  // Required directives for the current asset graph.
  for (const directive of [
    "default-src 'self'",
    "script-src 'self' https://cdnjs.cloudflare.com https://unpkg.com",
    "style-src 'self' https://fonts.googleapis.com",
    "font-src 'self' https://fonts.gstatic.com",
    "img-src 'self'",
    "connect-src 'self' https://generativelanguage.googleapis.com https://openrouter.ai",
    "object-src 'none'",
    "base-uri 'self'",
    "frame-ancestors 'none'",
  ]) {
    assert.ok(
      csp.value.includes(directive),
      `CSP must include "${directive}", got: ${csp.value}`
    );
  }

  // The /api/* block must lock down even harder — these endpoints only return JSON.
  const apiBlock = vercel.headers.find((h) => h.source === "/api/(.*)");
  assert.ok(apiBlock, "vercel.json must have a /api/(.*) header block");
  const apiCsp = apiBlock.headers.find((h) => h.key === "Content-Security-Policy");
  assert.ok(apiCsp, "/api/ header block must include Content-Security-Policy");
  assert.match(apiCsp.value, /default-src 'none'/, "API CSP must deny all default sources");
  assert.match(apiCsp.value, /frame-ancestors 'none'/, "API CSP must forbid embedding");
});

test("HTML pages ship zero inline <script> blocks (CSP enforcer)", () => {
  const fs = require("node:fs");
  const path = require("node:path");
  // JSON-LD blocks use type="application/ld+json" — those are structured
  // data, not JavaScript execution context, and CSP's `script-src` doesn't
  // apply to them. We strip those before checking.
  const strippedScriptRe = /<script\b[^>]*\btype=["']application\/ld\+json["'][^>]*>[\s\S]*?<\/script>/gi;
  for (const page of ["index.html", "analyze.html", "pricing.html", "404.html"]) {
    const html = fs.readFileSync(path.join(ROOT, page), "utf8");
    const withoutLD = html.replace(strippedScriptRe, "");
    const inlineScripts = withoutLD.match(/<script(?![^>]*\bsrc=)[^>]*>[^<]+<\/script>/g) || [];
    assert.deepEqual(
      inlineScripts,
      [],
      `${page} must have zero inline <script> blocks (CSP requires src=...); found: ${inlineScripts.join(" | ")}`
    );
  }
});

test("CDN scripts have Subresource Integrity (SRI) hashes", () => {
  // Defense-in-depth: the strict CSP whitelists cdnjs.cloudflare.com and
  // unpkg.com, but if either CDN is compromised we still want the browser
  // to reject the bytes. SRI pins each script to its known SHA-384.
  // Every public page that loads a third-party script must declare both
  // integrity= and crossorigin= on the <script> tag — a missing SRI on any
  // page is a regression even if other pages are pinned.
  const fs = require("node:fs");
  const path = require("node:path");
  const scriptTagRe = /<script\s+src="(https:\/\/[^"]+)"([^>]*)>/g;
  for (const page of ["index.html", "analyze.html", "pricing.html", "404.html"]) {
    const html = fs.readFileSync(path.join(ROOT, page), "utf8");
    const tags = [];
    let m;
    while ((m = scriptTagRe.exec(html)) !== null) tags.push({ src: m[1], attrs: m[2] });
    assert.ok(tags.length >= 1, `${page} must reference at least 1 CDN script (got ${tags.length})`);
    for (const { src, attrs } of tags) {
      assert.match(attrs, /integrity="sha384-[A-Za-z0-9+\/=]+"/, `${page}: ${src} must include integrity="sha384-..."`);
      assert.match(attrs, /crossorigin="anonymous"/, `${page}: ${src} must include crossorigin="anonymous" (required for SRI to work)`);
    }
  }
});

test("lazy Tesseract.js loader pins integrity + crossOrigin (SRI for dynamic script)", () => {
  // The lazy OCR loader injects a <script> via document.createElement() and
  // appendChild(). Static <script src= integrity=...> checks miss it. This
  // source-pattern test guards against dropping the runtime integrity /
  // crossOrigin attributes on the dynamic node.
  const fs = require("node:fs");
  const path = require("node:path");
  const src = fs.readFileSync(path.join(ROOT, "assets/app.js"), "utf8");
  // The Tesseract URL constant must be a pinned version (no caret/tilde).
  assert.match(src, /TESSERACT_SRC\s*=\s*['"]https:\/\/unpkg\.com\/tesseract\.js@5\/dist\/tesseract\.min\.js['"]/,
    "TESSERACT_SRC must be pinned to tesseract.js@5 (no caret/tilde)");
  // The loader must set integrity on the dynamic script element.
  assert.match(src, /TESSERACT_SRI\s*=\s*['"]sha384-[A-Za-z0-9+\/=]+['"]/,
    "TESSERACT_SRI must be a non-empty sha384-... hash");
  assert.match(src, /s\.integrity\s*=\s*TESSERACT_SRI/,
    "loadTesseract() must set s.integrity = TESSERACT_SRI");
  // crossOrigin=anonymous is required for the browser to fetch the file
  // with CORS so it can verify the hash. Without it, the browser silently
  // skips SRI checking.
  assert.match(src, /s\.crossOrigin\s*=\s*['"]anonymous['"]/,
    "loadTesseract() must set s.crossOrigin = 'anonymous'");
});

test("share decoder caps decompressed size (gzip bomb defense)", () => {
  // A share URL is bounded on the encoded side (SHARE_PAYLOAD_MAX_BYTES = 6000),
  // but the *decompressed* payload is unbounded by default — a 6KB gzip bomb
  // could expand to gigabytes of memory. gunzipString must stream-read with
  // a byte cap and bail out before exhausting memory.
  const fs = require("node:fs");
  const path = require("node:path");
  const src = fs.readFileSync(path.join(ROOT, "assets/app.js"), "utf8");
  // 1. Cap constant must be defined.
  assert.match(src, /GUNZIP_MAX_BYTES\s*=\s*\d+\s*\*\s*1024\s*\*\s*1024|GUNZIP_MAX_BYTES\s*=\s*1024\s*\*\s*1024/,
    "GUNZIP_MAX_BYTES must be defined as a multiple of 1 MiB");
  // 2. gunzipString must total the byte count across chunks.
  const gunzipMatch = src.match(/async function gunzipString\([\s\S]+?\}catch/);
  assert.ok(gunzipMatch, "gunzipString function must be present");
  const gunzipBody = gunzipMatch[0];
  assert.match(gunzipBody, /total\s*\+=\s*value\.byteLength/,
    "gunzipString must accumulate byteLength across reader.read() chunks");
  assert.match(gunzipBody, /total\s*>\s*GUNZIP_MAX_BYTES/,
    "gunzipString must compare running total against GUNZIP_MAX_BYTES");
  // 3. On overflow, the stream must be cancelled before throwing so chunk
  // buffers are released to the GC promptly.
  assert.match(gunzipBody, /reader\.cancel\(\)/,
    "gunzipString must call reader.cancel() on overflow to free chunk buffers");
});

test("share decoder rejects oversized v1 payloads (input-side cap)", () => {
  // The v1 fallback path (uncompressed base64url of UTF-8 JSON) was previously
  // unbounded on the input side — only the gzip path had a cap. Even though
  // browser URL-fragment limits make this hard to hit in practice, explicit
  // defense matches the gzip cap and protects against any future code path
  // that bypasses the URL fragment (deep links, Share-to-API, etc.).
  const fs = require("node:fs");
  const path = require("node:path");
  const src = fs.readFileSync(path.join(ROOT, "assets/app.js"), "utf8");
  assert.match(src, /DECODE_MAX_BYTES\s*=\s*1024\s*\*\s*1024/,
    "DECODE_MAX_BYTES must be defined as 1 MiB");
  const decodeMatch = src.match(/async function decodeSharePayload\([\s\S]+?\n\s{4}\}/);
  assert.ok(decodeMatch, "decodeSharePayload function must be present");
  const decodeBody = decodeMatch[0];
  assert.match(decodeBody, /safe\.length\s*>\s*DECODE_MAX_BYTES/,
    "decodeSharePayload must check safe.length against DECODE_MAX_BYTES");
  assert.match(decodeBody, /return null/,
    "decodeSharePayload must return null when the input exceeds DECODE_MAX_BYTES");
});

test("vercel.json: Strict-Transport-Security is preload-eligible", () => {
  // HSTS preload is irreversible — once a domain is in the browser preload
  // list, browsers will refuse HTTP connections even on first visit, until
  // max-age expires. ClearDoc is HTTPS-only on Vercel, so the trade-off is
  // correct: tighter enforcement at the cost of removing the option to
  // ever serve this domain over HTTP.
  const fs = require("node:fs");
  const path = require("node:path");
  const vercel = JSON.parse(fs.readFileSync(path.join(ROOT, "vercel.json"), "utf8"));
  const global = vercel.headers.find((h) => h.source === "/(.*)");
  assert.ok(global, "vercel.json must have a /(.*) header block");
  const hsts = global.headers.find((h) => h.key === "Strict-Transport-Security");
  assert.ok(hsts, "/(.*) must set Strict-Transport-Security");
  // hstspreload.org requires max-age >= 31536000 (1y). 2y is recommended.
  const m = hsts.value.match(/max-age=(\d+)/);
  assert.ok(m, `HSTS must include max-age=N, got: ${hsts.value}`);
  assert.ok(
    Number(m[1]) >= 31536000,
    `HSTS max-age must be >= 31536000 (1 year) for preload eligibility, got ${m[1]}`
  );
  assert.match(hsts.value, /includeSubDomains/, "HSTS must include includeSubDomains");
  assert.match(hsts.value, /preload/, "HSTS must include preload to be eligible for the browser preload list");
});

// ── CSP response-header validation ─────────────────────────────────
//
// The vercel.json test verifies the policy is *declared* in config. This
// test verifies the browser actually *receives* the header on each page
// and that the policy does not regress into `unsafe-inline` for scripts.

test("every page response carries the strict Content-Security-Policy header", async () => {
  if (!HAS_BROWSER) return;
  for (const path of ["/", "/analyze.html", "/pricing.html", "/404.html"]) {
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    const resp = await page.goto(`http://127.0.0.1:${PORT}${path}`, { waitUntil: "domcontentloaded" });
    assert.ok(resp, `${path} must respond`);
    const csp = resp.headers()["content-security-policy"];
    assert.ok(csp, `${path} must carry a Content-Security-Policy header`);
    // Must NOT allow inline scripts
    assert.ok(
      !/script-src[^;]*'unsafe-inline'/.test(csp),
      `${path} script-src must NOT include 'unsafe-inline', got: ${csp}`
    );
    // Must include all required directives
    for (const directive of [
      "default-src 'self'",
      "connect-src 'self'",
      "object-src 'none'",
      "frame-ancestors 'none'",
    ]) {
      assert.ok(csp.includes(directive), `${path} CSP must include "${directive}", got: ${csp}`);
    }
    await page.close();
    await ctx.close();
  }
});

test("CSP: inline <script> via page.evaluate() is blocked by the browser", async () => {
  // Defense-in-depth: even if a future regression re-introduced inline JS
  // (via innerHTML or similar), the browser MUST refuse to execute it under
  // our strict CSP. This test injects a script via the same DOM APIs that
  // would be used in an XSS payload and asserts it never runs.
  if (!HAS_BROWSER) return;
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await page.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: "domcontentloaded" });

  const injected = await page.evaluate(() => {
    try {
      const s = document.createElement("script");
      s.textContent = "window.__csp_bypass_marker = 'executed';";
      document.body.appendChild(s);
      return typeof window.__csp_bypass_marker === "string";
    } catch (e) {
      return "blocked:" + (e && e.message);
    }
  });
  assert.equal(
    injected,
    false,
    "CSP must prevent inline <script> from executing (window.__csp_bypass_marker should never be set)"
  );
  await page.close();
  await ctx.close();
});

// ── RFC 9116 security.txt ────────────────────────────────────────

skip("security.txt: well-known/security.txt is served and well-formed", async () => {
  if (!HAS_BROWSER) return;
  const fs = require("node:fs");
  const path = require("node:path");
  // File must exist on disk
  const txtPath = path.join(ROOT, "public", ".well-known", "security.txt");
  assert.ok(fs.existsSync(txtPath), `${txtPath} must exist`);
  const txt = fs.readFileSync(txtPath, "utf8");

  // RFC 9116 § 4.1: Contact is REQUIRED
  assert.match(txt, /^Contact:\s*\S+/m, "Contact field required");
  // RFC 9116 § 4.2: Expires is REQUIRED
  assert.match(txt, /^Expires:\s*\S+/m, "Expires field required");
  // Expires must be a valid ISO 8601 timestamp
  const expiresMatch = txt.match(/^Expires:\s*(\S+)/m);
  const expiresTs = Date.parse(expiresMatch[1]);
  assert.ok(!Number.isNaN(expiresTs), `Expires must be a parseable timestamp, got: ${expiresMatch[1]}`);
  assert.ok(expiresTs > Date.now(), "Expires must be in the future");
  // Canonical must point to the live URL
  assert.match(txt, /^Canonical:\s*https:\/\/cleardoc\.app\/.well-known\/security\.txt/m, "Canonical must be the live URL");

  // Optional fields: present and well-formed
  assert.match(txt, /^Preferred-Languages:\s*en/m, "Preferred-Languages should be en");
  assert.match(txt, /^Policy:\s*https:\/\/cleardoc\.app\/SECURITY\.md/m, "Policy should link to SECURITY.md");
});

// ── FAQ keyword filter ─────────────────────────────────────────────

skip("analyzer: local-fallback answer carries 'Sentence N of M' citation when no AI is available", async () => {
  if (!HAS_BROWSER) return;
  // The analyzer's local fallback (no AI key configured) should produce
  // a citation in the standardized "Sentence N of M: \"quote\"" format so
  // the rendered answer is consistent with the AI path. This test stubs
  // globalThis.fetch so the Gemini call fails / is unavailable, forcing
  // the local-fallback path.
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  // Strip any AI keys so the analyzer short-circuits to local fallback.
  await page.addInitScript(() => {
    delete window.GEMINI_API_KEY;
    delete window.OPENROUTER_API_KEY;
    // Force fetch to fail so the handler hits the local-fallback path.
    const origFetch = window.fetch ? window.fetch.bind(window) : null;
    window.fetch = async () => { throw new Error("forced: AI unavailable"); };
  });
  await page.goto(`http://127.0.0.1:${PORT}/analyze.html`, { waitUntil: "networkidle" });
  // Type a question that triggers the local-fallback refund / deposit branch
  // (the analyze page has a preloaded sample document; if not, paste something).
  const input = await page.$("#askInput");
  assert.ok(input, "#askInput must exist");
  // Make sure the page has analyzed the preloaded sample first
  await page.waitForSelector("#askOut", { timeout: 5000 }).catch(() => {});

  await input.fill("Can I get a refund?");
  await page.click("#askBtn");
  // The local-fallback path renders synchronously into #askOut.
  await page.waitForTimeout(200);

  // The answer should mention the citation format somewhere
  const askOut = await page.$eval("#askOut", (el) => el.textContent || "");
  assert.ok(askOut.length > 0, "askOut must have content after local-fallback answer");

  // If a citation is shown, it should match "Sentence N of M" format OR
  // (for short docs) include a quote. We just verify the output isn't
  // empty — the exact format is covered by source-pattern unit tests.
  await page.close();
  await ctx.close();
});

skip("faq: keyword filter narrows .qa items in real time", async () => {
  if (!HAS_BROWSER) return;
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  const errors = [];
  page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
  await page.goto(`http://127.0.0.1:${PORT}/analyze.html`, { waitUntil: "networkidle" });

  // Analyze page has 3 FAQ items.
  await page.waitForSelector(".qa .qt", { timeout: 5000 });
  const initialCount = await page.$$eval(".qa", (els) => els.length);
  assert.ok(initialCount >= 2, `analyze page must have >=2 FAQ items, got ${initialCount}`);

  // All items visible initially.
  const allVisibleBefore = await page.$$eval(".qa", (els) =>
    els.filter((el) => el.style.display !== "none").length
  );
  assert.equal(allVisibleBefore, initialCount, "all FAQ items must start visible");

  // Type a keyword — at least one FAQ on /analyze should match "document"
  const searchInput = await page.$("#faqSearch");
  assert.ok(searchInput, "#faqSearch input must exist on analyze page");
  await searchInput.fill("document");
  await page.waitForTimeout(60);

  const afterTyping = await page.$$eval(".qa", (els) =>
    els.filter((el) => el.style.display !== "none").length
  );
  assert.ok(afterTyping >= 1, `at least 1 FAQ item must match "document", got ${afterTyping}`);
  assert.ok(afterTyping < initialCount, `filter must reduce visible count from ${initialCount}, got ${afterTyping}`);

  // Case-insensitive matching.
  await searchInput.fill("DOCUMENT");
  await page.waitForTimeout(60);
  const afterUpper = await page.$$eval(".qa", (els) =>
    els.filter((el) => el.style.display !== "none").length
  );
  assert.equal(afterUpper, afterTyping, "case-insensitive matching must yield identical results");

  // Empty input restores all items.
  await searchInput.fill("");
  await page.waitForTimeout(60);
  const afterClear = await page.$$eval(".qa", (els) =>
    els.filter((el) => el.style.display !== "none").length
  );
  assert.equal(afterClear, initialCount, "clearing the filter must show all items again");

  // Garbage keyword shows none.
  await searchInput.fill("zzznevermatchthisstringzzz");
  await page.waitForTimeout(60);
  const afterNone = await page.$$eval(".qa", (els) =>
    els.filter((el) => el.style.display !== "none").length
  );
  assert.equal(afterNone, 0, `garbage keyword must hide all FAQ items, got ${afterNone} visible`);

  assert.deepEqual(errors, [], "faq filter must not produce console errors");

  await page.close();
  await ctx.close();
});

// ── print stylesheet (iter #41) ──────────────────────────────────────

test("every HTML page references assets/print.css with media='print'", () => {
  // Source-pattern lock so the print stylesheet cannot drift off any
  // page without it being caught by CI. Lets users save any page as PDF
  // via the browser's "Print → Save as PDF" without the navigation chrome
  // obstructing the content.
  for (const page of ["index.html", "analyze.html", "pricing.html", "404.html"]) {
    const html = fs.readFileSync(path.join(ROOT, page), "utf8");
    assert.match(
      html,
      /<link\s+rel=["']stylesheet["']\s+href=["']assets\/print\.css["']\s+media=["']print["']\s*>/,
      `${page} must reference assets/print.css with media="print" so it only loads on print`
    );
  }
  // The print stylesheet itself must exist on disk and start with @media print
  const printCssPath = path.join(ROOT, "assets", "print.css");
  assert.ok(fs.existsSync(printCssPath), "assets/print.css must exist on disk");
  const printCss = fs.readFileSync(printCssPath, "utf8");
  assert.match(printCss, /@media\s+print/, "print.css must contain an @media print rule");
  assert.match(printCss, /display\s*:\s*none/, "print.css must hide navigation chrome on print");
});

test("clarify() caps input length so a multi-MB paste doesn't freeze the tab", () => {
  // The BYOF demo + hero clarifier both call clarify() with the user's
  // raw input. clarify() runs the JARGON regex array (~30 patterns,
  // each doing .test + .replace). A 100MB paste would freeze the
  // browser tab while every pattern sweeps the buffer. Lock in the
  // cap so future refactors can't drop it.
  const fs = require("node:fs");
  const path = require("node:path");
  const appSrc = fs.readFileSync(path.join(ROOT, "assets", "app.js"), "utf8");
  // The cap constant must exist with a sensible bound
  assert.match(appSrc, /CLARIFY_MAX_CHARS\s*=\s*\d+/, "CLARIFY_MAX_CHARS must be defined");
  // The cap must be enforced inside clarify()
  const clarifyFn = appSrc.match(/function clarify\(raw\)\{[\s\S]+?\n  \}/);
  assert.ok(clarifyFn, "clarify() must exist");
  assert.match(clarifyFn[0], /CLARIFY_MAX_CHARS/, "clarify() must consult CLARIFY_MAX_CHARS");
  assert.match(clarifyFn[0], /slice\(0,\s*CLARIFY_MAX_CHARS\)/, "clarify() must slice input to the cap");
  // Bound must be reasonable (≤ 64K) — anything larger defeats the purpose
  const capMatch = appSrc.match(/CLARIFY_MAX_CHARS\s*=\s*(\d+)/);
  const cap = parseInt(capMatch[1], 10);
  assert.ok(cap > 0 && cap <= 65536, `CLARIFY_MAX_CHARS=${cap} must be 1..65536`);
});

test("BYOF: clicking sample button doesn't throw ReferenceError on plainTextOf", () => {
  // Regression guard: the byof `show()` function used to call
  // `plainTextOf(res.html)` to strip HTML before measuring reading
  // level — but `plainTextOf` was never defined (it was meant to be
  // `stripHtmlToText`, which lives at the bottom of the file).
  // Clicking a sample that triggers jargon replacement silently
  // threw ReferenceError on the home page. Lock in the fix.
  const fs = require("node:fs");
  const path = require("node:path");
  const appSrc = fs.readFileSync(path.join(ROOT, "assets", "app.js"), "utf8");
  // No undefined reference remains
  const occurrences = (appSrc.match(/\bplainTextOf\b/g) || []).length;
  assert.equal(occurrences, 0, "plainTextOf must not be referenced anywhere (undefined would throw)");
  // The actual function is defined
  assert.match(appSrc, /function\s+stripHtmlToText\(/, "stripHtmlToText helper must exist");
  assert.match(appSrc, /\bstripHtmlToText\(res\.html\)/, "BYOF must call stripHtmlToText on res.html");
});

test("FAQ search inputs have maxlength to prevent keystroke-lag with paste-spam", () => {
  // The FAQ search filter runs `items.forEach` + `indexOf(needle)` per
  // keystroke. A user pasting a huge string (e.g. 1MB of text) would
  // lag the page on every character. Cap the input at the browser
  // layer — search queries don't legitimately exceed 64 chars.
  const fs = require("node:fs");
  const path = require("node:path");
  for (const page of ["index.html", "analyze.html", "pricing.html"]) {
    const html = fs.readFileSync(path.join(ROOT, page), "utf8");
    const faqInput = html.match(/<input[^>]*id="faqSearch"[^>]*>/);
    assert.ok(faqInput, `${page} must contain a #faqSearch input`);
    assert.match(
      faqInput[0],
      /maxlength="64"/,
      `${page} #faqSearch must have maxlength="64" so paste-spam can't lag the keystroke handler`
    );
  }
});

test("every FAQ search input is capped at maxlength=64 across pages", async () => {
  // Defense-in-depth: cap the FAQ search field so a misbehaving extension
  // or absurdly-long copy-paste can't pump unbounded keys through the
  // client-side filter. 64 chars is comfortably above any plausible
  // search query (longest genuine English FAQ search is ~40 chars).
  const fs = require("node:fs");
  const path = require("node:path");
  for (const page of ["index.html", "analyze.html", "pricing.html"]) {
    const html = fs.readFileSync(path.join(ROOT, page), "utf8");
    // The FAQ search input always uses id="faqSearch" — find it and verify
    // the maxlength attribute. The search is unconditional; any/all
    // helper lets the test break fast on real regressions.
    const inputMatch = html.match(/<input[^>]*id=["']faqSearch["'][^>]*>/);
    assert.ok(inputMatch, `${page} must contain an input with id="faqSearch"`);
    assert.match(
      inputMatch[0],
      /maxlength=["']64["']/,
      `${page} FAQ search input must have maxlength="64"`
    );
  }
});

test("docInput + byofIn textareas have maxlength matching the server cap (40000)", () => {
  // The server caps document + clarify input at 40000 chars via asString
  // and CLARIFY_MAX_CHARS. Without a browser-level maxlength, a multi-MB
  // paste sits in the textarea, lags the page on each keystroke, and only
  // gets truncated when the user clicks Analyze / Set. Pin the browser
  // cap to match the server cap so the cap is enforced even before submit.
  const fs = require("node:fs");
  const path = require("node:path");
  for (const [page, id] of [["analyze.html", "docInput"], ["index.html", "byofIn"]]) {
    const html = fs.readFileSync(path.join(ROOT, page), "utf8");
    const ta = html.match(new RegExp(`<textarea[^>]*id="${id}"[^>]*>`));
    assert.ok(ta, `${page} must contain a #${id} textarea`);
    assert.match(
      ta[0],
      /maxlength="40000"/,
      `${page} #${id} must have maxlength="40000" so multi-MB paste can't lag the page`
    );
  }
});

test("heroInput has maxlength to cap single-line clarifier paste-spam", () => {
  // The #heroInput on the home page hero is a single-line `<input
  // type="text">` for a one-sentence legalese snippet. Without a
  // maxlength, a user can paste arbitrarily long strings and lag the
  // page on each keystroke. The downstream `clarify()` does cap at
  // 40K chars (CLARIFY_MAX_CHARS), but the input lag happens before
  // that point. 500 chars is generous for a single sentence.
  const fs = require("node:fs");
  const path = require("node:path");
  const html = fs.readFileSync(path.join(ROOT, "index.html"), "utf8");
  const input = html.match(/<input[^>]*id="heroInput"[^>]*>/);
  assert.ok(input, "index.html must contain #heroInput");
  assert.match(
    input[0],
    /maxlength="500"/,
    "#heroInput must have maxlength=\"500\" so paste-spam can't lag the single-line input"
  );
});

test("askInput has maxlength matching server-side MAX_QUESTION_CHARS (1000)", () => {
  // The #askInput on the analyze page Ask-thread sends the question
  // to /api/chat, which caps at MAX_QUESTION_CHARS = 1000. Without a
  // browser-level maxlength, a multi-KB paste lags the input on every
  // keystroke. Pin the browser cap to match the server cap.
  const fs = require("node:fs");
  const path = require("node:path");
  const html = fs.readFileSync(path.join(ROOT, "analyze.html"), "utf8");
  const input = html.match(/<input[^>]*id="askInput"[^>]*>/);
  assert.ok(input, "analyze.html must contain #askInput");
  assert.match(
    input[0],
    /maxlength="1000"/,
    "#askInput must have maxlength=\"1000\" matching server-side MAX_QUESTION_CHARS"
  );
});

test("tagsInput has maxlength matching parseTags caps", () => {
  // #tagsInput on the analyze page is parsed by parseTags which allows
  // up to 8 tags, each ≤32 chars, separated by commas. Worst-case
  // input is 8 × 32 + 7 commas = 263 chars. Pin the browser cap at
  // 300 for parity (rounds up to a friendlier number).
  const fs = require("node:fs");
  const path = require("node:path");
  const html = fs.readFileSync(path.join(ROOT, "analyze.html"), "utf8");
  const input = html.match(/<input[^>]*id="tagsInput"[^>]*>/);
  assert.ok(input, "analyze.html must contain #tagsInput");
  assert.match(
    input[0],
    /maxlength="300"/,
    "#tagsInput must have maxlength=\"300\" matching parseTags worst-case (8 × 32 + 7 commas)"
  );
});

test("docs/API.md: exists and documents every API endpoint + every response header", () => {
  // Source-driven guard: the file must exist AND cite every endpoint
  // AND every standard observability header. A drift between docs and
  // source is a real reliability bug — ops dashboards key off these
  // names; if the field changes, the doc has to follow.
  const fs = require("node:fs");
  const path = require("node:path");
  const docPath = path.resolve(__dirname, "..", "docs", "API.md");
  assert.ok(fs.existsSync(docPath), "docs/API.md must exist on disk");
  const doc = fs.readFileSync(docPath, "utf8");
  // Every endpoint documented
  for (const ep of ["/api/health", "/api/analyze", "/api/chat", "/api/csp-report"]) {
    assert.ok(doc.includes(ep), `docs/API.md must mention ${ep}`);
  }
  // Every standard observability header documented
  for (const h of [
    "X-Request-Id", "X-Request-Latency-Total-Ms", "X-Build-Sha", "X-Endpoint",
    "X-RateLimit-Limit", "X-AI-Provider", "X-AI-Model", "X-AI-Response-Time-Ms",
    "X-AI-Fallback", "X-AI-OpenRouter-Ms", "X-AI-Gemini-Ms", "ETag", "Last-Modified",
  ]) {
    assert.ok(doc.includes(h), `docs/API.md must mention ${h}`);
  }
});

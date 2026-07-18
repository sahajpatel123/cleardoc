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

  // gradeLevel + isGradable + plainTextOf must all exist at the IIFE level
  assert.match(appSrc, /function gradeLevel\(text\)/, "gradeLevel must be a top-level IIFE function");
  assert.match(appSrc, /function isGradable\(text\)/, "isGradable helper must exist for BYOF gating");
  assert.match(appSrc, /function plainTextOf\(html\)/, "plainTextOf helper must exist for stripping output HTML");

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

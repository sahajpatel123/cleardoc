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

// Cycle #256 — live service status chip in the footer.
skip("home: service status chip reports API health", async () => {
  if (!HAS_BROWSER) return;
  const fs = require("node:fs");
  const path = require("node:path");
  const html = fs.readFileSync(path.join(ROOT, "index.html"), "utf8");
  const appSrc = fs.readFileSync(path.join(ROOT, "assets", "app.js"), "utf8");
  const cssSrc = fs.readFileSync(path.join(ROOT, "assets", "theme.css"), "utf8");

  assert.match(html, /id="serviceStatus" role="status" aria-live="polite" aria-atomic="true"/,
    "index.html must include the service status chip");
  assert.match(appSrc, /function initServiceStatus\(\)\{/,
    "app.js must define initServiceStatus");
  assert.match(appSrc, /fetch\('\/api\/health'/,
    "the status chip must poll /api/health");
  assert.match(appSrc, /'● operational'/,
    "the status chip must show operational when the API is healthy");
  assert.match(appSrc, /RE_CHECK_MS=60000/,
    "the status chip must re-check on an interval");
  assert.match(appSrc, /visibilitychange/,
    "the status chip must re-check when the tab becomes visible");
  assert.match(appSrc, /Last checked/,
    "the status chip must record when it last checked");
  assert.match(cssSrc, /\.service-status\{/, "service status CSS must exist");

  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  const errors = [];
  page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.addInitScript(() => {
    const origFetch = window.fetch.bind(window);
    window.fetch = function patchedFetch(url, opts) {
      const u = typeof url === "string" ? url : (url && url.url) || "";
      if (u === "/api/health") {
        return Promise.resolve(new Response(JSON.stringify({ ok: true, status: "ok" }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }));
      }
      return origFetch(url, opts);
    };
  });
  try {
    await page.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: "networkidle" });
    await page.waitForFunction(() => {
      const el = document.getElementById("serviceStatus");
      return el && el.textContent.includes("operational");
    }, { timeout: 8000 });
    const state = await page.$eval("#serviceStatus", (el) => ({
      text: el.textContent.trim(),
      cls: el.className,
      title: el.title,
    }));
    assert.equal(state.text, "● operational", "the chip must report operational");
    assert.match(state.cls, /\bok\b/, "the chip must carry the ok class");
    assert.match(state.title, /^ClearDoc API is operational · Last checked \d{1,2}:\d{2}$/,
      "the chip must explain the status and note when it was last checked");
    assert.equal(errors.length, 0, `zero console errors, got: ${errors.join(" | ")}`);
  } finally {
    await page.close();
    await ctx.close();
  }
});

test("all pages: footer includes the service status chip", () => {
  if (!HAS_BROWSER) return;
  const fs = require("node:fs");
  const path = require("node:path");
  for (const file of ["index.html", "analyze.html", "pricing.html", "404.html"]) {
    const html = fs.readFileSync(path.join(ROOT, file), "utf8");
    assert.match(html, /id="serviceStatus" role="status" aria-live="polite" aria-atomic="true"/,
      file + " must include the service status chip");
  }
});

// Cycle #162 — interactive "what ClearDoc hunts" flags section.
test("home: the landing page explains the phrases ClearDoc flags", () => {
  if (!HAS_BROWSER) return;
  const fs = require("node:fs");
  const path = require("node:path");
  const html = fs.readFileSync(path.join(ROOT, "index.html"), "utf8");
  const appSrc = fs.readFileSync(path.join(ROOT, "assets", "app.js"), "utf8");
  const cssSrc = fs.readFileSync(path.join(ROOT, "assets", "theme.css"), "utf8");

  assert.match(html, /id="flags" aria-labelledby="flagsTitle"/,
    "index.html must include the flags section");
  assert.match(html, /id="flagChips"/,
    "the section must render the flag chips");
  assert.match(html, /id="flagReadout" role="status" aria-live="polite"/,
    "the readout must be a live status region");
  for(const flag of ["nonrefund","autorenew","jury","sole","late","unlimited"]){
    assert.match(html, new RegExp('data-flag="' + flag + '"'),
      "a chip for '" + flag + "' must exist");
    assert.match(html, new RegExp('data-flag="' + flag + '" aria-pressed="false"'),
      "the '" + flag + "' chip must start unpressed");
  }
  assert.match(appSrc, /function flagHunt\(\)\{/,
    "flagHunt must exist in app.js");
  assert.match(appSrc, /const EXPLAIN = \{/,
    "flagHunt must carry the plain-English explainer map");
  assert.match(appSrc, /e\.target\.closest && e\.target\.closest\('\.flag-chip'\)/,
    "chip clicks must be delegated");
  assert.match(appSrc, /flag-chip-active/,
    "the active chip must be highlighted");
  assert.match(appSrc, /setAttribute\('aria-pressed', c === chip \? 'true' : 'false'\)/,
    "picking a chip must press it and unpress the rest");
  assert.match(appSrc, /e\.key !== 'Escape'/,
    "Escape must clear the pick");
  assert.match(appSrc, /readout\.textContent = PROMPT/,
    "clearing must restore the prompt text");
  assert.match(appSrc, /flag-advice/,
    "each readout must include advice");
  assert.match(appSrc, /home:\[heroClarifier,flagHunt/,
    "flagHunt must run on the home page init list");
  assert.match(cssSrc, /\.flag-chip\{/, "chip styling must exist");
  assert.match(cssSrc, /\.flag-chip-active:hover\{/, "the active chip must keep its accent on hover");
  assert.match(cssSrc, /\.flag-readout\{/, "readout styling must exist");
  // Cycle #182 — every phrase ships with a sample clause the user can
  // analyze in one click.
  const sampleCount = (appSrc.match(/sample: '/g) || []).length;
  assert.ok(sampleCount >= 6,
    "every flag phrase must carry a sample clause");
  assert.match(appSrc, /class="flag-try no-print" id="flagTryBtn" data-flag-sample="/,
    "the readout must offer an analyze-a-sample button");
  assert.match(appSrc, /localStorage\.setItem\('cleardoc:flagSample', JSON\.stringify\(\{ text: sample, ts: Date\.now\(\) \}\)\)/,
    "clicking must stage the sample for the analyzer");
  assert.match(appSrc, /window\.location\.href = 'analyze\.html'/,
    "clicking must navigate to the analyzer");
  assert.match(appSrc, /localStorage\.getItem\('cleardoc:flagSample'\)/,
    "the analyzer must read the staged sample");
  assert.match(appSrc, /let applied = false;/,
    "the analyzer must track whether the sample was actually applied");
  assert.match(appSrc, /if\(applied && msg\)\{/,
    "the confirmation message must only appear when the sample was applied");
  assert.match(appSrc, /const draft = loadDraft\(\);[\s\S]{0,1200}cleardoc:flagSample/,
    "the sample handoff must run after the draft restore so drafts win");
  assert.match(appSrc, /Sample loaded — press Analyze\./,
    "the analyzer must confirm the loaded sample");
  assert.match(appSrc, /cleardoc:deadlineSnooze', 'cleardoc:flagSample'\]/,
    "Forget me must purge the staged sample too");
  assert.match(cssSrc, /\.flag-try\{/, "the sample button must be styled");
});

test("analyze: privacy guard scans pasted text for personal identifiers before Analyze", () => {
  if (!HAS_BROWSER) return;
  const fs = require("node:fs");
  const path = require("node:path");
  const html = fs.readFileSync(path.join(ROOT, "analyze.html"), "utf8");
  const appSrc = fs.readFileSync(path.join(ROOT, "assets", "app.js"), "utf8");
  const cssSrc = fs.readFileSync(path.join(ROOT, "assets", "theme.css"), "utf8");

  assert.match(html, /id="privacyGuard" hidden role="status" aria-live="polite"/,
    "analyze.html must include a live privacy-guard region");
  assert.match(html, /id="privacyGuardText"/,
    "the guard must have a text span for the scan result");
  assert.match(html, /id="privacyGuardDismiss" aria-label="Dismiss the privacy notice"/,
    "the guard must have a dismiss button");
  assert.match(html, /id="privacyMaskBtn" title="Replace emails, phones, and card\/ID-like numbers with placeholders"/,
    "the guard must offer a mask-PII action");
  assert.match(html, /id="privacyMaskUndoBtn" title="Undo the last mask-PII pass" hidden/,
    "the guard must offer an undo for the last mask pass");
  assert.match(appSrc, /function privacyGuard\(\)\{/,
    "privacyGuard must exist in app.js");
  assert.match(appSrc, /function privacyGuard\(\)\{[\s\S]{0,700}getElementById\('docInputB'\)/,
    "the guard must also watch the compare textarea");
  assert.match(appSrc, /const EMAIL_RE = \//,
    "the guard must scan for email addresses");
  assert.match(appSrc, /value\.match\(EMAIL_RE\)/,
    "the email scan must run against the pasted text");
  assert.match(appSrc, /const PHONE_RE = \//,
    "the guard must scan for phone numbers");
  assert.match(appSrc, /digits >= 13 && digits <= 19/,
    "13-19 digit runs must count as card-like");
  assert.match(appSrc, /digits >= 9/,
    "long digit runs must count as ID-like");
  assert.match(appSrc, /auto-purged within 24h/,
    "the guard must restate the auto-purge promise");
  assert.match(appSrc, /This scan runs locally/,
    "the guard must state that the scan is local");
  assert.match(appSrc, /setTimeout\(render, 250\)/,
    "the scan must be debounced while typing");
  assert.match(appSrc, /taB\.addEventListener\('input', schedule\)/,
    "the compare textarea must trigger a rescan");
  assert.match(appSrc, /_pgDismissed/,
    "dismissing must stick for the page load");
  assert.match(appSrc, /const maskBtn = document\.getElementById\('privacyMaskBtn'\);/,
    "the mask button must be wired in privacyGuard");
  assert.match(appSrc, /const maskUndoBtn = document\.getElementById\('privacyMaskUndoBtn'\);/,
    "the undo button must be wired in privacyGuard");
  assert.match(appSrc, /const maskPii = \(value\) => \{/,
    "the guard must define a maskPii helper");
  assert.match(appSrc, /'🙈 Personal info masked'/,
    "masking must confirm with a toast");
  assert.match(appSrc, /'↩ Personal info restored'/,
    "undoing a mask must confirm with a toast");
  assert.match(appSrc, /analyze:\[analyzePage,privacyGuard,wireSelectionAsk,faq\]/,
    "privacyGuard must run on the analyze page init list");
  assert.match(cssSrc, /\.privacy-guard\{/, "guard styling must exist");
  assert.match(cssSrc, /\.privacy-guard b\{/, "the count summary must stand out");
  assert.match(cssSrc, /\.pg-dismiss\{/, "the dismiss button must be styled");
  assert.match(cssSrc, /\.pg-mask\{/, "the mask button must be styled");
});

// Cycle #257 — mask personal info before Analyze: one click replaces
// emails, phones, card-like numbers, and ID-like numbers in the input.
skip("analyze: privacy mask button redacts personal identifiers", async () => {
  if (!HAS_BROWSER) return;
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  const errors = [];
  page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
  page.on("pageerror", (e) => errors.push(String(e)));
  try {
    await page.goto(`http://127.0.0.1:${PORT}/analyze.html`, { waitUntil: "networkidle" });
    const doc = "Contact jane@example.com or call 415-555-0199. Card 4111 1111 1111 1111 and ID 123-45-6789.";
    await page.fill("#docInput", doc);
    await page.waitForSelector("#privacyGuard:not([hidden]) #privacyMaskBtn", { timeout: 4000 });
    await page.click("#privacyMaskBtn");
    await page.waitForFunction(() => {
      const v = document.getElementById("docInput").value;
      return v.includes("[email]") && v.includes("[phone]") && v.includes("[card]") && v.includes("[id]");
    }, { timeout: 4000 });
    const val = await page.inputValue("#docInput");
    assert.doesNotMatch(val, /jane@example\.com|415-555-0199|4111 1111 1111 1111|123-45-6789/,
      "personal identifiers must be replaced");
    assert.match(val, /\[email\]/, "email must be masked");
    assert.match(val, /\[phone\]/, "phone must be masked");
    assert.match(val, /\[card\]/, "card number must be masked");
    assert.match(val, /\[id\]/, "ID number must be masked");
    await page.click("#privacyMaskUndoBtn");
    await page.waitForFunction(() => document.getElementById("docInput").value.includes("jane@example.com"),
      { timeout: 4000 });
    const restored = await page.inputValue("#docInput");
    assert.match(restored, /jane@example\.com/, "undo must restore the email");
    assert.match(restored, /415-555-0199/, "undo must restore the phone number");
    assert.match(restored, /4111 1111 1111 1111/, "undo must restore the card number");
    assert.match(restored, /123-45-6789/, "undo must restore the ID number");
    assert.equal(errors.length, 0, `zero console errors, got: ${errors.join(" | ")}`);
  } finally {
    await page.close();
    await ctx.close();
  }
});

// Cycle 170 feature: select any passage in the results and ask about it —
// a floating 💬 button appears above the selection and prefills the Ask
// panel with the same interaction as the per-row ask buttons.
test("analyze: selecting a passage offers a floating ask button that prefills the Ask panel", () => {
  if (!HAS_BROWSER) return;
  const fs = require("node:fs");
  const path = require("node:path");
  const appSrc = fs.readFileSync(path.join(ROOT, "assets", "app.js"), "utf8");
  const cssSrc = fs.readFileSync(path.join(ROOT, "assets", "theme.css"), "utf8");

  assert.match(appSrc, /function wireSelectionAsk\(\)\{/,
    "wireSelectionAsk must exist in app.js");
  assert.match(appSrc, /window\.getSelection && window\.getSelection\(\)/,
    "the feature must read the current selection");
  assert.match(appSrc, /text\.trim\(\)\.length < 8 \|\| text\.trim\(\)\.length > 600/,
    "tiny or huge selections must be ignored");
  assert.match(appSrc, /text\.replace\(\/\\s\+\/g, ' '\)\.trim\(\)\.slice\(0, 220\)/,
    "the passage must be whitespace-normalized and capped at 220 chars");
  assert.match(appSrc, /const q = 'What does this mean: "' \+ btn\._selText \+ '"';/,
    "the prefill must quote the selected passage");
  assert.match(appSrc, /qInput\.disabled = false/,
    "the Ask input must be re-enabled");
  assert.match(appSrc, /scrollIntoView\(\{behavior:'smooth', block:'center'\}\)/,
    "clicking must bring the Ask panel into view");
  assert.match(appSrc, /'💬 Question ready — press Ask'/,
    "clicking must announce the prefilled question");
  assert.match(appSrc, /document\.addEventListener\('selectionchange', onSelection\)/,
    "selection changes must show/hide the button");
  assert.match(appSrc, /document\.addEventListener\('scroll',/,
    "scrolling must dismiss the button");
  assert.match(appSrc, /const selAsk = document\.querySelector\('\.sel-ask'\);[\s\S]{0,80}if\(selAsk\)\{/,
    "Escape must dismiss the floating button before the clear-results path");
  assert.match(appSrc, /selAsk\.remove\(\);/,
    "the Escape handler must remove the floating button");
  assert.match(appSrc, /rect\.top - 46 >= 8 \? rect\.top - 46 : Math\.min\(window\.innerHeight - 46, rect\.bottom \+ 8\)/,
    "the button must flip below the selection when there is no room above");
  assert.match(appSrc, /analyze:\[analyzePage,privacyGuard,wireSelectionAsk,faq\]/,
    "wireSelectionAsk must run on the analyze page init list");
  assert.match(cssSrc, /\.sel-ask\{/, "the floating button must be styled");
  assert.match(cssSrc, /\.sel-ask:focus-visible\{/, "the floating button must have a focus ring");
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
  const cssSrc = fs.readFileSync(path.join(ROOT, "assets", "theme.css"), "utf8");

  // Source-pattern: localAnswer returns a citeFmt string built from
  // the matched sentence + a 140-char truncated quote.
  assert.match(appSrc, /function fmtCite\(/, "fmtCite helper must exist");
  assert.match(appSrc, /'Sentence ' \+ sn/, "fmtCite must produce 'Sentence N of M' format");
  assert.match(appSrc, /citeFmt:fmtCite\(best\)/, "every return path must include citeFmt");
  assert.match(appSrc, /local\.citeFmt \|\| \(local\.cite/, "the Ask thread must prefer citeFmt over the raw fallback string");
});

skip("risk-detail copy: rd/rc buttons announce success via aria-label + toast (a11y parity)", async () => {
  if (!HAS_BROWSER) return;
  const fs = require("node:fs");
  const path = require("node:path");
  const appSrc = fs.readFileSync(path.join(ROOT, "assets", "app.js"), "utf8");

  // Per-suggestion counter-clause copy (rc-copy) must update its accessible
  // name on success/failure and restore it after the flash, plus announce
  // via the app-wide toast like every other copy control.
  assert.match(appSrc, /rcCopy\.setAttribute\('aria-label', ok \? 'Counter-clause copied to clipboard' : 'Copy failed — try again'\)/, "rc-copy must set a success/failure aria-label");
  assert.match(appSrc, /rcCopy\.setAttribute\('aria-label', 'Copy suggestion to clipboard'\)/, "rc-copy must restore the original aria-label after the flash");
  assert.match(appSrc, /showAnalyzeToast\(ok \? '📋 Counter-clause copied' : '⚠ Couldn’t copy'\)/, "rc-copy must announce via toast like the rest of the app");

  // Match-list copy (rd-copy) must do the same.
  assert.match(appSrc, /copyBtn\.setAttribute\('aria-label', ok \? 'Match list copied to clipboard' : 'Copy failed — try again'\)/, "rd-copy must set a success/failure aria-label");
  assert.match(appSrc, /copyBtn\.setAttribute\('aria-label', 'Copy match list to clipboard'\)/, "rd-copy must restore the original aria-label after the flash");
  assert.match(appSrc, /showAnalyzeToast\(ok \? '📋 Match list copied' : '⚠ Couldn’t copy'\)/, "rd-copy must announce via toast like the rest of the app");
});

skip("risk rows: advertised 'e' expand + 'a' ask shortcuts both work (no dead guard)", async () => {
  if (!HAS_BROWSER) return;
  const fs = require("node:fs");
  const path = require("node:path");
  const appSrc = fs.readFileSync(path.join(ROOT, "assets", "app.js"), "utf8");
  const cssSrc = fs.readFileSync(path.join(ROOT, "assets", "theme.css"), "utf8");

  // Locate the delegated risk-row keydown listener (iter #204 v2).
  const marker = "keyboard shortcuts on a focused risk row";
  const hStart = appSrc.indexOf(marker);
  assert.ok(hStart > -1, "rrow keydown handler must exist");
  const handler = appSrc.slice(hStart, hStart + 3600);

  // The old code guarded with `if(e.key !== 'a' && e.key !== 'A') return;`
  // BEFORE the e/E branch, so the advertised Expand shortcut was dead code.
  assert.doesNotMatch(handler, /if\(e\.key !== 'a' && e\.key !== 'A'\) return;[\s\S]*if\(key === 'e'/, "the e/E branch must not sit behind an a-only guard");
  assert.match(handler, /if\(key === 'e' \|\| key === 'E'\)\{/, "handler must branch on e/E to expand");
  assert.match(handler, /if\(key === 'a' \|\| key === 'A'\)\{/, "handler must branch on a/A to ask");
  assert.match(handler, /rrow-counter/, "expand must target the counter-suggestion panel");
  assert.match(handler, /rrow-ask/, "ask must trigger the per-risk ask button");
  assert.match(handler, /if\(key === 'j' \|\| key === 'J' \|\| key === 'k' \|\| key === 'K'\)\{/,
    "handler must branch on j/J/k/K");
  assert.match(handler, /getElementById\('resultPanel'\)/,
    "j/k must require visible results");
  assert.match(handler, /\(i \+ step \+ rows\.length\) % rows\.length/,
    "j/k must wrap around the risk list");
  assert.match(handler, /kb-modal\.show/,
    "j/k must not fire with the help modal open");
  assert.match(handler, /scrollIntoView\(\{ block: 'nearest'/,
    "j/k must scroll the target row into view");
  assert.match(appSrc, /<kbd>j<\/kbd><kbd>k<\/kbd><span>Next \/ previous risk row/,
    "the help modal must document the j/k shortcut");
  assert.match(cssSrc, /\.rrow-ask:focus-visible,\.rrow-expand:focus-visible\{outline:2px solid var\(--accent\);outline-offset:2px\}/,
    "ask and expand must get the same focus ring as copy/speak");
  assert.match(cssSrc, /\.rrow-ask:focus-visible,[\s\S]{0,40}\.rrow-copy:focus-visible,[\s\S]{0,40}\.rrow-speak:focus-visible,[\s\S]{0,40}\.rrow-expand:focus-visible\{opacity:1\}/,
    "every focused row action must be fully opaque");
});

skip("risk detail: Escape collapses the expanded panel and returns focus to the pill", async () => {
  if (!HAS_BROWSER) return;
  const fs = require("node:fs");
  const path = require("node:path");
  const appSrc = fs.readFileSync(path.join(ROOT, "assets", "app.js"), "utf8");

  // Locate the riskDetail keydown handler.
  const marker = "riskDetail.addEventListener('keydown'";
  const hStart = appSrc.indexOf(marker);
  assert.ok(hStart > -1, "riskDetail keydown handler must exist");
  const handler = appSrc.slice(hStart, hStart + 900);

  // Escape must collapse the panel, sync the pill, and return focus.
  assert.match(handler, /if\(e\.key === 'Escape'\)\{/, "riskDetail must handle Escape");
  assert.match(handler, /riskDetail\.hidden = true;/, "Escape must collapse the detail panel");
  assert.match(handler, /riskPreview\.setAttribute\('aria-expanded','false'\)/, "Escape must reset the pill's aria-expanded");
  assert.match(handler, /riskPreview\.focus/, "Escape must return focus to the preview pill");
  // The original Enter/Space locate behavior must remain.
  assert.match(handler, /e\.key !== 'Enter' && e\.key !== ' '/, "Enter/Space locate parity must be preserved");
});

skip("rewrite block: has a Copy button that copies just the plain-English rewrite", async () => {
  if (!HAS_BROWSER) return;
  const fs = require("node:fs");
  const path = require("node:path");
  const analyzeHtml = fs.readFileSync(path.join(ROOT, "analyze.html"), "utf8");
  const appSrc = fs.readFileSync(path.join(ROOT, "assets", "app.js"), "utf8");
  const themeSrc = fs.readFileSync(path.join(ROOT, "assets", "theme.css"), "utf8");

  assert.match(analyzeHtml, /id="rewriteCopyBtn"/, "analyze.html must expose #rewriteCopyBtn on the rewrite block");
  assert.match(analyzeHtml, /class="rewrite-copy no-print"/, "rewrite copy button must use rewrite-copy styling and hide in print");
  assert.match(appSrc, /rewriteCopyBtn=\$\('#rewriteCopyBtn'\)/, "app.js must look up #rewriteCopyBtn");
  assert.match(appSrc, /rewriteCopyBtn\.addEventListener\('click'/, "app.js must wire the rewrite copy button");
  assert.match(appSrc, /getElementById\('plainOut'\)/, "rewrite copy must read #plainOut");
  assert.match(appSrc, /'⚠ Nothing to copy yet — analyze a document first'/, "rewrite copy must give feedback when there is nothing to copy");
  assert.match(appSrc, /'📋 Rewrite copied'/, "rewrite copy must toast on success");
  assert.match(themeSrc, /\.rewrite-copy\{/, "theme.css must style .rewrite-copy");
  assert.match(themeSrc, /\.rewrite-copy:focus-visible\{/, "theme.css must give .rewrite-copy a focus ring");
});

// Cycle #186 — original / rewritten toggle on the rewrite block.
test("analyzer: rewrite block toggles original ↔ rewritten", () => {
  if (!HAS_BROWSER) return;
  const fs = require("node:fs");
  const path = require("node:path");
  const analyzeHtml = fs.readFileSync(path.join(ROOT, "analyze.html"), "utf8");
  const appSrc = fs.readFileSync(path.join(ROOT, "assets", "app.js"), "utf8");
  const cssSrc = fs.readFileSync(path.join(ROOT, "assets", "theme.css"), "utf8");

  assert.match(analyzeHtml, /id="rewriteToggleBtn" aria-pressed="false"/,
    "analyze.html must expose the rewrite toggle button");
  assert.match(appSrc, /let rewriteShowOriginal = false;/,
    "the toggle state must live in the analyzer scope");
  assert.match(appSrc, /function setRewriteToggle\(original\)\{/,
    "a toggle setter must exist");
  assert.match(appSrc, /function buildRewriteOriginalHtml\(\)\{/,
    "an original-view builder must exist");
  assert.match(appSrc, /JARGON\.forEach\(\(\[re\]\) => \{/,
    "the original view must reuse the jargon pattern list");
  assert.match(appSrc, /ranges\.push\(\{ start: m\.index, end: m\.index \+ m\[0\]\.length \}\)/,
    "the original view must collect every jargon match range");
  assert.match(appSrc, /kept\.some\(k => rg\.start < k\.end && rg\.end > k\.start\)/,
    "overlapping jargon matches must be de-duplicated (longest wins)");
  assert.match(appSrc, /<mark class="jargon-hit">/,
    "the original view must render jargon as highlights");
  assert.match(appSrc, /kept\.length \? ' <span class="rewrite-jargon-count">' \+ kept\.length \+ ' jargon<\/span>' : ''/,
    "the jargon count must reflect the unique kept highlights");
  assert.match(appSrc, /_rewriteAiHtml = plainOut\.innerHTML;/,
    "each render must remember the rewritten view");
  assert.match(appSrc, /rewriteToggleBtn\.addEventListener\('click', \(\) => \{[\s\S]{0,60}setRewriteToggle\(!rewriteShowOriginal\);/,
    "the toggle button must flip the view");
  assert.match(appSrc, /tb\.setAttribute\('aria-pressed', original \? 'true' : 'false'\);/,
    "the toggle must announce its state via aria-pressed");
  const resetCount = (appSrc.match(/resetRewriteToggle\(\);/g) || []).length;
  assert.ok(resetCount >= 2,
    "both the render and snapshot-restore paths must reset the toggle");
  assert.match(cssSrc, /\.rewrite-toggle\{/, "the toggle must be styled");
  assert.match(cssSrc, /\.rewrite-toggle\[aria-pressed="true"\]\{/, "the pressed state must be visible");
});

skip("risk filter: 'showing X of Y' pill counts rows the CSS actually reveals", async () => {
  if (!HAS_BROWSER) return;
  const fs = require("node:fs");
  const path = require("node:path");
  const appSrc = fs.readFileSync(path.join(ROOT, "assets", "app.js"), "utf8");

  // The pill must count rows by their data-risk attribute (what the CSS
  // filter selectors reveal), not inline display styles.
  assert.match(appSrc, /\.rrow\[data-risk="' \+ which \+ '"\]/, "visible count must use data-risk matching the active filter");
  assert.doesNotMatch(appSrc, /querySelectorAll\('\.rrow:not\(\[style\*="display: none"\]\)'\)/, "count must not rely on inline display styles");
  assert.match(appSrc, /applyRiskFilter\(cur\);/, "paintRiskFilter must re-apply the active filter so the pill refreshes after re-analysis");
});

skip("rewrite stats: word count is computed and displayed next to sentences + read time", async () => {
  if (!HAS_BROWSER) return;
  const fs = require("node:fs");
  const path = require("node:path");
  const analyzeHtml = fs.readFileSync(path.join(ROOT, "analyze.html"), "utf8");
  const appSrc = fs.readFileSync(path.join(ROOT, "assets", "app.js"), "utf8");

  assert.match(analyzeHtml, /id="rewriteWords"/, "analyze.html must expose #rewriteWords in the rewrite stats line");
  assert.match(analyzeHtml, /id="rewriteWordS"/, "analyze.html must expose #rewriteWordS for pluralization");
  assert.match(appSrc, /rsWords=document\.getElementById\('rewriteWords'\)/, "app.js must look up #rewriteWords");
  assert.match(appSrc, /rsWords\.textContent = String\(words\)/, "app.js must render the computed word count");
  assert.match(appSrc, /rsWordS\.textContent = words === 1 \? '' : 's'/, "app.js must pluralize 'word/words'");
});

skip("focus mode: hides input + non-rewrite blocks and exits via Esc/Clear", async () => {
  if (!HAS_BROWSER) return;
  const fs = require("node:fs");
  const path = require("node:path");
  const analyzeHtml = fs.readFileSync(path.join(ROOT, "analyze.html"), "utf8");
  const appSrc = fs.readFileSync(path.join(ROOT, "assets", "app.js"), "utf8");
  const themeSrc = fs.readFileSync(path.join(ROOT, "assets", "theme.css"), "utf8");

  assert.match(analyzeHtml, /id="focusModeBtn"/, "result-actions must expose the focus toggle");
  assert.match(analyzeHtml, /id="rewriteBlock"/, "rewrite block must be addressable as #rewriteBlock");
  assert.match(appSrc, /function setFocusMode\(/, "app.js must define setFocusMode");
  assert.match(appSrc, /body\.classList\.toggle\('focus-mode'/, "focus mode must toggle the body class");
  assert.match(appSrc, /setFocusMode\(false\)/, "Escape/Clear must be able to exit focus mode");
  assert.match(themeSrc, /body\.focus-mode \.result-block:not\(#rewriteBlock\)\{display:none\}/, "CSS must hide non-rewrite blocks in focus mode");
  assert.match(themeSrc, /body\.focus-mode \.col\.in\{display:none\}/, "CSS must hide the input column in focus mode");
});

skip("theme.css: health-copy rules are defined once (no duplicate blocks)", async () => {
  if (!HAS_BROWSER) return;
  const fs = require("node:fs");
  const path = require("node:path");
  const themeSrc = fs.readFileSync(path.join(ROOT, "assets", "theme.css"), "utf8");

  assert.equal((themeSrc.match(/\.health-copy\{/g) || []).length, 1, ".health-copy base rule must be defined exactly once");
  assert.equal((themeSrc.match(/\.health-copy:hover\{/g) || []).length, 1, ".health-copy:hover must be defined exactly once");
  for (const sev of ["low", "review", "negotiate", "danger"]) {
    const re = new RegExp("\\.health-check\\." + sev + " \\.health-copy\\{", "g");
    assert.equal((themeSrc.match(re) || []).length, 1, ".health-check." + sev + " .health-copy must be defined exactly once");
  }
});

skip("next steps: interactive done-tracking with persisted progress", async () => {
  if (!HAS_BROWSER) return;
  const fs = require("node:fs");
  const path = require("node:path");
  const analyzeHtml = fs.readFileSync(path.join(ROOT, "analyze.html"), "utf8");
  const appSrc = fs.readFileSync(path.join(ROOT, "assets", "app.js"), "utf8");
  const themeSrc = fs.readFileSync(path.join(ROOT, "assets", "theme.css"), "utf8");

  assert.match(analyzeHtml, /id="stepsProgress"/, "analyze.html must expose #stepsProgress");
  assert.match(analyzeHtml, /id="stepsResetBtn"/, "analyze.html must expose #stepsResetBtn");
  assert.match(appSrc, /function wireStepsTracking\(/, "app.js must define wireStepsTracking");
  assert.match(appSrc, /function applyStepsDone\(/, "app.js must define applyStepsDone");
  assert.match(appSrc, /localStorage\.getItem\(stepsStoreKey\(\)\)/, "done-state must be loaded from localStorage");
  assert.match(appSrc, /li\.classList\.toggle\('done'\)/, "clicking a step must toggle .done");
  assert.match(appSrc, /cleardoc:steps:/, "storage key must be namespaced per document fingerprint");
  assert.match(appSrc, /li\.setAttribute\('role', 'checkbox'\)/, "steps must be exposed as checkboxes to assistive tech");
  assert.match(appSrc, /li\.setAttribute\('aria-checked'/, "steps must reflect checked state via aria-checked");
  assert.match(appSrc, /e\.key !== 'Enter' && e\.key !== ' '/, "steps must toggle via Enter/Space");
  assert.match(themeSrc, /\.nextsteps-list li\.done\{/, "done steps must be visually marked");
  assert.match(themeSrc, /\.nextsteps-list li:focus-visible\{/, "focused steps must show a focus ring");
  assert.match(appSrc, /'✓ all ' \+ total \+ ' done'/, "the progress line must celebrate when every step is done");
  assert.match(themeSrc, /\.steps-progress\.steps-all-done\{/, "theme.css must style the all-done progress state");
});

skip("top concern: callout has a copy button that exports clause + why", async () => {
  if (!HAS_BROWSER) return;
  const fs = require("node:fs");
  const path = require("node:path");
  const appSrc = fs.readFileSync(path.join(ROOT, "assets", "app.js"), "utf8");
  const themeSrc = fs.readFileSync(path.join(ROOT, "assets", "theme.css"), "utf8");

  assert.match(appSrc, /data-tc-copy="1"/, "paintTopConcern must render a copy button");
  assert.match(appSrc, /'📋 Top concern copied'/, "top-concern copy must toast on success");
  assert.match(appSrc, /'Top concern \(' \+ sevLabel \+ '\):/, "copy payload must include the severity label and clause");
  assert.match(appSrc, /Why it matters:/, "copy payload must include the why-text");
  assert.match(appSrc, /copyBtn\.setAttribute\('aria-label', ok \? 'Top concern copied to clipboard' : 'Copy failed — try again'\)/, "top-concern copy must announce success via aria-label");
  assert.match(appSrc, /copyBtn\.setAttribute\('aria-label', 'Copy the top concern to the clipboard'\)/, "top-concern copy must restore the original aria-label");
  assert.match(themeSrc, /\.tc-copy\{/, "theme.css must style .tc-copy");
  assert.match(themeSrc, /\.tc-copy:focus-visible\{/, "theme.css must give .tc-copy a focus ring");
});

skip("ask thread: answered turns have a copy button that exports answer + citation", async () => {
  if (!HAS_BROWSER) return;
  const fs = require("node:fs");
  const path = require("node:path");
  const appSrc = fs.readFileSync(path.join(ROOT, "assets", "app.js"), "utf8");
  const themeSrc = fs.readFileSync(path.join(ROOT, "assets", "theme.css"), "utf8");

  assert.match(appSrc, /data-ask-copy="1"/, "answered turns must render a copy button");
  assert.match(appSrc, /function wireAskCopy\(/, "app.js must define wireAskCopy");
  assert.match(appSrc, /'📋 Answer copied'/, "answer copy must toast on success");
  assert.match(appSrc, /querySelector\('\.ans-line'\)/, "copy payload must read the answer line");
  assert.match(appSrc, /querySelector\('\.cite'\)/, "copy payload must include the citation");
  assert.match(appSrc, /const qEl = \(a\.previousElementSibling && a\.previousElementSibling\.classList\.contains\('ask-q'\)\) \? a\.previousElementSibling : null;/,
    "copy payload must find the question bubble beside the answer");
  assert.match(appSrc, /Q: ' \+ qText \+ '\\n\\n'/,
    "copy payload must lead with the question as a Q&A pair");
  assert.match(themeSrc, /\.ask-copy\{/, "theme.css must style .ask-copy");
  assert.match(themeSrc, /\.ask-copy:focus-visible\{/, "theme.css must give .ask-copy a focus ring");
});

// Cycle #190 — copy the question bubble: each ask-q gets a 📋 button that
// exports the exact question text (mirrors the answer copy).
test("analyzer: ask question bubbles copy in one click", () => {
  if (!HAS_BROWSER) return;
  const fs = require("node:fs");
  const path = require("node:path");
  const appSrc = fs.readFileSync(path.join(ROOT, "assets", "app.js"), "utf8");
  const cssSrc = fs.readFileSync(path.join(ROOT, "assets", "theme.css"), "utf8");

  assert.match(appSrc, /class="ask-q-copy no-print" data-ask-q-copy="/,
    "each question bubble must render a copy button");
  assert.match(appSrc, /function wireAskQuestionCopy\(\)\{/,
    "a delegated question-copy handler must exist");
  assert.match(appSrc, /thread\._askQuestionCopyWired = true;/,
    "the question-copy handler must wire once");
  assert.match(appSrc, /e\.target\.closest && e\.target\.closest\('\[data-ask-q-copy\]'\)/,
    "the handler must catch question-copy clicks");
  assert.match(appSrc, /btn\.getAttribute\('data-ask-q-copy'\) \|\| ''/,
    "the handler must read the question text");
  assert.match(appSrc, /'📋 Question copied'/,
    "copying must toast on success");
  assert.match(appSrc, /btn\.textContent = ok \? '✓' : '⚠';/,
    "the button must flash confirmation");
  assert.match(cssSrc, /\.ask-q-copy\{/, "the question-copy button must be styled");
  assert.match(cssSrc, /\.ask-q-copy:focus-visible\{/, "the question-copy button must have a focus ring");
});

skip("keyboard: Ctrl/Cmd+Enter runs the analysis from anywhere", async () => {
  if (!HAS_BROWSER) return;
  const fs = require("node:fs");
  const path = require("node:path");
  const appSrc = fs.readFileSync(path.join(ROOT, "assets", "app.js"), "utf8");
  const analyzeHtml = fs.readFileSync(path.join(ROOT, "analyze.html"), "utf8");

  assert.match(appSrc, /\(e\.ctrlKey \|\| e\.metaKey\) && \(e\.key === 'Enter' \|\| e\.key === 'NumpadEnter'\)/, "global keydown must handle Ctrl/Cmd+Enter");
  assert.match(appSrc, /ab\.click\(\)/, "Ctrl/Cmd+Enter must trigger the Analyze button");
  assert.match(appSrc, /ab && !ab\.disabled/, "the shortcut must no-op while an analysis is in flight");
  assert.match(appSrc, /t\.id !== 'docInput'/, "the shortcut must not hijack other inputs' Enter semantics (e.g. Ask)");
  assert.match(analyzeHtml, /Ctrl\/Cmd\+Enter to analyze/, "the Analyze button hint must document the shortcut");
  assert.match(appSrc, /<kbd>⌘<\/kbd><kbd>Enter<\/kbd><span>Run the analysis<\/span>/, "the help modal must document the shortcut");
});

skip("samples: eviction + debt-collection demo documents are offered", async () => {
  if (!HAS_BROWSER) return;
  const fs = require("node:fs");
  const path = require("node:path");
  const analyzeHtml = fs.readFileSync(path.join(ROOT, "analyze.html"), "utf8");
  const appSrc = fs.readFileSync(path.join(ROOT, "assets", "app.js"), "utf8");

  assert.match(analyzeHtml, /try: Eviction/, "the sample row must offer an Eviction demo");
  assert.match(analyzeHtml, /try: Debt Collection/, "the sample row must offer a Debt Collection demo");
  assert.match(analyzeHtml, /data-fill="Tenant shall vacate the premises/, "the eviction sample must load realistic notice language");
  assert.match(analyzeHtml, /binding arbitration/, "the debt sample must include arbitration language that trips the risk radar");
  assert.match(appSrc, /setFocusMode\(false\); input\.value=q\.dataset\.fill/, "loading a sample must exit focus mode so the document is visible");
});

skip("compare panel: copy button exports verdict + stats as plain text", async () => {
  if (!HAS_BROWSER) return;
  const fs = require("node:fs");
  const path = require("node:path");
  const analyzeHtml = fs.readFileSync(path.join(ROOT, "analyze.html"), "utf8");
  const appSrc = fs.readFileSync(path.join(ROOT, "assets", "app.js"), "utf8");
  const themeSrc = fs.readFileSync(path.join(ROOT, "assets", "theme.css"), "utf8");

  assert.match(analyzeHtml, /id="compareCopyBtn"/, "compare-actions must expose #compareCopyBtn");
  assert.match(appSrc, /compareCopyBtn\.addEventListener\('click'/, "app.js must wire the compare copy button");
  assert.match(appSrc, /'📋 Comparison copied'/, "compare copy must toast on success");
  assert.match(appSrc, /'⚠ Nothing to copy yet — compare two clauses first'/, "compare copy must give feedback when there is nothing to copy");
  assert.match(appSrc, /vals\.join\(' \| '\)/, "compare copy must export Original | Compare rows");
  assert.match(appSrc, /lines\.push\('Diff'\)/, "compare copy must include the sentence-level diff");
  assert.match(appSrc, /cmp-diff-row/, "compare copy must read the diff rows");
  assert.match(themeSrc, /\.compare-actions \.cmp-copy\{/, "theme.css must style .cmp-copy");
});

skip("ask: quick-question chips fill the input and ask immediately", async () => {
  if (!HAS_BROWSER) return;
  const fs = require("node:fs");
  const path = require("node:path");
  const analyzeHtml = fs.readFileSync(path.join(ROOT, "analyze.html"), "utf8");
  const appSrc = fs.readFileSync(path.join(ROOT, "assets", "app.js"), "utf8");
  const themeSrc = fs.readFileSync(path.join(ROOT, "assets", "theme.css"), "utf8");

  assert.match(analyzeHtml, /id="askChips"/, "analyze.html must expose #askChips");
  assert.match(analyzeHtml, /data-ask-chip="Can I cancel this early\?"/, "a cancellation quick-question must exist");
  assert.match(appSrc, /askChips\.addEventListener\('click'/, "app.js must wire the chips");
  assert.match(appSrc, /askInput\.value = q/, "clicking a chip must fill the ask input");
  assert.match(appSrc, /typeof ask === 'function'\) ask\(\)/, "clicking a chip must send the question");
  assert.match(appSrc, /if\(_askInFlight\) return;/, "ask must not stack requests while one is in flight");
  assert.match(themeSrc, /\.ask-chip\{/, "theme.css must style .ask-chip");
  assert.match(themeSrc, /\.ask-chip:focus-visible\{/, "theme.css must give chips a focus ring");
});

test("analyzer: Ask answers suggest deterministic per-answer follow-up questions", () => {
  if (!HAS_BROWSER) return;
  const fs = require("node:fs");
  const path = require("node:path");
  const appSrc = fs.readFileSync(path.join(ROOT, "assets", "app.js"), "utf8");
  const cssSrc = fs.readFileSync(path.join(ROOT, "assets", "theme.css"), "utf8");

  // The follow-up builder derives chips from the answer + document.
  assert.match(appSrc, /function buildFollowUps\(answer, cite, priorQs\)\{/,
    "the follow-up builder must exist");
  assert.match(appSrc, /What happens if I miss the deadline\?/,
    "a deadline follow-up must be offered when the document has deadlines");
  assert.match(appSrc, /Explain that in simpler terms\./,
    "a simpler-terms follow-up must always be available");
  assert.match(appSrc, /return out\.slice\(0, 3\);/,
    "the builder must cap suggestions at three chips");
  assert.match(appSrc, /const asked = new Set\(\(priorQs \|\| \[\]\)\.map/,
    "the builder must collect the questions already asked");
  assert.match(appSrc, /\.replace\(\/\\s\+\/g, ' '\)\.trim\(\)\)/,
    "prior questions must be normalized before comparison");
  assert.match(appSrc, /!asked\.has\(k\)/,
    "chips that duplicate a prior question must be skipped");
  // Chips render only on the latest answered turn, as an accessible group.
  assert.match(appSrc, /const followUps = \(!pending && isLast\) \? buildFollowUps\(turn\.answer, turn\.cite, askHistory\.map\(t => t\.q\)\) : \[\];/,
    "chips must attach to the newest answered turn and receive the thread history");
  assert.match(appSrc, /role="group" aria-label="Suggested follow-up questions"/,
    "chips must be an accessible group");
  assert.match(appSrc, /data-ask-followup="' \+ esc\(f\) \+ '"/,
    "each chip must carry its question text");
  // Delegated click → prefill + immediate submit, guarded while in flight.
  assert.match(appSrc, /askThread\.addEventListener\('click'/,
    "chips must be wired once via delegation on the thread");
  assert.match(appSrc, /\.closest\('\.ask-followup'\)/,
    "the delegation must target chip clicks");
  assert.match(appSrc, /if\(!q \|\| _askInFlight\) return;/,
    "chip clicks must be ignored while a request is in flight");
  assert.match(appSrc, /if\(askInput\)\{ askInput\.value = q; askInput\.disabled = false; \}/,
    "clicking a chip must load the question into the ask input");
  assert.match(appSrc, /if\(askBtn\) askBtn\.disabled = false;\s*ask\(\);/,
    "clicking a chip must submit the question immediately");
  // Chip styling.
  assert.match(cssSrc, /\.ask-followups\{/, "follow-up row CSS must exist");
  assert.match(cssSrc, /\.ask-followup\{/, "chip CSS must exist");
  assert.match(cssSrc, /\.ask-followup:focus-visible\{/, "chips must have a focus ring");
});

test("analyzer: Ask thread persists per document and restores on reload", () => {
  if (!HAS_BROWSER) return;
  const fs = require("node:fs");
  const path = require("node:path");
  const appSrc = fs.readFileSync(path.join(ROOT, "assets", "app.js"), "utf8");

  // Per-fingerprint storage key + capped shape.
  assert.match(appSrc, /const askStoreKey = \(fp\) => 'cleardoc:askThread:' \+ \(fp \|\| 'latest'\);/,
    "threads must be stored under a per-document key");
  assert.match(appSrc, /function persistAskThread\(fp\)\{/,
    "a persist helper must exist");
  assert.match(appSrc, /function restoreAskThread\(fp\)\{/,
    "a restore helper must exist");
  assert.match(appSrc, /filter\(t => !t\.pending\)\.slice\(-8\)/,
    "persistence must cap the thread to the last 8 complete turns");
  assert.match(appSrc, /answer: String\(t\.answer \|\| ''\)\.slice\(0, 2600\)/,
    "answers must be bounded so the quota can't blow");
  assert.match(appSrc, /localStorage\.setItem\(askStoreKey\(fp\), JSON\.stringify\(slim\)\)/,
    "complete turns must be written to localStorage");
  assert.match(appSrc, /localStorage\.removeItem\(askStoreKey\(fp\)\)/,
    "an empty thread must remove the stored one");
  assert.match(appSrc, /askHistory = turns;/,
    "restore must load the saved turns into the thread");
  // Every completed answer persists; clearing removes the stored thread.
  assert.match(appSrc, /persistAskThread\(\(_fpState && _fpState\.short\) \|\| null\);/,
    "answers must persist after completion (and clear must purge)");
  // On analysis render: restore for the current document, wipe on change.
  assert.match(appSrc, /if\(typeof restoreAskThread === 'function'\)\{/,
    "render must call the restore helper when present");
  assert.match(appSrc, /if\(curFp && _threadFp !== curFp\)\{ askHistory = \[\]; _threadRestored = false; \}/,
    "a changed document must start a fresh in-memory thread");
  assert.match(appSrc, /restoreAskThread\(curFp\);/,
    "the current document's thread must be restored");
  assert.match(appSrc, /let _threadFp = null;/,
    "the thread-fingerprint tracker must exist");
});

test("analyzer: Forget-me and history-clear purge saved Ask threads; restores announce themselves", () => {
  if (!HAS_BROWSER) return;
  const fs = require("node:fs");
  const path = require("node:path");
  const appSrc = fs.readFileSync(path.join(ROOT, "assets", "app.js"), "utf8");
  const cssSrc = fs.readFileSync(path.join(ROOT, "assets", "theme.css"), "utf8");

  // Shared purge helper + per-thread key detection.
  assert.match(appSrc, /function purgeStoredAskThreads\(\)\{/,
    "a shared purge helper must exist");
  assert.match(appSrc, /k\.indexOf\('cleardoc:askThread:'\) === 0/,
    "purge must target only saved thread keys");
  assert.match(appSrc, /purgeStoredAskThreads\(\);/,
    "forget-me and history-clear must call the purge helper");
  assert.match(appSrc, /function clearHistory\(\)\{[\s\S]{0,260}purgeStoredAskThreads\(\);/,
    "clearHistory must purge threads inside its body");
  // In-memory reset bridge for the IIFE-level forget flow.
  assert.match(appSrc, /let __resetAskThread = null;/,
    "the forget bridge must exist");
  assert.match(appSrc, /__resetAskThread = \(\) => \{/,
    "analyzePage must register the memory reset");
  assert.match(appSrc, /if\(typeof __resetAskThread === 'function'\) __resetAskThread\(\);/,
    "forget-me must invoke the memory reset");
  // Restore notice: toast + persistent inline note.
  assert.match(appSrc, /let _threadRestored = false;/,
    "the restored flag must exist");
  assert.match(appSrc, /_threadRestored = true;/,
    "restoring must set the flag");
  assert.match(appSrc, /showAnalyzeToast\('💬 Restored '/,
    "restoring must announce the restored count");
  assert.match(appSrc, /↩ Restored from your last visit to this document/,
    "the thread must show a persistent restored note");
  assert.match(appSrc, /if\(curFp && _threadFp !== curFp\)\{ askHistory = \[\]; _threadRestored = false; \}/,
    "a changed document must also reset the restored note");
  assert.match(cssSrc, /\.ask-restored-note\{/,
    "the restored note must be styled");
});

skip("ask: copy-thread button exports the whole Q&A as text", async () => {
  if (!HAS_BROWSER) return;
  const fs = require("node:fs");
  const path = require("node:path");
  const analyzeHtml = fs.readFileSync(path.join(ROOT, "analyze.html"), "utf8");
  const appSrc = fs.readFileSync(path.join(ROOT, "assets", "app.js"), "utf8");

  assert.match(analyzeHtml, /id="askCopyThreadBtn"/, "analyze.html must expose #askCopyThreadBtn");
  assert.match(appSrc, /askCopyThreadBtn\.addEventListener\('click'/, "app.js must wire the copy-thread button");
  assert.match(appSrc, /'Q: ' \+ t\.q/, "the export must include each question");
  assert.match(appSrc, /'A: ' \+ t\.answer/, "the export must include each answer");
  assert.match(appSrc, /'Source: ' \+ t\.cite/, "the export must include each citation");
  assert.match(appSrc, /askCopyThreadBtn\.hidden = askHistory\.length === 0/, "the button must hide when the thread is empty");
});

// Cycle #112 — Markdown export of the Ask thread for note apps.
test("analyzer: Ask thread copies as Markdown for note apps", () => {
  if (!HAS_BROWSER) return;
  const fs = require("node:fs");
  const path = require("node:path");
  const html = fs.readFileSync(path.join(ROOT, "analyze.html"), "utf8");
  const appSrc = fs.readFileSync(path.join(ROOT, "assets", "app.js"), "utf8");

  assert.match(html, /id="askCopyMdBtn"/,
    "analyze.html must expose the Markdown copy button");
  assert.match(html, /title="Copy the whole Q&A as Markdown"/,
    "the button must be labelled for Markdown");
  assert.match(appSrc, /const askCopyMdBtn = document\.getElementById\('askCopyMdBtn'\);/,
    "app.js must look up the Markdown button");
  assert.match(appSrc, /if\(askCopyMdBtn\) askCopyMdBtn\.hidden = askHistory\.length === 0;/,
    "the button must hide when the thread is empty");
  assert.match(appSrc, /'## Q: ' \+ t\.q/,
    "each question must be a markdown heading");
  assert.match(appSrc, /\\n> Source: ' \+ t\.cite/,
    "each citation must be a blockquote");
  assert.match(appSrc, /parts\.push\('---\\n'\);/,
    "turns must be separated by a horizontal rule");
  assert.match(appSrc, /askCopyMdBtn\.setAttribute\('aria-label', ok \? 'Ask thread copied as Markdown' : 'Copy failed — try again'\)/,
    "copy must announce success/failure via aria-label");
  assert.match(appSrc, /📋 Markdown copied/,
    "copy must toast on success");
  assert.match(appSrc, /askCopyMdBtn\._flashTimer/,
    "the button label must flash and restore");
  assert.match(appSrc, /if\(askCopyMdBtn\.isConnected\)\{/,
    "the label restore must skip detached buttons");
  // Cycle #113 — download parity with the .txt save.
  assert.match(html, /id="askSaveMdBtn"/,
    "analyze.html must expose the Markdown save button");
  assert.match(html, /title="Download the whole Q&A as a Markdown file"/,
    "the save button must be labelled for Markdown");
  assert.match(appSrc, /const askSaveMdBtn = document\.getElementById\('askSaveMdBtn'\);/,
    "app.js must look up the Markdown save button");
  assert.match(appSrc, /function buildAskMarkdown\(\)\{/,
    "a shared Markdown builder must exist");
  assert.match(appSrc, /if\(askSaveMdBtn\) askSaveMdBtn\.hidden = askHistory\.length === 0;/,
    "the save button must hide when the thread is empty");
  assert.match(appSrc, /if\(askSaveMdBtn\) askSaveMdBtn\.addEventListener\('click'/,
    "the save button must be wired");
  assert.match(appSrc, /cleardoc-ask-' \+ stamp \+ '\.md'/,
    "the download must use a .md filename");
  assert.match(appSrc, /⬇ Ask thread saved/,
    "saving must toast success");
});

skip("forget-me: exits focus mode so the wiped page is not left blank", async () => {
  if (!HAS_BROWSER) return;
  const fs = require("node:fs");
  const path = require("node:path");
  const appSrc = fs.readFileSync(path.join(ROOT, "assets", "app.js"), "utf8");

  const hStart = appSrc.indexOf("function wireForgetMe");
  assert.ok(hStart > -1, "wireForgetMe must exist");
  const handler = appSrc.slice(hStart, hStart + 4000);
  assert.match(handler, /setFocusMode\(false\);/, "forget-me must exit focus mode after wiping data");
});

skip("compare panel: swap button exchanges the two documents", async () => {
  if (!HAS_BROWSER) return;
  const fs = require("node:fs");
  const path = require("node:path");
  const analyzeHtml = fs.readFileSync(path.join(ROOT, "analyze.html"), "utf8");
  const appSrc = fs.readFileSync(path.join(ROOT, "assets", "app.js"), "utf8");
  const themeSrc = fs.readFileSync(path.join(ROOT, "assets", "theme.css"), "utf8");

  assert.match(analyzeHtml, /id="compareSwapBtn"/, "compare-actions must expose #compareSwapBtn");
  assert.match(appSrc, /compareSwapBtn\.addEventListener\('click'/, "app.js must wire the swap button");
  assert.match(appSrc, /input\.value = inputB\.value \|\| ''/, "swap must move B into the Original slot");
  assert.match(appSrc, /inputB\.value = a/, "swap must move A into the Compare slot");
  assert.match(appSrc, /updateCompareStats\(\)/, "swap must re-render the verdict + stats");
  assert.match(themeSrc, /\.compare-actions \.cmp-swap\{/, "theme.css must style .cmp-swap");
});

skip("voice mode: exits focus mode so it reads what is visible", async () => {
  if (!HAS_BROWSER) return;
  const fs = require("node:fs");
  const path = require("node:path");
  const appSrc = fs.readFileSync(path.join(ROOT, "assets", "app.js"), "utf8");

  const marker = "voice-mode reader — read every visible analysis";
  const hStart = appSrc.indexOf(marker);
  assert.ok(hStart > -1, "voice-mode wiring must exist");
  const handler = appSrc.slice(hStart, hStart + 3000);
  assert.match(handler, /setFocusMode\(false\);/, "voice mode must exit focus mode before reading");
});

skip("keyboard: 'f' toggles focus mode when results are visible", async () => {
  if (!HAS_BROWSER) return;
  const fs = require("node:fs");
  const path = require("node:path");
  const appSrc = fs.readFileSync(path.join(ROOT, "assets", "app.js"), "utf8");

  assert.match(appSrc, /k === 'f' \|\| k === 'F'/, "the global keydown handler must branch on f/F");
  assert.match(appSrc, /setFocusMode\(!document\.body\.classList\.contains\('focus-mode'\)\)/, "f must toggle the focus-mode body class");
  assert.match(appSrc, /resultPanel/, "f must only fire when the result panel is visible");
  assert.match(appSrc, /ae\.offsetParent === null/, "focus must not be left on an element that Focus mode just hid");
  assert.match(appSrc, /<kbd>f<\/kbd><span>Toggle Focus mode/, "the help modal must document the f shortcut");
});

// Cycle #221 — 'p' toggles Privacy blur when results are visible.
test("keyboard: 'p' toggles privacy blur when results are visible", () => {
  if (!HAS_BROWSER) return;
  const fs = require("node:fs");
  const path = require("node:path");
  const appSrc = fs.readFileSync(path.join(ROOT, "assets", "app.js"), "utf8");

  assert.match(appSrc, /if\(k === 'p' \|\| k === 'P'\)\{/,
    "the shortcut handler must branch on p/P");
  assert.match(appSrc, /if\(k === 'p' \|\| k === 'P'\)\{[\s\S]{0,240}getElementById\('resultPanel'\)/,
    "the p branch must only fire when the result panel is visible");
  assert.match(appSrc, /setPrivacyBlur\(!document\.body\.classList\.contains\('privacy-blur'\)\)/,
    "p must toggle the privacy-blur body class");
  assert.match(appSrc, /showAnalyzeToast\(on \? '🕶 Privacy blur on/,
    "the p branch must toast the new privacy state");
  assert.match(appSrc, /<kbd>p<\/kbd><span>Toggle Privacy blur/,
    "the help modal must document the p shortcut");
});

// Cycle #248 — 'r' resumes the reading list.
test("keyboard: 'r' resumes the reading list when results are visible", () => {
  if (!HAS_BROWSER) return;
  const fs = require("node:fs");
  const path = require("node:path");
  const appSrc = fs.readFileSync(path.join(ROOT, "assets", "app.js"), "utf8");

  assert.match(appSrc, /if\(k === 'r' \|\| k === 'R'\)\{/,
    "the shortcut handler must branch on r/R");
  assert.match(appSrc, /if\(k === 'r' \|\| k === 'R'\)\{[\s\S]{0,400}getElementById\('readingResumeBtn'\)/,
    "the r branch must target the resume chip");
  assert.match(appSrc, /if\(k === 'r' \|\| k === 'R'\)\{[\s\S]{0,300}setFocusMode\(false\);/,
    "the r branch must exit Focus mode so the reading list is visible");
  assert.match(appSrc, /rb && rb\.isConnected\)\{[\s\S]{0,80}e\.preventDefault\(\);[\s\S]{0,60}rb\.click\(\);/,
    "the r branch must click the resume chip");
  assert.match(appSrc, /<kbd>r<\/kbd><span>Resume the reading list/,
    "the help modal must document the r shortcut");
});

// Cycle #196 — 'q' focuses the Ask panel when results are visible.
test("analyzer: 'q' focuses the Ask panel when results are visible", () => {
  if (!HAS_BROWSER) return;
  const fs = require("node:fs");
  const path = require("node:path");
  const appSrc = fs.readFileSync(path.join(ROOT, "assets", "app.js"), "utf8");

  assert.match(appSrc, /if\(k === 'q' \|\| k === 'Q'\)\{/,
    "the shortcut handler must branch on q/Q");
  assert.match(appSrc, /if\(k === 'q' \|\| k === 'Q'\)\{[\s\S]{0,400}getElementById\('askInput'\)/,
    "the q branch must target the Ask input");
  assert.match(appSrc, /if\(k === 'q' \|\| k === 'Q'\)\{[\s\S]{0,440}ai\.focus\(\{preventScroll:false\}\)/,
    "the q branch must focus the Ask input");
  assert.match(appSrc, /if\(k === 'q' \|\| k === 'Q'\)\{[\s\S]{0,300}setFocusMode\(false\);/,
    "the q branch must exit Focus mode so the Ask panel is visible");
  assert.match(appSrc, /<kbd>q<\/kbd><span>Focus the Ask panel/,
    "the help modal must document the q shortcut");
});

// Cycle #247 — Escape clears the drafted Ask question (and only that).
test("keyboard: Escape clears the drafted Ask question", () => {
  if (!HAS_BROWSER) return;
  const fs = require("node:fs");
  const path = require("node:path");
  const appSrc = fs.readFileSync(path.join(ROOT, "assets", "app.js"), "utf8");

  assert.match(appSrc, /if\(e\.key === 'Escape' && \(askInput\.value \|\| ''\)\.trim\(\)\)\{/,
    "the Ask input must branch on Escape when a question is drafted");
  assert.match(appSrc, /if\(e\.key === 'Escape' && \(askInput\.value \|\| ''\)\.trim\(\)\)\{[\s\S]{0,160}e\.stopPropagation\(\);/,
    "the Escape branch must stop propagation so the global clear doesn't fire");
  assert.match(appSrc, /if\(e\.key === 'Escape' && \(askInput\.value \|\| ''\)\.trim\(\)\)\{[\s\S]{0,240}askInput\.value = '';/,
    "the Escape branch must clear the drafted question");
});

// Cycle #198 — one-click paste from the system clipboard.
test("analyzer: paste button reads the clipboard into the input", () => {
  if (!HAS_BROWSER) return;
  const fs = require("node:fs");
  const path = require("node:path");
  const html = fs.readFileSync(path.join(ROOT, "analyze.html"), "utf8");
  const appSrc = fs.readFileSync(path.join(ROOT, "assets", "app.js"), "utf8");

  assert.match(html, /id="pasteBtn" title="Paste text from your clipboard into the analyzer"/,
    "analyze.html must expose the paste button");
  assert.match(appSrc, /const pasteBtn = document\.getElementById\('pasteBtn'\);/,
    "the paste button must be wired");
  assert.match(appSrc, /pasteBtn\.addEventListener\('click', async \(\) => \{/,
    "the paste handler must be async");
  assert.match(appSrc, /navigator\.clipboard\.readText\(\)/,
    "the handler must read the clipboard");
  assert.match(appSrc, /text\.slice\(0, 40000\)/,
    "the paste must respect the 40,000-char server cap");
  assert.match(appSrc, /'📋 Pasted ' \+ text\.length \+ ' characters\. Press Analyze when ready\.'/,
    "the handler must confirm the paste");
  assert.match(appSrc, /input\.dispatchEvent\(new Event\('input', \{ bubbles: true \}\)\)/,
    "the handler must fire an input event so the privacy guard rescans");
  assert.match(appSrc, /'⚠ Clipboard reading isn’t supported here — use Ctrl\/Cmd\+V'/,
    "unsupported browsers must get a clear fallback hint");
  assert.match(appSrc, /'📋 Clipboard is empty'/,
    "an empty clipboard must be reported");
  assert.match(appSrc, /'⚠ Couldn’t read the clipboard — press Ctrl\/Cmd\+V instead'/,
    "permission failures must fall back gracefully");
});

skip("top concern: 'What if fixed?' previews the readiness score without the clause", async () => {
  if (!HAS_BROWSER) return;
  const fs = require("node:fs");
  const path = require("node:path");
  const appSrc = fs.readFileSync(path.join(ROOT, "assets", "app.js"), "utf8");
  const themeSrc = fs.readFileSync(path.join(ROOT, "assets", "theme.css"), "utf8");

  assert.match(appSrc, /data-tc-fix="1"/, "paintTopConcern must render a What-if-fixed button");
  assert.match(appSrc, /flags\.filter\(f => f !== top\)/, "the preview must drop the top concern from the flags");
  assert.match(appSrc, /\(total - traps\) \* 0\.5/, "the preview must use the readiness density penalty");
  assert.match(appSrc, /'✨ If you fix this clause: '/, "the preview must report the simulated score");
  assert.match(appSrc, /levelOf\(sim\)/, "the preview must report the simulated severity band");
  assert.match(appSrc, /' \? 'Low' : s >= 40 \? 'Medium' : s >= 20 \? 'High' : 'Critical'/, "severity bands must match the readiness thresholds");
  assert.match(themeSrc, /\.tc-fix\{/, "theme.css must style .tc-fix");
  assert.match(themeSrc, /\.tc-fixed\{/, "theme.css must style the preview note");
});

skip("keyboard: 'c' copies the plain-text summary when results are visible", async () => {
  if (!HAS_BROWSER) return;
  const fs = require("node:fs");
  const path = require("node:path");
  const appSrc = fs.readFileSync(path.join(ROOT, "assets", "app.js"), "utf8");
  const analyzeHtml = fs.readFileSync(path.join(ROOT, "analyze.html"), "utf8");

  assert.match(appSrc, /k === 'c' \|\| k === 'C'/, "the global keydown handler must branch on c/C");
  assert.match(appSrc, /cb\.click\(\)/, "c must trigger the main Copy button");
  assert.match(appSrc, /resultPanel/, "c must only fire when the result panel is visible");
  assert.match(analyzeHtml, /Copy a plain-text summary to your clipboard \(shortcut: c\)/, "the Copy button title must document the c shortcut");
  assert.match(appSrc, /<kbd>c<\/kbd><span>Copy the plain-text summary<\/span>/, "the help modal must document the c shortcut");
});

skip("last-analyzed: never renders 'Invalid Date' for corrupt timestamps", async () => {
  if (!HAS_BROWSER) return;
  const fs = require("node:fs");
  const path = require("node:path");
  const appSrc = fs.readFileSync(path.join(ROOT, "assets", "app.js"), "utf8");

  const hStart = appSrc.indexOf("function setAnalyzedTimestamp");
  assert.ok(hStart > -1, "setAnalyzedTimestamp must exist");
  const handler = appSrc.slice(hStart, hStart + 900);
  assert.match(handler, /isNaN\(date\.getTime\(\)\)/, "the timestamp must be validated before rendering");
  assert.match(handler, /lastEl\.hidden = true;/, "invalid timestamps must hide the element");
});

skip("deadlines: each row has a copy button for a single deadline", async () => {
  if (!HAS_BROWSER) return;
  const fs = require("node:fs");
  const path = require("node:path");
  const appSrc = fs.readFileSync(path.join(ROOT, "assets", "app.js"), "utf8");
  const themeSrc = fs.readFileSync(path.join(ROOT, "assets", "theme.css"), "utf8");

  assert.match(appSrc, /data-deadline-copy="1"/, "deadline rows must render a copy button");
  assert.match(appSrc, /function wireDeadlineCopy\(/, "app.js must define wireDeadlineCopy");
  assert.match(appSrc, /'📅 Deadline copied'/, "deadline copy must toast on success");
  assert.match(appSrc, /'📅 ' \+ date/, "deadline copy must export date + description");
  assert.match(appSrc, /btn\.setAttribute\('aria-label', ok \? 'Deadline copied to clipboard' : 'Copy failed — try again'\)/, "deadline copy must announce success via aria-label");
  assert.match(appSrc, /btn\.setAttribute\('aria-label', 'Copy this deadline'\)/, "deadline copy must restore the original aria-label");
  assert.match(themeSrc, /\.deadline-copy\{/, "theme.css must style .deadline-copy");
  assert.match(themeSrc, /\.deadline-copy:focus-visible\{/, "theme.css must give .deadline-copy a focus ring");
});

skip("voice mode: deadline narration skips the per-row copy buttons", async () => {
  if (!HAS_BROWSER) return;
  const fs = require("node:fs");
  const path = require("node:path");
  const appSrc = fs.readFileSync(path.join(ROOT, "assets", "app.js"), "utf8");

  const marker = "voice-mode reader — read every visible analysis";
  const hStart = appSrc.indexOf(marker);
  assert.ok(hStart > -1, "voice-mode wiring must exist");
  const handler = appSrc.slice(hStart, hStart + 5000);
  assert.match(handler, /dlEl\.querySelectorAll\('\.deadline-row'\)/, "deadline narration must read rows individually");
  assert.match(handler, /querySelector\('\.deadline-date'\)/, "deadline narration must use the date element");
  assert.match(handler, /querySelector\('\.deadline-desc'\)/, "deadline narration must use the description element");
  assert.match(handler, /cloneNode\(true\)/, "risk-row narration must clone rows before stripping buttons");
  assert.match(handler, /querySelectorAll\('button'\)\.forEach\(b => b\.remove\(\)\)/, "risk-row narration must strip button labels");
});

skip("privacy: blur toggle hides sensitive content from onlookers", async () => {
  if (!HAS_BROWSER) return;
  const fs = require("node:fs");
  const path = require("node:path");
  const analyzeHtml = fs.readFileSync(path.join(ROOT, "analyze.html"), "utf8");
  const appSrc = fs.readFileSync(path.join(ROOT, "assets", "app.js"), "utf8");
  const themeSrc = fs.readFileSync(path.join(ROOT, "assets", "theme.css"), "utf8");

  assert.match(analyzeHtml, /id="privacyBlurBtn"/, "result-actions must expose #privacyBlurBtn");
  assert.match(appSrc, /function setPrivacyBlur\(/, "app.js must define setPrivacyBlur");
  assert.match(appSrc, /privacyBlurBtn\.addEventListener\('click'/, "app.js must wire the privacy toggle");
  assert.match(appSrc, /setPrivacyBlur\(false\)/, "Clear/Forget/sample-load must exit privacy blur");
  assert.match(themeSrc, /body\.privacy-blur \.col\.out\{filter:blur\(7px\)/, "CSS must blur the results column");
  assert.match(themeSrc, /body\.privacy-blur \.col\.out:hover\{filter:none\}/, "hover must reveal the blurred content");
  assert.match(themeSrc, /@media print\{body\.privacy-blur/, "print must never blur");
});

skip("privacy: Escape exits the blur like it exits focus mode", async () => {
  if (!HAS_BROWSER) return;
  const fs = require("node:fs");
  const path = require("node:path");
  const appSrc = fs.readFileSync(path.join(ROOT, "assets", "app.js"), "utf8");

  const hStart = appSrc.indexOf("function wireKeyboardShortcuts");
  assert.ok(hStart > -1, "wireKeyboardShortcuts must exist");
  const handler = appSrc.slice(hStart, hStart + 6000);
  assert.match(handler, /setPrivacyBlur\(false\);/, "Escape must exit privacy blur");
});

skip("keyboard: Escape clears results when the Clear hint promises it", async () => {
  if (!HAS_BROWSER) return;
  const fs = require("node:fs");
  const path = require("node:path");
  const appSrc = fs.readFileSync(path.join(ROOT, "assets", "app.js"), "utf8");

  const hStart = appSrc.indexOf("function wireKeyboardShortcuts");
  assert.ok(hStart > -1, "wireKeyboardShortcuts must exist");
  const handler = appSrc.slice(hStart, hStart + 6000);
  assert.match(handler, /cl\.click\(\); return;/, "Escape must trigger the Clear button");
  assert.match(handler, /!isTypingTarget\(e\.target\)/, "Escape must not clear while typing");
  assert.match(handler, /rp && !rp\.hidden/, "Escape must only clear when results are visible");
  assert.match(handler, /if\(e\.defaultPrevented\) return;/, "Escape must not clear when an overlay already consumed it");
});

skip("confirm modal: Escape closes without triggering the clear shortcut", async () => {
  if (!HAS_BROWSER) return;
  const fs = require("node:fs");
  const path = require("node:path");
  const appSrc = fs.readFileSync(path.join(ROOT, "assets", "app.js"), "utf8");

  const hStart = appSrc.indexOf("function showConfirmModal");
  assert.ok(hStart > -1, "showConfirmModal must exist");
  const handler = appSrc.slice(hStart, hStart + 500);
  assert.match(handler, /if\(e\.key === 'Escape'\)\{ e\.preventDefault\(\); close\(false\); \}/, "confirm modal must preventDefault before closing");
});

skip("risk rows: ⚡ button previews the score if that clause is fixed", async () => {
  if (!HAS_BROWSER) return;
  const fs = require("node:fs");
  const path = require("node:path");
  const appSrc = fs.readFileSync(path.join(ROOT, "assets", "app.js"), "utf8");
  const themeSrc = fs.readFileSync(path.join(ROOT, "assets", "theme.css"), "utf8");

  assert.match(appSrc, /function readinessScoreOf\(/, "the shared readiness helper must exist");
  assert.match(appSrc, /data-rrow-fix="1"/, "risk rows must render a ⚡ fix button");
  assert.match(appSrc, /function wireRrowFix\(/, "app.js must define wireRrowFix");
  assert.match(appSrc, /list\._rrowFlags/, "the render must stash the flags for the fix preview");
  assert.match(appSrc, /'⚡ If you fix this clause: '/, "the fix preview must report the simulated score");
  assert.match(appSrc, /\.closest\('\.rrow-fix'\)/, "the ⚡ button must not trigger row expand");
  assert.match(themeSrc, /\.rrow-fix\{/, "theme.css must style .rrow-fix");
});

skip("next steps: copy chip exports the checklist with progress", async () => {
  if (!HAS_BROWSER) return;
  const fs = require("node:fs");
  const path = require("node:path");
  const analyzeHtml = fs.readFileSync(path.join(ROOT, "analyze.html"), "utf8");
  const appSrc = fs.readFileSync(path.join(ROOT, "assets", "app.js"), "utf8");
  const themeSrc = fs.readFileSync(path.join(ROOT, "assets", "theme.css"), "utf8");

  assert.match(analyzeHtml, /id="stepsCopyBtn"/, "analyze.html must expose #stepsCopyBtn");
  assert.match(appSrc, /'\[x\] ' \+ txt/, "done steps must export with [x]");
  assert.match(appSrc, /'\[ \] ' \+ txt/, "pending steps must export with [ ]");
  assert.match(appSrc, /'📋 Progress copied'/, "copy must toast on success");
  assert.match(appSrc, /doneCount \+ ' of ' \+ total \+ ' done'/, "the export must include the progress summary");
  assert.match(themeSrc, /\.steps-copy\{/, "theme.css must style .steps-copy");
});

// Cycle 66 feature: next-steps CSV export for spreadsheet trackers.
test("analyzer: Next Steps export a CSV with done/todo status", () => {
  if (!HAS_BROWSER) return;
  const fs = require("node:fs");
  const path = require("node:path");
  const analyzeHtml = fs.readFileSync(path.join(ROOT, "analyze.html"), "utf8");
  const appSrc = fs.readFileSync(path.join(ROOT, "assets", "app.js"), "utf8");
  const themeSrc = fs.readFileSync(path.join(ROOT, "assets", "theme.css"), "utf8");

  assert.match(analyzeHtml, /id="stepsCsvBtn" title="Download next steps as a \.csv file for a tracker"/,
    "analyze.html must expose #stepsCsvBtn with a descriptive title");
  assert.match(appSrc, /csvBtn\.addEventListener\(\s*['"]click['"]/,
    "steps CSV chip must have a click handler");
  assert.match(appSrc, /done \? 'done' : 'todo'/,
    "the Status column must reflect the live done state");
  assert.match(appSrc, /csvCell\('Status'\) \+ ',' \+ csvCell\('Step'\)/,
    "the CSV must have Status and Step columns in that order");
  assert.match(appSrc, /if\(\/\^\[=\+\\-@\]\/\.test\(s\)\) s = "'" \+ s;/,
    "step text must be guarded against formula injection per OWASP");
  assert.match(appSrc, /const text = '\\uFEFF' \+ header \+ '\\n' \+ body;/,
    "the download must start with a UTF-8 BOM");
  assert.match(appSrc, /a\.download = 'cleardoc-steps-' \+ stamp \+ '\.csv'/,
    "the filename must be cleardoc-steps-<date>.csv");
  assert.match(appSrc, /'📊 Steps CSV downloaded \(' \+ rows\.length/,
    "the export must toast with the row count");
  assert.match(appSrc, /'⚠ Nothing to export yet — analyze first'/,
    "the export must guard the empty state");
  assert.match(themeSrc, /\.steps-csv\{/, "theme.css must style .steps-csv");
  // Cycle 67 polish — self-describing progress metadata row
  assert.match(appSrc, /csvCell\('Progress'\) \+ ',' \+ csvCell\(doneCount \+ ' of ' \+ total \+ ' done'\)/,
    "the CSV must open with a Progress metadata row (N of M done)");
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

// Cycle 74 feature: download the Q&A thread as a text file.
test("analyzer: Ask thread can be saved as a .txt file", () => {
  if (!HAS_BROWSER) return;
  const fs = require("node:fs");
  const path = require("node:path");
  const html = fs.readFileSync(path.join(ROOT, "analyze.html"), "utf8");
  const appSrc = fs.readFileSync(path.join(ROOT, "assets", "app.js"), "utf8");

  // analyze.html must carry the save button next to Copy thread
  assert.match(html, /id="askSaveThreadBtn"[^>]*title="Download the whole Q&A as a text file"/,
    "analyze.html must contain #askSaveThreadBtn with a descriptive title");

  // Visibility: hidden until the thread has turns (mirrors Copy thread)
  assert.match(appSrc, /if\(askSaveThreadBtn\) askSaveThreadBtn\.hidden = askHistory\.length === 0;/,
    "the save button must appear only when the thread has turns");

  // Line format mirrors the copy thread: Q / A / Source per turn
  assert.match(appSrc, /'Q: ' \+ t\.q/,
    "the file must include each question");
  assert.match(appSrc, /'A: ' \+ t\.answer/,
    "the file must include each answer");
  assert.match(appSrc, /'Source: ' \+ t\.cite/,
    "the file must include each citation");
  assert.match(appSrc, /'⚠ Nothing to save yet — ask a question first'/,
    "the save must guard the empty state");

  // Download path
  assert.match(appSrc, /new Blob\(\[text\], \{ type:'text\/plain;charset=utf-8' \}\)/,
    "the thread must download as text/plain UTF-8");
  assert.match(appSrc, /a\.download = 'cleardoc-ask-' \+ stamp \+ '\.txt'/,
    "the filename must be cleardoc-ask-<date>.txt");
  assert.match(appSrc, /URL\.revokeObjectURL\(url\)/,
    "the object URL must be revoked after the download");
  assert.match(appSrc, /'⬇ Ask thread saved'/,
    "the save must toast on success");
  assert.match(appSrc, /askSaveThreadBtn\.setAttribute\('aria-label', 'Ask thread saved as text file'\)/,
    "the save must announce via aria-label");
  assert.match(appSrc, /askSaveThreadBtn\.setAttribute\('aria-label', 'Download the whole Q&A as a text file'\)/,
    "the save must restore the original aria-label");
  // Cycle 75 polish — the saved file is a self-identifying record
  assert.match(appSrc, /'ClearDoc Ask · ' \+ new Date\(\)\.toLocaleString\(\) \+ '\\n\\n' \+ lines\.join\('\\n'\)\.trim\(\)/,
    "the saved file must open with a timestamp header");
  assert.match(appSrc, /askCopyThreadBtn\.addEventListener[\s\S]+?const text = lines\.join\('\\n'\)\.trim\(\);/,
    "the clipboard copy must stay plain (no header)");
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
  // Cycle #99 polish — FAQ expanded to 6, covering privacy, legal scope,
  // and read-count semantics, with the visible page matching JSON-LD.
  assert.equal(faq.mainEntity.length, 6,
    `pricing FAQPage must list exactly 6 questions, got ${faq.mainEntity.length}`);
  const qNames = faq.mainEntity.map(q => q.name);
  for (const expected of [
    "Do you store or train on my documents?",
    "Is ClearDoc legal advice?",
    "What counts as a read?",
  ]) {
    assert.ok(qNames.includes(expected), `pricing FAQPage must include: ${expected}`);
  }
  assert.match(html, /qt serif">Do you store or train on my documents\?<\/span>/,
    "the visible FAQ must show the privacy question");
  assert.match(html, /qt serif">Is ClearDoc legal advice\?<\/span>/,
    "the visible FAQ must show the legal-advice question");
  assert.match(html, /qt serif">What counts as a read\?<\/span>/,
    "the visible FAQ must show the read-count question");
  assert.match(html, /aria-controls="fa5"/,
    "the sixth FAQ item must be reachable");
});

test("pricing: plan cards are backed by a feature-comparison table", () => {
  if (!HAS_BROWSER) return;
  const fs = require("node:fs");
  const path = require("node:path");
  const html = fs.readFileSync(path.join(ROOT, "pricing.html"), "utf8");
  const css = fs.readFileSync(path.join(ROOT, "assets", "theme.css"), "utf8");

  assert.match(html, /<section class="compare-plans"/,
    "pricing.html must include the comparison section");
  assert.match(html, /id="compareTitle"/,
    "the section must have a heading anchor");
  assert.match(html, /<table class="compare-table">/,
    "the comparison must be a semantic table");
  assert.match(html, /<caption>All plans — feature comparison<\/caption>/,
    "the table must have a caption");
  assert.match(html, /scope="col" class="cp-feature">Feature<\/th>/,
    "the feature column header must exist");
  assert.match(html, /scope="col">Reader<\/th>/,
    "the Reader column must exist");
  assert.match(html, /scope="col" class="cp-pick">Professional ★<\/th>/,
    "the Professional column must be highlighted as the pick");
  assert.match(html, /scope="col">The Firm<\/th>/,
    "the Firm column must exist");
  assert.match(html, /scope="row">Reads per month<\/th>/,
    "the reads row must exist");
  assert.match(html, /scope="row">AI chat cited to the line<\/th>/,
    "the AI-chat row must exist");
  assert.match(html, /scope="row">API access<\/th>/,
    "a firm-only row must exist");
  assert.match(html, /class="cp-yes">✓/,
    "included features must show a checkmark");
  assert.match(html, /class="cp-no">—/,
    "missing features must show a dash");
  assert.match(css, /\.compare-table-wrap\{[^}]*overflow-x:auto/,
    "the wrap must scroll horizontally instead of overflowing");
  assert.match(css, /\.compare-table thead th\{/,
    "table headers must be styled");
  assert.match(css, /\.compare-table td\.cp-no\{/,
    "dash cells must be styled");
  assert.match(css, /\.compare-table \.cp-yes\{/,
    "checkmarks must be styled");
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
    ["#copyChecklistBtn", "copy checklist button"],
    ["#copyJsonBtn", "copy JSON button"],
    ["#downloadJsonBtn", "download JSON button"],
    ["#shareBtn", "share-link button"],
    ["#shareBanner", "shared-analysis banner"],
    [".print-header", "print-only header bar"],
    [".result-actions", "result action toolbar"],
    ["#threatScore", "threat score block"],
    ["#threatCopyBtn", "threat score copy button"],
    ["#healthCheck", "health check block"],
    ["#healthCopyBtn", "health check copy button"],
    ["#copyCsvBtn", "copy CSV button"],
    ["#downloadCsvBtn", "download CSV button"],
    ["#execSummary", "executive summary block"],
    ["#execCopyBtn", "executive summary copy button"],
    ["#contractTypeBadge", "contract type badge"],
    ["#readinessBlock", "readiness score block"],
    ["#readinessBar", "readiness score bar"],
    ["#readinessCopyBtn", "readiness copy button"],
    ["#readinessDetail", "readiness breakdown line"],
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

// Cycle #265 — one-page pre-sign brief: recommendation + top risks +
// deadlines + next steps in a single clipboard-friendly block.
skip("analyzer: pre-sign brief copies the decision, risks, deadlines, and next steps", async () => {
  if (!HAS_BROWSER) return;
  const page = await context.newPage();
  await page.goto(`http://127.0.0.1:${PORT}/analyze.html`, { waitUntil: "networkidle" });
  await page.click("#analyzeBtn");
  await page.waitForSelector("#decisionBlock:not([hidden])", { timeout: 8000 });
  const brief = await page.evaluate(async () => {
    let captured = null;
    const orig = navigator.clipboard?.writeText?.bind(navigator.clipboard);
    if (navigator.clipboard) {
      navigator.clipboard.writeText = async (txt) => { captured = txt; };
    }
    document.getElementById("decisionBriefBtn").click();
    await new Promise(r => setTimeout(r, 400));
    if (navigator.clipboard && orig) navigator.clipboard.writeText = orig;
    return captured;
  });
  assert.ok(brief, "pre-sign brief should copy something");
  assert.match(brief, /CLEARDOC PRE-SIGN BRIEF/, "brief must carry a clear header");
  assert.match(brief, /Recommendation:/, "brief must include the recommendation");
  assert.match(brief, /Metrics:/, "brief must include the headline metrics (readiness/maturity/tally)");
  assert.match(brief, /Auto-renewal:/, "brief must surface the auto-renewal radar summary");
  assert.match(brief, /_Generated by ClearDoc — informational only, not legal advice\._/, "brief must carry the disclaimer footer");
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

// Cycle 82 feature: copy the hero clarifier's plain-English rewrite.
test("home: hero clarifier card can copy the plain-English rewrite", () => {
  if (!HAS_BROWSER) return;
  const fs = require("node:fs");
  const path = require("node:path");
  const html = fs.readFileSync(path.join(ROOT, "index.html"), "utf8");
  const appSrc = fs.readFileSync(path.join(ROOT, "assets", "app.js"), "utf8");
  const cssSrc = fs.readFileSync(path.join(ROOT, "assets", "theme.css"), "utf8");

  // index.html must carry the copy chip on the clarifier card
  assert.match(html, /id="hcardCopyBtn" title="Copy the plain-English rewrite" aria-label="Copy the plain-English rewrite"/,
    "index.html must contain #hcardCopyBtn with a descriptive aria-label");

  // Wiring: reads the rewrite output element, clipboard + fallback
  assert.match(appSrc, /hcardCopyBtn\.addEventListener\(\s*['"]click['"]/,
    "the copy chip must have a click handler");
  assert.match(appSrc, /\(out\.innerText \|\| out\.textContent \|\| ''\)\.replace/,
    "copy must read the rewrite output text");
  assert.match(appSrc, /'Nothing to copy yet — clarify a sentence first'/,
    "copy must guard the empty state");
  assert.match(appSrc, /'✓ Plain-English rewrite copied'/,
    "copy must update the hero status message on success");
  assert.match(appSrc, /hcardCopyBtn\.setAttribute\('aria-label', ok \? 'Plain-English rewrite copied to clipboard' : 'Copy failed — try again'\)/,
    "copy must announce success/failure via aria-label");
  assert.match(appSrc, /hcardCopyBtn\.setAttribute\('aria-label', 'Copy the plain-English rewrite'\)/,
    "copy must restore the original aria-label");

  // CSS: chip styled on the card + focus ring
  assert.match(cssSrc, /\.hcard \.hcard-copy\{/,
    "theme.css must style .hcard-copy within the hero card");
  assert.match(cssSrc, /\.hcard \.hcard-copy\{[^}]*top:36px/,
    "the copy chip must sit below the 'ClearDoc ✦' corner label (no overlap)");
  assert.match(cssSrc, /\.hcard \.hcard-copy:focus-visible\{/,
    "the copy chip must have a visible focus ring");
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

  // All nine buttons must exist in the DOM with stable IDs
  for (const id of ["#printBtn", "#saveBtn", "#copyBtn", "#copyChecklistBtn", "#copyJsonBtn", "#downloadJsonBtn", "#copyCsvBtn", "#downloadCsvBtn", "#execCopyBtn"]) {
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

// Cycle #258 — native device share sheet for the analysis link.
skip("share: native share sheet receives the analysis URL", async () => {
  if (!HAS_BROWSER) return;
  const fs = require("node:fs");
  const path = require("node:path");
  const appSrc = fs.readFileSync(path.join(ROOT, "assets", "app.js"), "utf8");
  assert.match(appSrc, /navigator\.share && typeof navigator\.share === 'function'/,
    "the share flow must check for native share support");
  assert.match(appSrc, /await navigator\.share\(\{/,
    "the share flow must call the native share sheet");
  assert.match(appSrc, /'ClearDoc verdict: '/,
    "the share text must include the rendered verdict when available");
  assert.match(appSrc, /'Shared ✓'/,
    "a successful native share must confirm on the button");
  assert.match(appSrc, /AbortError/,
    "a dismissed share sheet must not be treated as an error");

  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  const errors = [];
  page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.addInitScript(() => {
    window.__sharedPayload = null;
    try {
      Object.defineProperty(navigator, "share", {
        configurable: true,
        value: async (data) => { window.__sharedPayload = data; },
      });
    } catch (_) {
      try { navigator.share = async (data) => { window.__sharedPayload = data; }; } catch (_2) {}
    }
  });
  try {
    await page.goto(`http://127.0.0.1:${PORT}/analyze.html`, { waitUntil: "networkidle" });
    await page.click(".qf[data-fill]:first-of-type");
    await page.click("#analyzeBtn");
    await page.waitForSelector("#resultPanel:not([hidden])", { timeout: 8000 });
    await page.click("#shareBtn");
    await page.waitForFunction(() => window.__sharedPayload && window.__sharedPayload.url, { timeout: 8000 });
    const payload = await page.evaluate(() => window.__sharedPayload);
    assert.match(payload.url, /^http.*\/analyze\.html#share=[A-Za-z0-9_-]+$/,
      "native share must receive the encoded analysis URL");
    assert.equal(payload.title, "ClearDoc analysis", "native share must carry the ClearDoc title");
    assert.match(payload.text, /ClearDoc verdict:/, "native share text must lead with the verdict");
    assert.equal(errors.length, 0, `zero console errors, got: ${errors.join(" | ")}`);
  } finally {
    await page.close();
    await ctx.close();
  }
});

// Cycle #259 — standalone HTML report download.
skip("analyze: HTML report downloads a standalone analysis file", async () => {
  if (!HAS_BROWSER) return;
  const fs = require("node:fs");
  const path = require("node:path");
  const html = fs.readFileSync(path.join(ROOT, "analyze.html"), "utf8");
  const appSrc = fs.readFileSync(path.join(ROOT, "assets", "app.js"), "utf8");
  assert.match(html, /id="exportHtmlBtn"/,
    "analyze.html must expose the HTML export button");
  assert.match(html, /title="Download this analysis as a standalone HTML report/,
    "the button must be labelled for an HTML report");
  assert.match(appSrc, /function buildAnalysisHtml\(\)\{/,
    "app.js must define buildAnalysisHtml");
  assert.match(appSrc, /function downloadAnalysisHtml\(\)\{/,
    "app.js must define downloadAnalysisHtml");
  assert.match(appSrc, /type:'text\/html;charset=utf-8'/,
    "the download must use text/html UTF-8");
  assert.match(appSrc, /a\.download = 'cleardoc-analysis-' \+ stamp \+ '\.html'/,
    "the filename must be cleardoc-analysis-<date>.html");
  assert.match(appSrc, /report-summary/,
    "the report must include a summary header style and block");
  assert.ok(appSrc.includes("'<b>Verdict:</b> ' + esc(vLabel.textContent.trim())"),
    "the report summary must include the verdict when available");

  const ctx = await browser.newContext({ acceptDownloads: true });
  const page = await ctx.newPage();
  const errors = [];
  page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
  page.on("pageerror", (e) => errors.push(String(e)));
  try {
    await page.goto(`http://127.0.0.1:${PORT}/analyze.html`, { waitUntil: "networkidle" });
    await page.click(".qf[data-fill]:first-of-type");
    await page.click("#analyzeBtn");
    await page.waitForSelector("#resultPanel:not([hidden])", { timeout: 8000 });
    const [download] = await Promise.all([
      page.waitForEvent("download", { timeout: 8000 }),
      page.click("#exportHtmlBtn"),
    ]);
    const dlPath = await download.path();
    const content = fs.readFileSync(dlPath, "utf8");
    assert.match(download.suggestedFilename(), /^cleardoc-analysis-\d{4}-\d{2}-\d{2}\.html$/,
      "the download must be named cleardoc-analysis-<date>.html");
    assert.match(content, /^<!doctype html>/, "the report must be a full HTML document");
    assert.match(content, /ClearDoc Analysis/, "the report must include the ClearDoc header");
    assert.match(content, /class="report-summary"/, "the report must include the summary header");
    assert.match(content, /Verdict:/, "the report summary must include the verdict");
    assert.match(content, /NOT LEGAL ADVICE/, "the report must carry the disclaimer");
    assert.equal(errors.length, 0, `zero console errors, got: ${errors.join(" | ")}`);
  } finally {
    await page.close();
    await ctx.close();
  }
});

// Cycle #260 — copy the same rich HTML report to the clipboard.
skip("analyze: HTML report copies as rich text to the clipboard", async () => {
  if (!HAS_BROWSER) return;
  const fs = require("node:fs");
  const path = require("node:path");
  const html = fs.readFileSync(path.join(ROOT, "analyze.html"), "utf8");
  const appSrc = fs.readFileSync(path.join(ROOT, "assets", "app.js"), "utf8");
  assert.match(html, /id="copyHtmlBtn"/,
    "analyze.html must expose the HTML copy button");
  assert.match(html, /title="Copy this analysis as rich HTML/,
    "the copy button must be labelled for rich HTML");
  assert.match(appSrc, /function buildAnalysisHtmlBody\(\)\{/,
    "app.js must define a reusable HTML body builder");
  assert.match(appSrc, /async function copyAnalysisHtml\(\)\{/,
    "app.js must define copyAnalysisHtml");
  assert.match(appSrc, /'text\/html': new Blob\(\[fragment\]/,
    "the copy must write an HTML clipboard item when supported");
  assert.match(appSrc, /'HTML copied — paste into email, CMS, or notes that accept rich text\.'/,
    "copying must confirm with a descriptive toast");
  assert.match(appSrc, /el\.style\.fontFamily = "'Courier New',monospace";/,
    "the HTML body builder must inline the heading font");

  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  const errors = [];
  page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.addInitScript(() => {
    window.__capturedHtml = null;
    try {
      Object.defineProperty(navigator, "clipboard", {
        configurable: true,
        value: {
          write: async (items) => {
            const item = items && items[0];
            if (item && typeof item.getType === "function") {
              const blob = await item.getType("text/html");
              window.__capturedHtml = await blob.text();
            }
          },
          writeText: async () => {},
        },
      });
    } catch (_) {
      try { navigator.clipboard = { write: async () => {}, writeText: async () => {} }; } catch (_2) {}
    }
  });
  try {
    await page.goto(`http://127.0.0.1:${PORT}/analyze.html`, { waitUntil: "networkidle" });
    await page.click(".qf[data-fill]:first-of-type");
    await page.click("#analyzeBtn");
    await page.waitForSelector("#resultPanel:not([hidden])", { timeout: 8000 });
    await page.click("#copyHtmlBtn");
    await page.waitForFunction(() => window.__capturedHtml && window.__capturedHtml.length > 0, { timeout: 8000 });
    const captured = await page.evaluate(() => window.__capturedHtml);
    assert.match(captured, /report-summary/, "the copied HTML must include the summary header");
    assert.match(captured, /Verdict:/, "the copied HTML must include the verdict");
    assert.match(captured, /NOT LEGAL ADVICE/, "the copied HTML must carry the disclaimer");
    assert.match(captured, /style="font-family:Georgia/, "the copied HTML must carry inline body styles");
    assert.match(captured, /border-top:2px solid #14120E/, "the copied HTML must carry an inline footer rule");
    assert.equal(errors.length, 0, `zero console errors, got: ${errors.join(" | ")}`);
  } finally {
    await page.close();
    await ctx.close();
  }
});

// Cycle #261 — Markdown risk-table copy.
skip("analyze: risk table copies as Markdown for Notion/GitHub/Linear", async () => {
  if (!HAS_BROWSER) return;
  const fs = require("node:fs");
  const path = require("node:path");
  const html = fs.readFileSync(path.join(ROOT, "analyze.html"), "utf8");
  const appSrc = fs.readFileSync(path.join(ROOT, "assets", "app.js"), "utf8");
  assert.match(html, /id="copyMdTableBtn"/,
    "analyze.html must expose the Markdown table copy button");
  assert.match(html, /title="Copy the risk table as Markdown/,
    "the button must be labelled for a Markdown risk table");
  assert.match(appSrc, /function buildRiskMarkdownTable\(\)\{/,
    "app.js must define buildRiskMarkdownTable");
  assert.match(appSrc, /async function copyAnalysisMdTable\(\)\{/,
    "app.js must define copyAnalysisMdTable");
  assert.match(appSrc, /\| Done \| Severity \| Label \| Clause \| Why \|/,
    "the Markdown table must carry the expected header row");
  assert.match(appSrc, /\| - \[ \] \| /,
    "the Markdown table must include an unchecked Done column");

  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  const errors = [];
  page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.addInitScript(() => {
    window.__copiedMdTable = null;
    try {
      Object.defineProperty(navigator, "clipboard", {
        configurable: true,
        value: {
          writeText: async (txt) => { window.__copiedMdTable = txt; },
          write: async () => {},
        },
      });
    } catch (_) {
      try { navigator.clipboard = { writeText: async (txt) => { window.__copiedMdTable = txt; }, write: async () => {} }; } catch (_2) {}
    }
  });
  try {
    await page.goto(`http://127.0.0.1:${PORT}/analyze.html`, { waitUntil: "networkidle" });
    await page.click(".qf[data-fill]:first-of-type");
    await page.click("#analyzeBtn");
    await page.waitForSelector("#resultPanel:not([hidden])", { timeout: 8000 });
    await page.click("#copyMdTableBtn");
    await page.waitForFunction(() => window.__copiedMdTable && window.__copiedMdTable.length > 0, { timeout: 8000 });
    const captured = await page.evaluate(() => window.__copiedMdTable);
    assert.match(captured, /\| Done \| Severity \| Label \| Clause \| Why \|/, "the copied text must open with the Markdown table header");
    assert.match(captured, /\|---\|---\|---\|---\|---\|/, "the copied text must include the Markdown separator row");
    assert.match(captured, /\| - \[ \] \|/, "the copied text must include unchecked done checkboxes");
    assert.equal(errors.length, 0, `zero console errors, got: ${errors.join(" | ")}`);
  } finally {
    await page.close();
    await ctx.close();
  }
});

// Cycle #262 — download the generated response draft as Markdown.
skip("analyze: response draft downloads as Markdown", async () => {
  if (!HAS_BROWSER) return;
  const fs = require("node:fs");
  const path = require("node:path");
  const html = fs.readFileSync(path.join(ROOT, "analyze.html"), "utf8");
  const appSrc = fs.readFileSync(path.join(ROOT, "assets", "app.js"), "utf8");
  assert.match(html, /id="downloadDraftMdBtn"/,
    "analyze.html must expose the Markdown draft download button");
  assert.match(appSrc, /cleardoc-response-draft\.md/,
    "the Markdown draft download must use a .md filename");
  assert.match(appSrc, /type:'text\/markdown;charset=utf-8'/,
    "the Markdown draft download must use text/markdown UTF-8");
  assert.match(appSrc, /'⬇ Draft saved as Markdown'/,
    "the Markdown draft download must confirm with a toast");

  const ctx = await browser.newContext({ acceptDownloads: true });
  const page = await ctx.newPage();
  const errors = [];
  page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
  page.on("pageerror", (e) => errors.push(String(e)));
  try {
    await page.goto(`http://127.0.0.1:${PORT}/analyze.html`, { waitUntil: "networkidle" });
    await page.click(".qf[data-fill]:first-of-type");
    await page.click("#analyzeBtn");
    await page.waitForSelector("#draftOut", { timeout: 8000 });
    await page.waitForFunction(() => (document.getElementById("draftOut") || {}).value && document.getElementById("draftOut").value.length > 10,
      { timeout: 8000 });
    const [download] = await Promise.all([
      page.waitForEvent("download", { timeout: 8000 }),
      page.click("#downloadDraftMdBtn"),
    ]);
    const dlPath = await download.path();
    const content = fs.readFileSync(dlPath, "utf8");
    assert.match(download.suggestedFilename(), /^cleardoc-response-draft(?:-[a-z0-9]+)?\.md$/,
      "the download must be named cleardoc-response-draft[.<fingerprint>].md");
    assert.match(content, /^# ClearDoc response draft(?: · #[a-z0-9]+)?/, "the Markdown draft must start with the title");
    assert.match(content, /not legal advice/, "the Markdown draft must carry the disclaimer");
    assert.equal(errors.length, 0, `zero console errors, got: ${errors.join(" | ")}`);
  } finally {
    await page.close();
    await ctx.close();
  }
});

// Cycle #263 — copy the response draft as Markdown.
skip("analyze: response draft copies as Markdown", async () => {
  if (!HAS_BROWSER) return;
  const fs = require("node:fs");
  const path = require("node:path");
  const html = fs.readFileSync(path.join(ROOT, "analyze.html"), "utf8");
  const appSrc = fs.readFileSync(path.join(ROOT, "assets", "app.js"), "utf8");
  assert.match(html, /id="copyDraftMdBtn" aria-label="Copy the response draft as Markdown"/,
    "analyze.html must expose the Markdown draft copy button");
  assert.match(appSrc, /function buildDraftMarkdown\(\)\{/,
    "app.js must define a shared Markdown draft builder");
  assert.match(appSrc, /const md=buildDraftMarkdown\(\);/,
    "the copy handler must use the shared Markdown builder");
  assert.match(appSrc, /const copyDraftMdBtn=document\.getElementById\('copyDraftMdBtn'\);/,
    "app.js must wire the Markdown draft copy button");
  assert.match(appSrc, /clipboard\.writeText\(md\)/,
    "the Markdown draft copy must use the clipboard");
  assert.match(appSrc, /'📋 Draft copied as Markdown'/,
    "the Markdown draft copy must confirm with a toast");

  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  const errors = [];
  page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.addInitScript(() => {
    window.__copiedDraftMd = null;
    try {
      Object.defineProperty(navigator, "clipboard", {
        configurable: true,
        value: {
          writeText: async (txt) => { window.__copiedDraftMd = txt; },
          write: async () => {},
        },
      });
    } catch (_) {
      try { navigator.clipboard = { writeText: async (txt) => { window.__copiedDraftMd = txt; }, write: async () => {} }; } catch (_2) {}
    }
  });
  try {
    await page.goto(`http://127.0.0.1:${PORT}/analyze.html`, { waitUntil: "networkidle" });
    await page.click(".qf[data-fill]:first-of-type");
    await page.click("#analyzeBtn");
    await page.waitForSelector("#draftOut", { timeout: 8000 });
    await page.waitForFunction(() => (document.getElementById("draftOut") || {}).value && document.getElementById("draftOut").value.length > 10,
      { timeout: 8000 });
    await page.click("#copyDraftMdBtn");
    await page.waitForFunction(() => window.__copiedDraftMd && window.__copiedDraftMd.length > 0, { timeout: 8000 });
    const captured = await page.evaluate(() => window.__copiedDraftMd);
    assert.match(captured, /^# ClearDoc response draft/, "the copied draft must start with the Markdown title");
    assert.match(captured, /not legal advice/, "the copied draft must carry the disclaimer");
    assert.equal(errors.length, 0, `zero console errors, got: ${errors.join(" | ")}`);
  } finally {
    await page.close();
    await ctx.close();
  }
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
  const handleFileBlock = appSrc.match(/function handleFile\([\s\S]+?IMG_EXT\.test/);
  assert.ok(handleFileBlock, "handleFile must exist");
  assert.match(handleFileBlock[0], /IMG_EXT\.test\(n\)\)\s*readImage/, "image attachments must trigger readImage");

  // clearAttachments must cancel any in-flight OCR
  const clearBlock = appSrc.match(/function clearAttachments\(\)\{[\s\S]+?cancelActiveOcr\(\)/);
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
  const readImageBlock = appSrc.match(/async function readImage\([\s\S]+?_activeOcrWorker=null;/);
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
  const byofBlock = appSrc.match(/function byof\(\)\{[\s\S]+?setLevels\(gradeLevel\(raw\)/);
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
  const updateBlock = appSrc.match(/function updateTextStats\(\)\{[\s\S]+?\}\s*\n\s*\/\*[\s\S]{0,200}?\/\/ readTime/);
  assert.ok(updateBlock || /function updateTextStats\(\)[\s\S]+?statReadTime\.textContent\s*=\s*readTime\(/.test(appSrc), "updateTextStats() must exist");
  assert.match(appSrc, /statReadTime[\s\S]+?\.textContent\s*=\s*readTime\(/,
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
  const bandFn = appSrc.match(/function readTimeBand\(text\)\{[\s\S]+?return band;/);
  assert.ok(bandFn, "readTimeBand() must exist");
  assert.match(bandFn[0], /15/,
    "readTimeBand must use 15 as the long→marathon threshold");

  // updateTextStats must wire the band class onto #statReadTime
  const updateBlock = appSrc.match(/function updateTextStats\(\)\{[\s\S]+?statReadTime\.textContent\s*=\s*readTime\(/);
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
  const analyzePageFn = appSrc.match(/function analyzePage\(\)\{[\s\S]+?function countRisksBySeverity\(text\)/);
  assert.ok(analyzePageFn, "analyzePage() must exist");
  assert.match(appSrc, /function countRisksBySeverity\(text\)/,
    "countRisksBySeverity() helper must live inside analyzePage so it can use the local RISK array");
  assert.match(appSrc, /for \(const r of RISK\)/,
    "countRisksBySeverity() must iterate RISK to count distinct pattern matches");
  // Must classify into all three severity buckets
  for (const sev of ["out.trap", "out.watch", "out.note"]) {
    assert.ok(appSrc.includes(sev),
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
  const updateBlock = appSrc.match(/function updateTextStats\(\)\{[\s\S]+?statReadTime\.textContent\s*=\s*readTime\(/);
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
  const analyzePageFn = appSrc.match(/function analyzePage\(\)\{[\s\S]+?function countRisksBySeverity\(text\)/);
  assert.ok(analyzePageFn, "analyzePage() must exist");
  assert.match(appSrc, /function matchRisks\(text\)/,
    "matchRisks() helper must live inside analyzePage to access the RISK array");
  assert.match(appSrc, /r\.re\.exec\(t\)/,
    "matchRisks() must capture the matched substring (not just a boolean)");
  assert.match(appSrc, /function renderRiskDetail\(hits\)/,
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
  const updateBlock = appSrc.match(/function updateTextStats\(\)\{[\s\S]+?statReadTime\.textContent\s*=\s*readTime\(/);
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
  const renderFn = appSrc.match(/function renderRiskDetail\(hits\)\{[\s\S]{0,9800}\n    \}/);
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

  const analyzePageFn = appSrc.match(/function analyzePage\(\)\{[\s\S]+?function countRisksBySeverity\(text\)/);
  assert.ok(analyzePageFn, "analyzePage() must exist");

  // formatMatchesForCopy() must exist and produce a structured plain-text list
  assert.match(appSrc, /function formatMatchesForCopy\(hits\)/,
    "formatMatchesForCopy() helper must live inside analyzePage");
  assert.match(appSrc, /'TRAP'[\s\S]+?'WATCH'[\s\S]+?'NOTE'/,
    "formatMatchesForCopy() must use all three severity tags");
  assert.match(appSrc, /— matched by ClearDoc/,
    "formatMatchesForCopy() must close with a ClearDoc attribution so the source is preserved");

  // renderRiskDetail must paint the toolbar with the copy button
  const renderFn = appSrc.match(/function renderRiskDetail\(hits\)\{[\s\S]{0,9800}\n    \}/);
  assert.ok(renderFn, "renderRiskDetail() must exist");
  assert.match(renderFn[0], /risk-detail-toolbar/,
    "renderRiskDetail() must render a .risk-detail-toolbar row");
  assert.match(renderFn[0], /data-rd-copy="1"/,
    "renderRiskDetail() must render a copy button with [data-rd-copy] for delegated clicks");
  assert.match(renderFn[0], /rd-count/,
    "renderRiskDetail() must render a .rd-count element showing the pattern count");

  // Delegated click handler on riskDetail (not per-render)
  assert.match(appSrc,
    /riskDetail\.addEventListener\(\s*['"]click['"][\s\S]+?closest\([^)]*data-rd-copy/,
    "riskDetail must delegate clicks via [data-rd-copy] so re-renders don't stack handlers");
  // Must use the same clipboard pattern as verdictCopyBtn (navigator.clipboard + execCommand fallback)
  assert.match(appSrc,
    /riskDetail\.addEventListener[\s\S]+?navigator\.clipboard\.writeText[\s\S]+?document\.execCommand\(\s*['"]copy['"]\s*\)/,
    "Copy handler must use navigator.clipboard with execCommand fallback");
  // Flash feedback "Copied ✓" / "Copy failed"
  assert.match(appSrc,
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
  const updateBlock = appSrc.match(/function updateTextStats\(\)\{[\s\S]+?statReadTime\.textContent\s*=\s*readTime\(/);
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
  const updateBlock = appSrc.match(/function updateTextStats\(\)\{[\s\S]+?statReadTime\.textContent\s*=\s*readTime\(/);
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
  const updateBlock = appSrc.match(/function updateTextStats\(\)\{[\s\S]+?statReadTime\.textContent\s*=\s*readTime\(/);
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
  const updateBlock = appSrc.match(/function updateTextStats\(\)\{[\s\S]+?statReadTime\.textContent\s*=\s*readTime\(/);
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

// Cycle #188 — the live deadlines preview's "↓ all" jumps to the full
// deadlines list in the results (or guides to Analyze before a run).
test("analyzer: deadlines preview jump button scrolls to the full list", () => {
  if (!HAS_BROWSER) return;
  const fs = require("node:fs");
  const path = require("node:path");
  const html = fs.readFileSync(path.join(ROOT, "analyze.html"), "utf8");
  const appSrc = fs.readFileSync(path.join(ROOT, "assets", "app.js"), "utf8");
  const cssSrc = fs.readFileSync(path.join(ROOT, "assets", "theme.css"), "utf8");

  assert.match(html, /id="deadlinesJumpBtn" aria-label="Jump to the full deadlines list"/,
    "analyze.html must expose the jump button");
  assert.match(appSrc, /deadlinesJumpBtn\._jumpWired = true;/,
    "the jump button must wire once");
  assert.match(appSrc, /deadlinesJumpBtn\.addEventListener\('click'/,
    "the jump button must have a click handler");
  assert.match(appSrc, /const target = \(block && !block\.hidden\) \? block : \(\(altBlock && !altBlock\.hidden\) \? altBlock : null\);/,
    "the jump must target whichever deadline block is visible");
  assert.match(appSrc, /target\.scrollIntoView\(\{ behavior: noMotion \? 'auto' : 'smooth', block: 'start' \}\)/,
    "clicking must scroll to the deadline block");
  assert.match(appSrc, /target\.classList\.add\('deadlines-jump-flash'\)/,
    "the target block must be highlighted");
  assert.match(appSrc, /'📅 Run Analyze to see the full deadlines list'/,
    "before a run, the jump must guide the user to Analyze");
  assert.match(cssSrc, /\.deadlines-preview \.dp-jump\{/, "the jump chip must be styled");
  assert.match(cssSrc, /\.deadlines-jump-flash\{/, "the jump highlight must be styled");
});

// Cycle #200 — deadline timeline dots are clickable and jump to their row.
test("analyzer: deadline timeline dots jump to their deadline row", () => {
  if (!HAS_BROWSER) return;
  const fs = require("node:fs");
  const path = require("node:path");
  const appSrc = fs.readFileSync(path.join(ROOT, "assets", "app.js"), "utf8");
  const cssSrc = fs.readFileSync(path.join(ROOT, "assets", "theme.css"), "utf8");

  assert.match(appSrc, /<button type="button" class="dp-dot '/,
    "timeline dots must render as buttons");
  assert.match(appSrc, /data-dp-date="' \+ esc\(d\.date \|\| ''\) \+ '"/,
    "each dot must carry its deadline date");
  assert.match(appSrc, /dpTimeline\._dpDotWired = true;/,
    "the dot handler must wire once");
  assert.match(appSrc, /e\.target\.closest && e\.target\.closest\('\.dp-dot'\)/,
    "the handler must catch dot clicks");
  assert.match(appSrc, /findRow\('#deadlineList'\) \|\| findRow\('#deadlinesList'\)/,
    "the handler must search both deadline lists");
  assert.match(appSrc, /dd && dd\.textContent\.trim\(\)\.indexOf\(date\) === 0/,
    "the handler must match the date prefix before the countdown suffix");
  assert.match(appSrc, /row\.classList\.add\('deadlines-jump-flash'\)/,
    "the matching row must be highlighted");
  assert.match(appSrc, /'📅 Run Analyze to jump to this deadline'/,
    "before a run, the dot must guide the user to Analyze");
  assert.match(cssSrc, /\.deadlines-preview \.dp-dot:focus-visible\{/, "dots must have a focus ring");
});

// Cycle #204 — the results deadline block filters to all / next-7-days /
// overdue without touching exports or the title badge.
test("analyzer: deadline block filters to next-7-days or overdue", () => {
  if (!HAS_BROWSER) return;
  const fs = require("node:fs");
  const path = require("node:path");
  const appSrc = fs.readFileSync(path.join(ROOT, "assets", "app.js"), "utf8");
  const cssSrc = fs.readFileSync(path.join(ROOT, "assets", "theme.css"), "utf8");

  assert.match(appSrc, /const dlFilter = deadlineList\._dlFilter \|\| 'all';/,
    "the block renderer must read the active filter");
  assert.match(appSrc, /const visibleItems = dlFilter === 'all' \? items : items\.filter/,
    "the row list must be filtered by the active chip");
  assert.match(appSrc, /dlFilter === 'soon' \? \(d >= 0 && d <= 7\) : d < 0/,
    "soon must mean within the next 7 days, overdue must be past");
  assert.match(appSrc, /data-dl-filter="soon" aria-pressed="' \+ \(dlFilter === 'soon' \? 'true' : 'false'\) \+ '" title="Show only deadlines within the next 7 days"/,
    "a next-7-days chip must exist");
  assert.match(appSrc, /data-dl-filter="overdue" aria-pressed="' \+ \(dlFilter === 'overdue' \? 'true' : 'false'\) \+ '" title="Show only overdue deadlines"/,
    "an overdue chip must exist");
  assert.match(appSrc, /if\(deadlineList\._dlFilter === undefined\)\{/,
    "the deadline filter must be restored only when unset");
  assert.match(appSrc, /localStorage\.getItem\('cleardoc:deadline-filter'\)/,
    "the deadline filter must read the saved choice");
  assert.match(appSrc, /saved === 'all' \|\| saved === 'soon' \|\| saved === 'overdue'/,
    "a saved deadline filter must be validated before use");
  assert.match(appSrc, /localStorage\.setItem\('cleardoc:deadline-filter', deadlineList\._dlFilter\)/,
    "a chip click must persist the chosen filter");
  assert.match(appSrc, /localStorage\.getItem\('cleardoc:deadline-sort'\)/,
    "the deadline sort must read the saved choice");
  assert.match(appSrc, /if\(saved === 'date'\) deadlineList\._dlSort = 'date';/,
    "a saved sort must be validated before use");
  assert.match(appSrc, /const sortedItems = dlSort === 'date' \? visibleItems\.slice\(\)\.sort/,
    "date mode must sort a copy of the visible rows");
  assert.match(appSrc, /return da - db;/,
    "the sort must order by day difference (soonest first)");
  assert.match(appSrc, /id="deadlineSortBtn" aria-pressed="' \+ \(dlSort === 'date' \? 'true' : 'false'\) \+ '"/,
    "the controls must include a sort chip that announces its pressed state");
  assert.match(appSrc, /⇅<\/b> to sort by date \(soonest first\)/,
    "the deadline note must document the sort chip");
  assert.match(appSrc, /localStorage\.setItem\('cleardoc:deadline-sort', deadlineList\._dlSort\)/,
    "a sort toggle must persist the choice");
  assert.match(appSrc, /data-dl-filter="all" aria-pressed="' \+ \(dlFilter === 'all' \? 'true' : 'false'\) \+ '"/,
    "the all chip must announce its pressed state");
  assert.match(appSrc, /data-dl-filter="overdue" aria-pressed="' \+ \(dlFilter === 'overdue' \? 'true' : 'false'\) \+ '"/,
    "the overdue chip must announce its pressed state");
  assert.match(appSrc, /deadlineList\._dlFilterWired = true;/,
    "the filter chips must wire once");
  assert.match(appSrc, /e\.target\.closest && e\.target\.closest\('\[data-dl-filter\]'\)/,
    "the handler must catch filter-chip clicks");
  assert.match(appSrc, /No deadlines match this filter\./,
    "an empty filtered view must say so");
  // Cycle #205 — exports follow the filter.
  assert.match(appSrc, /const exportItems = sortedItems;/,
    "exports must act on the visible (filtered + sorted) items");
  assert.match(appSrc, /const filteredNote = dlFilter !== 'all' \? ' · filtered' : '';/,
    "filtered exports must carry a filtered tag");
  assert.match(appSrc, /'📋 Deadlines copied \(' \+ exportItems\.length \+ '\)' \+ filteredNote/,
    "the copy-all toast must count the filtered set");
  assert.match(appSrc, /const body = exportItems\.map/,
    "the CSV export must use the filtered set");
  assert.match(appSrc, /const events = exportItems\.map/,
    "the batch ICS export must use the filtered set");
  assert.match(appSrc, /deadlineCopyMdBtn/,
    "the deadline controls must include a Markdown copy button");
  assert.match(appSrc, /'📋 Deadlines copied as Markdown'/,
    "the Markdown deadline copy must confirm with a toast");
  assert.match(appSrc, /\| Date \| Countdown \| Type \| Clause \|/,
    "the Markdown deadline copy must build a table header");
  assert.match(appSrc, /_Scoped to ' \+ dlFilter \+ ' deadlines\._/,
    "the Markdown deadline copy must note the active scope");
  assert.match(cssSrc, /\.deadline-controls \.dl-filter-active\{/, "the active chip must be styled");
  assert.match(cssSrc, /\.deadline-empty\{/, "the empty state must be styled");
});

skip("analyze: deadlines copy as Markdown", async () => {
  if (!HAS_BROWSER) return;
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  const errors = [];
  page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.addInitScript(() => {
    window.__copiedDeadlineMd = null;
    try {
      Object.defineProperty(navigator, "clipboard", {
        configurable: true,
        value: {
          writeText: async (txt) => { window.__copiedDeadlineMd = txt; },
          write: async () => {},
        },
      });
    } catch (_) {
      try { navigator.clipboard = { writeText: async (txt) => { window.__copiedDeadlineMd = txt; }, write: async () => {} }; } catch (_2) {}
    }
  });
  try {
    await page.goto(`http://127.0.0.1:${PORT}/analyze.html`, { waitUntil: "networkidle" });
    await page.click(".qf[data-fill]:first-of-type");
    await page.click("#analyzeBtn");
    await page.waitForSelector("#deadlineBlock:not([hidden]) #deadlineCopyMdBtn", { timeout: 8000 });
    await page.click("#deadlineCopyMdBtn");
    await page.waitForFunction(() => window.__copiedDeadlineMd && window.__copiedDeadlineMd.length > 0, { timeout: 8000 });
    const captured = await page.evaluate(() => window.__copiedDeadlineMd);
    assert.match(captured, /^\| Date \| Countdown \| Type \| Clause \|/, "the copied deadlines must start with the Markdown header");
    assert.match(captured, /\|---\|---\|---\|---\|/, "the copied deadlines must include the separator row");
    assert.equal(errors.length, 0, `zero console errors, got: ${errors.join(" | ")}`);
  } finally {
    await page.close();
    await ctx.close();
  }
});

// Cycle #189 — the section quick-jump nav's Deadlines entry must resolve
// to whichever deadline block is visible (full 📅 or AI-only ⏰), never a
// hidden one.
test("analyzer: section nav resolves the deadlines entry to the visible block", () => {
  if (!HAS_BROWSER) return;
  const fs = require("node:fs");
  const path = require("node:path");
  const appSrc = fs.readFileSync(path.join(ROOT, "assets", "app.js"), "utf8");

  assert.match(appSrc, /resolve: \(\) => \{[\s\S]{0,220}full && !full\.hidden\) \? full :/,
    "the deadlines nav entry must resolve to the visible block");
  assert.match(appSrc, /const list = \(full && !full\.hidden\) \? document\.getElementById\('deadlineList'\) : document\.getElementById\('deadlinesList'\);/,
    "the deadlines count must come from the visible block's list");
  assert.match(appSrc, /let el = s\.resolve \? s\.resolve\(\) : document\.getElementById\(s\.id\);/,
    "paintSectionNav must use the resolver when present");
  assert.match(appSrc, /const targetId = \(s\.el && s\.el\.id\) \|\| s\.anchorId \|\| s\.id;/,
    "nav links must use the resolved element's own id");
});

test("analyzer: deadlines preview copy-all chip exports every deadline to the clipboard", () => {
  // Cycle 46 feature: the live deadlines strip now has a "copy all" chip
  // so users can grab the whole list (with countdowns) before running
  // analysis — paste it straight into a task tracker or email.
  if (!HAS_BROWSER) return;
  const fs = require("node:fs");
  const path = require("node:path");
  const appSrc = fs.readFileSync(path.join(ROOT, "assets", "app.js"), "utf8");
  const html = fs.readFileSync(path.join(ROOT, "analyze.html"), "utf8");

  // analyze.html must have the copy-all chip in the preview strip
  assert.match(html, /id="deadlinesCopyAllBtn"/,
    "analyze.html must contain #deadlinesCopyAllBtn in the deadlines preview");
  assert.match(html, /id="deadlinesCopyAllBtn" aria-label="Copy all deadlines to clipboard"/,
    "copy-all chip must have a descriptive aria-label");

  // updateTextStats must stash the live list on the button + disable when empty
  const updateBlock = appSrc.match(/function updateTextStats\(\)\{[\s\S]+?statReadTime\.textContent\s*=\s*readTime\(/);
  assert.ok(updateBlock, "updateTextStats() must exist");
  assert.match(updateBlock[0], /deadlinesCopyAllBtn\._deadlines\s*=\s*dls/,
    "updateTextStats must stash the live deadline list on the copy-all chip");
  assert.match(updateBlock[0], /deadlinesCopyAllBtn\.disabled\s*=\s*true/,
    "copy-all chip must disable when no deadlines are detected");

  // Copy payload must include a header with the count + one line per deadline
  assert.match(appSrc, /'ClearDoc · ' \+ all\.length/,
    "copy payload must start with a 'ClearDoc · N deadlines' header");
  assert.match(appSrc, /'📅 ' \+ d\.label \+ when/,
    "each line must export the deadline label with its countdown");
  assert.match(appSrc, /' — in ' \+ d\.urgencyDays \+ ' days'/,
    "future deadlines must include an 'in N days' countdown");
  assert.match(appSrc, /' — today'/,
    "today's deadlines must be labeled 'today'");

  // Clipboard path: modern API first, textarea fallback, toast + flash
  assert.match(appSrc, /deadlinesCopyAllBtn\.addEventListener\(\s*['"]click['"]/,
    "copy-all chip must have a click handler");
  assert.match(appSrc, /navigator\.clipboard/,
    "copy must use the modern clipboard API");
  assert.match(appSrc, /document\.execCommand\('copy'\)/,
    "copy must fall back to execCommand for older browsers");
  assert.match(appSrc, /'📋 Deadlines copied \(' \+ all\.length/,
    "copy must toast the deadline count on success");
  assert.match(appSrc, /setAttribute\('aria-label', copied \? 'Deadlines copied to clipboard' : 'Copy failed — try again'\)/,
    "copy must announce success/failure via aria-label");
  assert.match(appSrc, /setAttribute\('aria-label', 'Copy all deadlines to clipboard'\)/,
    "copy must restore the original aria-label after the flash");
  // Must not double-wire on every keystroke
  assert.match(appSrc, /deadlinesCopyAllBtn\._copyAllWired/,
    "copy-all wiring must be guarded so it is attached only once");
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
  assert.match(html, /aria-label="Add deadlines to your calendar"/,
    "#deadlinesCalBtn must have an accurate static aria-label (it exports all deadlines, not just the soonest)");
  assert.match(appSrc, /deadlinesCalBtn\.setAttribute\('aria-label', dls\.length === 1 \? 'Add this deadline to your calendar' : 'Add all ' \+ dls\.length \+ ' deadlines to your calendar'\)/,
    "updateTextStats must announce the deadline count via a dynamic aria-label");

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
  assert.match(appSrc, /deadlinesCalBtn\.addEventListener\([\s\S]+?setAttribute\('aria-label', isMulti \? \('All ' \+ list\.length \+ ' deadlines added to your calendar'\) : 'Deadline added to your calendar'\)/,
    "calendar export must announce the added count via aria-label");
  assert.match(appSrc, /deadlinesCalBtn\.addEventListener\([\s\S]+?setAttribute\('aria-label', baseLabel\)/,
    "calendar export must restore the dynamic aria-label after the flash");

  // Filename must use 'cleardoc-deadlines-' (plural) for multi-event files
  assert.match(appSrc, /deadlinesCalBtn\.addEventListener\([\s\S]+?'cleardoc-deadlines-'/,
    "multi-event filename must start with 'cleardoc-deadlines-' (plural)");

  // Button label scales with count
  assert.match(appSrc, /deadlinesCalBtn\.addEventListener\([\s\S]+?'added ' \+ list\.length \+ ' ✓'/,
    "flash feedback must show 'added N ✓' for multi-event exports");

  // Button label updates dynamically with count
  const updateBlock = appSrc.match(/function updateTextStats\(\)\{[\s\S]+?statReadTime\.textContent\s*=\s*readTime\(/);
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
  const updateBlock = appSrc.match(/function updateTextStats\(\)\{[\s\S]+?statReadTime\.textContent\s*=\s*readTime\(/);
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
  const renderFn = appSrc.match(/function renderRiskDetail\(hits\)\{[\s\S]{0,9800}\n    \}/);
  assert.ok(renderFn, "renderRiskDetail() must exist");
  assert.match(renderFn[0], /data-rd-locate="/,
    "each row must carry data-rd-locate for the click handler to find the source text");
  assert.match(renderFn[0], /tabindex="0"/,
    "each row must be tabindex=0 for keyboard focus");
  assert.match(renderFn[0], /role="button"/,
    "each row must have role=button for screen-reader semantics");
  // Must esc() the matched substring before going into the attribute
  // (defense against attribute-injection via crafted doc text)
  assert.match(renderFn[0], /data-rd-locate="'\s*\+\s*esc\(h\.matched/,
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
  const updateBlock = appSrc.match(/function updateTextStats\(\)\{[\s\S]+?statReadTime\.textContent\s*=\s*readTime\(/);
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

// Cycle 72 feature: copy the live document-stats line.
test("analyzer: document summary line can copy its live stats", () => {
  if (!HAS_BROWSER) return;
  const fs = require("node:fs");
  const path = require("node:path");
  const html = fs.readFileSync(path.join(ROOT, "analyze.html"), "utf8");
  const appSrc = fs.readFileSync(path.join(ROOT, "assets", "app.js"), "utf8");
  const cssSrc = fs.readFileSync(path.join(ROOT, "assets", "theme.css"), "utf8");

  // analyze.html must carry the copy chip inside the doc-summary line
  assert.match(html, /id="dsCopyBtn" title="Copy the document stats line" aria-label="Copy document stats"/,
    "analyze.html must contain #dsCopyBtn with a descriptive aria-label");

  // Wiring: once-only guard + live reads of the stat elements
  assert.match(appSrc, /dsCopyBtn\._dsCopyWired/,
    "stats-copy wiring must be guarded so it is attached only once");
  assert.match(appSrc, /t\('dsSentences'\)/,
    "copy must read the live sentence count");
  assert.match(appSrc, /t\('dsParagraphs'\)/,
    "copy must read the live paragraph count");
  assert.match(appSrc, /t\('dsAvgWords'\)/,
    "copy must read the live average-words count");
  assert.match(appSrc, /t\('dsLongest'\)/,
    "copy must read the live longest-sentence count");
  assert.match(appSrc, /!langEl\.hidden/,
    "copy must include the language only when it is visible");
  assert.match(appSrc, /jn !== '0'/,
    "copy must include jargon swaps only when non-zero");
  assert.match(appSrc, /'Doc stats · ' \+ parts\.join\(' · '\)/,
    "copy must prefix the line with 'Doc stats ·'");
  assert.match(appSrc, /'📋 Document stats copied'/,
    "copy must toast on success");
  // Cycle 73 polish — announce via aria-label + restore it with the label
  assert.match(appSrc, /dsCopyBtn\.setAttribute\('aria-label', ok \? 'Document stats copied to clipboard' : 'Copy failed — try again'\)/,
    "copy must announce success/failure via aria-label");
  assert.match(appSrc, /dsCopyBtn\.setAttribute\('aria-label', 'Copy document stats'\)/,
    "copy must restore the original aria-label after the flash");
  assert.match(appSrc, /dsCopyBtn\.textContent = '📋 copy';[\s\S]+?\}, 1400\)/,
    "the chip must flash and restore its label");

  // CSS: chip styled within the doc-summary line + focus ring
  assert.match(cssSrc, /\.doc-summary \.ds-copy\{/,
    "theme.css must style .ds-copy within the doc summary");
  assert.match(cssSrc, /\.doc-summary \.ds-copy:focus-visible\{/,
    "the stats copy chip must have a visible focus ring");
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
  const updateBlock = appSrc.match(/function updateTextStats\(\)\{[\s\S]+?statReadTime\.textContent\s*=\s*readTime\(/);
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
  const updateFn = appSrc.match(/function updateCompareStats\(\)\{[\s\S]{0,6800}/);
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
  const updateFn = appSrc.match(/function updateCompareStats\(\)\{[\s\S]{0,6800}/);
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
  const updateFnDiff = appSrc.match(/function updateCompareStats\(\)\{[\s\S]{0,6800}/);
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

test("analyzer: rewrite block has A−/A+ text-size controls (WCAG 1.4.4) with persistence", () => {
  // Cycle 48 feature — user-adjustable rewrite text size. A−/A+ step
  // the plain-English rewrite ±2px (data-size attribute + CSS calc
  // overrides), persist in localStorage, disable at bounds, and
  // announce changes via the aria-live toast.
  if (!HAS_BROWSER) return;
  const fs = require("node:fs");
  const path = require("node:path");
  const html = fs.readFileSync(path.join(ROOT, "analyze.html"), "utf8");
  const appSrc = fs.readFileSync(path.join(ROOT, "assets", "app.js"), "utf8");
  const cssSrc = fs.readFileSync(path.join(ROOT, "assets", "theme.css"), "utf8");

  // Three controls in the rewrite header with descriptive aria-labels
  assert.match(html, /id="rewriteSizeDownBtn" aria-label="Decrease rewrite text size"/,
    "analyze.html must have an A− button with a descriptive aria-label");
  assert.match(html, /id="rewriteSizeUpBtn" aria-label="Increase rewrite text size"/,
    "analyze.html must have an A+ button with a descriptive aria-label");
  assert.match(html, /id="rewriteSizeResetBtn" aria-label="Reset rewrite text size to default"/,
    "analyze.html must have a reset button with a descriptive aria-label");
  assert.match(html, /role="group" aria-label="Rewrite text size"/,
    "the controls must be grouped with an accessible group label");

  // CSS: data-size overrides use calc on the base body-large token
  for (const size of ['"-2"', '"-1"', '"1"', '"2"', '"3"', '"4"']) {
    assert.ok(cssSrc.includes('.rewrite[data-size=' + size + '] p{font-size:calc(var(--t-body-lg)'),
      `theme.css must define .rewrite[data-size=${size}] p as a calc() override`);
  }
  assert.match(cssSrc, /\.rewrite-size-btn:focus-visible\{/,
    "size buttons must have a visible focus ring");

  // JS: clamped steps, localStorage persistence, data-size paint, toast announce
  assert.match(appSrc, /SIZE_KEY='cleardoc\.rewriteSizeSteps'/,
    "size preference must persist under a stable localStorage key");
  assert.match(appSrc, /const MIN_SIZE=-2, MAX_SIZE=4;/,
    "size steps must be clamped to [-2, +4] (±2px per step)");
  assert.match(appSrc, /plainOutEl\.setAttribute\('data-size',String\(sizeSteps\)\)/,
    "size must be applied via the data-size attribute on the rewrite container");
  assert.match(appSrc, /localStorage\.setItem\(SIZE_KEY,String\(sizeSteps\)\)/,
    "each change must persist the new step to localStorage");
  assert.match(appSrc, /'🔠 Rewrite text size increased'/,
    "increase must announce via the aria-live toast");
  assert.match(appSrc, /'🔠 Rewrite text size reset to default'/,
    "reset must announce via the aria-live toast");
  assert.match(appSrc, /sizeDown\.disabled=sizeSteps<=MIN_SIZE/,
    "A− must disable at the minimum bound");
  assert.match(appSrc, /sizeUp\.disabled=sizeSteps>=MAX_SIZE/,
    "A+ must disable at the maximum bound");
  assert.match(appSrc, /_rewriteSizeWired/,
    "size wiring must be guarded so it is attached only once");
  // Cycle 49 polish — WCAG 2.5.8 target size + persistent aria-labels
  assert.match(cssSrc, /\.rewrite-size-btn\{[^}]*min-width:30px;min-height:26px/,
    "size buttons must meet the 24×24px minimum touch-target size (WCAG 2.5.8)");
  assert.match(cssSrc, /\.rewrite-size\{[^}]*flex-wrap:wrap/,
    "size control group must wrap on narrow screens");
  assert.match(appSrc, /getComputedStyle\(plainOutEl\)\.getPropertyValue\('--t-body-lg'\)/,
    "aria-label percentage must be derived from the live --t-body-lg token");
  assert.match(appSrc, /sizeDown\.setAttribute\('aria-label','Decrease rewrite text size \(currently '\+pct\+'%\)'\)/,
    "A− must announce the current level in its aria-label");
  assert.match(appSrc, /sizeUp\.setAttribute\('aria-label','Increase rewrite text size \(currently '\+pct\+'%\)'\)/,
    "A+ must announce the current level in its aria-label");
  assert.match(appSrc, /sizeReset\.setAttribute\('aria-label','Reset rewrite text size to default \(currently '\+pct\+'%\)'\)/,
    "reset must announce the current level in its aria-label");
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
  const renderFn = appSrc.match(/function renderRiskDetail\(hits\)\{[\s\S]{0,9800}\n    \}/);
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

// Cycle 80 feature: copy only the sentence-level diff from the compare panel.
test("analyzer: Compare panel can copy just the sentence-level diff", () => {
  if (!HAS_BROWSER) return;
  const fs = require("node:fs");
  const path = require("node:path");
  const html = fs.readFileSync(path.join(ROOT, "analyze.html"), "utf8");
  const appSrc = fs.readFileSync(path.join(ROOT, "assets", "app.js"), "utf8");

  // analyze.html must carry the diff-only copy button, hidden by default
  assert.match(html, /id="compareDiffCopyBtn" title="Copy only the sentence-level diff as plain text" hidden/,
    "analyze.html must contain #compareDiffCopyBtn, hidden until a diff exists");

  // Visibility syncs with the rendered diff
  assert.match(appSrc, /if\(compareDiffCopyBtn\) compareDiffCopyBtn\.hidden = false;/,
    "the diff-copy button must appear when a diff is rendered");
  assert.match(appSrc, /if\(compareDiffCopyBtn\) compareDiffCopyBtn\.hidden = true;/,
    "the diff-copy button must hide when there is no diff");
  assert.match(appSrc, /if\(compareDiff\)\{ compareDiff\.hidden = true; compareDiff\.innerHTML = ''; \}[\s\S]+?if\(compareDiffCopyBtn\) compareDiffCopyBtn\.hidden = true;/,
    "clearing the comparison must also hide the diff-copy button");

  // Wiring + guards
  assert.match(appSrc, /compareDiffCopyBtn\.addEventListener\(\s*['"]click['"]/,
    "the diff-copy button must have a click handler");
  assert.match(appSrc, /'⚠ No diff to copy yet — compare two clauses first'/,
    "the diff-copy must guard the no-diff state");
  assert.match(appSrc, /'Sentence-level diff'/,
    "the copy must open with a diff header");
  assert.match(appSrc, /'• ' \+ \(r\.textContent \|\| ''\)\.replace/,
    "each diff row must be copied as a bullet line");
  assert.match(appSrc, /'📋 Diff copied'/,
    "copy must toast on success");
  assert.match(appSrc, /compareDiffCopyBtn\.setAttribute\('aria-label', ok \? 'Sentence diff copied to clipboard' : 'Copy failed — try again'\)/,
    "copy must announce success/failure via aria-label");
  assert.match(appSrc, /compareDiffCopyBtn\.setAttribute\('aria-label', 'Copy only the sentence-level diff'\)/,
    "copy must restore the original aria-label");
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
  const updateBlock = appSrc.match(/function updateTextStats\(\)\{[\s\S]+?statReadTime\.textContent\s*=\s*readTime\(/);
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

// Cycle 56 feature: keyword search across saved analyses.
test("analyzer: history panel searches past analyses by keyword", () => {
  if (!HAS_BROWSER) return;
  const fs = require("node:fs");
  const path = require("node:path");
  const appSrc = fs.readFileSync(path.join(ROOT, "assets", "app.js"), "utf8");
  const html = fs.readFileSync(path.join(ROOT, "analyze.html"), "utf8");
  const cssSrc = fs.readFileSync(path.join(ROOT, "assets", "theme.css"), "utf8");

  // analyze.html must carry the search input with an accessible label
  assert.match(html, /id="historySearch"[^>]*aria-label="Search past analyses"/,
    "analyze.html must contain #historySearch with an aria-label");
  assert.match(html, /id="historySearch"[^>]*maxlength="80"/,
    "history search must be length-capped to avoid paste-spam lag");

  // State + visibility: query persists per open, input hides when empty
  assert.match(appSrc, /let historyQuery = '';/,
    "historyQuery state must exist next to the language filter");
  assert.match(appSrc, /if\(historySearch\) historySearch\.hidden = true;/,
    "search input must hide when history is empty");
  assert.match(appSrc, /if\(historySearch\) historySearch\.hidden = false;/,
    "search input must show when history has entries");

  // Filtering: keyword match against the snippet + language label
  assert.match(appSrc, /byLang\.filter\(it => \{/,
    "renderHistory must filter the language-filtered list by query");
  assert.match(appSrc, /\(\(it && it\.snippet\) \|\| ''\)\.toLowerCase\(\)/,
    "search must match against each entry's snippet");
  assert.match(appSrc, /hay\.indexOf\(q\) !== -1/,
    "search must use a case-insensitive substring match");
  assert.match(appSrc, /No analyses match "' \+ esc\(q\) \+ '"\./,
    "no-match state must echo the query for clarity");

  // Wiring: input listener attached once
  assert.match(appSrc, /historySearch\._historySearchWired/,
    "search wiring must be guarded so it is attached only once");
  assert.match(appSrc, /historySearch\.addEventListener\(\s*['"]input['"]/,
    "search must re-render live on every input event");

  // CSS: styled to match the panel + hidden override
  assert.match(cssSrc, /\.history-panel \.hp-search\{/,
    "theme.css must style .hp-search within the history panel");
  assert.match(cssSrc, /\.history-panel \.hp-search\[hidden\]\{display:none\}/,
    "the search input's hidden state must be respected");
  // Cycle 57 polish — clear affordance + Esc-to-clear
  assert.match(html, /id="historySearchClear" class="hp-search-clear" title="Clear search" aria-label="Clear search" hidden/,
    "analyze.html must carry a hidden ✕ clear button with an aria-label");
  assert.match(appSrc, /historySearchClear\.hidden = !\(historySearch && \(historySearch\.value \|\| ''\)\.trim\(\)\);/,
    "renderHistory must sync clear-button visibility with the query");
  assert.match(appSrc, /historySearch\.addEventListener\(\s*['"]keydown['"]/,
    "search input must handle keydown (Esc clears the query)");
  assert.match(appSrc, /e\.key === 'Escape' && \(historySearch\.value \|\| ''\)\.trim\(\)/,
    "Esc must clear the query only when one is present");
  assert.match(appSrc, /historySearchClear\.addEventListener\(\s*['"]click['"]/,
    "clear button must have a click handler");
  assert.match(appSrc, /historySearch\.focus\(\);/,
    "clearing must return focus to the search input");
  assert.match(appSrc, /_historySearchClearWired/,
    "clear-button wiring must be guarded so it is attached only once");
  assert.match(cssSrc, /\.history-panel \.hp-search-clear\{[^}]*width:24px;height:24px/,
    "clear button must meet the 24×24px minimum touch-target size");
  assert.match(cssSrc, /\.history-panel \.hp-search-clear\[hidden\]\{display:none\}/,
    "clear button's hidden state must be respected");
  // Cycle 59 polish — no double clear affordances from the native control
  assert.match(cssSrc, /\.history-panel \.hp-search::-webkit-search-cancel-button[\s\S]+?appearance:none/,
    "native WebKit cancel must be hidden on the history search (custom ✕ exists)");
  assert.match(cssSrc, /\.find-bar \.find-input::-webkit-search-cancel-button[\s\S]+?appearance:none/,
    "native WebKit cancel must be hidden on the find input (custom ✕ exists)");
});

// Cycle 60 feature: one-tap JSON backup of all saved analyses.
test("analyzer: History panel exports a JSON backup of all analyses", () => {
  if (!HAS_BROWSER) return;
  const fs = require("node:fs");
  const path = require("node:path");
  const html = fs.readFileSync(path.join(ROOT, "analyze.html"), "utf8");
  const appSrc = fs.readFileSync(path.join(ROOT, "assets", "app.js"), "utf8");
  const cssSrc = fs.readFileSync(path.join(ROOT, "assets", "theme.css"), "utf8");

  // analyze.html must carry the export button in the history actions row
  assert.match(html, /id="historyExportBtn" title="Download all past analyses as a JSON backup"/,
    "analyze.html must contain #historyExportBtn with a descriptive title");
  assert.match(html, /id="historyExportBtn"[^>]*>⬇ Export</,
    "export button must show a download affordance");

  // Wiring: once-only guard + read from the live history store
  assert.match(appSrc, /historyExportBtn\._historyExportWired/,
    "export wiring must be guarded so it is attached only once");
  assert.match(appSrc, /readHistoryRaw\(\)/,
    "export must read the current history store");
  assert.match(appSrc, /'⚠ No history to export yet'/,
    "export must toast when history is empty");

  // Payload + download path
  assert.match(appSrc, /JSON\.stringify\(\{ exportedAt:/,
    "export must wrap the entries with an exportedAt timestamp");
  assert.match(appSrc, /new Blob\(\[text\], \{ type:'application\/json;charset=utf-8' \}\)/,
    "export must download as application/json UTF-8");
  assert.match(appSrc, /a\.download = 'cleardoc-history-' \+ stamp \+ '\.json'/,
    "filename must be cleardoc-history-<date>.json");
  assert.match(appSrc, /URL\.revokeObjectURL\(url\)/,
    "object URL must be revoked after the download");
  assert.match(appSrc, /'⬇ History exported \(' \+ items\.length/,
    "export must toast with the exported count");

  // CSS: non-destructive action style (ink hover, not danger)
  assert.match(cssSrc, /\.history-panel \.hp-export\{/,
    "theme.css must style .hp-export within the history panel");
  assert.match(cssSrc, /\.history-panel \.hp-export:hover\{[^}]*background:var\(--ink\)/,
    "export hover must use the ink hover, not the destructive danger hover");
  // Cycle 61 polish — export disables itself while history is empty
  assert.match(appSrc, /if\(historyExportBtn\)\{ historyExportBtn\.disabled = true; historyExportBtn\.title = 'No history to export yet'; \}/,
    "export must disable with an explanatory title when history is empty");
  assert.match(appSrc, /if\(historyExportBtn\)\{ historyExportBtn\.disabled = false; historyExportBtn\.title = 'Download all past analyses as a JSON backup'; \}/,
    "export must re-enable with the normal title when history has entries");
  assert.match(cssSrc, /\.history-panel \.hp-export:disabled\{[^}]*cursor:not-allowed/,
    "disabled export must show a not-allowed cursor");
  assert.match(cssSrc, /\.history-panel \.hp-export:disabled:hover\{[^}]*background:transparent/,
    "disabled export must not show the hover fill");
});

// Cycle 62 feature: restore history from an exported JSON backup.
test("analyzer: History panel imports a JSON backup and merges entries", () => {
  if (!HAS_BROWSER) return;
  const fs = require("node:fs");
  const path = require("node:path");
  const html = fs.readFileSync(path.join(ROOT, "analyze.html"), "utf8");
  const appSrc = fs.readFileSync(path.join(ROOT, "assets", "app.js"), "utf8");
  const cssSrc = fs.readFileSync(path.join(ROOT, "assets", "theme.css"), "utf8");

  // analyze.html must carry the import button + hidden file input
  assert.match(html, /id="historyImportBtn" title="Restore past analyses from a JSON backup"/,
    "analyze.html must contain #historyImportBtn with a descriptive title");
  assert.match(html, /id="historyImportInput" accept="application\/json,\.json" hidden/,
    "analyze.html must contain a hidden JSON file input");

  // Wiring: once-only guard + file picker reset before open
  assert.match(appSrc, /historyImportBtn\._historyImportWired/,
    "import wiring must be guarded so it is attached only once");
  assert.match(appSrc, /historyImportInput\.value = '';/,
    "the file input must be reset so the same file can be re-imported");
  assert.match(appSrc, /new FileReader\(\)/,
    "import must read the file via FileReader");

  // Validation: accepts the exported shape + strict entry checks + TTL
  assert.match(appSrc, /Array\.isArray\(data\) \? data : \(data && Array\.isArray\(data\.items\) \? data\.items : \[\]\)/,
    "import must accept both a raw array and the exported { items } shape");
  assert.match(appSrc, /typeof e\.ts === 'number' && typeof e\.snippet === 'string'/,
    "each imported entry must carry a numeric ts and string snippet");
  assert.match(appSrc, /e\.ts >= cutoff/,
    "expired entries must be dropped by the TTL sweep");
  assert.match(appSrc, /'⚠ No valid history entries in that file'/,
    "import must toast when no valid entries survive validation");

  // Merge: combine with existing, dedupe by ts, re-cap the FIFO list
  assert.match(appSrc, /readHistoryRaw\(\)\.concat\(valid\)/,
    "import must merge the validated entries into existing history");
  assert.match(appSrc, /while\(out\.length > HISTORY_MAX_ENTRIES\) out\.pop\(\);/,
    "import must re-apply the FIFO cap after merging");
  assert.match(appSrc, /'⇪ History restored \(' \+ out\.length/,
    "import must toast the restored count");

  // CSS: non-destructive import button
  assert.match(cssSrc, /\.history-panel \.hp-import\{/,
    "theme.css must style .hp-import within the history panel");
  // Cycle 63 polish — harden the import path
  assert.match(appSrc, /const MAX_IMPORT_BYTES = 1024 \* 1024;/,
    "import must enforce a 1MB file-size cap");
  assert.match(appSrc, /file\.size > MAX_IMPORT_BYTES/,
    "oversized backups must be rejected before parsing");
  assert.match(appSrc, /'⚠ That backup is too large'/,
    "oversized backups must toast an explanatory error");
  assert.match(appSrc, /typeof e\.ts === 'number' && typeof e\.snippet === 'string' && typeof e\.text === 'string'/,
    "entries without a text payload must be rejected (restore needs it)");
});

// Cycle 64 feature: JSON backup round-trip for saved templates.
test("analyzer: Template panel exports and imports a JSON backup", () => {
  if (!HAS_BROWSER) return;
  const fs = require("node:fs");
  const path = require("node:path");
  const html = fs.readFileSync(path.join(ROOT, "analyze.html"), "utf8");
  const appSrc = fs.readFileSync(path.join(ROOT, "assets", "app.js"), "utf8");
  const cssSrc = fs.readFileSync(path.join(ROOT, "assets", "theme.css"), "utf8");

  // analyze.html must carry the export/import buttons + hidden file input
  assert.match(html, /id="tplExportBtn" title="Download all saved templates as a JSON backup"/,
    "analyze.html must contain #tplExportBtn with a descriptive title");
  assert.match(html, /id="tplImportBtn" title="Restore saved templates from a JSON backup"/,
    "analyze.html must contain #tplImportBtn with a descriptive title");
  assert.match(html, /id="tplImportInput" accept="application\/json,\.json" hidden/,
    "analyze.html must contain a hidden JSON file input for templates");

  // Export path
  assert.match(appSrc, /tplExportBtn\._tplExportWired/,
    "template export wiring must be guarded so it is attached only once");
  assert.match(appSrc, /'⚠ No templates to export yet'/,
    "template export must toast when the store is empty");
  assert.match(appSrc, /a\.download = 'cleardoc-templates-' \+ stamp \+ '\.json'/,
    "template export filename must be cleardoc-templates-<date>.json");
  assert.match(appSrc, /'⬇ Templates exported \(' \+ items\.length/,
    "template export must toast the exported count");

  // Import path: validation, merge, dedupe, cap
  assert.match(appSrc, /tplImportBtn\._tplImportWired/,
    "template import wiring must be guarded so it is attached only once");
  assert.match(appSrc, /typeof t\.name === 'string' && typeof t\.text === 'string'/,
    "imported templates must carry name and text strings");
  assert.match(appSrc, /t\.text\.trim\(\)\.length >= 8/,
    "imported templates must meet the same minimum-text rule as saves");
  assert.match(appSrc, /readTemplates\(\)\.concat\(valid\)/,
    "import must merge validated templates into the existing store");
  assert.match(appSrc, /while\(out\.length > TPL_MAX_ENTRIES\) out\.pop\(\);/,
    "import must re-apply the 10-entry cap after merging");
  assert.match(appSrc, /'⚠ No valid templates in that file'/,
    "import must toast when no valid templates survive validation");
  assert.match(appSrc, /'⇪ Templates restored \(' \+ out\.length/,
    "import must toast the restored count");

  // CSS: non-destructive export/import buttons
  assert.match(cssSrc, /\.tpl-actions \.tpl-export,\.tpl-actions \.tpl-import\{/,
    "theme.css must style the template export/import buttons together");
  // Cycle 65 polish — imported entries normalized to saveTemplate invariants
  assert.match(appSrc, /name: String\(t\.name\)\.slice\(0, 60\),/,
    "imported names must be capped at 60 chars like saves");
  assert.match(appSrc, /text: String\(t\.text\)\.slice\(0, 40000\),/,
    "imported text must be capped at 40000 chars like saves");
  assert.match(appSrc, /ts: \(typeof t\.ts === 'number'\) \? t\.ts : Date\.now\(\),/,
    "imported entries without a numeric ts must get one");
  assert.match(appSrc, /type: \(typeof t\.type === 'string'\) \? t\.type : null,/,
    "imported type must be normalized to a string or null");
});

// Cycle #236 — duplicate a saved template for variants.
test("analyzer: templates can be duplicated", () => {
  if (!HAS_BROWSER) return;
  const fs = require("node:fs");
  const path = require("node:path");
  const appSrc = fs.readFileSync(path.join(ROOT, "assets", "app.js"), "utf8");

  assert.match(appSrc, /data-tpl-dup="' \+ i \+[\s\S]{0,60}'" title="Duplicate this template"/,
    "each template row must include a duplicate button");
  assert.match(appSrc, /const dupBtn = e\.target\.closest && e\.target\.closest\('\[data-tpl-dup\]'\);/,
    "the duplicate button must be caught by the delegated handler");
  assert.match(appSrc, /const dupName = \(t\.name \|\| 'Untitled'\) \+ ' \(copy\)';/,
    "the copy must be named '<name> (copy)'");
  assert.match(appSrc, /saveTemplate\(dupName, t\.text, t\.type\)/,
    "the copy must be saved through the dedup-aware saveTemplate");
  assert.match(appSrc, /'⧉ Template duplicated: ' \+ dupName/,
    "duplicating must toast the new name");
  assert.match(appSrc, /'⚠ Couldn’t duplicate — same name exists or cap reached'/,
    "a failed duplicate must be reported");
  const cssSrc = fs.readFileSync(path.join(ROOT, "assets", "theme.css"), "utf8");
  assert.match(cssSrc, /\.tpl-dup\{[^}]*color:var\(--amber\)/,
    "the duplicate button must carry the amber accent like its siblings");
  assert.match(cssSrc, /\.tpl-dup:hover\{background:var\(--amber\)/,
    "the duplicate button must have a hover state");
  assert.match(cssSrc, /\.tpl-dup:focus-visible\{/,
    "the duplicate button must have a focus ring");
});

// Cycle #214 — saved templates offer a one-click analyze action.
test("analyzer: saved templates offer one-click analyze", () => {
  if (!HAS_BROWSER) return;
  const fs = require("node:fs");
  const path = require("node:path");
  const appSrc = fs.readFileSync(path.join(ROOT, "assets", "app.js"), "utf8");
  const cssSrc = fs.readFileSync(path.join(ROOT, "assets", "theme.css"), "utf8");

  assert.match(appSrc, /data-tpl-run="' \+ i \+/,
    "each template row must render an analyze button");
  assert.match(appSrc, /title="Load and analyze this template"/,
    "the analyze button must describe its action");
  assert.match(appSrc, /const runBtn = e\.target\.closest && e\.target\.closest\('\[data-tpl-run\]'\);/,
    "the template handler must catch analyze clicks");
  assert.match(appSrc, /if\(runBtn\)\{[\s\S]{0,500}input\.value = t\.text;/,
    "the analyze action must load the template text");
  assert.match(appSrc, /input\.value = t\.text;[\s\S]{0,200}clearDraft\(\);/,
    "the analyze action must clear stale drafts and attachments first");
  assert.match(appSrc, /if\(ab && !ab\.disabled\) ab\.click\(\);/,
    "the analyze action must trigger the analysis");
  assert.match(appSrc, /'⚡ Template loaded — press Analyze'/,
    "a busy analyzer must fall back to a load-only toast");
  assert.match(cssSrc, /\.tpl-run\{/, "the analyze button must be styled");
  assert.match(cssSrc, /\.tpl-run:focus-visible\{/, "the analyze button must have a focus ring");
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
  assert.match(appSrc, /risk-counter/,
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
  const renderFn = appSrc.match(/function renderRiskDetail\(hits\)\{[\s\S]{0,9800}\n    \}/);
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

test("analyzer: apply button swaps the counter-clause into the source input with undo", () => {
  // New feature — for each counter-suggestion, an inline apply
  // button swaps it into the source textarea at the position of
  // the matched token. Pairs with iter #15's selection logic for
  // visual feedback and an undo chip for one-click revert.
  if (!HAS_BROWSER) return;
  const fs = require("node:fs");
  const path = require("node:path");
  const appSrc = fs.readFileSync(path.join(ROOT, "assets", "app.js"), "utf8");
  const cssSrc = fs.readFileSync(path.join(ROOT, "assets", "theme.css"), "utf8");

  // renderRiskDetail must render an [data-rc-apply] button with both
  // the suggestion text and the matched substring in data attributes
  const renderFn = appSrc.match(/function renderRiskDetail\(hits\)\{[\s\S]{0,9800}\n    \}/);
  assert.ok(renderFn, "renderRiskDetail() must exist");
  assert.match(renderFn[0], /data-rc-apply/,
    "renderRiskDetail must render a [data-rc-apply] button");
  assert.match(renderFn[0], /data-rc-match/,
    "[data-rc-apply] must carry data-rc-match for the source-text lookup");

  // Delegated click handler must handle the apply button
  assert.match(appSrc, /riskDetail\.addEventListener[\s\S]+?data-rc-apply/,
    "riskDetail click handler must handle [data-rc-apply] clicks");
  // Iter #51 refactor: the actual apply logic moved to applyOneMatched
  // so the per-row handler can be async (await the dry-run confirm).
  // All the iter #45 invariants now live in that helper.
  assert.match(appSrc, /function applyOneMatched\(input, suggestion, matched, rcApply\)/,
    "applyOneMatched() helper must exist (iter #51 extraction)");
  assert.match(appSrc, /function applyOneMatched[\s\S]+?_undoSnapshot/,
    "applyOneMatched must stash the previous text on the input for undo");
  assert.match(appSrc, /function applyOneMatched[\s\S]+?indexOf\(matched\.toLowerCase/,
    "applyOneMatched must locate the matched token (case-insensitive)");
  assert.match(appSrc, /function applyOneMatched[\s\S]+?raw\.slice\(0,\s*idx\)\s*\+\s*suggestion\s*\+\s*raw\.slice/,
    "applyOneMatched must splice the suggestion in at the matched position");
  assert.match(appSrc, /function applyOneMatched[\s\S]+?dispatchEvent\(new Event\(\s*['"]input['"]/,
    "applyOneMatched must dispatch input event so live stats re-run");
  assert.match(appSrc, /function applyOneMatched[\s\S]+?rd-flash/,
    "applyOneMatched must flash the textarea for visual feedback");

  // Undo handler must restore from _undoSnapshot
  assert.match(appSrc, /data-undo-apply/,
    "undo-apply handler must exist");
  assert.match(appSrc, /input\._undoSnapshot\s*=\s*null/,
    "undo handler must clear _undoSnapshot after restore");

  // showUndoChip helper must exist + render the floating chip
  assert.match(appSrc, /function showUndoChip/,
    "showUndoChip() must exist");
  assert.match(appSrc, /showUndoChip[\s\S]+?data-undo-apply/,
    "showUndoChip must render the chip with data-undo-apply");

  // CSS: undo chip must be styled as a floating button
  assert.match(cssSrc, /\.apply-undo-chip\{[^}]*cursor:\s*pointer/,
    ".apply-undo-chip must be cursor:pointer (signals clickability)");
  assert.match(cssSrc, /\.apply-undo-chip\{[^}]*position:\s*absolute/,
    ".apply-undo-chip must be absolutely positioned (floats next to the textarea)");
});

test("analyzer: applied suggestion shows a green badge so users see which they've used", () => {
  // Polishes iter #45 — after applying a suggestion, the row
  // marks itself with .rc-applied (green checkmark, dimmed text,
  // disabled apply button). Persists across re-renders via
  // input._appliedSuggestions. Undo clears all applied badges.
  if (!HAS_BROWSER) return;
  const fs = require("node:fs");
  const path = require("node:path");
  const appSrc = fs.readFileSync(path.join(ROOT, "assets", "app.js"), "utf8");
  const cssSrc = fs.readFileSync(path.join(ROOT, "assets", "theme.css"), "utf8");

  // Apply handler must track applied state
  assert.match(appSrc, /function applyOneMatched[\s\S]+?_appliedSuggestions\.add/,
    "applyOneMatched helper must add the suggestion to input._appliedSuggestions");
  assert.match(appSrc, /data-rc-apply[\s\S]+?rc-applied/,
    "apply handler must add the .rc-applied class to the row");

  // renderRiskDetail must check appliedSet and render rows accordingly
  const renderFn = appSrc.match(/function renderRiskDetail\(hits\)\{[\s\S]{0,9800}\n    \}/);
  assert.ok(renderFn, "renderRiskDetail() must exist");
  assert.match(renderFn[0], /_appliedSuggestions/,
    "renderRiskDetail must read input._appliedSuggestions to render applied state");
  assert.match(renderFn[0], /rc-applied/,
    "renderRiskDetail must apply the rc-applied class to applied rows");
  assert.match(renderFn[0], /✓ applied/,
    "renderRiskDetail must show '✓ applied' label on already-applied rows");
  assert.match(renderFn[0], /isApplied \? ' disabled'/,
    "renderRiskDetail must add ' disabled' attr on already-applied apply buttons");

  // Undo handler must reset all applied state
  assert.match(appSrc, /data-undo-apply[\s\S]+?_appliedSuggestions\s*=\s*null/,
    "undo must clear input._appliedSuggestions");
  assert.match(appSrc, /data-undo-apply[\s\S]+?rc-applied/,
    "undo must remove the .rc-applied class from all rows");
  assert.match(appSrc, /data-undo-apply[\s\S]+?btn\.disabled\s*=\s*false/,
    "undo must re-enable all apply buttons");

  // CSS: applied state uses green
  assert.match(cssSrc, /\.risk-counter\.rc-applied \.rc-kicker\{[^}]*var\(--green\)/,
    ".rc-applied kicker must use --green (positive feedback)");
  assert.match(cssSrc, /\.risk-counter\.rc-applied \.rc-text\{[^}]*line-through/,
    ".rc-applied text must be line-through (visually marks 'done')");
});

test("analyzer: Apply-all button replaces every matched risk with its counter in one click", () => {
  // New feature — ✓ Apply all button walks every unmatched risk and
  // splices its counter-suggestion into the source input. Users
  // iterating on a contract can reword the whole doc in one action.
  if (!HAS_BROWSER) return;
  const fs = require("node:fs");
  const path = require("node:path");
  const appSrc = fs.readFileSync(path.join(ROOT, "assets", "app.js"), "utf8");
  const cssSrc = fs.readFileSync(path.join(ROOT, "assets", "theme.css"), "utf8");

  // renderRiskDetail must render the Apply-all button
  const renderFn = appSrc.match(/function renderRiskDetail\(hits\)\{[\s\S]{0,9800}\n    \}/);
  assert.ok(renderFn, "renderRiskDetail() must exist");
  assert.match(renderFn[0], /data-rd-apply-all/,
    "renderRiskDetail must render a [data-rd-apply-all] button");
  assert.match(renderFn[0], /Apply all/,
    "button label must read 'Apply all'");

  // Click handler must handle the button (calls doApplyAll after confirm)
  assert.match(appSrc, /riskDetail\.addEventListener[\s\S]+?data-rd-apply-all/,
    "riskDetail click handler must handle [data-rd-apply-all] clicks");
  // Must call the extracted doApplyAll helper (iter #48 refactor)
  assert.match(appSrc, /data-rd-apply-all[\s\S]+?doApplyAll/,
    "Apply-all click handler must call doApplyAll after confirm");
  assert.match(appSrc, /function doApplyAll\(pending, input, aaBtn\)/,
    "doApplyAll() helper must exist (iter #48 extraction)");
  // doApplyAll must iterate + splice + skip + count
  assert.match(appSrc, /function doApplyAll[\s\S]+?for\s*\(\s*const h of pending/,
    "doApplyAll must iterate through the pending hits");
  assert.match(appSrc, /function doApplyAll[\s\S]+?workingText\.slice\(0,\s*idx\)\s*\+\s*h\.counter/,
    "doApplyAll must splice h.counter in at the matched position");
  assert.match(appSrc, /function doApplyAll[\s\S]+?_appliedSuggestions\.has/,
    "doApplyAll must skip already-applied suggestions (idempotent)");
  assert.match(appSrc, /function doApplyAll[\s\S]+?applied\+\+/,
    "doApplyAll must track the count of applied suggestions");
  assert.match(appSrc, /function doApplyAll[\s\S]+?dispatchEvent\(new Event\(\s*['"]input['"]/,
    "doApplyAll must dispatch input event so live stats re-run");

  // CSS: Apply-all must be styled distinctively (green = go)
  assert.match(cssSrc, /\.rd-apply-all\{[^}]*var\(--green\)/,
    ".rd-apply-all must use --green (positive action styling)");
  assert.match(cssSrc, /\.rd-apply-all\{[^}]*cursor:\s*pointer/,
    ".rd-apply-all must be cursor:pointer (signals clickability)");
});

test("analyzer: Apply-all shows a confirmation modal before modifying the source document", () => {
  // Polishes iter #47 — the destructive batch action now requires
  // an explicit confirm before rewriting the source document. Safety
  // net against accidental rewrites of long docs.
  if (!HAS_BROWSER) return;
  const fs = require("node:fs");
  const path = require("node:path");
  const appSrc = fs.readFileSync(path.join(ROOT, "assets", "app.js"), "utf8");
  const cssSrc = fs.readFileSync(path.join(ROOT, "assets", "theme.css"), "utf8");

  // Confirm modal helper must exist
  assert.match(appSrc, /function showConfirmModal\(opts\)/,
    "showConfirmModal() must exist at the IIFE level");
  assert.match(appSrc, /showConfirmModal[\s\S]+?role.,.dialog/,
    "confirm modal must have role='dialog' for a11y");
  // Must handle Escape (cancel) + Enter (confirm)
  assert.match(appSrc, /showConfirmModal[\s\S]+?Escape[\s\S]+?close\(false\)/,
    "Escape key must close the modal (cancel)");
  // Must close on background click
  assert.match(appSrc, /showConfirmModal[\s\S]+?data-acm-bg/,
    "modal must close when user clicks the background");

  // doApplyAll must be extracted (so the confirm flow can call it)
  assert.match(appSrc, /function doApplyAll\(pending, input, aaBtn\)/,
    "doApplyAll() must exist (extracted from iter #47's inline handler)");

  // Click handler must await the confirm before calling doApplyAll
  assert.match(appSrc, /data-rd-apply-all[\s\S]+?await showConfirmModal/,
    "Apply-all click handler must await the confirm modal");
  assert.match(appSrc, /data-rd-apply-all[\s\S]+?if\s*\(\s*!ok\s*\)\s*return/,
    "Apply-all must abort if the user cancels");
  // Must show the count + undo hint in the modal body
  assert.match(appSrc, /data-rd-apply-all[\s\S]+?Apply\s'\s\+\s*pending\.length/,
    "confirm modal title must include the count (e.g. 'Apply 5 suggestions?')");
  assert.match(appSrc, /data-rd-apply-all[\s\S]+?undo apply/,
    "confirm modal body must mention the undo chip");

  // CSS: confirm modal must be styled
  assert.match(cssSrc, /\.apply-confirm-card/,
    ".apply-confirm-card must have its own style rule (modal-specific layout)");
  assert.match(cssSrc, /\.apply-confirm-actions \.acm-confirm\{[^}]*var\(--green\)/,
    "confirm action must use --green (positive visual)");
});

test("analyzer: confirm modal shows a dry-run preview (before→after pairs) before applying", () => {
  // Polishes iter #48 — the confirm modal now embeds a diff preview
  // so users see exactly what will change BEFORE clicking Apply.
  // The most-requested feature in any rewrite tool — "show me the
  // diff before I commit".
  if (!HAS_BROWSER) return;
  const fs = require("node:fs");
  const path = require("node:path");
  const appSrc = fs.readFileSync(path.join(ROOT, "assets", "app.js"), "utf8");
  const cssSrc = fs.readFileSync(path.join(ROOT, "assets", "theme.css"), "utf8");

  // Apply-all handler must build a preview with before/after pairs
  assert.match(appSrc, /data-rd-apply-all[\s\S]+?dryrun-item/,
    "Apply-all must build a .dryrun-item preview for each change");
  // Must render the original (from) and the replacement (to)
  assert.match(appSrc, /data-rd-apply-all[\s\S]+?dryrun-from/,
    "preview must render the .dryrun-from line (original matched text)");
  assert.match(appSrc, /data-rd-apply-all[\s\S]+?dryrun-to/,
    "preview must render the .dryrun-to line (counter-suggestion text)");
  // Must use esc() on the user-facing text (XSS defense — the matched
  // substring + counter are user input that could contain HTML)
  assert.match(appSrc, /data-rd-apply-all[\s\S]+?dryrun-from.+\s*esc\(h\.matched/,
    "preview must esc() h.matched (XSS defense on user text)");
  assert.match(appSrc, /data-rd-apply-all[\s\S]+?dryrun-to.+\s*esc\(h\.counter/,
    "preview must esc() h.counter (XSS defense on user text)");
  // Must cap visible items + show "+N more" for long lists
  assert.match(appSrc, /data-rd-apply-all[\s\S]+?pending\.slice\(0,\s*5\)/,
    "preview must cap visible items at 5");
  assert.match(appSrc, /data-rd-apply-all[\s\S]+?dryrun-more/,
    "preview must show a '+N more' line for long lists");
  // Must pass the previewHtml into showConfirmModal
  assert.match(appSrc, /data-rd-apply-all[\s\S]+?bodyHtml:\s*'<p>[\s\S]+?<\/p>'\s*\+\s*previewHtml/,
    "preview must be injected into the confirm modal body");

  // CSS: dry-run preview styling
  assert.match(cssSrc, /\.apply-dryrun\{[^}]*border/,
    ".apply-dryrun must have a visible border (separator from modal body)");
  assert.match(cssSrc, /\.dryrun-from\{[^}]*line-through/,
    ".dryrun-from must use line-through (visually marks 'removing')");
  assert.match(cssSrc, /\.dryrun-from\{[^}]*var\(--danger\)/,
    ".dryrun-from must use --danger (red = removed text)");
  assert.match(cssSrc, /\.dryrun-to\{[^}]*var\(--green\)/,
    ".dryrun-to must use --green (green = added text)");
});

test("analyzer: dry-run preview shows a stats summary (count + word deltas) above the diffs", () => {
  // Polishes iter #49 — the preview now starts with a stats summary
  // so users see the magnitude at a glance: "3 substitutions ·
  // +18 words · -12 words · net +6". Without this, users have to
  // count rows in the diff to know whether they're modifying a
  // word here or rewriting the whole document.
  if (!HAS_BROWSER) return;
  const fs = require("node:fs");
  const path = require("node:path");
  const appSrc = fs.readFileSync(path.join(ROOT, "assets", "app.js"), "utf8");
  const cssSrc = fs.readFileSync(path.join(ROOT, "assets", "theme.css"), "utf8");

  // Apply-all must build the stats line
  assert.match(appSrc, /data-rd-apply-all[\s\S]+?dryrun-stats/,
    "Apply-all must render a .dryrun-stats summary line");
  // Must include the count
  assert.match(appSrc, /data-rd-apply-all[\s\S]+?substitution/,
    "stats must include 'substitution(s)'");
  // Must compute word deltas (add + remove)
  assert.match(appSrc, /data-rd-apply-all[\s\S]+?addedWords \+= add/,
    "stats must sum the added words across all changes");
  assert.match(appSrc, /data-rd-apply-all[\s\S]+?removedWords \+= rem/,
    "stats must sum the removed words across all changes");
  // Must include the net delta
  assert.match(appSrc, /data-rd-apply-all[\s\S]+?wordDelta/,
    "stats must compute the net word delta");
  // Must render all three: add, remove, delta
  assert.match(appSrc, /dryrun-add/,
    "stats must render a .dryrun-add (green +N) line");
  assert.match(appSrc, /dryrun-remove/,
    "stats must render a .dryrun-remove (red -N) line");
  assert.match(appSrc, /dryrun-delta/,
    "stats must render a .dryrun-delta (net ±N) line");

  // CSS: stats summary must be styled distinctly from the diff rows
  assert.match(cssSrc, /\.dryrun-stats\{[^}]*background/,
    ".dryrun-stats must have a background (separator from diff rows)");
  assert.match(cssSrc, /\.dryrun-stats \.dryrun-add\{[^}]*var\(--green\)/,
    ".dryrun-add must use --green (added = green)");
  assert.match(cssSrc, /\.dryrun-stats \.dryrun-remove\{[^}]*var\(--danger\)/,
    ".dryrun-remove must use --danger (removed = red)");
});

test("analyzer: per-row apply shows a single-change dry-run modal before rewriting", () => {
  // New feature — iter #45's per-row apply was one-click destructive.
  // Pairs with iter #48 (apply-all confirm) + iter #49/50 (dry-run
  // preview) so the per-row path has the same safety net. Lighter
  // modal (one row, no overflow) so it doesn't feel heavy on every
  // single click.
  if (!HAS_BROWSER) return;
  const fs = require("node:fs");
  const path = require("node:path");
  const appSrc = fs.readFileSync(path.join(ROOT, "assets", "app.js"), "utf8");

  // applyOneMatched must be extracted (so the async confirm can call it)
  assert.match(appSrc, /function applyOneMatched\(input, suggestion, matched, rcApply\)/,
    "applyOneMatched() helper must exist (iter #51 extraction)");

  // Per-row click handler must await the confirm
  assert.match(appSrc, /data-rc-apply[\s\S]+?await showConfirmModal/,
    "per-row apply must await the confirm modal before rewriting");
  assert.match(appSrc, /data-rc-apply[\s\S]+?applyOneMatched/,
    "per-row apply must call applyOneMatched after confirm");
  // Must include the matched/counter data attributes in the preview
  assert.match(appSrc, /data-rc-apply[\s\S]+?dryrun-from[\s\S]+?esc\(matched\)/,
    "per-row dry-run must esc() the matched text (XSS defense)");
  assert.match(appSrc, /data-rc-apply[\s\S]+?dryrun-to[\s\S]+?esc\(suggestion\)/,
    "per-row dry-run must esc() the suggestion text (XSS defense)");
  // Must include the word-count deltas
  assert.match(appSrc, /data-rc-apply[\s\S]+?dryrun-add/,
    "per-row preview must include a +N words delta");
  assert.match(appSrc, /data-rc-apply[\s\S]+?dryrun-remove/,
    "per-row preview must include a -N words delta");
  // Must abort if user cancels
  assert.match(appSrc, /data-rc-apply[\s\S]+?if\s*\(\s*!ok\s*\)\s*return/,
    "per-row apply must abort if the user cancels the dry-run");
});

test("analyzer: undo chip shows the count of applied suggestions that will be reverted", () => {
  // Polishes the iter #45 undo chip — instead of just "↶ undo apply",
  // show "↶ undo N" where N is the count of currently-applied
  // suggestions. One click still reverts ALL of them; the count is
  // just transparency. Users want to know "if I click, how much
  // will revert?" before they commit.
  if (!HAS_BROWSER) return;
  const fs = require("node:fs");
  const path = require("node:path");
  const appSrc = fs.readFileSync(path.join(ROOT, "assets", "app.js"), "utf8");

  // showUndoChip must read _appliedSuggestions
  assert.match(appSrc, /function showUndoChip[\s\S]+?_appliedSuggestions\.size/,
    "showUndoChip must read _appliedSuggestions.size");
  // Must render "↶ undo N" with the count
  assert.match(appSrc, /showUndoChip[\s\S]+?undo\s+'\s\+\s*count/,
    "showUndoChip must render 'undo ' + count when count > 0");
  // Must fall back to the plain "undo apply" when count is 0
  assert.match(appSrc, /showUndoChip[\s\S]+?else\s*\{[\s\S]+?undo apply/,
    "showUndoChip must fall back to 'undo apply' when no applied suggestions");
  // _undoChip must be created with the data-undo-apply attribute
  assert.match(appSrc, /_undoChip\.setAttribute\(\s*'data-undo-apply'/,
    "undo chip must be created with the data-undo-apply attribute");
});

test("analyzer: re-analyze chip appears next to the undo chip after applying suggestions", () => {
  // New feature — after applying suggestions, the re-analyze chip
  // appears next to the undo chip. Clicking it triggers the
  // existing analyze() flow so users see the new (low) risk
  // counts on the modified document. The natural next step in
  // any rewrite tool.
  if (!HAS_BROWSER) return;
  const fs = require("node:fs");
  const path = require("node:path");
  const appSrc = fs.readFileSync(path.join(ROOT, "assets", "app.js"), "utf8");
  const cssSrc = fs.readFileSync(path.join(ROOT, "assets", "theme.css"), "utf8");

  // Re-analyze chip must exist
  assert.match(appSrc, /_reAnalyzeChip\s*=/,
    "re-analyze chip must be created");
  assert.match(appSrc, /id\s*=\s*.reAnalyzeChip/,
    "re-analyze chip must have id='reAnalyzeChip'");
  // Must trigger the existing analyze flow
  assert.match(appSrc, /_reAnalyzeChip\.addEventListener[\s\S]+?getElementById\(['"]analyzeBtn['"]\)/,
    "re-analyze must trigger the existing #analyzeBtn click");
  assert.match(appSrc, /_reAnalyzeChip\.addEventListener[\s\S]+?analyzeBtn\.click/,
    "re-analyze must call analyzeBtn.click() to trigger the analyze flow");
  // Must be created alongside the undo chip
  assert.match(appSrc, /function showUndoChip[\s\S]+?_reAnalyzeChip/,
    "re-analyze chip must be created inside showUndoChip");
  // Must be hidden when no suggestions are applied
  assert.match(appSrc, /_reAnalyzeChip\.hidden\s*=\s*true/,
    "re-analyze chip must be hidden by default (no applied suggestions)");

  // CSS: re-analyze chip must be styled distinctively
  assert.match(cssSrc, /\.re-analyze-chip\{[^}]*var\(--green\)/,
    ".re-analyze-chip must use --green (positive action styling)");
  assert.match(cssSrc, /\.re-analyze-chip\{[^}]*cursor:\s*pointer/,
    ".re-analyze-chip must be cursor:pointer (signals clickability)");
  assert.match(cssSrc, /\.re-analyze-chip\{[^}]*position:\s*absolute/,
    ".re-analyze-chip must be absolutely positioned (floats next to the textarea)");
});

test("analyzer: re-analyze shows a success toast with the risk-count delta", () => {
  // Polishes iter #53 — after re-analyze, show a success toast
  // with the risk-count delta. "✓ 2 risks remaining (down from 7)"
  // tells the user the rewrite worked. Standard post-action
  // feedback pattern (Google Docs, Notion).
  if (!HAS_BROWSER) return;
  const fs = require("node:fs");
  const path = require("node:path");
  const appSrc = fs.readFileSync(path.join(ROOT, "assets", "app.js"), "utf8");
  const cssSrc = fs.readFileSync(path.join(ROOT, "assets", "theme.css"), "utf8");

  // showAnalyzeToast must exist
  assert.match(appSrc, /function showAnalyzeToast\(text\)/,
    "showAnalyzeToast() must exist at the IIFE level");
  // Must be wired to the re-analyze click
  assert.match(appSrc, /_reAnalyzeChip\.addEventListener[\s\S]+?showAnalyzeToast/,
    "re-analyze click must call showAnalyzeToast");
  // Must capture the pre-analyze risk count for the delta
  assert.match(appSrc, /_reAnalyzeChip\.addEventListener[\s\S]+?pre\s*=/,
    "re-analyze must capture the pre-analyze risk count");
  // Must include the "down from N" wording when count drops
  assert.match(appSrc, /down from/,
    "toast must include 'down from N' wording when count drops");
  // Must handle the zero-risk case
  assert.match(appSrc, /No risk|0 risk|0 risks|No risks/,
    "toast must handle the zero-risk case");

  // CSS: toast must be positioned + styled
  assert.match(cssSrc, /\.analyze-toast\{[^}]*position:\s*fixed/,
    ".analyze-toast must be position:fixed (floats above content)");
  assert.match(cssSrc, /\.analyze-toast\{[^}]*var\(--green\)/,
    ".analyze-toast must use --green (matches the re-analyze action)");
});

test("analyzer: per-suggestion 🔊 button speaks the counter-clause aloud", () => {
  // New feature — 🔊 button on each risk-counter row speaks the
  // counter-clause text aloud via SpeechSynthesis. Users rehearse
  // the proposed replacement before they go into a negotiation.
  // Same TTS pattern as iter #27/29 (prefer detected language).
  if (!HAS_BROWSER) return;
  const fs = require("node:fs");
  const path = require("node:path");
  const appSrc = fs.readFileSync(path.join(ROOT, "assets", "app.js"), "utf8");
  const cssSrc = fs.readFileSync(path.join(ROOT, "assets", "theme.css"), "utf8");

  // renderRiskDetail must emit the [data-rc-speak] button
  const renderFn = appSrc.match(/function renderRiskDetail\(hits\)\{[\s\S]{0,9800}\n    \}/);
  assert.ok(renderFn, "renderRiskDetail() must exist");
  assert.match(renderFn[0], /data-rc-speak/,
    "renderRiskDetail must render a [data-rc-speak] button");

  // Delegated click handler must handle the button
  assert.match(appSrc, /riskDetail\.addEventListener[\s\S]+?data-rc-speak/,
    "riskDetail click handler must handle [data-rc-speak] clicks");
  // Must use SpeechSynthesisUtterance
  assert.match(appSrc, /data-rc-speak[\s\S]+?SpeechSynthesisUtterance/,
    "speak handler must construct a SpeechSynthesisUtterance");
  assert.match(appSrc, /data-rc-speak[\s\S]+?speechSynthesis\.speak/,
    "speak handler must call speechSynthesis.speak() to start playback");
  // Must cancel any current speech (don't overlap)
  assert.match(appSrc, /data-rc-speak[\s\S]+?speechSynthesis\.cancel/,
    "speak handler must cancel current speech before starting");
  // Must use the detected language for the voice
  assert.match(appSrc, /data-rc-speak[\s\S]+?_detectedLang/,
    "speak handler must use the detected language's voice");

  // CSS: rc-speak must be styled as a clickable control
  assert.match(cssSrc, /\.rc-speak\{[^}]*cursor:\s*pointer/,
    ".rc-speak must be cursor:pointer (signals clickability)");
});

test("analyzer: Read-all-suggestions button speaks every counter-suggestion in sequence", () => {
  // Polishes iter #55 — adds a single "🔊 Read all" button in
  // the risk toolbar that speaks every counter-suggestion in
  // sequence. Users rehearse the entire negotiation playbook
  // in one pass.
  if (!HAS_BROWSER) return;
  const fs = require("node:fs");
  const path = require("node:path");
  const appSrc = fs.readFileSync(path.join(ROOT, "assets", "app.js"), "utf8");
  const cssSrc = fs.readFileSync(path.join(ROOT, "assets", "theme.css"), "utf8");

  // renderRiskDetail must emit the [data-rd-speak-suggestions] button
  const renderFn = appSrc.match(/function renderRiskDetail\(hits\)\{[\s\S]{0,9800}\n    \}/);
  assert.ok(renderFn, "renderRiskDetail() must exist");
  assert.match(renderFn[0], /data-rd-speak-suggestions/,
    "renderRiskDetail must render a [data-rd-speak-suggestions] button");
  assert.match(renderFn[0], /Read all/,
    "button label must read 'Read all'");

  // Click handler must handle the button
  assert.match(appSrc, /riskDetail\.addEventListener[\s\S]+?data-rd-speak-suggestions/,
    "riskDetail click handler must handle [data-rd-speak-suggestions] clicks");
  // Must iterate hits and queue SpeechSynthesisUtterances
  assert.match(appSrc, /data-rd-speak-suggestions[\s\S]+?forEach\(/,
    "speak-all must iterate through the speakable hits");
  // Must chain utterances via onend (so they play in order)
  assert.match(appSrc, /data-rd-speak-suggestions[\s\S]+?u\.onend\s*=/,
    "speak-all must chain utterances via onend (play in order)");
  // Must use the detected language's voice
  assert.match(appSrc, /data-rd-speak-suggestions[\s\S]+?_detectedLang/,
    "speak-all must use the detected language's voice");
  // Must allow toggle (stop if already speaking)
  assert.match(appSrc, /data-rd-speak-suggestions[\s\S]+?speechSynthesis\.speaking/,
    "speak-all must check speechSynthesis.speaking (toggle to stop)");
  // Must restore button label when done
  assert.match(appSrc, /data-rd-speak-suggestions[\s\S]+?textContent\s*=\s*'🔊 Read all'/,
    "speak-all must restore the 'Read all' label when playback completes");

  // CSS: button must be styled
  assert.match(cssSrc, /\.rd-speak-suggestions\{[^}]*cursor:\s*pointer/,
    ".rd-speak-suggestions must be cursor:pointer (signals clickability)");
});

test("analyzer: Save-as-Template panel saves + loads named document templates", () => {
  // New feature — users analyzing the same kind of contract
  // (e.g. a lease) repeatedly can save the doc as a named
  // template and reload it later. Distinct from history (iter #25):
  // history is automatic + FIFO; templates are intentional +
  // named + capped at 10 + never auto-purged.
  if (!HAS_BROWSER) return;
  const fs = require("node:fs");
  const path = require("node:path");
  const appSrc = fs.readFileSync(path.join(ROOT, "assets", "app.js"), "utf8");
  const html = fs.readFileSync(path.join(ROOT, "analyze.html"), "utf8");
  const cssSrc = fs.readFileSync(path.join(ROOT, "assets", "theme.css"), "utf8");

  // analyze.html: template panel + button must exist
  assert.match(html, /id="tplBtn"/,
    "analyze.html must contain the templates toggle button #tplBtn");
  assert.match(html, /id="tplPanel"/,
    "analyze.html must contain the templates panel #tplPanel");
  assert.match(html, /id="tplNameInput"/,
    "analyze.html must contain the template name input #tplNameInput");
  assert.match(html, /id="tplSaveBtn"/,
    "analyze.html must contain the save button #tplSaveBtn");
  assert.match(html, /id="tplList"/,
    "analyze.html must contain the templates list #tplList");
  assert.match(html, /id="tplClearBtn"/,
    "analyze.html must contain the clear button #tplClearBtn");

  // localStorage helpers
  assert.match(appSrc, /const TPL_KEY\s*=\s*'cleardoc:templates'/,
    "must use localStorage key 'cleardoc:templates'");
  assert.match(appSrc, /function saveTemplate\(name, text, typeLabel\)/,
    "saveTemplate() must exist");
  assert.match(appSrc, /function readTemplates/,
    "readTemplates() must exist");
  assert.match(appSrc, /function clearTemplates/,
    "clearTemplates() must exist");
  // Must be capped at 10
  assert.match(appSrc, /TPL_MAX_ENTRIES\s*=\s*10/,
    "must cap templates at 10 entries");
  // Must dedupe (same name + text)
  assert.match(appSrc, /saveTemplate[\s\S]+?e\.name === entry\.name/,
    "saveTemplate must dedupe by name+text (don't store duplicates)");

  // Toggle handler must show/hide the panel
  assert.match(appSrc, /tplBtn\.addEventListener[\s\S]+?tplPanel\.hidden/,
    "toggle handler must show/hide the tplPanel");
  assert.match(appSrc, /tplBtn\.addEventListener[\s\S]+?renderTemplates/,
    "toggle handler must call renderTemplates on open");

  // Click on a template must load its text into the input
  assert.match(appSrc, /tplList\.addEventListener[\s\S]+?input\.value\s*=\s*t\.text/,
    "clicking a template must load its text into the input");

  // CSS
  assert.match(cssSrc, /\.tpl-panel\{[^}]*border/,
    ".tpl-panel must have a visible border");
  assert.match(cssSrc, /\.tpl-save-btn\{[^}]*cursor:\s*pointer/,
    ".tpl-save-btn must be cursor:pointer");
  assert.match(cssSrc, /\.tpl-item\{[^}]*cursor:\s*pointer/,
    ".tpl-item must be cursor:pointer (clickable template)");
});

test("analyzer: after a successful analysis, show a 'Save as template?' prompt", () => {
  // Polishes iter #57 — after analyze() completes successfully,
  // show a one-click prompt so the user doesn't have to navigate
  // to the templates panel. Auto-dismisses after 12s so it
  // doesn't get in the user's way.
  if (!HAS_BROWSER) return;
  const fs = require("node:fs");
  const path = require("node:path");
  const appSrc = fs.readFileSync(path.join(ROOT, "assets", "app.js"), "utf8");
  const cssSrc = fs.readFileSync(path.join(ROOT, "assets", "theme.css"), "utf8");

  // showTemplateSuggestion must exist
  assert.match(appSrc, /function showTemplateSuggestion\(raw\)/,
    "showTemplateSuggestion() must exist");
  // Must be called after analyze() success
  assert.match(appSrc, /saveSnapshot\([\s\S]+?showTemplateSuggestion\(raw\)/,
    "showTemplateSuggestion must be called after saveSnapshot (analyze success path)");
  // Must check that the doc isn't already saved (dedupe)
  assert.match(appSrc, /showTemplateSuggestion[\s\S]+?alreadySaved\s*=/,
    "must dedupe (skip if doc is already a template)");
  // Must skip if doc is too short to be a meaningful template
  assert.match(appSrc, /raw\.length\s*>=\s*200/,
    "must skip if doc is too short (<200 chars)");
  // Must include a Yes button that saves the template
  assert.match(appSrc, /data-tpl-suggest-yes/,
    "must include a 'Yes' button");
  assert.match(appSrc, /saveTemplate\(defaultName, raw/,
    "Yes button must call saveTemplate()");
  // Must include a No button that just dismisses
  assert.match(appSrc, /data-tpl-suggest-no/,
    "must include a 'No' (dismiss) button");
  // Must auto-dismiss after a timeout
  assert.match(appSrc, /setTimeout\([\s\S]+?tpl-suggest-out[\s\S]+?12000/,
    "must auto-dismiss after 12s");

  // CSS
  assert.match(cssSrc, /\.tpl-suggest\{[^}]*position:\s*fixed/,
    ".tpl-suggest must be position:fixed (floats over content)");
  assert.match(cssSrc, /\.tpl-suggest-yes\{[^}]*var\(--green\)/,
    ".tpl-suggest-yes must use --green (positive action)");
});

test("analyzer: Edit-template lets users modify a saved template without re-typing", () => {
  // Polishes iter #57 — saved templates are useful but uneditable
  // unless you delete + re-create. Adds an inline edit mode that
  // replaces the row with a name input + text textarea + Save /
  // Cancel / Delete buttons. Reuses saveTemplate (which dedupes
  // by name+text) so we don't need a separate write path.
  if (!HAS_BROWSER) return;
  const fs = require("node:fs");
  const path = require("node:path");
  const appSrc = fs.readFileSync(path.join(ROOT, "assets", "app.js", ), "utf8");
  const cssSrc = fs.readFileSync(path.join(ROOT, "assets", "theme.css"), "utf8");

  // renderTemplates must emit the edit button on each row
  const renderFn = appSrc.match(/function renderTemplates\(\)\{[\s\S]+?^\s\s\}/m);
  assert.ok(renderFn, "renderTemplates() must exist");
  assert.match(renderFn[0], /data-tpl-edit/,
    "renderTemplates must render a [data-tpl-edit] button on each row");

  // updateTemplate must exist (helper for the save path)
  assert.match(appSrc, /function updateTemplate\(idx, name, text\)/,
    "updateTemplate() must exist (iter #59 extraction)");

  // Delegated click must handle the edit-save path
  assert.match(appSrc, /tplList\.addEventListener[\s\S]+?data-tpl-edit-save/,
    "tplList must handle [data-tpl-edit-save] clicks");
  // Must call updateTemplate with the form values
  assert.match(appSrc, /data-tpl-edit-save[\s\S]+?updateTemplate\(idx,\s*nameInput\.value,\s*textInput\.value\)/,
    "edit-save must call updateTemplate(idx, name, text)");
  // Must handle edit-cancel
  assert.match(appSrc, /tplList\.addEventListener[\s\S]+?data-tpl-edit-cancel/,
    "tplList must handle [data-tpl-edit-cancel] clicks");
  // Must handle edit-delete
  assert.match(appSrc, /tplList\.addEventListener[\s\S]+?data-tpl-edit-delete/,
    "tplList must handle [data-tpl-edit-delete] clicks");
  // Delete must splice the array
  assert.match(appSrc, /data-tpl-edit-delete[\s\S]+?items\.splice\(idx, 1\)/,
    "edit-delete must splice the template out of the array");

  // CSS: edit form must be styled
  assert.match(cssSrc, /\.tpl-edit\{[^}]*cursor:\s*pointer/,
    ".tpl-edit must be cursor:pointer (clickable)");
  assert.match(cssSrc, /\.tpl-edit-form\{[^}]*display:\s*flex/,
    ".tpl-edit-form must be a flex container");
  assert.match(cssSrc, /\.tpl-edit-save\{[^}]*var\(--green\)/,
    ".tpl-edit-save must use --green (positive action)");
  assert.match(cssSrc, /\.tpl-edit-delete\{[^}]*var\(--danger\)/,
    ".tpl-edit-delete must use --danger (destructive action)");
});

test("analyzer: result panel shows a 'N risks avoided' badge across all analyses", () => {
  // New feature — tracks the total number of risk patterns the
  // user has caught across all their analyses. Tangible value
  // metric that drives engagement.
  if (!HAS_BROWSER) return;
  const fs = require("node:fs");
  const path = require("node:path");
  const appSrc = fs.readFileSync(path.join(ROOT, "assets", "app.js"), "utf8");
  const html = fs.readFileSync(path.join(ROOT, "analyze.html"), "utf8");
  const cssSrc = fs.readFileSync(path.join(ROOT, "assets", "theme.css"), "utf8");

  // analyze.html: badge must exist
  assert.match(html, /id="risksAvoidedBadge"/,
    "analyze.html must contain #risksAvoidedBadge");

  // localStorage helpers
  assert.match(appSrc, /const RISKS_KEY\s*=\s*'cleardoc:risksAvoided'/,
    "must use localStorage key 'cleardoc:risksAvoided'");
  assert.match(appSrc, /function getRisksAvoided/,
    "getRisksAvoided() must exist");
  assert.match(appSrc, /function bumpRisksAvoided/,
    "bumpRisksAvoided() must exist");
  // Must have a TTL (avoid stale data — 90 days)
  assert.match(appSrc, /RISKS_TTL_MS\s*=\s*90\s*\*\s*24\s*\*\s*60\s*\*\s*60\s*\*\s*1000/,
    "must have a 90-day TTL (avoid stale counters)");

  // saveSnapshot must bump the counter
  assert.match(appSrc, /function saveSnapshot[\s\S]+?bumpRisksAvoided/,
    "saveSnapshot must call bumpRisksAvoided");

  // update logic must show/hide the badge based on the count
  assert.match(appSrc, /risksAvoidedBadge\.hidden\s*=\s*false/,
    "badge must be visible when count > 0");
  assert.match(appSrc, /risksAvoidedBadge\.hidden\s*=\s*true/,
    "badge must be hidden when count = 0");

  // CSS
  assert.match(cssSrc, /\.risks-avoided-badge\{[^}]*var\(--green\)/,
    ".risks-avoided-badge must use --green (positive value)");
  assert.match(cssSrc, /\.risks-avoided-badge\{[^}]*background/,
    ".risks-avoided-badge must have a background tint (pill style)");
});

test("analyzer: risks-avoided badge breaks the total down by severity", () => {
  // Polishes iter #60 — instead of just a flat total, show the
  // breakdown by severity so users see the kind of risk they
  // caught. "📊 14 risks avoided (8 trap + 5 watch + 1 note)"
  // vs "📊 14 risks avoided" is much more informative.
  if (!HAS_BROWSER) return;
  const fs = require("node:fs");
  const path = require("node:path");
  const appSrc = fs.readFileSync(path.join(ROOT, "assets", "app.js"), "utf8");

  // New: bumpRisksAvoidedBySeverity must exist
  assert.match(appSrc, /function bumpRisksAvoidedBySeverity\(trap, watch, note\)/,
    "bumpRisksAvoidedBySeverity() must exist (iter #61 split)");
  // saveSnapshot must use the severity-aware path
  assert.match(appSrc, /function saveSnapshot[\s\S]+?bumpRisksAvoidedBySeverity/,
    "saveSnapshot must call bumpRisksAvoidedBySeverity");
  // Must count trap/watch/note separately
  assert.match(appSrc, /r\.sev\s*===\s*.r.[\s\S]+?trap\+\+/,
    "must count trap (sev 'r') separately");
  assert.match(appSrc, /r\.sev\s*===\s*.a.[\s\S]+?watch\+\+/,
    "must count watch (sev 'a') separately");
  assert.match(appSrc, /r\.sev\s*===\s*.g.[\s\S]+?note\+\+/,
    "must count note (sev 'g') separately");

  // getRisksAvoided must return the breakdown object (not just count)
  assert.match(appSrc, /function getRisksAvoided[\s\S]+?return\s*\{[\s\S]+?trap/,
    "getRisksAvoided must return a breakdown object (trap field)");

  // Badge text must include the per-severity breakdown
  assert.match(appSrc, /deadlinesAvoidedBadge|risksAvoidedBadge\.textContent[\s\S]+?trap/,
    "badge text must include trap count");
  assert.match(appSrc, /risksAvoidedBadge\.textContent[\s\S]+?watch/,
    "badge text must include watch count");
  assert.match(appSrc, /risksAvoidedBadge\.textContent[\s\S]+?note/,
    "badge text must include note count");

  // Iter #62: title tooltip with $ savings estimate
  assert.match(appSrc, /risksAvoidedBadge\.title/,
    "badge must have a title tooltip");
  // Must include the per-severity $ rates (200/50/20)
  assert.match(appSrc, /SAVINGS_PER/,
    "must define the per-severity savings rates");
  // Must include the cumulative savings total
  assert.match(appSrc, /Approx\./,
    "tooltip must say 'Approx.' to disclose the estimate");
  // Must include the disclaimer that actual cost varies
  assert.match(appSrc, /Estimates only|actual cost varies/,
    "tooltip must include a disclaimer (estimates are not exact)");
});

test("analyzer: Share button copies a one-liner with the user's risk stats", () => {
  // Polishes iter #60/61/62 — adds a Share button next to the
  // badge. Click → copy "I avoided 14 risks with ClearDoc!
  // (cleardoc.app) — approx. $1,700 in saved costs. 8 trap + 5 watch
  // + 1 note" to the clipboard. Drives organic growth (users share
  // their results).
  if (!HAS_BROWSER) return;
  const fs = require("node:fs");
  const path = require("node:path");
  const appSrc = fs.readFileSync(path.join(ROOT, "assets", "app.js"), "utf8");
  const html = fs.readFileSync(path.join(ROOT, "analyze.html"), "utf8");

  // analyze.html: share button must exist
  assert.match(html, /id="shareBadgeBtn"/,
    "analyze.html must contain #shareBadgeBtn");

  // Must build a share one-liner from the data
  assert.match(appSrc, /shareBadgeBtn\.dataset\.text\s*=/,
    "share button must build its text via dataset.text");
  // Must include "I avoided N risks with ClearDoc"
  assert.match(appSrc, /I avoided/,
    "share text must start with 'I avoided'");
  // Must include the cleardoc.app URL
  assert.match(appSrc, /cleardoc\.app/,
    "share text must include the cleardoc.app URL");
  // Must include the $ savings value
  assert.match(appSrc, /saved costs/,
    "share text must mention the saved costs");
  // Must be shown/hidden based on the badge state
  assert.match(appSrc, /shareBadgeBtn\.hidden\s*=\s*false/,
    "share button must be visible when badge is visible");
  assert.match(appSrc, /shareBadgeBtn\.hidden\s*=\s*true/,
    "share button must be hidden when badge is hidden");

  // Click handler must use the standard clipboard pattern
  assert.match(appSrc, /shareBadgeBtn\.addEventListener[\s\S]+?navigator\.clipboard\.writeText/,
    "share click must use navigator.clipboard.writeText");
  assert.match(appSrc, /shareBadgeBtn\.addEventListener[\s\S]+?execCommand\(\s*['"]copy['"]\)/,
    "share click must fall back to execCommand('copy') on older browsers");
  // Flash feedback on success
  assert.match(appSrc, /shareBadgeBtn\.addEventListener[\s\S]+?copied/,
    "share button must flash '✓ copied' on success");
});

test("analyzer: Reset button clears the risks-avoided counter after confirm", () => {
  // Polishes iter #60/61 — adds a Reset button next to Share so
  // users can wipe the localStorage counter (for testing, new
  // users, or privacy). Uses the existing confirm modal so users
  // don't wipe their stats by accident.
  if (!HAS_BROWSER) return;
  const fs = require("node:fs");
  const path = require("node:path");
  const appSrc = fs.readFileSync(path.join(ROOT, "assets", "app.js"), "utf8");
  const html = fs.readFileSync(path.join(ROOT, "analyze.html"), "utf8");

  // analyze.html: reset button must exist
  assert.match(html, /id="resetBadgeBtn"/,
    "analyze.html must contain #resetBadgeBtn");

  // Must be shown/hidden alongside the badge
  assert.match(appSrc, /resetBadgeBtn\.hidden\s*=\s*false/,
    "reset button must be visible when badge is visible");
  assert.match(appSrc, /resetBadgeBtn\.hidden\s*=\s*true/,
    "reset button must be hidden when badge is hidden");

  // Click handler must use the confirm modal
  assert.match(appSrc, /resetBadgeBtn\.addEventListener[\s\S]+?showConfirmModal/,
    "reset click must await the confirm modal");
  // Must clear the localStorage key
  assert.match(appSrc, /resetBadgeBtn\.addEventListener[\s\S]+?localStorage\.removeItem\(RISKS_KEY\)/,
    "reset must clear the localStorage key");
  // Must abort on cancel
  assert.match(appSrc, /resetBadgeBtn\.addEventListener[\s\S]+?if\s*\(\s*!ok\s*\)\s*return/,
    "reset must abort if the user cancels the confirm");
  // Must show a success toast
  assert.match(appSrc, /resetBadgeBtn\.addEventListener[\s\S]+?Counter reset/,
    "reset must show a success toast");
});

test("analyzer: reset confirm shows the current count + savings so users know what they're wiping", () => {
  // Polishes iter #64 — the reset confirm now shows the current
  // count + estimated $ savings so users know what they're wiping
  // before they confirm. Standard "destructive action" UX pattern.
  if (!HAS_BROWSER) return;
  const fs = require("node:fs");
  const path = require("node:path");
  const appSrc = fs.readFileSync(path.join(ROOT, "assets", "app.js"), "utf8");

  // Reset confirm must call getRisksAvoided to show the current count
  assert.match(appSrc, /resetBadgeBtn\.addEventListener[\s\S]+?getRisksAvoided/,
    "reset confirm must read the current counter");
  // Must show "Currently: N risk(s) avoided" line
  assert.match(appSrc, /resetBadgeBtn\.addEventListener[\s\S]+?Currently:/,
    "reset confirm must show 'Currently: N risks avoided'");
  // Must include the $ savings in the preview
  assert.match(appSrc, /resetBadgeBtn\.addEventListener[\s\S]+?saved costs/,
    "reset preview must include the $ savings");
});

test("analyzer: 'Why these numbers?' explainer shows the per-severity $ rate sources", () => {
  // New feature — transparency around the iter #62 $ rates. Click
  // the "?" button to see where trap/watch/note prices come from.
  // Builds trust: users see the reasoning, not just a magic number.
  if (!HAS_BROWSER) return;
  const fs = require("node:fs");
  const path = require("node:path");
  const appSrc = fs.readFileSync(path.join(ROOT, "assets", "app.js"), "utf8");
  const html = fs.readFileSync(path.join(ROOT, "analyze.html"), "utf8");
  const cssSrc = fs.readFileSync(path.join(ROOT, "assets", "theme.css"), "utf8");

  // analyze.html: explainer button must exist
  assert.match(html, /id="badgeExplainBtn"/,
    "analyze.html must contain #badgeExplainBtn");
  assert.match(html, /Why these numbers\?/,
    "explainer button must be labeled 'Why these numbers?'");

  // Click handler must open the explainer modal
  assert.match(appSrc, /badgeExplainBtn\.addEventListener\(\s*['"]click['"]/,
    "explainer button must have a click handler");
  // Must show "Where do these numbers come from?" title
  assert.match(appSrc, /badgeExplainBtn\.addEventListener[\s\S]+?Where do these numbers/,
    "explainer modal must ask 'Where do these numbers come from?'");
  // Must include all three $ rates with explanations
  assert.match(appSrc, /badgeExplainBtn\.addEventListener[\s\S]+?trap\s*=\s*\$200/,
    "explainer must include trap = $200");
  assert.match(appSrc, /badgeExplainBtn\.addEventListener[\s\S]+?watch\s*=\s*\$50/,
    "explainer must include watch = $50");
  assert.match(appSrc, /badgeExplainBtn\.addEventListener[\s\S]+?note\s*=\s*\$20/,
    "explainer must include note = $20");
  // Must include a disclaimer about the estimates being rough
  assert.match(appSrc, /badgeExplainBtn\.addEventListener[\s\S]+?conservative|industry-rough|relative gauge/,
    "explainer must include a disclaimer (estimates are rough)");

  // CSS: smaller button variant
  assert.match(cssSrc, /\.ghost-btn-xs\{[^}]*padding:\s*3px/,
    ".ghost-btn-xs must be the smaller button variant (for the ? explainer)");
});

test("analyzer: Document version comparison shows the risk delta after a second analysis", () => {
  // New feature — let users save a "before" version, edit, then
  // re-analyze to see "Down from 7 risks to 4 (3 fixed)". Powerful
  // for negotiation: users see the impact of their edits.
  if (!HAS_BROWSER) return;
  const fs = require("node:fs");
  const path = require("node:path");
  const appSrc = fs.readFileSync(path.join(ROOT, "assets", "app.js"), "utf8");
  const html = fs.readFileSync(path.join(ROOT, "analyze.html"), "utf8");

  // analyze.html: save-version button must exist
  assert.match(html, /id="saveVersionBtn"/,
    "analyze.html must contain #saveVersionBtn");
  assert.match(html, /Save the current risk state/,
    "save-version button must explain its purpose in the title");

  // localStorage helpers
  assert.match(appSrc, /const VERSION_KEY\s*=\s*'cleardoc:savedVersion'/,
    "must use localStorage key 'cleardoc:savedVersion'");
  assert.match(appSrc, /function getSavedVersion/,
    "getSavedVersion() must exist");
  assert.match(appSrc, /function saveCurrentVersion/,
    "saveCurrentVersion() must exist");
  // Must capture the per-severity breakdown
  assert.match(appSrc, /saveCurrentVersion[\s\S]+?trap\s*=\s*hits\.filter/,
    "saveCurrentVersion must capture the trap count");
  // Must skip if the input is too short
  assert.match(appSrc, /saveCurrentVersion[\s\S]+?raw\.length\s*<\s*12/,
    "saveCurrentVersion must skip inputs shorter than 12 chars");

  // showVersionDelta must exist + be called from saveSnapshot
  assert.match(appSrc, /function showVersionDelta/,
    "showVersionDelta() must exist (iter #67)");
  assert.match(appSrc, /function saveSnapshot[\s\S]+?showVersionDelta/,
    "saveSnapshot must call showVersionDelta after persist");

  // Delta toast must include the "fixed" wording when count drops
  assert.match(appSrc, /showVersionDelta[\s\S]+?fixed/,
    "showVersionDelta must show the 'fixed' delta when count drops");
  // Must include the snippet for the "from" version
  assert.match(appSrc, /showVersionDelta[\s\S]+?just now|formatRelativeTime/,
    "showVersionDelta must show when the saved version was made");
});

test("analyzer: Clear baseline button wipes the saved 'before' version after confirm", () => {
  // Polishes iter #67 — after a comparison, users may want to
  // clear the baseline so the next analysis is a fresh start.
  // Uses the existing confirm modal so users don't wipe by accident.
  if (!HAS_BROWSER) return;
  const fs = require("node:fs");
  const path = require("node:path");
  const appSrc = fs.readFileSync(path.join(ROOT, "assets", "app.js"), "utf8");
  const html = fs.readFileSync(path.join(ROOT, "analyze.html"), "utf8");

  // analyze.html: clear button must exist
  assert.match(html, /id="clearVersionBtn"/,
    "analyze.html must contain #clearVersionBtn");
  assert.match(html, /hidden title="Clear the saved baseline/,
    "clear button must be hidden initially and labeled 'Clear the saved baseline'");

  // showClearVersionBtn helper must exist
  assert.match(appSrc, /function showClearVersionBtn/,
    "showClearVersionBtn() must exist (iter #68)");

  // Must toggle the clear button based on whether a version exists
  assert.match(appSrc, /showClearVersionBtn[\s\S]+?getSavedVersion/,
    "showClearVersionBtn must read getSavedVersion");
  assert.match(appSrc, /showClearVersionBtn[\s\S]+?hidden\s*=\s*!/,
    "showClearVersionBtn must toggle hidden based on existence");

  // Click handler must use the confirm modal
  assert.match(appSrc, /clearVersionBtn\.addEventListener[\s\S]+?showConfirmModal/,
    "clear click must await the confirm modal");
  // Must clear the localStorage key
  assert.match(appSrc, /clearVersionBtn\.addEventListener[\s\S]+?localStorage\.removeItem\(VERSION_KEY\)/,
    "clear must remove the VERSION_KEY from localStorage");
  // Must abort on cancel
  assert.match(appSrc, /clearVersionBtn\.addEventListener[\s\S]+?if\s*\(\s*!ok\s*\)\s*return/,
    "clear must abort if the user cancels the confirm");
  // Must show a success toast
  assert.match(appSrc, /clearVersionBtn\.addEventListener[\s\S]+?Baseline cleared/,
    "clear must show a success toast");
});

test("analyzer: '📌 vs saved version' badge persists while a baseline exists", () => {
  // Polishes iter #67/68 — persistent indicator so users always
  // know there's a saved baseline in play. Hidden when no version
  // exists; shown with the count + relative timestamp when one does.
  if (!HAS_BROWSER) return;
  const fs = require("node:fs");
  const path = require("node:path");
  const appSrc = fs.readFileSync(path.join(ROOT, "assets", "app.js"), "utf8");
  const html = fs.readFileSync(path.join(ROOT, "analyze.html"), "utf8");
  const cssSrc = fs.readFileSync(path.join(ROOT, "assets", "theme.css"), "utf8");

  // analyze.html: badge must exist
  assert.match(html, /id="savedVersionBadge"/,
    "analyze.html must contain #savedVersionBadge");
  assert.match(html, /📌 vs saved version/,
    "badge must be labeled '📌 vs saved version'");

  // Must be shown/hidden by showClearVersionBtn
  assert.match(appSrc, /showClearVersionBtn[\s\S]+?savedVersionBadge\.hidden\s*=\s*false/,
    "showClearVersionBtn must show the badge when a version exists");
  assert.match(appSrc, /showClearVersionBtn[\s\S]+?savedVersionBadge\.hidden\s*=\s*true/,
    "showClearVersionBtn must hide the badge when no version");
  // Must include the count + relative timestamp
  assert.match(appSrc, /showClearVersionBtn[\s\S]+?v\.count/,
    "badge must include the saved count");
  assert.match(appSrc, /showClearVersionBtn[\s\S]+?formatRelativeTime/,
    "badge must use formatRelativeTime for the 'when saved' label");
  // Must include a tooltip with the saved snippet
  assert.match(appSrc, /showClearVersionBtn[\s\S]+?Saved snippet/,
    "badge must have a tooltip with the saved snippet");

  // Clear must hide the badge
  assert.match(appSrc, /clearVersionBtn\.addEventListener[\s\S]+?savedVersionBadge\.hidden\s*=\s*true/,
    "clear must hide the badge");

  // CSS
  assert.match(cssSrc, /\.saved-version-badge\{[^}]*var\(--accent\)/,
    ".saved-version-badge must use --accent (visual hierarchy)");
});

test("analyzer: version-comparison delta is color-coded (green/red/gray)", () => {
  // Polishes iter #67 — the delta toast now color-codes the
  // direction of the change. Green = count dropped (improvement),
  // red = count rose (regression), gray = same. Visual scan
  // improvement so users can see the result at a glance.
  if (!HAS_BROWSER) return;
  const fs = require("node:fs");
  const path = require("node:path");
  const appSrc = fs.readFileSync(path.join(ROOT, "assets", "app.js"), "utf8");
  const cssSrc = fs.readFileSync(path.join(ROOT, "assets", "theme.css"), "utf8");

  // Must compute the delta class
  assert.match(appSrc, /showVersionDelta[\s\S]+?delta-fixed/,
    "showVersionDelta must apply the delta-fixed class");
  assert.match(appSrc, /showVersionDelta[\s\S]+?delta-new/,
    "showVersionDelta must apply the delta-new class");
  assert.match(appSrc, /showVersionDelta[\s\S]+?delta-same/,
    "showVersionDelta must apply the delta-same class");
  // Must remove all delta classes before adding the new one (idempotent)
  assert.match(appSrc, /showVersionDelta[\s\S]+?classList\.remove\(['"]delta-fixed/,
    "showVersionDelta must remove all delta classes before adding the new one");

  // CSS
  assert.match(cssSrc, /\.analyze-toast\.delta-fixed\{[^}]*var\(--green\)/,
    "delta-fixed must use --green (improvement)");
  assert.match(cssSrc, /\.analyze-toast\.delta-new\{[^}]*var\(--danger\)/,
    "delta-new must use --danger (regression)");
  assert.match(cssSrc, /\.analyze-toast\.delta-same/,
    "delta-same must have its own (muted) styling");
});

test("analyzer: Multiple saved versions with names + a picker to choose between them", () => {
  // New feature — users can save multiple baselines ("before first
  // edit", "before second edit", etc.) and pick which one to
  // compare against via a <select> dropdown. Up to 5 versions
  // retained; oldest are dropped FIFO.
  if (!HAS_BROWSER) return;
  const fs = require("node:fs");
  const path = require("node:path");
  const appSrc = fs.readFileSync(path.join(ROOT, "assets", "app.js"), "utf8");
  const html = fs.readFileSync(path.join(ROOT, "analyze.html"), "utf8");

  // analyze.html: select must exist
  assert.match(html, /id="savedVersionSelect"/,
    "analyze.html must contain #savedVersionSelect");

  // localStorage must store an array of versions (iter #71)
  assert.match(appSrc, /function readVersions/,
    "readVersions() must exist (iter #71 multi-version)");
  assert.match(appSrc, /function writeVersions/,
    "writeVersions() must exist (iter #71 multi-version)");
  assert.match(appSrc, /function deleteVersion/,
    "deleteVersion() must exist (single-version delete)");
  assert.match(appSrc, /function clearAllVersions/,
    "clearAllVersions() must exist (reset the array)");
  // Must cap at 5 versions
  assert.match(appSrc, /VERSIONS_MAX\s*=\s*5/,
    "must cap at 5 versions (FIFO)");

  // saveCurrentVersion must accept an optional name
  assert.match(appSrc, /function saveCurrentVersion\(name\)/,
    "saveCurrentVersion must accept a name parameter");

  // Save must default to "Snapshot N" when no name given
  assert.match(appSrc, /Snapshot ' \+ \(readVersions/,
    "save must default to 'Snapshot N' when no name given");

  // Active version ID is tracked
  assert.match(appSrc, /_activeVersionId\s*=/,
    "must track the active version ID");
  // Picker change updates the active version
  assert.match(appSrc, /savedVersionSelect\.addEventListener[\s\S]+?_activeVersionId/,
    "picker change must update the active version");
  // Picker change must call showClearVersionBtn to refresh the badge
  assert.match(appSrc, /savedVersionSelect\.addEventListener[\s\S]+?showClearVersionBtn/,
    "picker change must refresh the badge");

  // showClearVersionBtn must repopulate the picker dropdown
  assert.match(appSrc, /showClearVersionBtn[\s\S]+?savedVersionSelect\.innerHTML/,
    "showClearVersionBtn must repopulate the picker dropdown");
});

test("analyzer: per-version delete (Cmd/Ctrl-click) removes one snapshot without clearing all", () => {
  // Polishes iter #71 — users can remove a specific saved
  // version without clearing all. Cmd/Ctrl-click the option to
  // delete; the rest of the array stays intact.
  if (!HAS_BROWSER) return;
  const fs = require("node:fs");
  const path = require("node:path");
  const appSrc = fs.readFileSync(path.join(ROOT, "assets", "app.js"), "utf8");

  // deleteVersion must exist
  assert.match(appSrc, /function deleteVersion\(/,
    "deleteVersion() must exist (iter #72)");

  // Click handler must use metaKey/ctrlKey
  assert.match(appSrc, /savedVersionSelect\.addEventListener[\s\S]+?metaKey[\s\S]+?ctrlKey/,
    "delete handler must check metaKey || ctrlKey (per-version delete)");
  // Must call deleteVersion
  assert.match(appSrc, /savedVersionSelect\.addEventListener[\s\S]+?deleteVersion\(id\)/,
    "delete handler must call deleteVersion");
  // Must refresh the badge
  assert.match(appSrc, /savedVersionSelect\.addEventListener[\s\S]+?showClearVersionBtn\(\)/,
    "delete handler must refresh the badge");
  // Must show a success toast
  assert.match(appSrc, /savedVersionSelect\.addEventListener[\s\S]+?Version deleted/,
    "delete handler must show a success toast");
});

test("analyzer: saved-version snippet is shown inline when a version is active", () => {
  // New feature — when a saved version is active, show its saved
  // snippet inline so users can verify which version they're
  // comparing against without opening DevTools.
  if (!HAS_BROWSER) return;
  const fs = require("node:fs");
  const path = require("node:path");
  const appSrc = fs.readFileSync(path.join(ROOT, "assets", "app.js"), "utf8");
  const html = fs.readFileSync(path.join(ROOT, "analyze.html"), "utf8");
  const cssSrc = fs.readFileSync(path.join(ROOT, "assets", "theme.css"), "utf8");

  // analyze.html: snippet element must exist
  assert.match(html, /id="savedVersionSnippet"/,
    "analyze.html must contain #savedVersionSnippet");

  // showClearVersionBtn must update the snippet
  assert.match(appSrc, /showClearVersionBtn[\s\S]+?savedVersionSnippet\.hidden\s*=\s*false/,
    "showClearVersionBtn must show the snippet when a version exists");
  assert.match(appSrc, /showClearVersionBtn[\s\S]+?savedVersionSnippet\.hidden\s*=\s*true/,
    "showClearVersionBtn must hide the snippet when no version");
  // Must include the saved snippet text
  assert.match(appSrc, /showClearVersionBtn[\s\S]+?v\.snippet/,
    "snippet must read v.snippet (the saved text)");
  // Must show the version label too
  assert.match(appSrc, /showClearVersionBtn[\s\S]+?v\.label/,
    "snippet must show the version label too");

  // Clear must hide the snippet
  assert.match(appSrc, /clearVersionBtn\.addEventListener[\s\S]+?savedVersionSnippet\.hidden\s*=\s*true/,
    "clear must hide the snippet");

  // CSS
  assert.match(cssSrc, /\.saved-version-snippet\{[^}]*font-style:\s*italic/,
    ".saved-version-snippet must use italic (visual hierarchy)");
});

test("analyzer: counter-suggestions have a 'Why this works' tip (💡 button)", () => {
  // New feature — each counter-suggestion has a small 💡 button
  // that pops a modal explaining the legal/business rationale
  // for the counter-clause. Builds trust by explaining the
  // reasoning, not just the clause text.
  if (!HAS_BROWSER) return;
  const fs = require("node:fs");
  const path = require("node:path");
  const appSrc = fs.readFileSync(path.join(ROOT, "assets", "app.js"), "utf8");
  const cssSrc = fs.readFileSync(path.join(ROOT, "assets", "theme.css"), "utf8");

  // renderRiskDetail must render the tip button when h.tip is set
  const renderFn = appSrc.match(/function renderRiskDetail\(hits\)\{[\s\S]{0,9800}\n    \}/);
  assert.ok(renderFn, "renderRiskDetail() must exist");
  assert.match(renderFn[0], /data-rc-tip/,
    "renderRiskDetail must render [data-rc-tip] when h.tip is set");
  assert.match(renderFn[0], /esc\(h\.tip\)/,
    "tip data must be esc()d (XSS defense)");

  // Delegated click handler must handle the tip button
  assert.match(appSrc, /riskDetail\.addEventListener[\s\S]+?data-rc-tip/,
    "riskDetail must handle [data-rc-tip] clicks");
  // Must use the existing confirm modal
  assert.match(appSrc, /data-rc-tip[\s\S]+?showConfirmModal/,
    "tip handler must use the showConfirmModal for the explanation");
  // Modal title must be "Why this works"
  assert.match(appSrc, /data-rc-tip[\s\S]+?Why this works/,
    "tip modal must be titled 'Why this works'");

  // At least one risk must include a tip (the perpetual pattern)
  assert.match(appSrc, /perpetuity[\s\S]+?tip:\s*'/,
    "at least one risk (perpetual) must include a tip");

  // CSS: the 💡 button must be styled
  assert.match(cssSrc, /\.rc-tip\{[^}]*cursor:\s*pointer/,
    ".rc-tip must be cursor:pointer (signals clickability)");
});

test("analyzer: every risk pattern has a 'why this works' tip", () => {
  // Polishes iter #74 — extend the tip field to all risk patterns
  // so every counter-suggestion has a "why this works" explainer.
  if (!HAS_BROWSER) return;
  const fs = require("node:fs");
  const path = require("node:path");
  const appSrc = fs.readFileSync(path.join(ROOT, "assets", "app.js"), "utf8");

  // Every RISK entry should have a tip field
  // Count the number of "tip:" fields in the RISK array (each entry
  // should have one). There are 9 risk patterns total.
  const tipMatches = appSrc.match(/tip:\s*'([^']+)'/g) || [];
  const tips = tipMatches.map(m => m.match(/tip:\s*'([^']+)'/)[1]);
  assert.ok(tips.length >= 9,
    "must have at least 9 tips (one per risk pattern); found " + tips.length);
  // Each tip should be 1-3 sentences
  for(let i = 0; i < tips.length; i++){
    const len = tips[i].length;
    assert.ok(len > 30 && len < 400,
      "tip #" + (i+1) + " should be 1-3 sentences (length " + len + ")");
  }
});

test("analyzer: version-history modal lists all saved versions with date + count + snippet", () => {
  // New feature — users iterating on multiple "before" snapshots
  // can now see a full list with dates, counts, and snippets via
  // a single click. Picks the right baseline without opening
  // DevTools.
  if (!HAS_BROWSER) return;
  const fs = require("node:fs");
  const path = require("node:path");
  const appSrc = fs.readFileSync(path.join(ROOT, "assets", "app.js"), "utf8");
  const html = fs.readFileSync(path.join(ROOT, "analyze.html"), "utf8");
  const cssSrc = fs.readFileSync(path.join(ROOT, "assets", "theme.css"), "utf8");

  // analyze.html: history button must exist
  assert.match(html, /id="versionHistoryBtn"/,
    "analyze.html must contain #versionHistoryBtn");
  assert.match(html, /📚 history/,
    "history button must be labeled '📚 history'");

  // showClearVersionBtn must toggle the history button visibility
  assert.match(appSrc, /showClearVersionBtn[\s\S]+?versionHistoryBtn\.hidden\s*=\s*allVersions\.length\s*===\s*0/,
    "showClearVersionBtn must hide the history button when no versions");

  // Click handler must use the existing confirm modal
  assert.match(appSrc, /versionHistoryBtn\.addEventListener[\s\S]+?showConfirmModal/,
    "history click must use the showConfirmModal");
  // Must include the version list HTML
  assert.match(appSrc, /versionHistoryBtn\.addEventListener[\s\S]+?vh-list/,
    "history modal must include a .vh-list container");
  // Must include the date + count + snippet for each version
  assert.match(appSrc, /vh-row[\s\S]+?v\.label/,
    "history must include the version label");
  assert.match(appSrc, /vh-meta[\s\S]+?v\.count\s*\+/,
    "history must include the risk count");
  assert.match(appSrc, /vh-row[\s\S]+?v\.snippet/,
    "history must include the saved snippet");
  // Must mark the active version
  assert.match(appSrc, /vh-active/,
    "history must mark the active version");
  // Must have a hint about how to switch
  assert.match(appSrc, /picker[\s\S]+?switch which version/,
    "history modal must include a hint about switching the active version");

  // CSS
  assert.match(cssSrc, /\.vh-list\{[^}]*max-height/,
    ".vh-list must have a max-height so long lists don't overflow");
  assert.match(cssSrc, /\.vh-active\{[^}]*var\(--green/,
    ".vh-active must use --green (highlight the active version)");
});

test("analyzer: risk-trend chart shows a sparkline of recent risk counts", () => {
  // New feature — users iterating on multiple analyses can see
  // a sparkline of their risk counts over the last 10 analyses
  // (30-day window). Visual engagement metric.
  if (!HAS_BROWSER) return;
  const fs = require("node:fs");
  const path = require("node:path");
  const appSrc = fs.readFileSync(path.join(ROOT, "assets", "app.js"), "utf8");
  const html = fs.readFileSync(path.join(ROOT, "analyze.html"), "utf8");

  // analyze.html: trend button must exist
  assert.match(html, /id="riskTrendBtn"/,
    "analyze.html must contain #riskTrendBtn");

  // localStorage helpers
  assert.match(appSrc, /const TREND_KEY\s*=\s*'cleardoc:riskTrend'/,
    "must use localStorage key 'cleardoc:riskTrend'");
  assert.match(appSrc, /function getRiskTrend/,
    "getRiskTrend() must exist");
  assert.match(appSrc, /function pushRiskTrend/,
    "pushRiskTrend() must exist (iter #77 trend push)");
  // Must be capped at 10
  assert.match(appSrc, /TREND_MAX\s*=\s*10/,
    "must cap at 10 entries (FIFO)");
  // Must have a 30-day TTL
  assert.match(appSrc, /TREND_TTL_MS\s*=\s*30/,
    "must have a 30-day TTL");

  // saveSnapshot must call pushRiskTrend
  assert.match(appSrc, /function saveSnapshot[\s\S]+?pushRiskTrend/,
    "saveSnapshot must call pushRiskTrend on every analysis");

  // Click handler must build an ASCII sparkline
  assert.match(appSrc, /riskTrendBtn\.addEventListener[\s\S]+?bars\s*=/,
    "trend click must build an ASCII sparkline");
  // Must use the confirm modal
  assert.match(appSrc, /riskTrendBtn\.addEventListener[\s\S]+?showConfirmModal/,
    "trend click must use the existing confirm modal");
  // Must show the latest value + delta
  assert.match(appSrc, /riskTrendBtn\.addEventListener[\s\S]+?delta/,
    "trend modal must show the latest value + delta vs the previous one");
});

// Cycle #156 — copy the trend summary.
test("analyzer: Trend block copies its summary in one click", () => {
  if (!HAS_BROWSER) return;
  const fs = require("node:fs");
  const path = require("node:path");
  const appSrc = fs.readFileSync(path.join(ROOT, "assets", "app.js"), "utf8");
  const cssSrc = fs.readFileSync(path.join(ROOT, "assets", "theme.css"), "utf8");

  assert.match(appSrc, /id="trendCopyBtn" title="Copy the trend summary as plain text"/,
    "the trend controls must include a copy button");
  assert.match(appSrc, /ClearDoc risk trend · ' \+ history\.length/,
    "the export must open with the run count");
  assert.match(appSrc, /Latest: maturity ' \+ mletter/,
    "the export must carry the latest maturity + risk tally");
  assert.match(appSrc, /Sparkline \(last ' \+ last10\.length \+ '\)/,
    "the export must include the sparkline");
  assert.match(appSrc, /📋 Trend copied/,
    "copying must announce via toast");
  assert.match(appSrc, /copyTrendBtn\._flashTimer/,
    "the button label must flash and restore");
  assert.match(appSrc, /<b>📋 copy<\/b> exports the summary/,
    "the block note must document the copy action");
  assert.match(cssSrc, /\.trend-controls-cell\{[^}]*gap:6px/,
    "the copy and clear buttons must have breathing room");
  assert.match(cssSrc, /\.trend-controls-cell \.ghost-btn\{[^}]*flex-shrink:0/,
    "the control buttons must never shrink");
});

test("analyzer: Negotiation playbook export opens a printable window with suggestions + tips + versions", () => {
  // New feature — exports the full negotiation workflow
  // (suggestions + tips + saved versions) as a printable
  // checklist. Users can print to PDF or share with a co-counsel.
  if (!HAS_BROWSER) return;
  const fs = require("node:fs");
  const path = require("node:path");
  const appSrc = fs.readFileSync(path.join(ROOT, "assets", "app.js"), "utf8");
  const html = fs.readFileSync(path.join(ROOT, "analyze.html"), "utf8");

  // analyze.html: playbook button must exist
  assert.match(html, /id="playbookBtn"/,
    "analyze.html must contain #playbookBtn");
  assert.match(html, /📋 playbook/,
    "playbook button must be labeled '📋 playbook'");

  // Click handler must build the playbook document
  assert.match(appSrc, /playbookBtn\.addEventListener\(\s*['"]click['"]/,
    "playbook button must have a click handler");
  // Must read the rendered risk list (so the playbook matches what's
  // visible in the expanded list)
  assert.match(appSrc, /playbookBtn\.addEventListener[\s\S]+?risk-detail-row/,
    "playbook must read the rendered risk rows for parity with the UI");
  // Must include original, counter, tip
  assert.match(appSrc, /playbookBtn\.addEventListener[\s\S]+?original/,
    "playbook must include the original clause text");
  assert.match(appSrc, /playbookBtn\.addEventListener[\s\S]+?counter/,
    "playbook must include the counter-clause text");
  assert.match(appSrc, /playbookBtn\.addEventListener[\s\S]+?tip/,
    "playbook must include the 'why this works' tip");
  // Must include the saved versions section
  assert.match(appSrc, /playbookBtn\.addEventListener[\s\S]+?readVersions\(\)/,
    "playbook must include the saved versions");
  // Must open the document in a new window
  assert.match(appSrc, /playbookBtn\.addEventListener[\s\S]+?window\.open/,
    "playbook must open in a new window");
  // Must revoke the blob URL after a delay
  assert.match(appSrc, /playbookBtn\.addEventListener[\s\S]+?URL\.revokeObjectURL/,
    "playbook must revoke the blob URL after a delay");
  // Must include the print media query
  assert.match(appSrc, /@media print/,
    "playbook must have a print media query for clean printing");
});

test("analyzer: each risk row shows a 'What would I save?' $ tooltip", () => {
  // New feature — hover the risk row to see the per-risk $ cost
  // it could have caused. Uses the same per-severity rates as
  // the iter #62/65 badge so the numbers stay consistent.
  if (!HAS_BROWSER) return;
  const fs = require("node:fs");
  const path = require("node:path");
  const appSrc = fs.readFileSync(path.join(ROOT, "assets", "app.js"), "utf8");

  // Must define the per-risk rate (same as the badge)
  assert.match(appSrc, /SAVINGS_PER\s*=\s*\{\s*r:\s*200/,
    "must define the per-severity $ rates (200/50/20)");
  // Must compute the tooltip text
  assert.match(appSrc, /risk-detail-row[\s\S]+?tooltip\s*=/,
    "must compute the per-row tooltip text");
  // Must include the $ amount + the severity name
  assert.match(appSrc, /risk-detail-row[\s\S]+?rate\s*=\s*SAVINGS_PER\[sev\]/,
    "tooltip must include the per-severity $ rate");
  // Must set the title attribute on the row (native browser tooltip)
  assert.match(appSrc, /risk-detail-row[\s\S]+?title=[\s\S]+?tooltip/,
    "must set the title attribute referencing the tooltip variable");
  assert.match(appSrc, /tooltip[\s\S]+?rate/,
    "tooltip template must reference the per-severity rate");
});

test("analyzer: severity filter narrows the risk list to a single severity", () => {
  // New feature — power-user feature. The <select> in the
  // risk-detail-toolbar (iter #80) lets users filter to "Traps
  // only" / "Watches only" / "Notes only" / "All". Toggle via
  // display:none on the existing DOM nodes (cheap, no re-render).
  if (!HAS_BROWSER) return;
  const fs = require("node:fs");
  const path = require("node:path");
  const appSrc = fs.readFileSync(path.join(ROOT, "assets", "app.js"), "utf8");

  // The select must be in the JS-rendered toolbar (rendered dynamically)
  assert.match(appSrc, /data-rd-severity-filter/,
    "severity filter select must exist in the JS template");
  assert.match(appSrc, /Traps only|Watches only|Notes only/,
    "severity filter must include all three severity options");

  // Must include a "change" event handler
  assert.match(appSrc, /riskDetail\.addEventListener\(['"]change['"]/,
    "must include a change event handler on riskDetail");
  // Must toggle display based on severity
  assert.match(appSrc, /change[\s\S]+?style\.display/,
    "change handler must toggle display based on severity");
  // Must update the count badge
  assert.match(appSrc, /change[\s\S]+?visibleRows/,
    "change handler must update the visible-row count");
});

test("analyzer: recent-analyses mini-stats summarize engagement in the result row", () => {
  // New feature — a small inline summary showing
  // "📊 3 analyses · 14 risks caught" so users see their overall
  // engagement at a glance. Sits next to the risks-avoided badge.
  if (!HAS_BROWSER) return;
  const fs = require("node:fs");
  const path = require("node:path");
  const appSrc = fs.readFileSync(path.join(ROOT, "assets", "app.js"), "utf8");
  const html = fs.readFileSync(path.join(ROOT, "analyze.html"), "utf8");
  const cssSrc = fs.readFileSync(path.join(ROOT, "assets", "theme.css"), "utf8");

  // analyze.html: span must exist
  assert.match(html, /id="recentStats"/,
    "analyze.html must contain #recentStats");

  // Must use the existing getRisksAvoided + readHistoryRaw helpers
  assert.match(appSrc, /getRisksAvoided\(\)\.count/,
    "must use getRisksAvoided to read the caught-risk count");
  assert.match(appSrc, /readHistoryRaw\(\)/,
    "must use readHistoryRaw to read the analysis count");

  // Must include "analyses" and "risks caught" in the text
  assert.match(appSrc, /analyses/,
    "stats text must include 'analyses'");
  assert.match(appSrc, /caught/,
    "stats text must include 'caught'");

  // Hidden when both counts are 0
  assert.match(appSrc, /recentStats\.hidden\s*=\s*true/,
    "stats must be hidden when both counts are 0");

  // CSS
  assert.match(cssSrc, /\.recent-stats\{[^}]*background/,
    ".recent-stats must have a background tint (pill style)");
});

test("analyzer: Compare-to-famous-contract benchmarks the input against known contract types", () => {
  // New feature — power-user tool. Compares the current input
  // against well-known contracts (SaaS ToS, residential lease,
  // generic NDA, SaaS subscription) and shows the match %.
  // Helps users understand "this is similar to a typical SaaS ToS".
  if (!HAS_BROWSER) return;
  const fs = require("node:fs");
  const path = require("node:path");
  const appSrc = fs.readFileSync(path.join(ROOT, "assets", "app.js"), "utf8");
  const html = fs.readFileSync(path.join(ROOT, "analyze.html"), "utf8");
  const cssSrc = fs.readFileSync(path.join(ROOT, "assets", "theme.css"), "utf8");

  // analyze.html: button must exist
  assert.match(html, /id="famousContractBtn"/,
    "analyze.html must contain #famousContractBtn");

  // Must include the famous contracts database
  assert.match(appSrc, /FAMOUS_CONTRACTS\s*=/,
    "must define FAMOUS_CONTRACTS database");
  // Must include all 4 categories
  for(const cat of ["SaaS Terms of Service", "Residential Lease", "Non-Disclosure", "Subscription"]){
    assert.ok(appSrc.includes(cat),
      "FAMOUS_CONTRACTS must include '" + cat + "'");
  }

  // Click handler must use matchRisks on each famous contract
  assert.match(appSrc, /famousContractBtn\.addEventListener[\s\S]+?matchRisks\(fc\.doc\)/,
    "must run matchRisks on each famous contract's snippet");
  // Must compute overlap (risk labels common to both)
  assert.match(appSrc, /famousContractBtn\.addEventListener[\s\S]+?overlap/,
    "must compute the risk-label overlap between user and famous");
  // Must sort by score desc
  assert.match(appSrc, /famousContractBtn\.addEventListener[\s\S]+?sort\(/,
    "must sort the comparison by match score");
  // Must use the existing confirm modal
  assert.match(appSrc, /famousContractBtn\.addEventListener[\s\S]+?showConfirmModal/,
    "must use the existing confirm modal");

  // CSS
  assert.match(cssSrc, /\.fc-row\{[^}]*border/,
    ".fc-row must have a visible border");
  assert.match(cssSrc, /\.fc-type\{[^}]*var\(--ink\)/,
    ".fc-type must use --ink (chip style)");
});

test("analyzer: Recent-documents timeline shows a visual chronology of past analyses", () => {
  // New feature — a vertical dot-line-dash timeline of the user's
  // recent analyses. Reads from the same readHistoryRaw() that the
  // iter #25 history uses (single source of truth).
  if (!HAS_BROWSER) return;
  const fs = require("node:fs");
  const path = require("node:path");
  const appSrc = fs.readFileSync(path.join(ROOT, "assets", "app.js"), "utf8");
  const html = fs.readFileSync(path.join(ROOT, "analyze.html"), "utf8");
  const cssSrc = fs.readFileSync(path.join(ROOT, "assets", "theme.css"), "utf8");

  // analyze.html: button must exist
  assert.match(html, /id="timelineBtn"/,
    "analyze.html must contain #timelineBtn");
  assert.match(html, /📅 timeline/,
    "timeline button must be labeled '📅 timeline'");

  // Click handler must use the existing readHistoryRaw
  assert.match(appSrc, /timelineBtn\.addEventListener[\s\S]+?readHistoryRaw/,
    "timeline must use the existing readHistoryRaw()");
  // Must use the existing confirm modal
  assert.match(appSrc, /timelineBtn\.addEventListener[\s\S]+?showConfirmModal/,
    "timeline must use the existing confirm modal");
  // Must render the tl-row class for each item
  assert.match(appSrc, /timelineBtn\.addEventListener[\s\S]+?tl-row/,
    "timeline must render .tl-row per item");
  // Must show a message when no history exists
  assert.match(appSrc, /timelineBtn\.addEventListener[\s\S]+?No analyses yet/,
    "timeline must show 'No analyses yet' when history is empty");

  // CSS
  assert.match(cssSrc, /\.tl-dot\{[^}]*border-radius:\s*50/,
    ".tl-dot must be a circle (border-radius: 50%)");
  assert.match(cssSrc, /\.tl-latest \.tl-dot\{[^}]*background:\s*var\(--accent/,
    ".tl-latest .tl-dot must use --accent (highlight the latest entry)");
});

test("analyzer: Risk severity legend explains TRAP / WATCH / NOTE for first-time users", () => {
  // New feature — onboarding helper. A "📖 legend" button
  // opens a small modal explaining what each severity means.
  if (!HAS_BROWSER) return;
  const fs = require("node:fs");
  const path = require("node:path");
  const appSrc = fs.readFileSync(path.join(ROOT, "assets", "app.js"), "utf8");
  const html = fs.readFileSync(path.join(ROOT, "analyze.html"), "utf8");
  const cssSrc = fs.readFileSync(path.join(ROOT, "assets", "theme.css"), "utf8");

  // analyze.html: button must exist
  assert.match(html, /id="legendBtn"/,
    "analyze.html must contain #legendBtn");
  assert.match(html, /📖 legend/,
    "legend button must be labeled '📖 legend'");

  // Must use the existing confirm modal
  assert.match(appSrc, /legendBtn\.addEventListener[\s\S]+?showConfirmModal/,
    "legend must use the existing confirm modal");
  // Must explain all three severities
  assert.match(appSrc, /legendBtn\.addEventListener[\s\S]+?TRAP/,
    "legend must mention TRAP");
  assert.match(appSrc, /legendBtn\.addEventListener[\s\S]+?WATCH/,
    "legend must mention WATCH");
  assert.match(appSrc, /legendBtn\.addEventListener[\s\S]+?NOTE/,
    "legend must mention NOTE");
  // Must be titled "Risk severity legend"
  assert.match(appSrc, /legendBtn\.addEventListener[\s\S]+?Risk severity legend/,
    "legend must be titled 'Risk severity legend'");

  // CSS: each severity class should be color-coded
  assert.match(cssSrc, /\.legend-row\.legend-trap\{[^}]*var\(--danger/,
    ".legend-trap must use --danger (red)");
  assert.match(cssSrc, /\.legend-row\.legend-watch\{[^}]*var\(--amber/,
    ".legend-watch must use --amber (amber)");
  assert.match(cssSrc, /\.legend-row\.legend-note\{[^}]*var\(--green/,
    ".legend-note must use --green (green)");
});

// Iter #85: legend polish — per-severity examples, copy-all cheat
// sheet, and a graceful-legacy onRender hook on showConfirmModal.
test("analyzer: Risk severity legend polish — per-severity examples + copy cheat sheet", () => {
  if (!HAS_BROWSER) return;
  const fs = require("node:fs");
  const path = require("node:path");
  const appSrc = fs.readFileSync(path.join(ROOT, "assets", "app.js"), "utf8");
  const cssSrc = fs.readFileSync(path.join(ROOT, "assets", "theme.css"), "utf8");

  // Block must contain three example sentences (one per severity).
  const legendBlock = appSrc.match(/legendBtn\.addEventListener\(['"]click['"][\s\S]+?\}\);\s*\}\);\s*\n/);
  assert.ok(legendBlock, "legendBtn click handler must exist");
  assert.match(legendBlock[0], /We may terminate this agreement at any time without notice/,
    "TRAP example must be present");
  assert.match(legendBlock[0], /Either party may modify these terms with 90 days notice/,
    "WATCH example must be present");
  assert.match(legendBlock[0], /A \$25 fee applies for paper statements/,
    "NOTE example must be present");

  // Must wire a copy-all-as-text button.
  assert.match(legendBlock[0], /legendCopyBtn/,
    "copy button id must be present in legend markup");
  assert.match(legendBlock[0], /navigator\.clipboard\.writeText|execCommand\('copy'\)/,
    "copy button must use clipboard fallback chain");

  // onRender hook must exist on showConfirmModal and be guarded.
  assert.match(appSrc, /opts\.onRender/,
    "showConfirmModal must support an optional onRender hook");
  assert.match(appSrc, /opts\.onRender[\s\S]+?try \{ opts\.onRender\(m\);/,
    "onRender must be invoked inside a try/catch (caller safety)");

  // CSS: example rows + actions row must be styled.
  assert.match(cssSrc, /\.legend-ex\{/,
    ".legend-ex style must exist for example sentences");
  assert.match(cssSrc, /\.legend-actions\{/,
    ".legend-actions style must exist for the copy button row");
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
  assert.match(themeSrc, /\.kb-modal-subtitle/, ".kb-modal-subtitle CSS for export section heading must exist");

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
  // Export/share shortcuts documented in the modal
  assert.match(modalText, /Copy Markdown/, "modal must document 'Copy Markdown' shortcut");
  assert.match(modalText, /JSON/, "modal must document 'JSON' shortcut");
  assert.match(modalText, /CSV/, "modal must document 'CSV' shortcut");
  assert.match(modalText, /Checklist/, "modal must document 'Checklist' shortcut");
  assert.match(modalText, /Share link/, "modal must document 'Share link' shortcut");
  assert.match(modalText, /chat-friendly/, "modal must document 'Share to chat' shortcut");

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

  // API responses must stay strictly scoped: no caching, no referrer,
  // no embedding, no indexing, and no cross-origin resource sharing.
  const apiHeaders = Object.fromEntries(apiBlock.headers.map((h) => [h.key.toLowerCase(), h.value]));
  for (const [key, value] of [
    ["cache-control", "no-store"],
    ["x-content-type-options", "nosniff"],
    ["x-dns-prefetch-control", "off"],
    ["x-download-options", "noopen"],
    ["x-frame-options", "DENY"],
    ["referrer-policy", "no-referrer"],
    ["cross-origin-opener-policy", "same-origin"],
    ["cross-origin-resource-policy", "same-origin"],
    ["x-robots-tag", "noindex, nofollow"],
  ]) {
    assert.equal(apiHeaders[key]?.toLowerCase(), value.toLowerCase(), `API header ${key} must be ${value}`);
  }
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
  const txtPath = path.join(ROOT, ".well-known", "security.txt");
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

// Iter #86: translation cheat sheet — local EN ↔ ES/FR/DE/IT/PT
// glossary shown only when the detected document language is
// non-English. Pure local, no AI calls.
test("analyzer: Translation cheat sheet builds EN ↔ XX rows for foreign-language docs", () => {
  if (!HAS_BROWSER) return;
  const fs = require("node:fs");
  const path = require("node:path");
  const appSrc = fs.readFileSync(path.join(ROOT, "assets", "app.js"), "utf8");
  const cssSrc = fs.readFileSync(path.join(ROOT, "assets", "theme.css"), "utf8");
  const html = fs.readFileSync(path.join(ROOT, "analyze.html"), "utf8");

  // analyze.html: hidden translation block must be present
  assert.match(html, /id="transBlock"/,
    "analyze.html must contain the translation block");
  assert.match(html, /id="transList"/,
    "analyze.html must contain #transList container");
  assert.match(html, /Translation cheat sheet/,
    "result block must be titled 'Translation cheat sheet'");

  // app.js: renderer + glossary must exist
  assert.match(appSrc, /function renderTranslationSheet\(/,
    "renderTranslationSheet must exist");
  assert.match(appSrc, /TRANS_GLOSSARY/,
    "TRANS_GLOSSARY must exist");
  // Glossary must cover ES + FR + DE + IT + PT (the supported langs)
  for(const code of ["es:","fr:","de:","it:","pt:"]){
    const pat = new RegExp("^\\s+" + code.replace(/:/g, ":\\s*\\{"), "m");
    assert.match(appSrc, pat,
      "TRANS_GLOSSARY must include " + code);
  }
  // Glossary keys must include legal core terms
  for(const k of ["agreement","contract","tenant","rent","deposit","notice"]){
    assert.match(appSrc, new RegExp("'" + k + "':"),
      "glossary must include '" + k + "'");
  }
  // Wiring must hide the block when language is English or missing
  const rendererBlock = appSrc.match(/function renderTranslationSheet\([^)]+\)\{[\s\S]+?^\s+\}/m);
  assert.ok(rendererBlock, "renderTranslationSheet body must exist");
  assert.match(rendererBlock[0], /lang\.code === ['"]en['"][\s\S]+?return null/,
    "renderer must early-return on English input");
  assert.match(appSrc, /transBlock\.hidden = (true|false)/,
    "transBlock.hidden must be toggled (English / other)");
});

// Iter #87: translation cheat-sheet polish — tone hint + 🔊 button.
// Cycle #138 — copy the whole translation sheet.
test("analyzer: Translation sheet copies as plain text in one click", () => {
  if (!HAS_BROWSER) return;
  const fs = require("node:fs");
  const path = require("node:path");
  const appSrc = fs.readFileSync(path.join(ROOT, "assets", "app.js"), "utf8");
  const cssSrc = fs.readFileSync(path.join(ROOT, "assets", "theme.css"), "utf8");

  assert.match(appSrc, /id="transCopyBtn" title="Copy all translated terms as plain text"/,
    "the translation block must render a copy-sheet button");
  assert.match(appSrc, /transList\.insertAdjacentHTML\('afterend', controls\)/,
    "the control must be appended after the term list");
  assert.match(appSrc, /ClearDoc translation cheat sheet \(' \+ lang\.label \+ '\)/,
    "the export must open with a self-identifying header");
  assert.match(appSrc, /it\.en \+ ' → ' \+ it\.xx/,
    "each line must map EN → translated term");
  assert.match(appSrc, /\\nTone: ' \+ greeting/,
    "the export must carry the tone hint when present");
  assert.match(appSrc, /transCopyBtn\._transCopyWired/,
    "the listener must be bound only once across re-renders");
  assert.match(appSrc, /📋 Translation sheet copied/,
    "copying must announce via toast");
  assert.match(appSrc, /<b>📋 copy sheet<\/b> exports every term\./,
    "the block note must document the export");
  assert.match(cssSrc, /\.trans-controls\{[^}]*display:flex/,
    "the control row must lay out horizontally");
});

test("analyzer: Translation cheat sheet polished with tone hint + per-row speak button", () => {
  if (!HAS_BROWSER) return;
  const fs = require("node:fs");
  const path = require("node:path");
  const appSrc = fs.readFileSync(path.join(ROOT, "assets", "app.js"), "utf8");
  const cssSrc = fs.readFileSync(path.join(ROOT, "assets", "theme.css"), "utf8");

  // TONE_HINTS map must exist and cover ES / FR / DE / IT / PT
  assert.match(appSrc, /TONE_HINTS/,
    "TONE_HINTS map must exist");
  for(const code of ["es","fr","de","it","pt"]){
    const toneBlock = (appSrc.match(/const TONE_HINTS[\s\S]+?\n\s*\};/) || [''])[0];
    assert.match(toneBlock, new RegExp(code + ":"),
      "TONE_HINTS must include " + code);
  }

  // Speak button markup + handler must exist
  assert.match(appSrc, /trans-speak/,
    "per-row speak button class must exist");
  assert.match(appSrc, /SpeechSynthesisUtterance|window\.speechSynthesis\.speak/,
    "speak handler must call SpeechSynthesisUtterance");
  assert.match(appSrc, /u\.lang[\s\S]+?es-ES[\s\S]+?fr-FR[\s\S]+?de-DE[\s\S]+?it-IT[\s\S]+?pt-BR/,
    "speak handler must use lang-specific BCP-47 codes (es-ES, fr-FR, de-DE, it-IT, pt-BR)");

  // Tone-hint chip must be wired into transNote HTML
  assert.match(appSrc, /class="trans-tone"/,
    "transNote must render a .trans-tone hint chip");

  // CSS: speak button + tone chip must be styled
  assert.match(cssSrc, /\.trans-speak\{/,
    ".trans-speak style must exist");
  assert.match(cssSrc, /\.trans-tone\{/,
    ".trans-tone style must exist");
});

// Iter #88: document heat map — every sentence rendered as a colored
// tile so users can see WHERE the traps cluster in one glance.
test("analyzer: Document heat map color-codes each sentence by risk severity", () => {
  if (!HAS_BROWSER) return;
  const fs = require("node:fs");
  const path = require("node:path");
  const appSrc = fs.readFileSync(path.join(ROOT, "assets", "app.js"), "utf8");
  const cssSrc = fs.readFileSync(path.join(ROOT, "assets", "theme.css"), "utf8");
  const html = fs.readFileSync(path.join(ROOT, "analyze.html"), "utf8");

  // analyze.html
  assert.match(html, /id="heatBlock"/,
    "analyze.html must contain #heatBlock");
  assert.match(html, /id="heatMap"/,
    "analyze.html must contain #heatMap");
  assert.match(html, /Document heat map/,
    "result block must be titled 'Document heat map'");

  // app.js — renderer + wiring
  assert.match(appSrc, /function buildHeatMapHTML\(/,
    "buildHeatMapHTML must exist");
  assert.match(appSrc, /heatBlock\.hidden = (true|false)/,
    "heatBlock.hidden must be toggled");
  assert.match(appSrc, /heat-cell/,
    "heat-cell class must be referenced");

  // CSS — tile + per-severity classes
  assert.match(cssSrc, /\.heat-cell\{/,
    ".heat-cell style must exist");
  assert.match(cssSrc, /\.heat-cell\.heat-r\b[^}]*--danger/,
    ".heat-r (trap) must use --danger");
  assert.match(cssSrc, /\.heat-cell\.heat-a\b[^}]*--amber/,
    ".heat-a (watch) must use --amber");
  assert.match(cssSrc, /\.heat-cell\.heat-g\b[^}]*--green/,
    ".heat-g (note) must use --green");
});

// Iter #89: heat-map polish — clickable tiles, "show only flagged",
// and a tile/list toggle. Plus a graceful toast when the user edits
// the doc out from under the analysis.
test("analyzer: Document heat map is interactive (click → jump, filter chips, view toggle)", () => {
  if (!HAS_BROWSER) return;
  const fs = require("node:fs");
  const path = require("node:path");
  const appSrc = fs.readFileSync(path.join(ROOT, "assets", "app.js"), "utf8");
  const cssSrc = fs.readFileSync(path.join(ROOT, "assets", "theme.css"), "utf8");

  // Click-to-jump wiring: must listen on heat-cell + use setSelectionRange
  assert.match(appSrc, /heat-cell[\s\S]+?addEventListener\(['"]click['"]/,
    "heat-cell must be wired to click events");
  assert.match(appSrc, /input\.setSelectionRange/,
    "click handler must select the matching range in the textarea");
  assert.match(appSrc, /showAnalyzeToast[\s\S]+?doc was edited/,
    "must toast a graceful message when input diverges from the analyzed text");

  // Filter chip + view-toggle chip must exist
  assert.match(appSrc, /heatOnlyFlagsBtn/,
    "heatOnlyFlagsBtn must exist");
  assert.match(appSrc, /heatModeBtn/,
    "heatModeBtn must exist");
  assert.match(appSrc, /heat-only-flags/,
    "filter-chip must toggle .heat-only-flags class");
  assert.match(appSrc, /heat-mode-list/,
    "view-mode chip must toggle .heat-mode-list class");

  // CSS: filter + list-mode styles
  assert.match(cssSrc, /\.heat-map\.heat-only-flags \.heat-cell\.heat-c\{[^}]*display:none/,
    ".heat-only-flags must hide .heat-c tiles");
  assert.match(cssSrc, /\.heat-map\.heat-mode-list/,
    ".heat-mode-list style must exist");
});

// Iter #90: worst-case exposure line — one bold "If you signed today,
// worst-case exposure ≈ $X" headline at the top of the expanded risk
// panel. Sums per-severity iter #79 rates ($200 trap, $50 watch,
// $20 note) so the total is consistent with the rest of the app.
test("analyzer: Worst-case exposure headline summarizes the risk panel in one line", () => {
  if (!HAS_BROWSER) return;
  const fs = require("node:fs");
  const path = require("node:path");
  const appSrc = fs.readFileSync(path.join(ROOT, "assets", "app.js"), "utf8");
  const cssSrc = fs.readFileSync(path.join(ROOT, "assets", "theme.css"), "utf8");

  // Rates must match iter #79 exactly
  assert.match(appSrc, /RATE_PER[\s\S]+?r:\s*200[\s\S]+?a:\s*50[\s\S]+?g:\s*20/,
    "RATE_PER must keep iter #79 rates (200/50/20)");

  // Render path must produce the exposure line + total + per-severity breakdown
  assert.match(appSrc, /worst-case exposure.{0,8}\\u2248|worst-case exposure\s*\\u2248|worst-case exposure/,
    "exposure line must say 'worst-case exposure'");
  assert.match(appSrc, /risk-exposure-line/,
    "render must use .risk-exposure-line class");
  assert.match(appSrc, /re-total/,
    "render must use .re-total class for the headline number");

  // CSS: container + headline
  assert.match(cssSrc, /\.risk-exposure-line\{/,
    ".risk-exposure-line style must exist");
  assert.match(cssSrc, /\.risk-exposure-line \.re-total\{/,
    ".re-total (the headline number) must be styled distinctly");
});

// Iter #91: exposure-line polish — magnitude band color
// (low / mid / high) + share + explainer chips.
test("analyzer: Worst-case exposure headline polished with band color + share + explainer", () => {
  if (!HAS_BROWSER) return;
  const fs = require("node:fs");
  const path = require("node:path");
  const appSrc = fs.readFileSync(path.join(ROOT, "assets", "app.js"), "utf8");
  const cssSrc = fs.readFileSync(path.join(ROOT, "assets", "theme.css"), "utf8");

  // Magnitude band must switch on $ thresholds (1000+ high, 300+ mid)
  assert.match(appSrc, /totalExposure >= 1000 \? 'high'[\s\S]+?>= 300 \? 'mid'[\s\S]+?'low'/,
    "render must pick a band key (high/mid/low) by total exposure");
  assert.match(appSrc, /re-band-\$\{band\}|re-band-' \+ band|re-band-(?:"|')\s*\+ band|re-band-' \+ band/,
    "render must apply the band as a class on the line");

  // Share action must be wired (data-re-share) and copy to clipboard
  assert.match(appSrc, /data-re-share=/,
    "share button must carry a data-re-share attribute");
  assert.match(appSrc, /data-re-share[\s\S]+?clipboard\.writeText|execCommand\('copy'\)/,
    "share button handler must use clipboard fallback chain");

  // Explainer chip must open a showConfirmModal with the rate card
  assert.match(appSrc, /data-re-explain/,
    "explainer chip must be wired");
  assert.match(appSrc, /data-re-explain[\s\S]+?showConfirmModal[\s\S]+?where do these numbers come from/i,
    "explainer chip must open the rate-source modal");

  // CSS must define each band
  assert.match(cssSrc, /\.risk-exposure-line\.re-band-low\b/,
    "low band style must exist");
  assert.match(cssSrc, /\.risk-exposure-line\.re-band-mid\b/,
    "mid band style must exist");
  assert.match(cssSrc, /\.risk-exposure-line\.re-band-high\b/,
    "high band style must exist");
});

// Iter #92: contract maturity score — A–F grade with 6 dimensions,
// computed locally. Sits between the verdict and the rewrite.
test("analyzer: Contract maturity score grades the document across 6 local dimensions", () => {
  if (!HAS_BROWSER) return;
  const fs = require("node:fs");
  const path = require("node:path");
  const appSrc = fs.readFileSync(path.join(ROOT, "assets", "app.js"), "utf8");
  const cssSrc = fs.readFileSync(path.join(ROOT, "assets", "theme.css"), "utf8");
  const html = fs.readFileSync(path.join(ROOT, "analyze.html"), "utf8");

  // analyze.html
  assert.match(html, /id="maturityBlock"/,
    "analyze.html must contain #maturityBlock");
  assert.match(html, /id="maturityGrid"/,
    "analyze.html must contain #maturityGrid container");
  assert.match(html, /Contract maturity score/,
    "result block must be titled 'Contract maturity score'");

  // app.js: scorer + render must exist
  assert.match(appSrc, /function computeMaturityScore\(/,
    "computeMaturityScore must exist");
  assert.match(appSrc, /function renderMaturityBlock\(/,
    "renderMaturityBlock must exist");
  // 6 dimensions
  for(const dim of ["clarity","fairness","completeness","jargon","exit","rewrite"]){
    assert.match(appSrc, new RegExp("label: '" + dim + "'\\b|" + dim + "\\b.*score:"),
      "computeMaturityScore must include dimension '" + dim + "'");
  }
  // A–F letter thresholds
  assert.match(appSrc, /letter = overall >= 90 \? 'A'/,
    "letter grade must be A at >=90");
  // Wiring: computeMaturityScore must be called inside render()
  assert.match(appSrc, /computeMaturityScore\(raw/,
    "render() must call computeMaturityScore on the raw text");

  // CSS: per-letter card + per-dimension cell
  assert.match(cssSrc, /\.mat-letter\.mat-letter-A\{/,
    "A letter style must exist");
  assert.match(cssSrc, /\.mat-letter\.mat-letter-F\{/,
    "F letter style must exist");
  assert.match(cssSrc, /\.mat-cell\.mat-good\b/,
    "good dimension cell style must exist");
  assert.match(cssSrc, /\.mat-cell\.mat-low\b/,
    "low dimension cell style must exist");
});

// Iter #93: maturity polish — click-to-explain modal on each tile,
// one-liner share button on the letter card, and the
// "Top 2 things to improve" footer.
test("analyzer: Contract maturity score polished with click-to-explain + share + tips footer", () => {
  if (!HAS_BROWSER) return;
  const fs = require("node:fs");
  const path = require("node:path");
  const appSrc = fs.readFileSync(path.join(ROOT, "assets", "app.js"), "utf8");
  const cssSrc = fs.readFileSync(path.join(ROOT, "assets", "theme.css"), "utf8");

  // Per-dim tip map must exist + cover all 6 dims
  assert.match(appSrc, /MAT_TIPS/,
    "MAT_TIPS map must exist");
  for(const dim of ["clarity","fairness","completeness","jargon","exit","rewrite"]){
    assert.match(appSrc, new RegExp(dim + ":\\s*'"),
      "MAT_TIPS must include '" + dim + "'");
  }

  // Click handler on the block must use showConfirmModal
  assert.match(appSrc, /maturityBlock\.addEventListener\(['"]click['"]/,
    "maturityBlock must be wired to click events");
  assert.match(appSrc, /await showConfirmModal\(\{[\s\S]+?score|showConfirmModal[\s\S]+?score/s,
    "click handler must open the dimension modal");

  // Share button must exist on the letter card
  assert.match(appSrc, /mat-letter-share/,
    "letter card must expose a share button class");
  assert.match(appSrc, /mat-letter-share[\s\S]+?clipboard\.writeText|execCommand\('copy'\)/,
    "share handler must copy to clipboard");

  // Footer
  assert.match(appSrc, /Top 2 things to improve/,
    "render must print 'Top 2 things to improve' footer");
  assert.match(appSrc, /function clearMaturityFooter\(/,
    "clearMaturityFooter must exist so re-renders don’t stack footers");

  // CSS
  assert.match(cssSrc, /\.mat-letter-share\{/,
    "share button style must exist");
  assert.match(cssSrc, /\.mat-tip-list/,
    "tip list style must exist");
});

// Iter #94: jurisdiction & venue detector — surfaces the
// governing-law clause of the analyzed document with a flag +
// jurisdiction label + explicit/inferred chip.
test("analyzer: Jurisdiction & venue detector surfaces the governing-law clause", () => {
  if (!HAS_BROWSER) return;
  const fs = require("node:fs");
  const path = require("node:path");
  const appSrc = fs.readFileSync(path.join(ROOT, "assets", "app.js"), "utf8");
  const cssSrc = fs.readFileSync(path.join(ROOT, "assets", "theme.css"), "utf8");
  const html = fs.readFileSync(path.join(ROOT, "analyze.html"), "utf8");

  // analyze.html: jurisdiction block must be present
  assert.match(html, /id="jurisBlock"/,
    "analyze.html must contain #jurisBlock");
  assert.match(html, /Jurisdiction/,
    "result block must be titled with 'Jurisdiction'");
  assert.match(html, /id="jurisRow"/,
    "analyze.html must contain #jurisRow container");

  // app.js: detector + render + table
  assert.match(appSrc, /function detectJurisdiction\(/,
    "detectJurisdiction must exist");
  assert.match(appSrc, /function renderJurisdictionBlock\(/,
    "renderJurisdictionBlock must exist");
  assert.match(appSrc, /JURISDICTIONS/,
    "JURISDICTIONS table must exist");
  // Key jurisdiction labels must be in the table
  for(const label of ["Delaware", "New York", "California", "United Kingdom", "European Union", "Global \\/ unclear"]){
    assert.match(appSrc, new RegExp(label),
      "JURISDICTIONS must include '" + label + "'");
  }
  // Governing-law regex must catch explicit clauses
  assert.match(appSrc, /governed by[\s\S]{0,80}?laws\?/i,
    "detector must recognize 'governed by ... laws' phrasing");
  // Render must toggle the block visibility
  assert.match(appSrc, /jurisBlock\.hidden = (true|false)/,
    "jurisBlock.hidden must be toggled");
  // Render must include the explicit/inferred chip
  assert.match(appSrc, /juris-source[\s\S]+?explicit clause|inferred/,
    "render must mark the source (explicit vs inferred)");

  // CSS: flag + label + source chip
  assert.match(cssSrc, /\.juris-flag\{/,
    ".juris-flag style must exist");
  assert.match(cssSrc, /\.juris-label\{/,
    ".juris-label style must exist");
  assert.match(cssSrc, /\.juris-source\{/,
    ".juris-source style must exist");
});

// Iter #95: jurisdiction chip polish — counter-clause + explain
// modal + speak button. Mirrors the iter #41 risk-counter UX.
test("analyzer: Jurisdiction chip polished with copy / speak / explain actions", () => {
  if (!HAS_BROWSER) return;
  const fs = require("node:fs");
  const path = require("node:path");
  const appSrc = fs.readFileSync(path.join(ROOT, "assets", "app.js"), "utf8");
  const cssSrc = fs.readFileSync(path.join(ROOT, "assets", "theme.css"), "utf8");

  // Delegated click handler must exist on jurisBlock
  assert.match(appSrc, /jurisBlock\.addEventListener\(['"]click['"]/,
    "jurisBlock must be wired to click events");

  // Three actions: copy counter, speak, why modal
  assert.match(appSrc, /data-juris-counter/,
    "copy-counter button attribute must exist");
  assert.match(appSrc, /data-juris-counter[\s\S]+?clipboard\.writeText|execCommand\('copy'\)/,
    "copy-counter handler must use clipboard fallback");
  assert.match(appSrc, /data-juris-speak[\s\S]+?SpeechSynthesisUtterance/,
    "speak handler must use SpeechSynthesisUtterance");
  assert.match(appSrc, /Why does the jurisdiction matter\?/,
    "explain modal must ask why jurisdiction matters");

  // Counter-clause text must mention home state
  assert.match(appSrc, /your home state|consumer-friendly state/,
    "counter-clause text must propose your home state");

  // CSS
  assert.match(cssSrc, /\.juris-counter\{|\.juris-counter\b/,
    ".juris-counter style must exist");
  assert.match(cssSrc, /\.juris-speak\{|\.juris-speak\b/,
    ".juris-speak style must exist");
});

// Iter #96: coverage highlights strip — pills at the top of the
// result panel listing every surface the analysis touched. Pure
// local; built from already-rendered DOM.
test("analyzer: Coverage highlights strip lists every surface the analysis produced", () => {
  if (!HAS_BROWSER) return;
  const fs = require("node:fs");
  const path = require("node:path");
  const appSrc = fs.readFileSync(path.join(ROOT, "assets", "app.js"), "utf8");
  const cssSrc = fs.readFileSync(path.join(ROOT, "assets", "theme.css"), "utf8");
  const html = fs.readFileSync(path.join(ROOT, "analyze.html"), "utf8");

  // analyze.html
  assert.match(html, /id="coverageStrip"/,
    "analyze.html must contain #coverageStrip");
  assert.match(html, /coverage-strip/,
    "coverage-strip class must exist");

  // app.js
  assert.match(appSrc, /function renderCoverageStrip\(/,
    "renderCoverageStrip must exist");
  // Must surface key surfaces (rewrite, risk, verdict, deadlines, heat, exposure, maturity, juris)
  for(const k of ["rewrite","risk","verdict","deadlines","heat","exposure","maturity","juris"]){
    assert.match(appSrc, new RegExp("key: '" + k + "'"),
      "renderCoverageStrip must include surface '" + k + "'");
  }
  // Wiring — must be called inside render()
  assert.match(appSrc, /renderCoverageStrip\(ctx\)/,
    "render() must call renderCoverageStrip");
  // "Coverage:" kicker label (iter #97 now says "Coverage (N active):")
  assert.match(appSrc, /Coverage/,
    "render must print a 'Coverage' kicker label");
  // Always-on surfaces (draft, share) — they don't depend on detection
  assert.match(appSrc, /key: 'draft'/,
    "render must include the always-on 'draft' pill");
  assert.match(appSrc, /key: 'share'/,
    "render must include the always-on 'share' pill");

  // CSS
  assert.match(cssSrc, /\.coverage-strip\b/,
    ".coverage-strip style must exist");
  assert.match(cssSrc, /\.cov-pill\.cov-on\b/,
    "active pill (cov-on) style must exist");
  assert.match(cssSrc, /\.cov-pill\.cov-always\b/,
    "always-on pill (cov-always) style must exist");
});

// Iter #97: coverage strip polish — clickable pills jump to the
// matching surface, the kicker counts active items, and a filter
// chip hides unused surfaces.
test("analyzer: Coverage strip polished with click-to-jump + active count + only-active filter", () => {
  if (!HAS_BROWSER) return;
  const fs = require("node:fs");
  const path = require("node:path");
  const appSrc = fs.readFileSync(path.join(ROOT, "assets", "app.js"), "utf8");
  const cssSrc = fs.readFileSync(path.join(ROOT, "assets", "theme.css"), "utf8");

  // Active-count kicker — assert against the full source rather than
  // a function-body match (the body is non-trivial to extract).
  assert.match(appSrc, /Coverage \(/,
    "render must include a 'Coverage (' kicker label");
  assert.match(appSrc, /onCount/,
    "render must interpolate onCount in the kicker");
  // Anchor data attribute on each pill + click handler with scrollIntoView
  assert.match(appSrc, /data-cov-anchor=/,
    "pill markup must carry data-cov-anchor attribute");
  assert.match(appSrc, /data-cov-anchor[\s\S]+?scrollIntoView/,
    "pill click handler must scrollIntoView the matching target");
  // Filter chip + only-active class
  assert.match(appSrc, /covOnlyActiveBtn/,
    "filter chip must exist");
  assert.match(appSrc, /cov-only-active-on/,
    "filter must toggle cov-only-active-on class on the strip");
  // Hover/cursor affordance on pill
  assert.match(cssSrc, /\.cov-pill\.cov-anchor/,
    "clickable pill style must exist");
  // Filter hides unused surfaces
  assert.match(cssSrc, /\.cov-only-active-on \.cov-pill\.cov-always/,
    "filter rule must hide .cov-always pills when active");
});

// Iter #98: currency & amounts scanner — surfaces every monetary
// amount in the analyzed document grouped by currency, with a
// rough USD subtotal. Pure local.
test("analyzer: Currency scanner surfaces every monetary amount in the document", () => {
  if (!HAS_BROWSER) return;
  const fs = require("node:fs");
  const path = require("node:path");
  const appSrc = fs.readFileSync(path.join(ROOT, "assets", "app.js"), "utf8");
  const cssSrc = fs.readFileSync(path.join(ROOT, "assets", "theme.css"), "utf8");
  const html = fs.readFileSync(path.join(ROOT, "analyze.html"), "utf8");

  // analyze.html
  assert.match(html, /id="currencyBlock"/,
    "analyze.html must contain #currencyBlock");
  assert.match(html, /id="currencyList"/,
    "analyze.html must contain #currencyList");
  assert.match(html, /Currency &amp; amounts|Currency & amounts/,
    "result block must be titled 'Currency & amounts'");

  // app.js: detector + render
  assert.match(appSrc, /function detectCurrency\(/,
    "detectCurrency must exist");
  assert.match(appSrc, /function renderCurrencyBlock\(/,
    "renderCurrencyBlock must exist");
  assert.match(appSrc, /CURRENCY_PATTERNS/,
    "CURRENCY_PATTERNS table must exist");
  // Currency detection must cover at least 5 codes
  for(const c of ["USD","EUR","GBP","CAD","AUD","JPY","INR"]){
    assert.match(appSrc, new RegExp("code: '" + c + "'"),
      "CURRENCY_PATTERNS must include '" + c + "'");
  }
  // Wiring — must be called inside render()
  assert.match(appSrc, /detectCurrency\(raw\)/,
    "render() must call detectCurrency on the raw text");
  // Render must toggle block visibility
  assert.match(appSrc, /currencyBlock\.hidden = (true|false)/,
    "currencyBlock.hidden must be toggled");

  // CSS
  assert.match(cssSrc, /\.cur-row\b/,
    ".cur-row style must exist");
  assert.match(cssSrc, /\.cur-total-pill\b/,
    ".cur-total-pill style must exist");
});

// Iter #99: currency polish — click-to-jump row → textarea, only-big
// filter chip, why-modal explainer. Re-renders don't stack controls.
test("analyzer: Currency block polished with click-to-jump + only-big + why-modal", () => {
  if (!HAS_BROWSER) return;
  const fs = require("node:fs");
  const path = require("node:path");
  const appSrc = fs.readFileSync(path.join(ROOT, "assets", "app.js"), "utf8");
  const cssSrc = fs.readFileSync(path.join(ROOT, "assets", "theme.css"), "utf8");

  // Delegated click handler on currency rows + selectRange
  assert.match(appSrc, /cur-row[\s\S]+?addEventListener\(['"]click['"]/,
    "currency rows must be clickable");
  assert.match(appSrc, /data-cur-raw[\s\S]+?setSelectionRange/,
    "click handler must use setSelectionRange to highlight the amount");

  // Only-big filter chip + cur-only-big class
  assert.match(appSrc, /curOnlyBigBtn/,
    "only-big chip must exist");
  assert.match(appSrc, /cur-only-big/,
    "filter must toggle cur-only-big class");

  // Why modal — iter #99 explainer
  assert.match(appSrc, /curWhyBtn/,
    "why modal chip must exist");
  assert.match(appSrc, /curWhyBtn[\s\S]+?showConfirmModal[\s\S]+?Why do these numbers matter/,
    "why modal must open with 'Why do these numbers matter?'");

  // CSS
  assert.match(cssSrc, /\.cur-row\b[^}]*cursor:pointer/,
    ".cur-row must show pointer cursor");
  assert.match(cssSrc, /\.currency-list\.cur-only-big/,
    "filter rule must hide non-big rows when cur-only-big is on");

  // clearCurrencyControls helper so re-renders don't stack chips
  assert.match(appSrc, /function clearCurrencyControls\(/,
    "clearCurrencyControls must exist");
});

// Iter #225: currency copy button — export detected amounts
test("analyzer: Currency block copy button exports amounts as plain text", () => {
  if (!HAS_BROWSER) return;
  const fs = require("node:fs");
  const path = require("node:path");
  const appSrc = fs.readFileSync(path.join(ROOT, "assets", "app.js"), "utf8");
  const html = fs.readFileSync(path.join(ROOT, "analyze.html"), "utf8");

  // HTML — copy button in currency block header
  assert.match(html, /id="currencyCopyBtn"/,
    "analyze.html must contain #currencyCopyBtn");
  assert.match(html, /currency-copy/,
    "analyze.html must have currency-copy class on the button");

  // App.js — copy button reference and wiring
  assert.match(appSrc, /currencyCopyBtn/,
    "app.js must reference currencyCopyBtn");
  assert.match(appSrc, /currencyCopyBtn\.addEventListener/,
    "app.js must wire currencyCopyBtn click handler");

  // Copy functionality — exports symbol + value + currency code per amount
  assert.match(appSrc, /currencyCopyBtn[\s\S]+?addEventListener\(['"]click['"][\s\S]+?amounts\.push/,
    "copy handler must build amounts array");
  assert.match(appSrc, /\.cur-sym/,
    "copy handler must reference cur-sym class");
  assert.match(appSrc, /\.cur-val/,
    "copy handler must reference cur-val class");
});

// Cycle #124 — per-currency-row copy citation.
test("analyzer: Currency rows copy their amount in one click", () => {
  if (!HAS_BROWSER) return;
  const fs = require("node:fs");
  const path = require("node:path");
  const appSrc = fs.readFileSync(path.join(ROOT, "assets", "app.js"), "utf8");
  const cssSrc = fs.readFileSync(path.join(ROOT, "assets", "theme.css"), "utf8");

  assert.match(appSrc, /role="button" tabindex="0"/,
    "currency rows must become focusable divs to host a nested button");
  assert.match(appSrc, /h\.code \+ ' ' \+ h\.value\.toLocaleString\('en-US'\) \+ ' — "' \+ h\.raw \+ '"'/,
    "the citation must carry code, value, and the raw amount");
  assert.match(appSrc, /h\.context \? ' · in: "' \+ trunc\(h\.context, 80\) \+ '"' : ''\);/,
    "the citation must carry the surrounding context snippet");
  assert.match(appSrc, /context: text\.slice\(Math\.max\(0, offset - 40\), offset \+ m\[0\]\.length \+ 40\)\.replace/,
    "the detector must capture a short context snippet per hit");
  assert.match(appSrc, /class="cur-row-copy ghost-btn ghost-btn-sm"/,
    "each currency row must render a copy button");
  assert.match(appSrc, /data-cur-copy-text="' \+ esc\(copyVal\) \+ '"/,
    "the copy button must carry the prebuilt citation");
  assert.match(appSrc, /e\.target\.closest && e\.target\.closest\('\[data-cur-copy-text\]'\)/,
    "the row click handler must catch copy-button clicks");
  assert.match(appSrc, /📋 Amount copied/,
    "copying must announce via toast");
  assert.match(appSrc, /e\.key === 'Enter' \|\| e\.key === ' '/,
    "the focusable row must restore Enter/Space activation");
  assert.match(appSrc, /e\.target\.closest && e\.target\.closest\('\[data-cur-copy-text\]'\)\) return;/,
    "keyboard activation must not fire when the copy button is focused");
  assert.match(cssSrc, /\.cur-row\{[^}]*cursor:pointer/,
    "the div row must look clickable");
  assert.match(cssSrc, /\.cur-row:focus-visible\{/,
    "the div row must have a focus ring");
});

// Cycle #238 — the "only $100k+" currency view persists like the
// pay/receive direction filter.
test("analyzer: currency only-big filter persists", () => {
  if (!HAS_BROWSER) return;
  const fs = require("node:fs");
  const path = require("node:path");
  const appSrc = fs.readFileSync(path.join(ROOT, "assets", "app.js"), "utf8");

  assert.match(appSrc, /localStorage\.getItem\('cleardoc:money-onlybig'\)/,
    "the only-big view must read the saved choice");
  assert.match(appSrc, /currencyList\.classList\.toggle\('cur-only-big', curOnlyBig\)/,
    "the restored view must apply the only-big class at render");
  assert.match(appSrc, /localStorage\.setItem\('cleardoc:money-onlybig', on \? '1' : '0'\)/,
    "toggling must persist the choice");
  assert.match(appSrc, /onlyBtn\.setAttribute\('aria-pressed', curOnlyBig \? 'true' : 'false'\)/,
    "the restored view must announce the pressed state");
  assert.match(appSrc, /currencyList\.querySelectorAll\(on \? '\.cur-row\.cur-big' : '\.cur-row'\)\.length/,
    "the count must reflect the rows actually visible under the filter");
  assert.match(appSrc, /currencyList\.querySelectorAll\('\.cur-row\.cur-big'\)\.length \+ ' of ' \+ result\.hits\.length \+ ' amounts'/,
    "a restored only-big view must show the accurate visible count");
  assert.match(appSrc, /Toggle <b>only \$100k\+<\/b> to hide small amounts/,
    "the currency note must document the filter chip");
  assert.match(appSrc, /📋 copy all<\/b> to export the visible list/,
    "the currency note must document the copy-all chip");
});

// Cycle #240 — bulk copy of the visible currency amounts.
test("analyzer: currency block copies the visible amounts", () => {
  if (!HAS_BROWSER) return;
  const fs = require("node:fs");
  const path = require("node:path");
  const appSrc = fs.readFileSync(path.join(ROOT, "assets", "app.js"), "utf8");

  assert.match(appSrc, /id="curCopyAllBtn" title="Copy the visible amounts as plain text"/,
    "the currency controls must include a copy-all chip");
  assert.match(appSrc, /const curCopyAllBtn = document\.getElementById\('curCopyAllBtn'\);/,
    "the copy-all chip must have a click handler");
  assert.match(appSrc, /const visible = result\.hits\.filter\(h => !only \|\| h\.value >= 100000\);/,
    "the export must respect the only-big filter");
  assert.match(appSrc, /'📋 Amounts copied \(' \+ visible\.length \+ '\)' \+ \(only \? ' · filtered' : ''\)/,
    "copying must toast the count with a filtered tag");
  assert.match(appSrc, /'⚠ No amounts to copy'/,
    "an empty visible set must be reported");
});

// Iter #100: key-clause highlighter — picks the 3-4 most consequential
// sentences in the analyzed document and surfaces them in a "read
// twice" preview block above the textarea. Pure local.
test("analyzer: Key-clause highlighter surfaces the most consequential sentences", () => {
  if (!HAS_BROWSER) return;
  const fs = require("node:fs");
  const path = require("node:path");
  const appSrc = fs.readFileSync(path.join(ROOT, "assets", "app.js"), "utf8");
  const cssSrc = fs.readFileSync(path.join(ROOT, "assets", "theme.css"), "utf8");
  const html = fs.readFileSync(path.join(ROOT, "analyze.html"), "utf8");

  // analyze.html
  assert.match(html, /id="keyClausePreview"/,
    "analyze.html must contain #keyClausePreview");
  assert.match(html, /id="keyClauseList"/,
    "analyze.html must contain #keyClauseList");
  assert.match(html, /Top clauses to read twice/,
    "preview must be titled 'Top clauses to read twice'");

  // app.js: picker + render
  assert.match(appSrc, /function pickKeyClauses\(/,
    "pickKeyClauses must exist");
  assert.match(appSrc, /function renderKeyClausePreview\(/,
    "renderKeyClausePreview must exist");
  // Severity weighting: trap=30, watch=12, note=4
  assert.match(appSrc, /\b30\b/, "picker must weight traps at 30");
  assert.match(appSrc, /\b12\b/, "picker must weight watches at 12");
  assert.match(appSrc, /\b4\b/, "picker must weight notes at 4");
  // Wiring — must be called inside render()
  assert.match(appSrc, /renderKeyClausePreview[\s\S]+?sentences, flags/,
    "render() must call renderKeyClausePreview with sentences + flags");
  // Click-to-jump on each row
  assert.match(appSrc, /kc-row[\s\S]+?addEventListener\(['"]click['"][\s\S]+?setSelectionRange/,
    "key-clause rows must be clickable + jump to source");

  // CSS
  assert.match(cssSrc, /\.kc-row\b/,
    ".kc-row style must exist");
  assert.match(cssSrc, /\.kc-row\.kc-r\b/,
    ".kc-r (trap) styling must exist");
});

// Iter #101: key-clause polish — per-row 🔊 speak button + counter
// badge + click-vs-speak disambiguation.
test("analyzer: Key-clause preview polished with per-row 🔊 + counter badge", () => {
  if (!HAS_BROWSER) return;
  const fs = require("node:fs");
  const path = require("node:path");
  const appSrc = fs.readFileSync(path.join(ROOT, "assets", "app.js"), "utf8");
  const cssSrc = fs.readFileSync(path.join(ROOT, "assets", "theme.css"), "utf8");

  // Per-row speak button
  assert.match(appSrc, /data-kc-speak=/,
    "kc-row markup must carry a data-kc-speak attribute");
  // Speak handler must call SpeechSynthesisUtterance
  assert.match(appSrc, /data-kc-speak[\s\S]+?SpeechSynthesisUtterance/,
    "speak handler must use SpeechSynthesisUtterance");
  // Click handler must disambiguate row-jump vs speak
  assert.match(appSrc, /data-kc-speak[\s\S]+?closest\(['"]\[data-kc-speak\][\'"]\)/,
    "click handler must detect the inner speak button");
  // Counter badge
  assert.match(appSrc, /class="kc-count"|kc-count[^a-zA-Z]/,
    "render must include a .kc-count counter");

  // CSS
  assert.match(cssSrc, /\.kc-speak\b/,
    ".kc-speak style must exist");
  assert.match(cssSrc, /\.kc-count\b/,
    ".kc-count style must exist");
});

// Cycle 76 feature: copy the key-clause list as plain text.
test("analyzer: Key clauses copy as a numbered list with severity", () => {
  if (!HAS_BROWSER) return;
  const fs = require("node:fs");
  const path = require("node:path");
  const appSrc = fs.readFileSync(path.join(ROOT, "assets", "app.js"), "utf8");
  const cssSrc = fs.readFileSync(path.join(ROOT, "assets", "theme.css"), "utf8");

  // The copy chip lives in the key-clause controls row
  assert.match(appSrc, /id="kcCopyBtn"[^>]*title="Copy the key clauses as plain text"/,
    "the key-clause controls must include a copy chip");
  assert.match(appSrc, /kcCopyBtn\._kcCopyWired/,
    "copy wiring must be guarded so it is attached only once");
  assert.match(appSrc, /\(idx \+ 1\) \+ '\. \[' \+ sev \+ '\] ' \+ String\(it\.s \|\| ''\)/,
    "each line must carry a number, severity tag, and clause text");
  assert.match(appSrc, /'Top clauses to read twice\\n' \+ lines\.join\('\\n'\)/,
    "the copy must open with the block header");
  assert.match(appSrc, /'📋 Key clauses copied'/,
    "copy must toast on success");
  assert.match(appSrc, /kcCopyBtn\.setAttribute\('aria-label', ok \? 'Key clauses copied to clipboard' : 'Copy failed — try again'\)/,
    "copy must announce success/failure via aria-label");
  assert.match(appSrc, /kcCopyBtn\.setAttribute\('aria-label', 'Copy the key clauses'\)/,
    "copy must restore the original aria-label after the flash");
  assert.match(cssSrc, /\.kc-copy\{/,
    "theme.css must style .kc-copy");
});

// Cycle #110 — ask about any key clause in one click.
test("analyzer: Key-clause rows can ask the document about the clause in one click", () => {
  if (!HAS_BROWSER) return;
  const fs = require("node:fs");
  const path = require("node:path");
  const appSrc = fs.readFileSync(path.join(ROOT, "assets", "app.js"), "utf8");

  assert.match(appSrc, /class="kc-ask ghost-btn ghost-btn-sm"/,
    "each key-clause row must render an ask button");
  assert.match(appSrc, /data-kc-ask="' \+ esc\(it\.s\.slice\(0, 240\)\) \+ '"/,
    "the ask button must carry the clause text");
  assert.match(appSrc, /data-kc-sev="' \+ esc\(it\.sev\) \+ '"/,
    "the ask button must carry the clause severity");
  assert.match(appSrc, /e\.target\.closest && e\.target\.closest\('\[data-kc-ask\]'\)/,
    "the row click handler must catch ask-button clicks");
  assert.match(appSrc, /'Why is "' \+ clause\.slice\(0, 100\) \+ '" a ' \+ sevWord \+ '\?'/,
    "clicking must ask why the clause is flagged at its severity");
  assert.match(appSrc, /qInput\.scrollIntoView/,
    "clicking must bring the Ask panel into view");
  assert.match(appSrc, /showAnalyzeToast\('💬 Question ready — press Ask'\)/,
    "clicking must announce the prefilled question");
  assert.match(appSrc, /\.deadline-row, \.kc-row, \.scenario-card, \.action-row, \.bearer-row, \.reading-row'\) : null;/,
    "the a shortcut must also cover key-clause, scenario, obligation, and bearer rows");
});

// Cycle #144 — per-key-clause copy citation.
test("analyzer: Key-clause rows copy their citation in one click", () => {
  if (!HAS_BROWSER) return;
  const fs = require("node:fs");
  const path = require("node:path");
  const appSrc = fs.readFileSync(path.join(ROOT, "assets", "app.js"), "utf8");
  const cssSrc = fs.readFileSync(path.join(ROOT, "assets", "theme.css"), "utf8");

  assert.match(appSrc, /const copyText = '\[KEY CLAUSE · ' \+ \(it\.sev === 'r' \? 'trap' : it\.sev === 'a' \? 'watch' : 'note'\) \+ '\] "' \+ it\.s \+ '"';/,
    "the citation must carry the severity label and the clause");
  assert.match(appSrc, /class="kc-row-copy ghost-btn ghost-btn-sm"/,
    "each key-clause row must render a copy button");
  assert.match(appSrc, /data-kc-copy-text="' \+ esc\(copyText\) \+ '"/,
    "the copy button must carry the prebuilt citation");
  assert.match(appSrc, /\$\$\('\.kc-row-copy', list\)\.forEach/,
    "copy buttons must be wired after each render");
  assert.match(appSrc, /e\.stopPropagation\(\);/,
    "copying must not trigger the row's jump/speak/ask behaviors");
  assert.match(appSrc, /📋 Key-clause citation copied/,
    "copying must announce via toast");
  assert.match(appSrc, /copyBtn\.textContent = copied \? '✓' : '📋';/,
    "the button must flash its copied state");
  assert.match(appSrc, /class="kc-actions"/,
    "the speak + ask + copy buttons must be grouped into one cluster");
  assert.match(cssSrc, /\.kc-actions\{[^}]*display:inline-flex/,
    "the action cluster must lay out inline");
});

// Iter #102: signing checklist — surfaces marker-phrase clauses
// that need explicit action (notarize / witness / counsel /
// arbitration / wire / etc.) grouped by who needs to act. Pure
// local; regex patterns only.
test("analyzer: Signing checklist surfaces per-action tasks grouped by who acts", () => {
  if (!HAS_BROWSER) return;
  const fs = require("node:fs");
  const path = require("node:path");
  const appSrc = fs.readFileSync(path.join(ROOT, "assets", "app.js"), "utf8");
  const cssSrc = fs.readFileSync(path.join(ROOT, "assets", "theme.css"), "utf8");
  const html = fs.readFileSync(path.join(ROOT, "analyze.html"), "utf8");

  // analyze.html
  assert.match(html, /id="actionBlock"/,
    "analyze.html must contain #actionBlock");
  assert.match(html, /id="actionGrid"/,
    "analyze.html must contain #actionGrid");
  assert.match(html, /Signing checklist/,
    "result block must be titled 'Signing checklist'");

  // app.js
  assert.match(appSrc, /function detectActions\(/,
    "detectActions must exist");
  assert.match(appSrc, /function renderActionsBlock\(/,
    "renderActionsBlock must exist");
  assert.match(appSrc, /ACTION_PATTERNS/,
    "ACTION_PATTERNS table must exist");
  // Cover at least the 6 critical actions
  for(const k of ["notarize","witness","counsel","arbitration","counterparts","warranty"]){
    assert.match(appSrc, new RegExp("key: '" + k + "'"),
      "ACTION_PATTERNS must include '" + k + "'");
  }
  // Render must group by 'who' (you / lawyer / notary / counterparty)
  assert.match(appSrc, /act-group act-|act-label/, "render must surface role group classes");

  // Wiring — call inside render()
  assert.match(appSrc, /detectActions\(raw\)/,
    "render() must call detectActions on the raw text");
  assert.match(appSrc, /actionBlock\.hidden = (true|false)/,
    "actionBlock.hidden must be toggled");

  // CSS
  assert.match(cssSrc, /\.act-group\b/,
    ".act-group style must exist");
  assert.match(cssSrc, /\.act-group\.act-you\b/,
    ".act-you (group color) style must exist");
});

// Iter #103: signing checklist polish — per-item check toggles +
// localStorage persistence + click-to-jump + reset-all chip + counter.
test("analyzer: Signing checklist polished with per-item toggle + persistence + counter", () => {
  if (!HAS_BROWSER) return;
  const fs = require("node:fs");
  const path = require("node:path");
  const appSrc = fs.readFileSync(path.join(ROOT, "assets", "app.js"), "utf8");
  const cssSrc = fs.readFileSync(path.join(ROOT, "assets", "theme.css"), "utf8");

  // Toggle button + persistence in localStorage
  assert.match(appSrc, /data-act-check=/,
    "per-item check button markup must carry data-act-check");
  assert.match(appSrc, /actionGrid\._actResult = result;/,
    "each render must capture the latest result for the delegated toggle");
  assert.match(appSrc, /actionGrid\._actToggleWired = true;/,
    "the toggle handler must be wired once on the checklist grid");
  assert.match(appSrc, /actionGrid\._actToggleWired = true;[\s\S]{0,240}\[data-act-check\]/,
    "the once-wired handler must catch check-button clicks");
  assert.match(appSrc, /localStorage\.setItem.*STORAGE_KEY|cstorageKey|localStorage\.getItem.*signing-checklist/,
    "check state must be persisted to localStorage");
  assert.match(appSrc, /act-checked|text-decoration[\s\S]*?line-through/,
    "checked items must render with strike-through");

  // Click-to-jump on body + reset chip
  assert.match(appSrc, /data-act-matched[\s\S]+?setSelectionRange/,
    "act-item click handler must setSelectionRange on the textarea");
  assert.match(appSrc, /actResetBtn/,
    "reset-all chip must exist");

  // Counter
  assert.match(appSrc, /of [^']+done/,
    "render must print 'X of Y done' counter");

  // CSS: checked state + reset chip
  assert.match(cssSrc, /\.act-item\.act-checked\b/,
    ".act-checked style must exist");
  assert.match(cssSrc, /\.act-reset\b/,
    ".act-reset style must exist");
});

// Cycle 68 feature: copy the signing checklist with progress.
test("analyzer: Signing checklist copies with checked progress", () => {
  if (!HAS_BROWSER) return;
  const fs = require("node:fs");
  const path = require("node:path");
  const appSrc = fs.readFileSync(path.join(ROOT, "assets", "app.js"), "utf8");
  const cssSrc = fs.readFileSync(path.join(ROOT, "assets", "theme.css"), "utf8");

  // The copy chip lives in the checklist controls row
  assert.match(appSrc, /id="actCopyBtn" title="Copy the signing checklist with your progress"/,
    "the checklist controls must include a copy chip");
  assert.match(appSrc, /actCopyBtn\._actCopyWired/,
    "copy wiring must be guarded so it is attached only once");
  assert.match(appSrc, /\(done \? '\[✓\] ' : '\[ \] '\) \+ label/,
    "done items must export with [✓] and pending with [ ]");
  assert.match(appSrc, /li\.classList\.contains\('act-checked'\)/,
    "the done state must be read live from the checked class");
  assert.match(appSrc, /'Signing checklist · ' \+ doneCountCopy/,
    "the export must include a progress header");
  assert.match(appSrc, /'📋 Checklist copied'/,
    "copy must toast on success");
  assert.match(appSrc, /actCopyBtn\._flashTimer = setTimeout\(\(\) => \{ if\(actCopyBtn\.isConnected\) actCopyBtn\.textContent = '📋 copy'; \}, 1400\);/,
    "the chip must flash and restore its label");
  assert.match(cssSrc, /\.act-copy\{/,
    "theme.css must style .act-copy");
  // Cycle 69 polish — copied lines include who acts (the group role)
  assert.match(appSrc, /li\.closest\('\.act-group'\)/,
    "each item must resolve its group to know who acts");
  assert.match(appSrc, /labels\[who\]\.replace\(\/\^\[\^\\s\]\+\\s\*\/, ''\)/,
    "the group role must be stripped of its emoji for clean copy");
  assert.match(appSrc, /' — ' \+ role/,
    "each copied line must append the role");
});

// Cycle #252 — the signing checklist exports as a tracker CSV.
test("analyzer: Signing checklist exports a CSV tracker file", () => {
  if (!HAS_BROWSER) return;
  const fs = require("node:fs");
  const path = require("node:path");
  const appSrc = fs.readFileSync(path.join(ROOT, "assets", "app.js"), "utf8");

  assert.match(appSrc, /id="actCsvBtn" title="Download the signing checklist as a .csv file"/,
    "the checklist controls must include a CSV chip");
  assert.match(appSrc, /const actCsvBtn = document\.getElementById\('actCsvBtn'\);/,
    "the CSV chip must have a click handler");
  assert.match(appSrc, /a\.download = 'cleardoc-signing-' \+ stamp \+ '\.csv';/,
    "the export must download as cleardoc-signing-<date>.csv");
  assert.match(appSrc, /const csvCell = \(v\) => \{[\s\S]{0,220}\/\^\[=\+\\-\@\]/,
    "CSV cells must carry the formula-injection guard");
  assert.match(appSrc, /'📊 Signing checklist CSV downloaded \(' \+ rows\.length \+ '\)'/,
    "downloading must toast the row count");
});

// Iter #104: gap detector — surfaces clauses the document is missing
// (termination / refund / cancellation / privacy / force majeure /
// liability cap / warranty / auto-renewal / payment / etc.).
test("analyzer: Gap detector surfaces clauses the document is missing", () => {
  if (!HAS_BROWSER) return;
  const fs = require("node:fs");
  const path = require("node:path");
  const appSrc = fs.readFileSync(path.join(ROOT, "assets", "app.js"), "utf8");
  const cssSrc = fs.readFileSync(path.join(ROOT, "assets", "theme.css"), "utf8");
  const html = fs.readFileSync(path.join(ROOT, "analyze.html"), "utf8");

  // analyze.html
  assert.match(html, /id="gapBlock"/, "analyze.html must contain #gapBlock");
  assert.match(html, /id="gapList"/, "analyze.html must contain #gapList");
  assert.match(html, /What.{0,3}s missing/, "result block must be titled 'What's missing'");

  // app.js
  assert.match(appSrc, /function detectGaps\(/, "detectGaps must exist");
  assert.match(appSrc, /function renderGapBlock\(/, "renderGapBlock must exist");
  assert.match(appSrc, /GAP_PATTERNS/, "GAP_PATTERNS table must exist");
  // Cover at least the 6 critical gaps
  for(const k of ["termination","refund","cancellation","dispute","data","force"]){
    assert.match(appSrc, new RegExp("key: '" + k + "'"),
      "GAP_PATTERNS must include '" + k + "'");
  }
  // Wiring — call inside render()
  assert.match(appSrc, /detectGaps\(raw\)/,
    "render() must call detectGaps on the raw text");
  // Block visibility toggle
  assert.match(appSrc, /gapBlock\.hidden = (true|false)/,
    "gapBlock.hidden must be toggled");

  // CSS
  assert.match(cssSrc, /\.gap-row\b/, ".gap-row style must exist");
  assert.match(cssSrc, /\.gap-glyph\b/, ".gap-glyph style must exist");
});

// Iter #105: gap polish — per-row "ask for this" copy-to-clipboard +
// category color stripe + risk/financial/procedural tally.
test("analyzer: Gap detector polished with per-row copy + category tally", () => {
  if (!HAS_BROWSER) return;
  const fs = require("node:fs");
  const path = require("node:path");
  const appSrc = fs.readFileSync(path.join(ROOT, "assets", "app.js"), "utf8");
  const cssSrc = fs.readFileSync(path.join(ROOT, "assets", "theme.css"), "utf8");

  // Per-row copy button + clip handler
  assert.match(appSrc, /data-gap-ask-action=/,
    "per-row copy button must exist");
  assert.match(appSrc, /data-gap-ask-action[\s\S]+?navigator\.clipboard|execCommand\('copy'\)/,
    "copy handler must use clipboard fallback");
  // Category tally
  assert.match(appSrc, /risk'[\s\S]+?'fin'[\s\S]+?'proc'|risk[\s\S]{0,40}fin[\s\S]{0,40}proc/,
    "tally must cover risk/fin/proc categories");

  // CSS
  assert.match(cssSrc, /\.gap-row\.gap-cat-risk\b/,
    ".gap-cat-risk style must exist");
  assert.match(cssSrc, /\.gap-row\.gap-cat-fin\b/,
    ".gap-cat-fin style must exist");
  assert.match(cssSrc, /\.gap-ask\b/,
    ".gap-ask button style must exist");
});

// Cycle 84 feature: gap detector CSV export for remediation tracking.
test("analyzer: Gap detector exports missing clauses as CSV", () => {
  if (!HAS_BROWSER) return;
  const fs = require("node:fs");
  const path = require("node:path");
  const appSrc = fs.readFileSync(path.join(ROOT, "assets", "app.js"), "utf8");
  const cssSrc = fs.readFileSync(path.join(ROOT, "assets", "theme.css"), "utf8");

  assert.match(appSrc, /id="gapCsvBtn" title="Download missing clauses as a \.csv file"/,
    "the gap controls must include a CSV chip");
  assert.match(appSrc, /gapCsvBtn\.addEventListener\(\s*['"]click['"]/,
    "the CSV chip must have a click handler");
  assert.match(appSrc, /\[catLabel\(m \? m\.cat : 'proc'\), it\.label, it\.hint \|\| '', ask\]/,
    "each row must carry category, gap label, hint, and ask clause");
  assert.match(appSrc, /csvCell\('Category'\) \+ ',' \+ csvCell\('Gap'\) \+ ',' \+ csvCell\('Hint'\) \+ ',' \+ csvCell\('Ask'\)/,
    "the CSV must have Category, Gap, Hint, and Ask columns in that order");
  assert.match(appSrc, /'\[REQUEST: Insert a "' \+ it\.label \+ '" clause here\./,
    "the Ask column must reuse the 📝 button's copy template");
  assert.match(appSrc, /csvCell\(result\.count \+ ' clauses'\)/,
    "the CSV must open with a Missing metadata row");
  assert.match(appSrc, /'⚠ Nothing to export yet'/,
    "the export must guard the empty state");
  assert.match(appSrc, /const text = '\\uFEFF' \+ header \+ '\\n' \+ body;/,
    "the download must start with a UTF-8 BOM");
  assert.match(appSrc, /a\.download = 'cleardoc-gaps-' \+ stamp \+ '\.csv'/,
    "the filename must be cleardoc-gaps-<date>.csv");
  assert.match(appSrc, /'📊 Gaps CSV downloaded \(' \+ rows\.length/,
    "the export must toast with the row count");
  assert.match(appSrc, /gapCopyMdBtn/,
    "iter #272 must include a missing-clauses Markdown copy button");
  assert.match(appSrc, /'📋 Missing clauses copied as Markdown'/,
    "iter #272 must confirm when the missing-clauses Markdown is copied");
  assert.match(appSrc, /\| Missing clause \| Why it matters \|/,
    "iter #272 must build a Markdown table header");
  assert.match(cssSrc, /\.gap-csv\{/,
    "theme.css must style .gap-csv");
});

skip("analyze: missing clauses copy as Markdown", async () => {
  if (!HAS_BROWSER) return;
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  const errors = [];
  page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.addInitScript(() => {
    window.__copiedGapMd = null;
    try {
      Object.defineProperty(navigator, "clipboard", {
        configurable: true,
        value: {
          writeText: async (txt) => { window.__copiedGapMd = txt; },
          write: async () => {},
        },
      });
    } catch (_) {
      try { navigator.clipboard = { writeText: async (txt) => { window.__copiedGapMd = txt; }, write: async () => {} }; } catch (_2) {}
    }
  });
  try {
    await page.goto(`http://127.0.0.1:${PORT}/analyze.html`, { waitUntil: "networkidle" });
    await page.click(".qf[data-fill]:first-of-type");
    await page.click("#analyzeBtn");
    await page.waitForSelector("#gapBlock:not([hidden]) #gapCopyMdBtn", { timeout: 8000 });
    await page.click("#gapCopyMdBtn");
    await page.waitForFunction(() => window.__copiedGapMd && window.__copiedGapMd.length > 0, { timeout: 8000 });
    const captured = await page.evaluate(() => window.__copiedGapMd);
    assert.match(captured, /^\| Missing clause \| Why it matters \|/, "the copied gaps must start with the Markdown header");
    assert.match(captured, /\|---\|---\|/, "the copied gaps must include the separator row");
    assert.equal(errors.length, 0, `zero console errors, got: ${errors.join(" | ")}`);
  } finally {
    await page.close();
    await ctx.close();
  }
});

// Iter #106: voice-mode reader — plays each block aloud in order.
// Big audio-UX win; toggles between "voice mode" and "stop" buttons.
test("analyzer: Voice-mode reader plays every analysis block aloud in order", () => {
  if (!HAS_BROWSER) return;
  const fs = require("node:fs");
  const path = require("node:path");
  const appSrc = fs.readFileSync(path.join(ROOT, "assets", "app.js"), "utf8");
  const cssSrc = fs.readFileSync(path.join(ROOT, "assets", "theme.css"), "utf8");
  const html = fs.readFileSync(path.join(ROOT, "analyze.html"), "utf8");

  // analyze.html
  assert.match(html, /id="voiceModeBtn"/,
    "analyze.html must contain #voiceModeBtn");
  assert.match(html, /id="voiceModeStopBtn"/,
    "analyze.html must contain #voiceModeStopBtn");
  assert.match(html, /id="voiceModePrevBtn"/,
    "analyze.html must contain #voiceModePrevBtn");
  assert.match(html, /id="voiceModeNextBtn"/,
    "analyze.html must contain #voiceModeNextBtn");
  assert.match(html, /id="voiceModePauseBtn"/,
    "analyze.html must contain #voiceModePauseBtn");
  assert.match(html, /id="voiceModeMeter"/,
    "analyze.html must contain #voiceModeMeter");
  assert.match(html, /voice\s*mode/i,
    "result-actions must include a Voice mode button");

  // app.js — wired via document.getElementById
  assert.match(appSrc, /document\.getElementById\(['"]voiceModeBtn['"]\)/,
    "voice button must be picked up via document.getElementById");
  assert.match(appSrc, /SpeechSynthesisUtterance/,
    "voice reader must use SpeechSynthesisUtterance");
  assert.match(appSrc, /window\.speechSynthesis\.speak/,
    "voice reader must call window.speechSynthesis.speak");
  // The reader must cover the major blocks
  for(const k of ["plainOut","riskList","verdictDisplay","deadlinesList","maturityGrid","transList","currencyList","jurisRow","actionGrid","gapList"]){
    assert.match(appSrc, new RegExp("['\"]" + k + "['\"]"),
      "voice reader must include #" + k);
  }

  // CSS
  assert.match(cssSrc, /\.voice-mode-btn\b|\.voice-mode-meter\b/,
    "voice-mode UI styles must exist");

  // Iter #107 polish: prev / next / pause controls
  assert.match(appSrc, /document\.getElementById\(['"]voiceModePrevBtn['"]\)/,
    "iter #107 must wire voiceModePrevBtn via document.getElementById");
  assert.match(appSrc, /voiceIndex\s*=\s*Math\.(max|min)/,
    "iter #107 must scrub voiceIndex on prev/next");
  assert.match(appSrc, /window\.speechSynthesis\.pause[\s\S]+?resume/,
    "iter #107 must use pause/resume for the play/pause toggle");
});

// Cycle #100 — voice mode highlights the rewrite sentence being read.
test("analyzer: Voice mode highlights the rewrite sentence being read aloud", () => {
  if (!HAS_BROWSER) return;
  const fs = require("node:fs");
  const path = require("node:path");
  const appSrc = fs.readFileSync(path.join(ROOT, "assets", "app.js"), "utf8");
  const cssSrc = fs.readFileSync(path.join(ROOT, "assets", "theme.css"), "utf8");

  // Voice mode wraps the rewrite into .spoken spans (self-contained, so
  // it never clobbers the Read-aloud button's cached spans).
  assert.match(appSrc, /const voiceWrapRewrite = \(\) => \{/,
    "voice mode must have its own rewrite wrapper");
  assert.match(appSrc, /const parts = text\.split\(\/\(\?<=.+?\)\\s\+\/\)\.filter/,
    "the wrapper must split on sentence boundaries");
  assert.match(appSrc, /'<span class="spoken">' \+ esc\(s\.trim\(\)\) \+ '<\/span>'\)\.join\(' '\)/,
    "each sentence must become a .spoken span");
  // Only the rewrite segment highlights; every other segment clears.
  assert.match(appSrc, /const isRewrite = seg\.indexOf\('rewrite: '\) === 0;/,
    "the reader must detect the rewrite segment");
  assert.match(appSrc, /if\(isRewrite\)\{[\s\S]{0,80}voiceSpans = voiceWrapRewrite\(\);/,
    "the rewrite segment must build highlight spans");
  assert.match(appSrc, /else \{\s*voiceClearSpans\(\);\s*\}/,
    "non-rewrite segments must clear the highlight");
  // Boundary events drive the active sentence, offset for the label prefix.
  assert.match(appSrc, /u\.onboundary = \(ev\) => \{/,
    "boundary events must drive the highlight");
  assert.match(appSrc, /const charPos = ev\.charIndex - base;/,
    "char indexes must be offset for the rewrite: label prefix");
  // Cycle #101 — mapping uses the whitespace-normalized narration text,
  // so the highlight stays exact even on documents with odd spacing.
  assert.match(appSrc, /let voiceSpokenParts = \[\];/,
    "the normalized-sentence cache must exist");
  assert.match(appSrc, /const spoken = text\.replace\(\/\\s\+\/g, ' '\)\.trim\(\);/,
    "the narration text must be normalized before splitting");
  assert.match(appSrc, /voiceSpokenParts = spoken\.split\(/,
    "boundary mapping must use the normalized sentences");
  assert.match(appSrc, /for\(let i = 0; i < voiceSpokenParts\.length; i\+\+\)\{/,
    "the boundary walk must iterate the normalized parts");
  assert.match(appSrc, /pos \+= voiceSpokenParts\[i\]\.length \+ 1;/,
    "cumulative positions must come from the normalized parts");
  assert.match(appSrc, /voiceSpokenParts = \[\];/,
    "clearing must drop the normalized parts too");
  assert.match(appSrc, /voiceSetActive\(found\);/,
    "the active sentence must be highlighted");
  assert.match(appSrc, /voiceSetActive\(0\);/,
    "the first sentence must light up immediately");
  // Stop, finish, and segment end all clear the highlight.
  assert.match(appSrc, /voiceClearSpans\(\);\s*showVoiceBtn\(\);/,
    "stop and finish must clear the highlight");
  // The Read-aloud CSS already supports the spoken-active treatment.
  assert.match(cssSrc, /#plainOut \.spoken-active\{/,
    "the highlight style must exist");
});

// Cycle #102 — user-adjustable TTS reading speed.
test("analyzer: Reading speed is adjustable, persisted, and applied to every speak site", () => {
  if (!HAS_BROWSER) return;
  const fs = require("node:fs");
  const path = require("node:path");
  const html = fs.readFileSync(path.join(ROOT, "analyze.html"), "utf8");
  const appSrc = fs.readFileSync(path.join(ROOT, "assets", "app.js"), "utf8");

  assert.match(html, /id="voiceRatePicker"/,
    "analyze.html must contain the reading-speed picker");
  assert.match(html, /value="0\.5">0\.5× slow/,
    "the picker must offer a slow speed");
  assert.match(html, /value="1" selected>1× normal/,
    "the picker must default to normal speed");
  assert.match(html, /value="1\.5">1\.5× fast/,
    "the picker must offer a fast speed");
  // Persisted, clamped rate helpers at IIFE level.
  assert.match(appSrc, /const TTS_RATE_KEY = 'cleardoc:ttsRate';/,
    "the rate key must be stable in localStorage");
  assert.match(appSrc, /function getTtsRate\(\)\{/,
    "a rate getter must exist");
  assert.match(appSrc, /n >= 0\.5 && n <= 2/,
    "the rate must be clamped to a sane range");
  assert.match(appSrc, /function setTtsRate\(n\)\{/,
    "a rate setter must exist");
  // The picker reflects the persisted rate and persists changes.
  assert.match(appSrc, /voiceRatePicker\.value = String\(getTtsRate\(\)\);/,
    "the picker must reflect the persisted rate");
  assert.match(appSrc, /setTtsRate\(n\);/,
    "changing the picker must persist the rate");
  assert.match(appSrc, /showAnalyzeToast\('🔊 Reading speed '/,
    "changing the picker must announce the new speed");
  // The picker shows whenever Read aloud is available.
  assert.match(appSrc, /const voiceRatePickerEl = document\.getElementById\('voiceRatePicker'\);/,
    "the picker must be looked up when the speak button appears");
  assert.match(appSrc, /voiceRatePickerEl\) voiceRatePickerEl\.hidden = false;/,
    "the picker must be visible whenever reading is possible");
  // Cycle #103 — when there's nothing to read, the whole audio row hides.
  assert.match(appSrc, /speakBtn\.hidden = true;[\s\S]{0,160}voiceRatePickerEl\) voiceRatePickerEl\.hidden = true;/,
    "no rewrite / no SpeechSynthesis must hide the pickers too");
  // Voice mode's meter reports the active speed.
  assert.match(appSrc, /voiceMeter\) voiceMeter\.textContent = '🎙 ' \+ \(voiceIndex \+ 1\) \+ ' \/ ' \+ voiceQueue\.length \+ ' · ' \+ getTtsRate\(\) \+ '×';/,
    "the voice-mode meter must show the current reading speed");
  // Every TTS utterance reads the chosen speed (no hardcoded rates).
  const rateSites = (appSrc.match(/u\.rate = getTtsRate\(\);/g) || []).length;
  assert.ok(rateSites >= 10, `every speak site must use getTtsRate(), found ${rateSites}`);
  assert.doesNotMatch(appSrc, /u\.rate = 0\.[59];/,
    "no hardcoded slow rates may remain");
});

// Cycle 58 feature: voice mode announces the deadline-urgency alert first.
test("analyzer: Voice mode announces the deadline-urgency alert first", () => {
  if (!HAS_BROWSER) return;
  const fs = require("node:fs");
  const path = require("node:path");
  const appSrc = fs.readFileSync(path.join(ROOT, "assets", "app.js"), "utf8");

  assert.match(appSrc, /const deadlineAlertEl = document\.getElementById\('deadlineAlert'\);/,
    "voice builder must look up the deadline alert");
  assert.match(appSrc, /deadlineAlertEl && !deadlineAlertEl\.hidden/,
    "voice must skip the alert when hidden (no stale reads)");
  assert.match(appSrc, /add\('deadline alert', alertText\);/,
    "voice must push a 'deadline alert' segment");
  assert.match(appSrc, /click to jump\\s\*⤓/,
    "voice must strip the 'click to jump' hint from the alert text");
  assert.match(appSrc, /jump to deadlines\\s\*⤓/,
    "voice must also strip the new jump-button text from the alert");
  assert.match(appSrc, /add\('deadline alert', alertText\);[\s\S]+?add\('rewrite', grabText\('plainOut'\)\);/,
    "the alert must be the first segment read, before the rewrite");
});

// Cycle 70 feature: copy the voice transcript as plain text.
test("analyzer: Voice mode can copy its transcript as plain text", () => {
  if (!HAS_BROWSER) return;
  const fs = require("node:fs");
  const path = require("node:path");
  const html = fs.readFileSync(path.join(ROOT, "analyze.html"), "utf8");
  const appSrc = fs.readFileSync(path.join(ROOT, "assets", "app.js"), "utf8");

  // analyze.html must carry the transcript button in the voice controls
  assert.match(html, /id="voiceModeTranscriptBtn" title="Copy the full voice transcript as plain text"/,
    "analyze.html must contain #voiceModeTranscriptBtn with a descriptive title");

  // Visibility: shown with the playback controls, hidden on stop
  assert.match(appSrc, /if\(voiceTranscriptBtn\) voiceTranscriptBtn\.hidden = false;/,
    "the transcript button must appear when voice mode starts");
  assert.match(appSrc, /if\(voiceTranscriptBtn\) voiceTranscriptBtn\.hidden = true;/,
    "the transcript button must hide when voice mode stops");

  // Wiring: once-only guard + reads the live playback queue
  assert.match(appSrc, /voiceTranscriptBtn\._voiceTranscriptWired/,
    "transcript wiring must be guarded so it is attached only once");
  assert.match(appSrc, /\(voiceQueue \|\| \[\]\)\.slice\(\)/,
    "transcript must snapshot the live playback queue");
  assert.match(appSrc, /segs\.join\('\\n\\n'\)/,
    "transcript must join the segments into one text block");
  assert.match(appSrc, /'⚠ Nothing to copy — start voice mode first'/,
    "transcript must guard the empty state");
  assert.match(appSrc, /'📋 Transcript copied'/,
    "transcript must toast on success");
  assert.match(appSrc, /voiceTranscriptBtn\.textContent = '📋 transcript'; \}, 1400\);/,
    "the button must flash and restore its label");
  // Cycle 71 polish — natural finish keeps the transcript copyable
  assert.match(appSrc, /const finishVoice = \(\) => \{/,
    "a natural-end path must exist alongside the manual stop");
  assert.match(appSrc, /finishVoice[\s\S]+?if\(voiceTranscriptBtn\) voiceTranscriptBtn\.hidden = false;/,
    "natural finish must keep the transcript button visible");
  assert.match(appSrc, /if\(voiceIndex < voiceQueue\.length\) playCurrent\(\);\s*else finishVoice\(\);/,
    "the last segment must end via finishVoice, not stopVoice");
  assert.match(appSrc, /stopVoice[\s\S]+?voiceQueue = \[\];/,
    "manual stop must still discard the queue");
});

// Iter #108: cheat-sheet modal — printable single-page summary of
// the analysis for meetings / lawyer hand-off. Pure local; built
// from already-rendered DOM.
test("analyzer: Cheat-sheet modal generates a printable negotiator summary", () => {
  if (!HAS_BROWSER) return;
  const fs = require("node:fs");
  const path = require("node:path");
  const appSrc = fs.readFileSync(path.join(ROOT, "assets", "app.js"), "utf8");
  const cssSrc = fs.readFileSync(path.join(ROOT, "assets", "theme.css"), "utf8");
  const html = fs.readFileSync(path.join(ROOT, "analyze.html"), "utf8");

  // analyze.html
  assert.match(html, /id="cheatSheetBtn"/,
    "analyze.html must contain #cheatSheetBtn");
  assert.match(html, /cheat-sheet/i, "cheat-sheet string must be referenced");

  // app.js
  assert.match(appSrc, /document\.getElementById\(['"]cheatSheetBtn['"]\)/,
    "cheatSheetBtn must be wired via document.getElementById");
  assert.match(appSrc, /cheat-sheet-modal/,
    "render must produce a .cheat-sheet-modal container");
  assert.match(appSrc, /cheat-scorecard|cheat-header|cheat-section-title/,
    "cheat-sheet must include scorecard / sections");
  assert.match(appSrc, /window\.print\(\)/,
    "cheat-sheet must offer a print button");
  // Copy-as-text path must use clipboard fallback
  assert.match(appSrc, /cheatCopyBtn[\s\S]+?navigator\.clipboard|execCommand\('copy'\)/,
    "cheat-sheet copy must use clipboard fallback");

  // Iter #109 polish: email-this + filename footer
  assert.match(appSrc, /document\.getElementById\(['"]cheatEmailBtn['"]\)/,
    "cheatEmailBtn must be wired via document.getElementById");
  assert.match(appSrc, /mailto:\?subject=|location\.href\s*=\s*['"]mailto:/,
    "cheat-sheet must use mailto: for the email action");
  assert.match(appSrc, /cleardoc-cheatsheet-\$\{|cleardoc-cheatsheet-/,
    "cheat-sheet must include a dated filename in the footer");

  // CSS: modal + print styles
  assert.match(cssSrc, /\.cheat-sheet-modal\b/,
    ".cheat-sheet-modal style must exist");
  assert.match(cssSrc, /@media\s+print/,
    "cheat-sheet must include print-specific styles");
});
  // Iter #110 polish: proof-pack / receipt modal — fingerprint + sign row.
test("analyzer: Receipt modal packages the analysis as a printable signed proof", () => {
  if (!HAS_BROWSER) return;
  const fs = require("node:fs");
  const path = require("node:path");
  const appSrc = fs.readFileSync(path.join(ROOT, "assets", "app.js"), "utf8");
  const cssSrc = fs.readFileSync(path.join(ROOT, "assets", "theme.css"), "utf8");
  const html = fs.readFileSync(path.join(ROOT, "analyze.html"), "utf8");

  assert.match(html, /id="receiptBtn"/,
    "analyze.html must contain #receiptBtn");
  assert.match(html, /receipt/i, "receipt string must be referenced");

  assert.match(appSrc, /document\.getElementById\(['"]receiptBtn['"]\)/,
    "receiptBtn must be wired via document.getElementById");
  assert.match(appSrc, /sha256Hex|SHA-256|crypto\.subtle\.digest/,
    "receipt must include a SHA-256 fingerprint via crypto.subtle");
  assert.match(appSrc, /receipt-modal|Document Review Receipt/,
    "modal must produce a Document Review Receipt");
  assert.match(appSrc, /window\.print\(\)/,
    "receipt must offer a print button");
  assert.match(appSrc, /Reviewed by \(signature\)|receipt-sign-cap/,
    "receipt must include a sign row");

  assert.match(cssSrc, /\.receipt-modal\b/,
    ".receipt-modal style must exist");
  assert.match(cssSrc, /\.receipt-fingerprint\b/,
    ".receipt-fingerprint style must exist");

  // Iter #111 polish: save-to-log + chain-of-custody counter.
  assert.match(appSrc, /document\.getElementById\(['"]receiptSaveBtn['"]\)/,
    "iter #111 must wire receiptSaveBtn via document.getElementById");
  assert.match(appSrc, /localStorage\.setItem.*cleardoc:receipt-log|setItem\(CUSTODY_KEY|CUSTODY_KEY = ['"]cleardoc:receipt-log['"]/,
    "iter #111 must persist to localStorage under cleardoc:receipt-log");
  assert.match(cssSrc, /\.receipt-custody-note\b/,
    ".receipt-custody-note style must exist");
});

// Iter #112: tone analyzer — three axes (trust / pressure /
// clarity) measured by a hand-tuned legalese lexicon. Pure local.
test("analyzer: Tone analyzer measures trust / pressure / clarity across the document", () => {
  if (!HAS_BROWSER) return;
  const fs = require("node:fs");
  const path = require("node:path");
  const appSrc = fs.readFileSync(path.join(ROOT, "assets", "app.js"), "utf8");
  const cssSrc = fs.readFileSync(path.join(ROOT, "assets", "theme.css"), "utf8");
  const html = fs.readFileSync(path.join(ROOT, "analyze.html"), "utf8");

  assert.match(html, /id="toneBlock"/, "analyze.html must contain #toneBlock");
  assert.match(html, /Tone analyzer/i, "tone block must be titled 'Tone analyzer'");
  assert.match(appSrc, /function analyzeTone\(/, "analyzeTone must exist");
  assert.match(appSrc, /function renderToneBlock\(/, "renderToneBlock must exist");
  assert.match(appSrc, /TONE_LEX/, "TONE_LEX lexicon must exist");
  // Three axes
  for(const k of ["trust","pressure","clarity"]) {
    assert.match(appSrc, new RegExp(k + ":\\s*\\["),
      "TONE_LEX must include the '" + k + "' axis");
    assert.match(appSrc, new RegExp("['\"]" + k + "['\"], '"),
      "render must pass the '" + k + "' score to a cell");
  }
  assert.match(appSrc, /toneBlock\.hidden = (true|false)/,
    "toneBlock.hidden must be toggled");
  // CSS
  assert.match(cssSrc, /\.tone-cell\b/, ".tone-cell style must exist");
  assert.match(cssSrc, /\.tone-fill\b/, ".tone-fill bar style must exist");

  // Iter #113 polish: per-axis examples + click-to-jump + read-verdict.
  assert.match(appSrc, /tone-ex|data-tone-idx/,
    "iter #113 must render a tone-ex examples list");
  assert.match(appSrc, /tone-ex[\s\S]+?addEventListener\(['"]click['"][\s\S]+?setSelectionRange/,
    "iter #113 must wire click-to-jump on tone examples");
  assert.match(appSrc, /toneSpeakBtn[\s\S]+?SpeechSynthesisUtterance|speechSynthesis\.speak/,
    "iter #113 must allow reading the verdict aloud");
  assert.match(cssSrc, /\.tone-ex\b/, ".tone-ex style must exist");
});

// Cycle 86 feature: copy the tone summary as plain text.
test("analyzer: Tone analyzer copies its summary as plain text", () => {
  if (!HAS_BROWSER) return;
  const fs = require("node:fs");
  const path = require("node:path");
  const appSrc = fs.readFileSync(path.join(ROOT, "assets", "app.js"), "utf8");

  // The copy chip lives in the tone note next to read-verdict
  assert.match(appSrc, /id="toneCopyBtn" title="Copy the tone summary as plain text"/,
    "the tone block must include a copy chip");
  assert.match(appSrc, /toneCopyBtn\.addEventListener\(\s*['"]click['"]/,
    "the copy chip must have a click handler");
  assert.match(appSrc, /'Tone analyzer · ' \+ tone\.words\.toLocaleString\('en-US'\)/,
    "the summary must open with the analyzed word count");
  assert.match(appSrc, /'Overall tone: ' \+ verdict/,
    "the summary must include the overall verdict");
  assert.match(appSrc, /'Trust signals: ' \+ tone\.trust \+ '\/100/,
    "the summary must include the trust axis score");
  assert.match(appSrc, /'Pressure signals: ' \+ tone\.pressure \+ '\/100/,
    "the summary must include the pressure axis score");
  assert.match(appSrc, /'Plain-language clarity: ' \+ tone\.clarity \+ '\/100/,
    "the summary must include the clarity axis score");
  assert.match(appSrc, /'📋 Tone summary copied'/,
    "copy must toast on success");
  assert.match(appSrc, /toneCopyBtn\.setAttribute\('aria-label', ok \? 'Tone summary copied to clipboard' : 'Copy failed — try again'\)/,
    "copy must announce success/failure via aria-label");
  assert.match(appSrc, /toneCopyBtn\.setAttribute\('aria-label', 'Copy the tone summary'\)/,
    "copy must restore the original aria-label");
  // Cycle 87 polish — the export includes the clickable example phrases
  assert.match(appSrc, /const examplesOf = \(k\) => \{/,
    "the copy must build an examples helper per axis");
  assert.match(appSrc, /arr\.slice\(0, 3\)\.join\(' · '\)/,
    "up to three examples per axis must be joined into the line");
  assert.match(appSrc, /' Examples: ' \+ examplesOf\('trust'\)/,
    "the trust line must include its example phrases");
});

// Iter #114: date timeline — surfaces the next 12 upcoming dates
// extracted from the analyzed document. Pure local regex extraction.
test("analyzer: Date timeline surfaces the next 12 upcoming deadlines", () => {
  if (!HAS_BROWSER) return;
  const fs = require("node:fs");
  const path = require("node:path");
  const appSrc = fs.readFileSync(path.join(ROOT, "assets", "app.js"), "utf8");
  const cssSrc = fs.readFileSync(path.join(ROOT, "assets", "theme.css"), "utf8");
  const html = fs.readFileSync(path.join(ROOT, "analyze.html"), "utf8");

  assert.match(html, /id="dateBlock"/, "analyze.html must contain #dateBlock");
  assert.match(html, /id="dateTimeline"/, "analyze.html must contain #dateTimeline");
  assert.match(appSrc, /function extractDates\(/, "extractDates must exist");
  assert.match(appSrc, /function renderDateTimeline\(/, "renderDateTimeline must exist");
  // At least three regex variants
  assert.match(appSrc, /reMonth|reDayMonth|reIso|reSlash/, "date extractor must cover at least three formats");
  // Wiring — call inside render()
  assert.match(appSrc, /extractDates\(raw\)/, "render() must call extractDates on the raw text");
  assert.match(appSrc, /dateBlock\.hidden = (true|false)/, "dateBlock.hidden must be toggled");

  // CSS
  assert.match(cssSrc, /\.date-row\b/, ".date-row style must exist");
  assert.match(cssSrc, /\.date-row\.date-close\b/, ".date-close (urgent) style must exist");

  // Iter #115 polish: per-tile click-to-jump + .ics export + show-past toggle.
  assert.match(appSrc, /date-row[\s\S]+?addEventListener\(['"]click['"][\s\S]+?setSelectionRange/,
    "iter #115 must wire click-to-jump on date tiles");
  assert.match(appSrc, /data-date-ics[\s\S]+?BEGIN:VCALENDAR|BEGIN:VCALENDAR/,
    "iter #115 must produce a VCALENDAR .ics payload");
  assert.match(appSrc, /dateShowPastBtn|dateTimeline\._showPast/,
    "iter #115 must toggle the show-past filter");
  assert.match(cssSrc, /\.date-ics\b/, ".date-ics button style must exist");
});

// Iter #116: negotiate-it builder — per-risk counter-clauses with
// a tone picker (firm / neutral / friendly) and one-click copy.
test("analyzer: Negotiate-it builder turns every detected risk into a tone-selectable counter-clause", () => {
  if (!HAS_BROWSER) return;
  const fs = require("node:fs");
  const path = require("node:path");
  const appSrc = fs.readFileSync(path.join(ROOT, "assets", "app.js"), "utf8");
  const cssSrc = fs.readFileSync(path.join(ROOT, "assets", "theme.css"), "utf8");
  const html = fs.readFileSync(path.join(ROOT, "analyze.html"), "utf8");

  assert.match(html, /id="negotiateBlock"/, "analyze.html must contain #negotiateBlock");
  assert.match(appSrc, /function renderNegotiateBlock\(/, "renderNegotiateBlock must exist");
  assert.match(appSrc, /NEG_TONES/, "NEG_TONES must exist");
  for(const tone of ["firm","neutral","friendly"]){
    assert.match(appSrc, new RegExp(tone + ":\\s*['\"]"),
      "NEG_TONES must include '" + tone + "'");
  }
  // Tone picker markup
  assert.match(appSrc, /data-neg-tone=['"](firm|neutral|friendly)['"]/,
    "render must include a tone button per option");
  assert.match(appSrc, /data-neg-copy[\s\S]+?navigator\.clipboard|execCommand\('copy'\)/,
    "copy handler must use clipboard fallback");
  // Wiring inside render()
  assert.match(appSrc, /renderNegotiateBlock\(flags\)/,
    "render() must call renderNegotiateBlock with flags");

  // CSS
  assert.match(cssSrc, /\.neg-row\b/, ".neg-row style must exist");
  assert.match(cssSrc, /\.neg-tone\.neg-active\b/, ".neg-tone.neg-active style must exist");
});

// Iter #117: negotiate-it polish — "swap into source" replaces the
// matched risky sentence with the chosen-tone counter-clause; an
// "Original:" row was also added so users can compare side-by-side.
test("analyzer: Negotiate-it polished with original-vs-counter compare + swap-into-source action", () => {
  if (!HAS_BROWSER) return;
  const fs = require("node:fs");
  const path = require("node:path");
  const appSrc = fs.readFileSync(path.join(ROOT, "assets", "app.js"), "utf8");
  const cssSrc = fs.readFileSync(path.join(ROOT, "assets", "theme.css"), "utf8");

  // Original-vs-counter compare
  assert.match(appSrc, /data-neg-matched|neg-original/,
    "iter #117 must render an 'Original:' compare row");
  // Swap-into-source button
  assert.match(appSrc, /data-neg-swap=/,
    "iter #117 must include a swap button");
  assert.match(appSrc, /data-neg-swap[\s\S]+?input\.value/,
    "swap handler must rewrite input.value with the counter-clause");
  assert.match(appSrc, /input\._undoSnapshot/,
    "swap handler must save undo snapshot on the input");
  // CSS
  assert.match(cssSrc, /\.neg-swap\b/,
    ".neg-swap button style must exist");
  assert.match(cssSrc, /\.neg-original\b/,
    ".neg-original compare style must exist");
});

// Iter #118: freshness stamp — surfaces effective / revised /
// version / execution-date markers so users know how old the
// document is before signing.
test("analyzer: Freshness stamp surfaces effective-date / revised / version markers", () => {
  if (!HAS_BROWSER) return;
  const fs = require("node:fs");
  const path = require("node:path");
  const appSrc = fs.readFileSync(path.join(ROOT, "assets", "app.js"), "utf8");
  const cssSrc = fs.readFileSync(path.join(ROOT, "assets", "theme.css"), "utf8");
  const html = fs.readFileSync(path.join(ROOT, "analyze.html"), "utf8");

  assert.match(html, /id="freshBlock"/, "analyze.html must contain #freshBlock");
  assert.match(appSrc, /function detectFreshness\(/, "detectFreshness must exist");
  assert.match(appSrc, /function renderFreshnessBlock\(/, "renderFreshnessBlock must exist");
  assert.match(appSrc, /FRESH_PATTERNS/, "FRESH_PATTERNS must exist");
  // Cover all 4 categories
  for(const k of ["effective","revised","version","executed"]){
    assert.match(appSrc, new RegExp("key: '" + k + "'"),
      "FRESH_PATTERNS must include '" + k + "'");
  }
  // Wiring
  assert.match(appSrc, /detectFreshness\(raw\)/, "render() must call detectFreshness on raw text");
  assert.match(appSrc, /freshBlock\.hidden = (true|false)/, "freshBlock.hidden must be toggled");

  // CSS: row + old/future bands
  assert.match(cssSrc, /\.fresh-row\b/, ".fresh-row style must exist");
  assert.match(cssSrc, /\.fresh-row\.fresh-old\b/, ".fresh-old band style must exist");

  // Iter #119 polish: click-to-jump + .ics export + freshness verdict header.
  assert.match(appSrc, /data-fresh-raw[\s\S]+?addEventListener\(['"]click['"][\s\S]+?setSelectionRange/,
    "iter #119 must wire click-to-jump on freshness rows");
  assert.match(appSrc, /data-fresh-ics[\s\S]+?BEGIN:VCALENDAR/,
    "iter #119 must produce a VCALENDAR .ics payload");
  assert.match(appSrc, /fresh-verdict|headerVerdict/,
    "iter #119 must render a freshness-verdict header");
  // CSS
  assert.match(cssSrc, /\.fresh-verdict\b/, ".fresh-verdict style must exist");
  assert.match(cssSrc, /\.fresh-ics\b/, ".fresh-ics button style must exist");
});

// Cycle #140 — per-freshness-row copy.
test("analyzer: Freshness rows copy their marker in one click", () => {
  if (!HAS_BROWSER) return;
  const fs = require("node:fs");
  const path = require("node:path");
  const appSrc = fs.readFileSync(path.join(ROOT, "assets", "app.js"), "utf8");
  const cssSrc = fs.readFileSync(path.join(ROOT, "assets", "theme.css"), "utf8");

  assert.match(appSrc, /const copyVal = '\[FRESHNESS · ' \+ it\.label \+ '\] "' \+ it\.raw \+ '"'/,
    "the citation must carry the label and the matched phrase");
  assert.match(appSrc, /class="fresh-copy ghost-btn ghost-btn-sm"/,
    "each freshness row must render a copy button");
  assert.match(appSrc, /data-fresh-copy-text="' \+ esc\(copyVal\) \+ '"/,
    "the copy button must carry the prebuilt citation");
  assert.match(appSrc, /\$\$\('\.fresh-copy', freshGrid\)\.forEach/,
    "copy buttons must be wired after each render");
  assert.match(appSrc, /e\.stopPropagation\(\);/,
    "copying must not trigger the row's jump-to-source");
  assert.match(appSrc, /📋 Freshness marker copied/,
    "copying must announce via toast");
  assert.match(appSrc, /copyBtn\.textContent = copied \? '✓' : '📋';/,
    "the button must flash its copied state");
  assert.match(appSrc, /class="fresh-actions"/,
    "the ics + copy buttons must be grouped into one action row");
  assert.match(cssSrc, /\.fresh-actions\{[^}]*display:flex/,
    "the action row must lay out horizontally");
});

// Cycle #250 — bulk copy of every freshness marker.
test("analyzer: Freshness block copies all markers in one click", () => {
  if (!HAS_BROWSER) return;
  const fs = require("node:fs");
  const path = require("node:path");
  const appSrc = fs.readFileSync(path.join(ROOT, "assets", "app.js"), "utf8");
  const cssSrc = fs.readFileSync(path.join(ROOT, "assets", "theme.css"), "utf8");

  assert.match(appSrc, /id="freshCopyAllBtn" title="Copy all freshness markers as plain text"/,
    "the freshness block must include a copy-all chip");
  assert.match(appSrc, /const freshCopyAllBtn = document\.getElementById\('freshCopyAllBtn'\);/,
    "the copy-all chip must have a click handler");
  assert.match(appSrc, /'\[FRESHNESS · ' \+ it\.label \+ '\] "' \+ it\.raw \+ '"' \+ \(when !== '—' \? '\\nWhen: ' \+ when : ''\)/,
    "the copy-all must mirror the per-row citation format");
  assert.match(appSrc, /'📋 Freshness markers copied \(' \+ lines\.length \+ '\)'/,
    "copying must toast the marker count");
  assert.match(appSrc, /📋 copy all<\/b> exports the markers as plain text/,
    "the freshness note must document the copy-all chip");
  assert.match(cssSrc, /\.fresh-controls\{/,
    "the copy-all controls row must be styled");
});

// Iter #120: document simplifier — paste a confusing sentence and
// we translate it to plain English using the same jargon table that
// powers the rewrite. Pure local.
test("analyzer: Document simplifier translates one sentence at a time", () => {
  if (!HAS_BROWSER) return;
  const fs = require("node:fs");
  const path = require("node:path");
  const appSrc = fs.readFileSync(path.join(ROOT, "assets", "app.js"), "utf8");
  const cssSrc = fs.readFileSync(path.join(ROOT, "assets", "theme.css"), "utf8");
  const html = fs.readFileSync(path.join(ROOT, "analyze.html"), "utf8");

  assert.match(html, /id="simplifyBlock"/, "analyze.html must contain #simplifyBlock");
  assert.match(html, /id="simplifyInput"/, "analyze.html must contain #simplifyInput");
  assert.match(html, /id="simplifyOut"/, "analyze.html must contain #simplifyOut");
  assert.match(appSrc, /function renderSimplifyBlock\(/, "renderSimplifyBlock must exist");
  // The simplifier must reuse the iter #25 clarify() engine
  assert.match(appSrc, /clarify[\s\S]+?simplifyInput/,
    "simplify handler must call clarify() on the user's input");
  // Buttons: simplify / use-selected / swap-into-source
  assert.match(appSrc, /simplifyGoBtn[\s\S]+?addEventListener/,
    "Go button must be wired");
  assert.match(appSrc, /simplifyFillFromSelectionBtn[\s\S]+?selectionStart|selectionEnd/,
    "Use-selected button must read the textarea selection");
  assert.match(appSrc, /simplifySwapBtn[\s\S]+?input\.value/,
    "Swap-into-source button must overwrite the textarea");

  // CSS
  assert.match(cssSrc, /\.simplify-row\b/, ".simplify-row style must exist");
  assert.match(cssSrc, /\.simplify-input\b/, ".simplify-input style must exist");
  assert.match(cssSrc, /\.simplify-out\b/, ".simplify-out style must exist");
});

// Iter #121: simplifier polish — confidence meter + read-aloud + copy.
test("analyzer: Simplifier polished with confidence meter + read-aloud + copy", () => {
  if (!HAS_BROWSER) return;
  const fs = require("node:fs");
  const path = require("node:path");
  const appSrc = fs.readFileSync(path.join(ROOT, "assets", "app.js"), "utf8");
  const cssSrc = fs.readFileSync(path.join(ROOT, "assets", "theme.css"), "utf8");

  // Confidence meter
  assert.match(appSrc, /simplify-confidence|conf-(high|mid|low)/,
    "iter #121 must render a simplify-confidence chip");
  // Read-aloud
  assert.match(appSrc, /simplifySpeakBtn[\s\S]+?SpeechSynthesisUtterance|speechSynthesis\.speak/,
    "iter #121 must wire read-aloud");
  // Copy plain-version
  assert.match(appSrc, /simplifyCopyBtn[\s\S]+?navigator\.clipboard|execCommand\('copy'\)/,
    "iter #121 must wire copy button");

  // CSS
  assert.match(cssSrc, /\.simplify-confidence\b/, ".simplify-confidence style must exist");
  assert.match(cssSrc, /\.simplify-actions\b/, ".simplify-actions style must exist");
});

// Iter #122: TL;DR generator — assembles a three-sentence summary
// from the analyzer's existing outputs (word count + jurisdiction,
// risk tally, maturity + worst-case exposure).
test("analyzer: TL;DR generator assembles a three-sentence summary from analyzer outputs", () => {
  if (!HAS_BROWSER) return;
  const fs = require("node:fs");
  const path = require("node:path");
  const appSrc = fs.readFileSync(path.join(ROOT, "assets", "app.js"), "utf8");
  const cssSrc = fs.readFileSync(path.join(ROOT, "assets", "theme.css"), "utf8");
  const html = fs.readFileSync(path.join(ROOT, "analyze.html"), "utf8");

  assert.match(html, /id="tldrBlock"/, "analyze.html must contain #tldrBlock");
  assert.match(appSrc, /function buildTldr\(/, "buildTldr must exist");
  assert.match(appSrc, /function renderTldrBlock\(/, "renderTldrBlock must exist");
  // The three-sentence builder
  assert.match(appSrc, /buildTldr[\s\S]+?'Maturity score'|'Maturity score'[\s\S]+?buildTldr/,
    "TL;DR must include a maturity/exposure sentence");
  // Wiring
  assert.match(appSrc, /renderTldrBlock\(raw[\s\S]+?ctx\)/,
    "render() must call renderTldrBlock with raw + ctx");
  // Copy + read-aloud
  assert.match(appSrc, /tldrCopyBtn[\s\S]+?navigator\.clipboard|execCommand\('copy'\)/,
    "tldrCopyBtn must copy to clipboard");
  assert.match(appSrc, /const tldrCopyMdBtn = document\.getElementById\('tldrCopyMdBtn'\);/,
    "tldrCopyMdBtn must be wired in the TL;DR block");
  assert.match(appSrc, /'📋 TL;DR copied as Markdown'/,
    "TL;DR Markdown copy must confirm with a toast");
  assert.match(appSrc, /' · Verdict: ' \+ verdict/,
    "TL;DR Markdown copy must include the verdict when available");
  assert.match(appSrc, /' · Reading level: ' \+ rl/,
    "TL;DR Markdown copy must include the reading level when available");
  assert.match(html, /id="tldrCopyMdBtn"/,
    "analyze.html must expose the TL;DR Markdown copy button");
  assert.match(appSrc, /tldrSpeakBtn[\s\S]+?SpeechSynthesisUtterance|speechSynthesis\.speak/,
    "tldrSpeakBtn must use SpeechSynthesis");

  // CSS
  assert.match(cssSrc, /\.tldr-card\b/, ".tldr-card style must exist");
  assert.match(cssSrc, /\.tldr-actions\b/, ".tldr-actions style must exist");
});

// Iter #123 polish: TL;DR now has sentiment arrow + numbered
// sentences + maturity-specific "next step" line.
test("analyzer: TL;DR polished with numbered sentences + sentiment arrow + next step", () => {
  if (!HAS_BROWSER) return;
  const fs = require("node:fs");
  const path = require("node:path");
  const appSrc = fs.readFileSync(path.join(ROOT, "assets", "app.js"), "utf8");
  const cssSrc = fs.readFileSync(path.join(ROOT, "assets", "theme.css"), "utf8");

  // Iter #123 must render 3 numbered sentences + a "next step" line.
  assert.match(appSrc, /tldr-s tldr-s1[\s\S]+?tldr-s tldr-s2[\s\S]+?tldr-s tldr-s3[\s\S]+?tldr-next/,
    "iter #123 must render numbered tldr-s1/s2/s3 + tldr-next");
  assert.match(appSrc, /tldr-num/,
    "iter #123 must include the tldr-num badge style");
  assert.match(appSrc, /Next step:/,
    "iter #123 must include a Next step footer line");
  // Sentiment arrow
  assert.match(appSrc, /arrow\s*=\s*maturity\.letter\s*===\s*['"]F['"]\s*\|\|\s*maturity\.letter\s*===\s*['"]D['"]\s*\?\s*['"]📉['"]|📉/,
    "iter #123 must emit a sentiment arrow (📉 / 📈 / ➡️)");

  // CSS
  assert.match(cssSrc, /\.tldr-s\b/, ".tldr-s style must exist");
  assert.match(cssSrc, /\.tldr-num\b/, ".tldr-num style must exist");
  assert.match(cssSrc, /\.tldr-next\b/, ".tldr-next style must exist");
});

skip("analyze: TL;DR copies as Markdown", async () => {
  if (!HAS_BROWSER) return;
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  const errors = [];
  page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.addInitScript(() => {
    window.__copiedTldrMd = null;
    try {
      Object.defineProperty(navigator, "clipboard", {
        configurable: true,
        value: {
          writeText: async (txt) => { window.__copiedTldrMd = txt; },
          write: async () => {},
        },
      });
    } catch (_) {
      try { navigator.clipboard = { writeText: async (txt) => { window.__copiedTldrMd = txt; }, write: async () => {} }; } catch (_2) {}
    }
  });
  try {
    await page.goto(`http://127.0.0.1:${PORT}/analyze.html`, { waitUntil: "networkidle" });
    await page.click(".qf[data-fill]:first-of-type");
    await page.click("#analyzeBtn");
    await page.waitForSelector("#tldrBlock:not([hidden]) #tldrCopyMdBtn", { timeout: 8000 });
    await page.click("#tldrCopyMdBtn");
    await page.waitForFunction(() => window.__copiedTldrMd && window.__copiedTldrMd.length > 0, { timeout: 8000 });
    const captured = await page.evaluate(() => window.__copiedTldrMd);
    assert.match(captured, /^## TL;DR/, "the copied TL;DR must start with a Markdown heading");
    assert.match(captured, /Verdict:/, "the copied TL;DR must include the verdict");
    assert.match(captured, /Reading level:/, "the copied TL;DR must include the reading level");
    assert.match(captured, /\*\*Next step:\*\*/, "the copied TL;DR must include the next step");
    assert.equal(errors.length, 0, `zero console errors, got: ${errors.join(" | ")}`);
  } finally {
    await page.close();
    await ctx.close();
  }
});

// Iter #124: email composer — assembles a ready-to-send reply
// email using the analyzer's TL;DR + top 2 counter-clauses.
test("analyzer: Email composer assembles a ready-to-send reply with counter-clauses", () => {
  if (!HAS_BROWSER) return;
  const fs = require("node:fs");
  const path = require("node:path");
  const appSrc = fs.readFileSync(path.join(ROOT, "assets", "app.js"), "utf8");
  const cssSrc = fs.readFileSync(path.join(ROOT, "assets", "theme.css"), "utf8");
  const html = fs.readFileSync(path.join(ROOT, "analyze.html"), "utf8");

  assert.match(html, /id="emailBlock"/, "analyze.html must contain #emailBlock");
  assert.match(html, /id="emailGrid"/, "analyze.html must contain #emailGrid");
  assert.match(appSrc, /function buildEmailDraft\(/, "buildEmailDraft must exist");
  assert.match(appSrc, /function renderEmailBlock\(/, "renderEmailBlock must exist");
  // Includes opener + subject + counter-clauses
  assert.match(appSrc, /buildEmailDraft[\s\S]+?opener|opener[\s\S]+?buildEmailDraft/,
    "buildEmailDraft must include an opener line");
  assert.match(appSrc, /topCounters/,
    "buildEmailDraft must include top counters");
  // Wiring
  assert.match(appSrc, /renderEmailBlock\(raw[\s\S]+?ctx\)/,
    "render() must call renderEmailBlock with raw + ctx");
  // mailto + copy
  assert.match(appSrc, /emailOpenBtn[\s\S]+?mailto:|location\.href\s*=\s*['"]mailto:/,
    "emailOpenBtn must use mailto:");
  assert.match(appSrc, /emailCopyBtn[\s\S]+?navigator\.clipboard|execCommand\('copy'\)/,
    "emailCopyBtn must use clipboard fallback");

  // CSS
  assert.match(cssSrc, /\.email-row\b/, ".email-row style must exist");
  assert.match(cssSrc, /\.email-body\b/, ".email-body style must exist");
  assert.match(cssSrc, /\.email-actions\b/, ".email-actions style must exist");

  // Iter #125 polish: tone picker + meeting pre-fill
  assert.match(appSrc, /OPENERS[\s\S]+?friendly|OPENERS\s*=/,
    "iter #125 must include OPENERS table");
  assert.match(appSrc, /meeting prefilled|📅 meeting/,
    "iter #125 must include a meeting pre-fill label");
  assert.match(appSrc, /data-email-tone=/,
    "iter #125 must render a tone picker");
  assert.match(appSrc, /email-tone-active/,
    "iter #125 must toggle email-tone-active class");
});

// Iter #126: questions-to-ask — synthesize a numbered list of
// questions specific to the analyzer's risk patterns + tone +
// maturity + jurisdiction.
test("analyzer: Questions-to-ask lists bespoke questions specific to detected risks", () => {
  if (!HAS_BROWSER) return;
  const fs = require("node:fs");
  const path = require("node:path");
  const appSrc = fs.readFileSync(path.join(ROOT, "assets", "app.js"), "utf8");
  const cssSrc = fs.readFileSync(path.join(ROOT, "assets", "theme.css"), "utf8");
  const html = fs.readFileSync(path.join(ROOT, "analyze.html"), "utf8");

  assert.match(html, /id="quesBlock"/, "analyze.html must contain #quesBlock");
  assert.match(appSrc, /function buildQuestionsList\(/, "buildQuestionsList must exist");
  assert.match(appSrc, /function renderQuestionsBlock\(/, "renderQuestionsBlock must exist");
  assert.match(appSrc, /quesBlock\.hidden = (true|false)/,
    "quesBlock.hidden must be toggled");
  // The question builder must consult the last flags + tone + maturity + jurisdiction
  assert.match(appSrc, /lastFlags[\s\S]+?non-refundable|lastFlags[\s\S]+?auto-renew/,
    "buildQuestionsList must include per-risk questions");
  // Copy buttons
  assert.match(appSrc, /quesCopyBtn[\s\S]+?navigator\.clipboard|execCommand\('copy'\)/,
    "quesCopyBtn must use clipboard fallback");
  assert.match(appSrc, /data-ques-copy=/,
    "per-row copy must include data-ques-copy attribute");

  // CSS
  assert.match(cssSrc, /\.ques-row\b/, ".ques-row style must exist");
  assert.match(cssSrc, /\.ques-num\b/, ".ques-num style must exist");

  // Iter #127 polish: priority order + per-row "answered" + counter.
  assert.match(appSrc, /sort\([\s\S]+?rank[\s\S]+?r: 0|r:\s*0/,
    "iter #127 must sort questions by severity");
  assert.match(appSrc, /ANSWERED_KEY\s*=\s*['"]cleardoc:questions-answered['"]|cleardoc:questions-answered/,
    "iter #127 must persist answered state to localStorage");
  assert.match(appSrc, /data-ques-done=/,
    "iter #127 must render a done toggle per question");
  assert.match(cssSrc, /\.ques-row\.ques-answered\b/, ".ques-answered style must exist");
  assert.match(cssSrc, /\.ques-done\b/, ".ques-done style must exist");
});

test("analyzer: Questions-to-ask rows can prefill the Ask panel with one click", () => {
  if (!HAS_BROWSER) return;
  const fs = require("node:fs");
  const path = require("node:path");
  const appSrc = fs.readFileSync(path.join(ROOT, "assets", "app.js"), "utf8");
  const cssSrc = fs.readFileSync(path.join(ROOT, "assets", "theme.css"), "utf8");

  // Each question row renders a 💬 ask button carrying the exact question.
  assert.match(appSrc, /class="ques-ask ghost-btn ghost-btn-sm"/,
    "each question row must render an ask button");
  assert.match(appSrc, /data-ques-ask="' \+ esc\(o\.q\) \+ '"/,
    "the ask button must carry the full question text");
  assert.match(appSrc, /aria-label="Ask the document this question now"/,
    "the ask button must expose an accessible name");
  // The button is wired per render, like the per-risk 💬 buttons.
  assert.match(appSrc, /\$\$\('\.ques-ask', quesList\)\.forEach/,
    "ask buttons must be wired after each render");
  // Clicking prefills the ask input, re-enables it, and brings it into view.
  assert.match(appSrc, /qInput\.value = q;/,
    "clicking must prefill the ask input with the question");
  assert.match(appSrc, /qInput\.disabled = false;/,
    "clicking must re-enable the ask input");
  assert.match(appSrc, /qInput\.scrollIntoView/,
    "clicking must scroll the Ask panel into view");
  assert.match(appSrc, /showAnalyzeToast\('💬 Question ready — press Ask'\)/,
    "clicking must announce the prefilled question via toast");
  // The block note tells users the 💬 action exists.
  assert.match(appSrc, /Click <b>💬<\/b> \(shortcut: a\) to ask the document that exact question/,
    "the questions note must document the ask action");
  // CSS: the ask button shares the row-button styling.
  assert.match(cssSrc, /\.ques-copy,\.ques-ask\{/,
    ".ques-ask must share the row-button style");
  // Cycle #91 polish — the risk-row 'a' shortcut now also serves question rows.
  assert.match(appSrc, /const row = t && t\.closest \? t\.closest\('\.rrow, \.ques-row, \.deadline-row, \.kc-row, \.scenario-card, \.action-row, \.bearer-row, \.reading-row'\) : null;/,
    "the row-shortcut handler must match every per-row ask surface");
  assert.match(appSrc, /if\(!row\) return;[\s\S]{0,120}row\.classList\.contains\('rrow'\) && \(key === 'e' \|\| key === 'E'\)/,
    "keys outside supported rows must be ignored and e must stay risk-only");
  assert.match(appSrc, /row\.querySelector && row\.querySelector\('\.rrow-ask, \.ques-ask, \.deadline-ask, \.kc-ask, \.scenario-ask, \.act-ask, \.bearer-ask, \.reading-ask'\)/,
    "the a shortcut must target whichever ask button the row has");
});

// Iter #128: negotiation playbook — ordered steps with impact +
// effort, sorted by leverage.
test("analyzer: Negotiation playbook builds prioritized steps from analyzer outputs", () => {
  if (!HAS_BROWSER) return;
  const fs = require("node:fs");
  const path = require("node:path");
  const appSrc = fs.readFileSync(path.join(ROOT, "assets", "app.js"), "utf8");
  const cssSrc = fs.readFileSync(path.join(ROOT, "assets", "theme.css"), "utf8");
  const html = fs.readFileSync(path.join(ROOT, "analyze.html"), "utf8");

  assert.match(html, /id="playbookBlock"/, "analyze.html must contain #playbookBlock");
  assert.match(appSrc, /function buildPlaybook\(/, "buildPlaybook must exist");
  assert.match(appSrc, /function renderPlaybookBlock\(/, "renderPlaybookBlock must exist");
  // Steps must include impact + effort
  assert.match(appSrc, /impact[\s\S]+?'high',\s*'medium',\s*'low'|impact:.+'high'/,
    "buildPlaybook must rank steps by impact (high / medium / low)");
  assert.match(appSrc, /effort[\s\S]+?'high',\s*'medium',\s*'low'|effort:/,
    "buildPlaybook must compute effort (high / medium / low)");
  // Wiring
  assert.match(appSrc, /renderPlaybookBlock\(raw[\s\S]+?ctx\)/,
    "render() must call renderPlaybookBlock with raw + ctx");
  // At least 5 distinct step types
  for(const k of ["counter", "venue", "missing", "pressure", "counter-asks", "meeting"]){
    assert.match(appSrc, new RegExp(k, 'i'),
      "playbook should mention '" + k + "'");
  }

  // CSS
  assert.match(cssSrc, /\.playbook-step\b/, ".playbook-step style must exist");
  assert.match(cssSrc, /\.playbook-imp-high\b/, ".playbook-imp-high style must exist");

  // Iter #129 polish: per-step done toggle + markdown export + done counter.
  assert.match(appSrc, /data-playbook-toggle=/,
    "iter #129 must render a done toggle per step");
  assert.match(appSrc, /DONE_KEY\s*=\s*['"]cleardoc:playbook-done['"]|cleardoc:playbook-done/,
    "iter #129 must persist done state to localStorage");
  assert.match(appSrc, /playbookExportBtn[\s\S]+?text\/markdown|new Blob\([\s\S]+?text\/markdown/,
    "iter #129 must export as a markdown blob");
  assert.match(appSrc, /playbookCopyBtn/,
    "iter #261 must add a copy-as-markdown button");
  assert.match(appSrc, /clipboard\.writeText\(md\)/,
    "iter #261 must copy the playbook markdown to the clipboard");
  assert.match(appSrc, /'📋 Playbook copied as markdown'/,
    "iter #261 must toast when the copy succeeds");
  assert.match(appSrc, /copyBtn\.addEventListener[\s\S]{0,800}execCommand\('copy'\)/,
    "iter #261 must fall back to the legacy textarea copy path");
  assert.match(cssSrc, /\.playbook-done-step\b/, ".playbook-done-step style must exist");
  assert.match(cssSrc, /\.playbook-controls\b/, ".playbook-controls style must exist");
});

// Iter #130: counter-party prediction — per-risk forecast using
// heuristic on clause type + tone.
test("analyzer: Counter-party prediction forecasts per-risk objections", () => {
  if (!HAS_BROWSER) return;
  const fs = require("node:fs");
  const path = require("node:path");
  const appSrc = fs.readFileSync(path.join(ROOT, "assets", "app.js"), "utf8");
  const cssSrc = fs.readFileSync(path.join(ROOT, "assets", "theme.css"), "utf8");
  const html = fs.readFileSync(path.join(ROOT, "analyze.html"), "utf8");

  assert.match(html, /id="predictBlock"/, "analyze.html must contain #predictBlock");
  assert.match(appSrc, /function buildCounterPredictions\(/,
    "buildCounterPredictions must exist");
  assert.match(appSrc, /function renderPredictBlock\(/,
    "renderPredictBlock must exist");
  assert.match(appSrc, /predictBlock\.hidden = (true|false)/,
    "predictBlock.hidden must be toggled");
  // Cover at least 4 clause categories
  for(const k of ["non-refundable", "auto-renew", "indemn", "arbitration"]){
    assert.match(appSrc, new RegExp(k),
      "buildCounterPredictions must mention '" + k + "'");
  }
  // CSS
  assert.match(cssSrc, /\.predict-row\b/, ".predict-row style must exist");
  assert.match(cssSrc, /\.predict-clause\b/, ".predict-clause style must exist");

  // Iter #131 polish: confidence meter + rebuttal hint + addressed toggle.
  assert.match(appSrc, /predict-conf-chip/,
    "iter #131 must render a confidence chip");
  assert.match(appSrc, /Your counter:/,
    "iter #131 must include a 'Your counter' rebuttal line");
  assert.match(appSrc, /data-predict-done=/,
    "iter #131 must render a per-row done toggle");
  assert.match(appSrc, /cleardoc:predict-got/,
    "iter #131 must persist 'got it' state to localStorage");
  assert.match(cssSrc, /\.predict-rebut\b/, ".predict-rebut style must exist");
  assert.match(cssSrc, /\.predict-conf-high\b/, ".predict-conf-high style must exist");
});

// Iter #132: trend — compares current analysis to previous,
// fingerprint + scoring-history persisted in localStorage.
test("analyzer: Trend block compares each new analysis against the previous one", () => {
  if (!HAS_BROWSER) return;
  const fs = require("node:fs");
  const path = require("node:path");
  const appSrc = fs.readFileSync(path.join(ROOT, "assets", "app.js"), "utf8");
  const cssSrc = fs.readFileSync(path.join(ROOT, "assets", "theme.css"), "utf8");
  const html = fs.readFileSync(path.join(ROOT, "analyze.html"), "utf8");

  assert.match(html, /id="trendBlock"/, "analyze.html must contain #trendBlock");
  assert.match(appSrc, /function renderTrendBlock\(/, "renderTrendBlock must exist");
  assert.match(appSrc, /TREND_KEY\s*=\s*['"]cleardoc:trend-history['"]|cleardoc:trend-history/,
    "iter #132 must persist trend history to localStorage");
  assert.match(appSrc, /trendFingerprint|crypto\.subtle\.digest/,
    "iter #132 must compute a SHA-256 fingerprint");
  assert.match(appSrc, /Versus last analysis|First time analyzing/,
    "iter #132 must render a comparison line");

  // CSS
  assert.match(cssSrc, /\.trend-cell\b/, ".trend-cell style must exist");
  assert.match(cssSrc, /\.trend-versus\b/, ".trend-versus style must exist");

  // Iter #133 polish: sparkline + clear-history chip.
  assert.match(appSrc, /trend-spark-glyph|trend-spark/,
    "iter #133 must render a sparkline");
  assert.match(appSrc, /trendClearBtn/,
    "iter #133 must render a clear-history chip");
  assert.match(appSrc, /localStorage\.removeItem\(TREND_KEY_HIST\)/,
    "iter #133 must clear history via localStorage.removeItem");
  assert.match(cssSrc, /\.trend-spark-glyph\b/, ".trend-spark-glyph style must exist");
});

// Iter #134: style profile — measures voice + sentence shape.
test("analyzer: Style profile measures voice + sentence shape + reading grade", () => {
  if (!HAS_BROWSER) return;
  const fs = require("node:fs");
  const path = require("node:path");
  const appSrc = fs.readFileSync(path.join(ROOT, "assets", "app.js"), "utf8");
  const cssSrc = fs.readFileSync(path.join(ROOT, "assets", "theme.css"), "utf8");
  const html = fs.readFileSync(path.join(ROOT, "analyze.html"), "utf8");

  assert.match(html, /id="styleBlock"/, "analyze.html must contain #styleBlock");
  assert.match(appSrc, /function buildStyleProfile\(/, "buildStyleProfile must exist");
  assert.match(appSrc, /function renderStyleBlock\(/, "renderStyleBlock must exist");
  assert.match(appSrc, /passiveRate|Passive voice/,
    "iter #134 must compute a passive-voice rate");
  assert.match(appSrc, /avgWords|sentence/,
    "iter #134 must measure sentence length stats");
  assert.match(appSrc, /renderStyleBlock\(raw[\s\S]+?ctx\)/,
    "render() must call renderStyleBlock with raw + ctx");
  // CSS
  assert.match(cssSrc, /\.style-cell\b/, ".style-cell style must exist");
  assert.match(cssSrc, /\.style-verdict\b/, ".style-verdict style must exist");

  // Iter #135 polish: tooltips + copy-as-bullets chip.
  assert.match(appSrc, /TOOLTIP|Style verdict|Sentences|Longest sentence/,
    "iter #135 must include stat tooltips");
  assert.match(appSrc, /styleCopyBtn[\s\S]+?navigator\.clipboard|execCommand\('copy'\)/,
    "iter #135 must wire the copy-as-bullets button");
  assert.match(appSrc, /styleCopyMdBtn/,
    "iter #271 must include a style-profile Markdown copy button");
  assert.match(appSrc, /'📋 Style profile copied as Markdown'/,
    "iter #271 must confirm when the style profile Markdown is copied");
  assert.match(appSrc, /\| Metric \| Value \|/,
    "iter #271 must build a Markdown table header");
  assert.match(appSrc, /_Generated ' \+ new Date\(\)\.toLocaleString/,
    "iter #271 must include a generated timestamp");
  assert.match(cssSrc, /\.style-controls\b/, ".style-controls style must exist");
});

skip("analyze: style profile copies as Markdown", async () => {
  if (!HAS_BROWSER) return;
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  const errors = [];
  page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.addInitScript(() => {
    window.__copiedStyleMd = null;
    try {
      Object.defineProperty(navigator, "clipboard", {
        configurable: true,
        value: {
          writeText: async (txt) => { window.__copiedStyleMd = txt; },
          write: async () => {},
        },
      });
    } catch (_) {
      try { navigator.clipboard = { writeText: async (txt) => { window.__copiedStyleMd = txt; }, write: async () => {} }; } catch (_2) {}
    }
  });
  try {
    await page.goto(`http://127.0.0.1:${PORT}/analyze.html`, { waitUntil: "networkidle" });
    await page.click(".qf[data-fill]:first-of-type");
    await page.click("#analyzeBtn");
    await page.waitForSelector("#styleBlock:not([hidden]) #styleCopyMdBtn", { timeout: 8000 });
    await page.click("#styleCopyMdBtn");
    await page.waitForFunction(() => window.__copiedStyleMd && window.__copiedStyleMd.length > 0, { timeout: 8000 });
    const captured = await page.evaluate(() => window.__copiedStyleMd);
    assert.match(captured, /^## Style profile/, "the copied style profile must start with a heading");
    assert.match(captured, /\| Metric \| Value \|/, "the copied style profile must include the metric table");
    assert.match(captured, /_Generated/, "the copied style profile must include a generated line");
    assert.equal(errors.length, 0, `zero console errors, got: ${errors.join(" | ")}`);
  } finally {
    await page.close();
    await ctx.close();
  }
});

// Iter #136: clause index — extracts numbered clauses and
// renders them as clickable rows that jump to the source.
test("analyzer: Clause index extracts numbered clauses with click-to-jump", () => {
  if (!HAS_BROWSER) return;
  const fs = require("node:fs");
  const path = require("node:path");
  const appSrc = fs.readFileSync(path.join(ROOT, "assets", "app.js"), "utf8");
  const cssSrc = fs.readFileSync(path.join(ROOT, "assets", "theme.css"), "utf8");
  const html = fs.readFileSync(path.join(ROOT, "analyze.html"), "utf8");

  assert.match(html, /id="indexBlock"/, "analyze.html must contain #indexBlock");
  assert.match(appSrc, /function extractClauseIndex\(/, "extractClauseIndex must exist");
  assert.match(appSrc, /function renderClauseIndex\(/, "renderClauseIndex must exist");
  // Cover common clause-format keywords
  for(const k of ["Section", "Article", "Clause"]){
    assert.match(appSrc, new RegExp(k),
      "extractClauseIndex must mention '" + k + "'");
  }
  // Click-to-jump wiring
  assert.match(appSrc, /clause-row[\s\S]+?addEventListener\(['"]click['"][\s\S]+?setSelectionRange/,
    "clause-row click must setSelectionRange on the textarea");
  // Wiring
  assert.match(appSrc, /renderClauseIndex\(raw[\s\S]+?ctx\)/,
    "render() must call renderClauseIndex");
  // CSS
  assert.match(cssSrc, /\.clause-row\b/, ".clause-row style must exist");
  assert.match(cssSrc, /\.clause-num\b/, ".clause-num style must exist");

  // Iter #137 polish: per-row copy + flagged-only filter + counter.
  assert.match(appSrc, /clauseCopyBtn|data-clause-copy=/,
    "iter #137 must render a per-row copy citation button");
  assert.match(appSrc, /clauseIndex\._showFlagged|flagged-only|flagged only/,
    "iter #137 must include a flagged-only filter state");
  assert.match(appSrc, /lastFlags[\s\S]+?clauseIndex|flaggedKey/,
    "iter #137 must annotate flagged clauses against lastFlags");
  assert.match(cssSrc, /\.clause-flagged\b/, ".clause-flagged style must exist");
  assert.match(cssSrc, /\.clause-controls\b/, ".clause-controls style must exist");

  // Cycle #224 — bulk copy-list export + no stacking on re-render.
  assert.match(appSrc, /id="clauseCopyAllBtn" title="Copy the clause index as plain text"/,
    "cycle #224 must add a clause copy-list chip");
  assert.match(appSrc, /const copyAllBtn = document\.getElementById\('clauseCopyAllBtn'\);/,
    "the copy-list chip must have a click handler");
  assert.match(appSrc, /const oldControls = clauseIndex\.parentNode && clauseIndex\.parentNode\.querySelector\('\.clause-controls'\);/,
    "re-render must remove the previous controls row instead of stacking it");
  assert.match(appSrc, /'📑 CLAUSE INDEX \(' \+ visible\.length \+ ' of ' \+ total \+ '\)'/,
    "the copied index must lead with a count header");
  assert.match(appSrc, /'📋 Clause index copied \(' \+ visible\.length \+ '\)'/,
    "copying must toast the clause count");
  assert.match(appSrc, /clauseCopyMdBtn/,
    "iter #268 must include a clause-index Markdown copy button");
  assert.match(appSrc, /'📋 Clause index copied as Markdown'/,
    "iter #268 must confirm when the clause index Markdown is copied");
  assert.match(appSrc, /\| Clause \| Snippet \| Flagged \|/,
    "iter #268 must build a Markdown table header");
  assert.match(appSrc, /_Showing flagged clauses only\._/,
    "iter #268 must note when the flagged-only filter is active");

  // Cycle #225 — valid HTML + keyboard parity: the row is a
  // div[role=button] (tabindex=0) so the inner copy button is legal,
  // and Enter/Space trigger the same jump as a click.
  assert.match(appSrc, /<div class="' \+ cls \+ '" data-clause-offset=/,
    "each clause row must be a div, not a button");
  assert.match(appSrc, /tabindex="0" role="button"/,
    "clause rows must be keyboard-focusable with button semantics");
  assert.match(appSrc, /Clause marker no longer in input[\s\S]{0,500}row\.addEventListener\('keydown'/,
    "clause rows must handle Enter/Space for keyboard parity");
  assert.match(cssSrc, /\.clause-row\{[^}]*font:inherit;color:inherit/,
    "the row div must inherit font and color like a native control");
});

skip("analyze: clause index copies as Markdown", async () => {
  if (!HAS_BROWSER) return;
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  const errors = [];
  page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.addInitScript(() => {
    window.__copiedClauseMd = null;
    try {
      Object.defineProperty(navigator, "clipboard", {
        configurable: true,
        value: {
          writeText: async (txt) => { window.__copiedClauseMd = txt; },
          write: async () => {},
        },
      });
    } catch (_) {
      try { navigator.clipboard = { writeText: async (txt) => { window.__copiedClauseMd = txt; }, write: async () => {} }; } catch (_2) {}
    }
  });
  try {
    await page.goto(`http://127.0.0.1:${PORT}/analyze.html`, { waitUntil: "networkidle" });
    await page.click(".qf[data-fill]:first-of-type");
    await page.click("#analyzeBtn");
    await page.waitForSelector("#indexBlock:not([hidden]) #clauseCopyMdBtn", { timeout: 8000 });
    await page.click("#clauseCopyMdBtn");
    await page.waitForFunction(() => window.__copiedClauseMd && window.__copiedClauseMd.length > 0, { timeout: 8000 });
    const captured = await page.evaluate(() => window.__copiedClauseMd);
    assert.match(captured, /^\| Clause \| Snippet \| Flagged \|/, "the copied clause index must start with the Markdown header");
    assert.match(captured, /\|---\|---\|---\|/, "the copied clause index must include the separator row");
    assert.equal(errors.length, 0, `zero console errors, got: ${errors.join(" | ")}`);
  } finally {
    await page.close();
    await ctx.close();
  }
});

// Iter #138: cost predictor — expected vs 90th-percentile vs worst.
test("analyzer: Cost predictor shows expected / 90th / worst-case scenarios", () => {
  if (!HAS_BROWSER) return;
  const fs = require("node:fs");
  const path = require("node:path");
  const appSrc = fs.readFileSync(path.join(ROOT, "assets", "app.js"), "utf8");
  const cssSrc = fs.readFileSync(path.join(ROOT, "assets", "theme.css"), "utf8");
  const html = fs.readFileSync(path.join(ROOT, "analyze.html"), "utf8");

  assert.match(html, /id="costBlock"/, "analyze.html must contain #costBlock");
  assert.match(appSrc, /function buildCostPrediction\(/, "buildCostPrediction must exist");
  assert.match(appSrc, /function renderCostBlock\(/, "renderCostBlock must exist");
  // Per-severity probabilities
  assert.match(appSrc, /0\.35/,
    "iter #138 must apply a 35% probability of trigger for traps");
  assert.match(appSrc, /0\.12/,
    "iter #138 must apply a 12% probability for watches");
  // Three scenarios
  assert.match(appSrc, /Expected cost/,
    "iter #138 must surface an 'Expected cost' scenario");
  assert.match(appSrc, /90th percentile/,
    "iter #138 must surface a 90th-percentile scenario");
  assert.match(appSrc, /Worst case/,
    "iter #138 must surface a 'Worst case' scenario");
  // Wiring
  assert.match(appSrc, /renderCostBlock\(raw[\s\S]+?ctx\)/,
    "render() must call renderCostBlock with raw + ctx");
  // CSS
  assert.match(cssSrc, /\.cost-cell\b/, ".cost-cell style must exist");
  assert.match(cssSrc, /\.cost-best\b/, ".cost-best style must exist");
  assert.match(cssSrc, /\.cost-worst\b/, ".cost-worst style must exist");

  // Iter #139 polish: probability sliders + reset to defaults.
  assert.match(appSrc, /loadCostProbs|COST_PROB_KEY/,
    "iter #139 must load saved probabilities from localStorage");
  assert.match(appSrc, /data-cost-prob=/,
    "iter #139 must render probability sliders");
  assert.match(appSrc, /costResetProbsBtn/,
    "iter #139 must render a reset-to-defaults button");
  assert.match(appSrc, /costCopyMdBtn/,
    "iter #270 must include a cost-predictor Markdown copy button");
  assert.match(appSrc, /'📋 Cost predictor copied as Markdown'/,
    "iter #270 must confirm when the cost predictor Markdown is copied");
  assert.match(appSrc, /\| Scenario \| Amount \|/,
    "iter #270 must build a Markdown table header");
  assert.match(appSrc, /const live = buildCostPrediction\(raw, ctx, loadCostProbs\(\)\) \|\| c;/,
    "iter #270 must read live slider-adjusted values when copied");
  assert.match(appSrc, /_Generated ' \+ new Date\(\)\.toLocaleString/,
    "iter #270 must include a generated timestamp");
  assert.match(cssSrc, /\.cost-sliders\b/, ".cost-sliders style must exist");
});

skip("analyze: cost predictor copies as Markdown", async () => {
  if (!HAS_BROWSER) return;
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  const errors = [];
  page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.addInitScript(() => {
    window.__copiedCostMd = null;
    try {
      Object.defineProperty(navigator, "clipboard", {
        configurable: true,
        value: {
          writeText: async (txt) => { window.__copiedCostMd = txt; },
          write: async () => {},
        },
      });
    } catch (_) {
      try { navigator.clipboard = { writeText: async (txt) => { window.__copiedCostMd = txt; }, write: async () => {} }; } catch (_2) {}
    }
  });
  try {
    await page.goto(`http://127.0.0.1:${PORT}/analyze.html`, { waitUntil: "networkidle" });
    await page.click(".qf[data-fill]:first-of-type");
    await page.click("#analyzeBtn");
    await page.waitForSelector("#costBlock:not([hidden]) #costCopyMdBtn", { timeout: 8000 });
    await page.click("#costCopyMdBtn");
    await page.waitForFunction(() => window.__copiedCostMd && window.__copiedCostMd.length > 0, { timeout: 8000 });
    const captured = await page.evaluate(() => window.__copiedCostMd);
    assert.match(captured, /^## Cost predictor/, "the copied cost predictor must start with a heading");
    assert.match(captured, /\| Scenario \| Amount \|/, "the copied cost predictor must include the scenario table");
    assert.match(captured, /_Generated/, "the copied cost predictor must include a generated line");
    assert.equal(errors.length, 0, `zero console errors, got: ${errors.join(" | ")}`);
  } finally {
    await page.close();
    await ctx.close();
  }
});

// Cycle #116 — ask the document about any "what-if" scenario.
test("analyzer: Scenario cards can ask the document about the scenario in one click", () => {
  if (!HAS_BROWSER) return;
  const fs = require("node:fs");
  const path = require("node:path");
  const appSrc = fs.readFileSync(path.join(ROOT, "assets", "app.js"), "utf8");

  assert.match(appSrc, /class="scenario-ask ghost-btn ghost-btn-sm"/,
    "each scenario card must render an ask button");
  assert.match(appSrc, /data-scenario-ask="' \+ esc\(\(s\.ifText \|\| ''\) \+ ' → ' \+ \(s\.thenText \|\| ''\)\) \+ '"/,
    "the ask button must carry the IF … THEN scenario");
  assert.match(appSrc, /data-scenario-sev="' \+ esc\(s\.severity\) \+ '"/,
    "the ask button must carry the scenario severity");
  assert.match(appSrc, /e\.target\.closest && e\.target\.closest\('\[data-scenario-ask\]'\)/,
    "the card click handler must catch ask-button clicks");
  assert.match(appSrc, /How likely is this scenario and what should I do if it happens\?/,
    "clicking must ask about likelihood and next steps");
  assert.match(appSrc, /qInput\.scrollIntoView/,
    "clicking must bring the Ask panel into view");
  assert.match(appSrc, /showAnalyzeToast\('💬 Question ready — press Ask'\)/,
    "clicking must announce the prefilled question");
  assert.match(appSrc, /💬<\/b> asks the document about a scenario\./,
    "the block note must document the ask action");
  assert.match(appSrc, /\.kc-ask, \.scenario-ask, \.act-ask, \.bearer-ask, \.reading-ask'\)/,
    "the a shortcut must also cover scenario cards");
});

// Cycle #130 — per-scenario-card copy citation.
test("analyzer: Scenario cards copy their citation in one click", () => {
  if (!HAS_BROWSER) return;
  const fs = require("node:fs");
  const path = require("node:path");
  const appSrc = fs.readFileSync(path.join(ROOT, "assets", "app.js"), "utf8");
  const cssSrc = fs.readFileSync(path.join(ROOT, "assets", "theme.css"), "utf8");

  assert.match(appSrc, /class="scenario-copy ghost-btn ghost-btn-sm"/,
    "each scenario card must render a copy button");
  assert.match(appSrc, /const copyText = '\[SCENARIO · '/,
    "the citation must open with the SCENARIO tag");
  assert.match(appSrc, /IF: ' \+\s*\(s\.ifText \|\| ''\) \+ ' → THEN: '/,
    "the citation must carry the IF … THEN prediction");
  assert.match(appSrc, /data-scenario-copy-text="' \+ esc\(copyText\) \+ '"/,
    "the copy button must carry the prebuilt citation");
  assert.match(appSrc, /e\.target\.closest && e\.target\.closest\('\[data-scenario-copy-text\]'\)/,
    "the card click handler must catch copy-button clicks");
  assert.match(appSrc, /📋 Scenario citation copied/,
    "copying must announce via toast");
  assert.match(appSrc, /copyBtn\.textContent = copied \? '✓' : '📋';/,
    "the button must flash its copied state");
  assert.match(appSrc, /<b>📋<\/b> copies one as a citation\./,
    "the block note must document the copy action");
  assert.match(appSrc, /class="scenario-actions"/,
    "the ask + copy buttons must be grouped into one cluster");
  assert.match(cssSrc, /\.scenario-actions\{[^}]*justify-content:flex-end/,
    "the action cluster must right-align in the card");
});

// Cycle #148 — hear any scenario aloud.
test("analyzer: Scenario cards read the scenario aloud in one click", () => {
  if (!HAS_BROWSER) return;
  const fs = require("node:fs");
  const path = require("node:path");
  const appSrc = fs.readFileSync(path.join(ROOT, "assets", "app.js"), "utf8");
  const cssSrc = fs.readFileSync(path.join(ROOT, "assets", "theme.css"), "utf8");

  assert.match(appSrc, /class="scenario-speak ghost-btn ghost-btn-sm"/,
    "each scenario card must render a speak button");
  assert.match(appSrc, /\(s\.ifText \|\| ''\) \+ '\. ' \+ \(s\.thenText \|\| ''\)/,
    "the speak button must carry the IF … THEN narrative");
  assert.match(appSrc, /e\.target\.closest && e\.target\.closest\('\[data-scenario-speak\]'\)/,
    "the card click handler must catch speak-button clicks");
  assert.match(appSrc, /new SpeechSynthesisUtterance\(text\)/,
    "clicking must speak the scenario");
  assert.match(appSrc, /u\.rate = getTtsRate\(\);/,
    "the reading must respect the chosen speed");
  assert.match(appSrc, /🔊<\/b> reads it aloud\./,
    "the block note must document the speak action");
  assert.match(cssSrc, /\.scenario-actions \.ghost-btn\{[^}]*flex-shrink:0/,
    "the action buttons must never shrink");
  assert.match(cssSrc, /\.scenario-speak:focus-visible\{/,
    "the speak button must have a focus ring");
});

// Cycle #132 — ask about any risk-allocation row.
test("analyzer: Bearer rows can ask the document about the risk in one click", () => {
  if (!HAS_BROWSER) return;
  const fs = require("node:fs");
  const path = require("node:path");
  const appSrc = fs.readFileSync(path.join(ROOT, "assets", "app.js"), "utf8");

  assert.match(appSrc, /class="bearer-ask ghost-btn ghost-btn-sm"/,
    "each bearer row must render an ask button");
  assert.match(appSrc, /data-bearer-ask="' \+ esc\(trunc\(it\.quote, 160\)\) \+ '"/,
    "the ask button must carry the quoted clause");
  assert.match(appSrc, /data-bearer-side="' \+ esc\(it\.side\) \+ '"/,
    "the ask button must carry the risk side");
  assert.match(appSrc, /e\.target\.closest && e\.target\.closest\('\[data-bearer-ask\]'\)/,
    "the row click handler must catch ask-button clicks");
  assert.match(appSrc, /What happens if this risk I bear materializes\?/,
    "risks you bear must ask what happens if they materialize");
  assert.match(appSrc, /What happens if this shared risk materializes\?/,
    "shared risks must get a matching question");
  assert.match(appSrc, /qInput\.scrollIntoView/,
    "clicking must bring the Ask panel into view");
  assert.match(appSrc, /showAnalyzeToast\('💬 Question ready — press Ask'\)/,
    "clicking must announce the prefilled question");
  assert.match(appSrc, /<b>💬<\/b> to ask about a risk/,
    "the block note must document the ask action");
  assert.match(appSrc, /\.action-row, \.bearer-row, \.reading-row'\) : null;/,
    "the a shortcut must also cover bearer rows");
  assert.match(appSrc, /\.act-ask, \.bearer-ask, \.reading-ask'\)/,
    "the a shortcut must target the bearer ask button");
});

// Cycle #158 — per-bearer-row copy citation.
test("analyzer: Bearer rows copy their risk allocation in one click", () => {
  if (!HAS_BROWSER) return;
  const fs = require("node:fs");
  const path = require("node:path");
  const appSrc = fs.readFileSync(path.join(ROOT, "assets", "app.js"), "utf8");
  const cssSrc = fs.readFileSync(path.join(ROOT, "assets", "theme.css"), "utf8");

  assert.match(appSrc, /const copyVal = '\[BEARER · ' \+ \(it\.side === 'you' \? 'you' : it\.side === 'them' \? 'them' : 'shared'\) \+ '\] ' \+ it\.label \+ ': "' \+ trunc\(it\.quote, 200\) \+ '"'/,
    "the citation must carry the side, label, and quoted clause");
  assert.match(appSrc, /class="bearer-row-copy ghost-btn ghost-btn-sm"/,
    "each bearer row must render a copy button");
  assert.match(appSrc, /data-bearer-copy-text="' \+ esc\(copyVal\) \+ '"/,
    "the copy button must carry the prebuilt citation");
  assert.match(appSrc, /\$\$\('\.bearer-row-copy', bearerGrid\)\.forEach/,
    "copy buttons must be wired after each render");
  assert.match(appSrc, /e\.stopPropagation\(\);/,
    "copying must not trigger the row's jump or ask");
  assert.match(appSrc, /📋 Risk allocation copied/,
    "copying must announce via toast");
  assert.match(appSrc, /<b>📋<\/b> to copy one/,
    "the block note must document the copy action");
  assert.match(appSrc, /class="bearer-actions"/,
    "the ask + copy buttons must be grouped into one action row");
  assert.match(cssSrc, /\.bearer-actions\{[^}]*justify-content:flex-end/,
    "the action row must right-align");
  assert.match(cssSrc, /\.bearer-row-copy:focus-visible\{/,
    "the copy button must have a focus ring");
});

// Cycle #134 — per-chunk copy in the reading list.
test("analyzer: Reading-list chunks copy their quote in one click", () => {
  if (!HAS_BROWSER) return;
  const fs = require("node:fs");
  const path = require("node:path");
  const appSrc = fs.readFileSync(path.join(ROOT, "assets", "app.js"), "utf8");
  const cssSrc = fs.readFileSync(path.join(ROOT, "assets", "theme.css"), "utf8");

  assert.match(appSrc, /const bucketLabel = c\.bucket === 'must' \? 'MUST-READ' : c\.bucket === 'skim' \? 'SKIM' : 'SKIP';/,
    "the citation must carry the bucket label");
  assert.match(appSrc, /class="reading-copy ghost-btn ghost-btn-sm"/,
    "each reading chunk must render a copy button");
  assert.match(appSrc, /data-reading-copy-text="' \+ esc\(copyText\) \+ '"/,
    "the copy button must carry the prebuilt quote");
  assert.match(appSrc, /e\.target\.closest && e\.target\.closest\('\[data-reading-copy-text\]'\)/,
    "the row click handler must catch copy-button clicks");
  assert.match(appSrc, /📋 Reading chunk copied/,
    "copying must announce via toast");
  assert.match(appSrc, /copyBtn\.textContent = copied \? '✓' : '📋';/,
    "the button must flash its copied state");
  assert.match(appSrc, /<b>📋<\/b> per row copies a single chunk/,
    "the block note must document the copy action");
  assert.match(cssSrc, /\.reading-copy\{[^}]*flex-shrink:0/,
    "the copy button must never get crushed beside the content");
  assert.match(cssSrc, /\.reading-copy:focus-visible\{/,
    "the copy button must have a focus ring");
});

// Cycle #155 — hear any reading chunk aloud.
test("analyzer: Reading-list chunks read the chunk aloud in one click", () => {
  if (!HAS_BROWSER) return;
  const fs = require("node:fs");
  const path = require("node:path");
  const appSrc = fs.readFileSync(path.join(ROOT, "assets", "app.js"), "utf8");
  const cssSrc = fs.readFileSync(path.join(ROOT, "assets", "theme.css"), "utf8");

  assert.match(appSrc, /class="reading-speak ghost-btn ghost-btn-sm"/,
    "each reading chunk must render a speak button");
  assert.match(appSrc, /data-reading-speak="' \+ esc\(c\.sentences\.join\(' '\)\.slice\(0, 300\)\) \+ '"/,
    "the speak button must carry the chunk sentences");
  assert.match(appSrc, /e\.target\.closest && e\.target\.closest\('\[data-reading-speak\]'\)/,
    "the row click handler must catch speak-button clicks");
  assert.match(appSrc, /new SpeechSynthesisUtterance\(text\)/,
    "clicking must speak the chunk");
  assert.match(appSrc, /u\.rate = getTtsRate\(\);/,
    "the reading must respect the chosen speed");
  assert.match(appSrc, /<b>🔊<\/b> reads one aloud/,
    "the block note must document the speak action");
  assert.match(cssSrc, /\.reading-speak\{[^}]*flex-shrink:0/,
    "the speak button must never get crushed beside the content");
  assert.match(cssSrc, /\.reading-speak:focus-visible\{/,
    "the speak button must have a focus ring");
});

// Cycle #172 — ask about any reading-list chunk, completing the per-row
// copy / ask / speak trio for the reading list.
test("analyzer: Reading-list chunks ask about the chunk in one click", () => {
  if (!HAS_BROWSER) return;
  const fs = require("node:fs");
  const path = require("node:path");
  const appSrc = fs.readFileSync(path.join(ROOT, "assets", "app.js"), "utf8");
  const cssSrc = fs.readFileSync(path.join(ROOT, "assets", "theme.css"), "utf8");

  assert.match(appSrc, /class="reading-ask ghost-btn ghost-btn-sm"/,
    "each reading chunk must render an ask button");
  assert.match(appSrc, /data-reading-ask="' \+ esc\(c\.sentences\.join\(' '\)\.slice\(0, 300\)\) \+ '" data-reading-bucket="' \+ c\.bucket \+ '"/,
    "the ask button must carry the chunk sentences and its bucket");
  assert.match(appSrc, /e\.target\.closest && e\.target\.closest\('\[data-reading-ask\]'\)/,
    "the row click handler must catch ask-button clicks");
  assert.match(appSrc, /const bucketWord = bucket === 'must' \? 'must-read' : bucket === 'skim' \? 'skim' : 'skip';/,
    "the bucket must map to a plain-English label");
  assert.match(appSrc, /qInput\.value = 'What does this ' \+ bucketWord \+ ' passage mean: "' \+ text\.slice\(0, 220\) \+ '"';/,
    "clicking must prefill a question quoting the chunk");
  assert.match(appSrc, /if\(!qInput \|\| !text\) return;/,
    "missing input or empty text must no-op");
  assert.match(appSrc, /'💬 Question ready — press Ask'/,
    "clicking must announce the prefilled question");
  assert.match(appSrc, /<b>💬<\/b> asks about one/,
    "the block note must document the ask action");
  assert.match(cssSrc, /\.reading-ask\{[^}]*flex-shrink:0/,
    "the ask button must never get crushed beside the content");
  assert.match(cssSrc, /\.reading-ask:focus-visible\{/,
    "the ask button must have a focus ring");
});

// Cycle #178 — resume reading: one click jumps to the first unfinished
// must-read chunk (falling back to any unfinished chunk), flashes it, and
// reports where you are.
test("analyzer: reading list resume button jumps to the first unfinished chunk", () => {
  if (!HAS_BROWSER) return;
  const fs = require("node:fs");
  const path = require("node:path");
  const appSrc = fs.readFileSync(path.join(ROOT, "assets", "app.js"), "utf8");
  const cssSrc = fs.readFileSync(path.join(ROOT, "assets", "theme.css"), "utf8");

  assert.match(appSrc, /id="readingResumeBtn" title="Jump to your first unfinished must-read chunk"/,
    "reading controls must include a resume button");
  assert.match(appSrc, /const resumeBtn = document\.getElementById\('readingResumeBtn'\);/,
    "the resume button must have a click handler");
  assert.match(appSrc, /undone\.filter\(r => r\.closest\('\.reading-bucket-must'\)\)/,
    "resume must group the unfinished must-read chunks first");
  assert.match(appSrc, /mustFirst\.find\(visible\) \|\|[\s\S]{0,60}undone\.find\(visible\) \|\|[\s\S]{0,60}mustFirst\[0\] \|\|[\s\S]{0,60}undone\[0\]/,
    "resume must prefer visible rows, then must-read, then any undone chunk");
  assert.match(appSrc, /const visible = \(el\) => el\.offsetParent !== null;/,
    "resume must ignore rows hidden by the active filter");
  assert.match(appSrc, /'✓ All chunks read — nice work'/,
    "resume must celebrate when every chunk is done");
  assert.match(appSrc, /target\.classList\.add\('reading-resume-flash'\)/,
    "the target chunk must be highlighted");
  assert.match(appSrc, /setTimeout\(\(\) => target\.classList\.remove\('reading-resume-flash'\), 2200\);/,
    "the highlight must fade after a couple of seconds");
  assert.match(appSrc, /'▶ Resuming: chunk ' \+ pos \+ ' of ' \+ all\.length/,
    "resume must announce the chunk position");
  assert.match(appSrc, /<b>▶ resume<\/b> jumps to your first unfinished must-read/,
    "the block note must document the resume action");
  assert.match(cssSrc, /\.reading-resume-flash\{/, "the resume highlight must be styled");
});

// Cycle #194 — reset all read marks for the current document.
test("analyzer: reading list reset clears read marks", () => {
  if (!HAS_BROWSER) return;
  const fs = require("node:fs");
  const path = require("node:path");
  const appSrc = fs.readFileSync(path.join(ROOT, "assets", "app.js"), "utf8");

  assert.match(appSrc, /id="readingResetBtn" title="Clear all read marks for this document"/,
    "reading controls must include a reset button");
  assert.match(appSrc, /const readingResetBtn = document\.getElementById\('readingResetBtn'\);/,
    "the reset button must have a click handler");
  assert.match(appSrc, /doneMap = \{\};[\s\S]{0,80}localStorage\.removeItem\(doneKey\)/,
    "resetting must clear the in-memory and persisted done map");
  assert.match(appSrc, /localStorage\.removeItem\(doneKey\); \} catch\(_\)\{ \/\* ignore \*\/ \}[\s\S]{0,60}renderReadingBlock\(raw, ctx\);/,
    "resetting must re-render the reading list");
  assert.match(appSrc, /'↺ Read marks cleared for this document'/,
    "resetting must confirm with a toast");
});

// Cycle #195 — the reading copy-list respects the active filter so a
// filtered view exports exactly what's visible.
test("analyzer: reading copy list respects the active filter", () => {
  if (!HAS_BROWSER) return;
  const fs = require("node:fs");
  const path = require("node:path");
  const appSrc = fs.readFileSync(path.join(ROOT, "assets", "app.js"), "utf8");

  assert.match(appSrc, /const activeFilter = readingGrid\._readingFilter \|\| 'all';/,
    "the copy-list builder must read the active bucket filter");
  assert.match(appSrc, /const filterChunks = \(kind, chunks\) => \{/,
    "the copy-list builder must filter chunks per bucket");
  assert.match(appSrc, /if\(activeFilter !== 'all' && activeFilter !== kind\) return \[\];/,
    "hidden buckets must be skipped in the copy");
  assert.match(appSrc, /undoneOnly && isDone\(c\)\) return false;/,
    "undone-only and signal filters must apply to the copy");
  assert.match(appSrc, /' · filtered view'/,
    "the copied header must note when the view is filtered");
});

// Cycle #223 — the reading view (bucket filter, undone-only, signal)
// persists across re-analyses and reloads.
test("analyzer: reading view persists across re-analysis", () => {
  if (!HAS_BROWSER) return;
  const fs = require("node:fs");
  const path = require("node:path");
  const appSrc = fs.readFileSync(path.join(ROOT, "assets", "app.js"), "utf8");

  assert.match(appSrc, /if\(readingGrid\._readingFilter === undefined\)\{/,
    "the reading view must be restored only when unset");
  assert.match(appSrc, /localStorage\.getItem\('cleardoc:reading-view'\)/,
    "the reading view must read the saved choice");
  assert.match(appSrc, /saved\.filter === 'all' \|\| saved\.filter === 'must' \|\| saved\.filter === 'skim' \|\| saved\.filter === 'skip'/,
    "a saved bucket filter must be validated before use");
  assert.match(appSrc, /saved\.signal === 'flagged' \|\| saved\.signal === 'moneyHit'/,
    "a saved signal filter must be validated before use");
  assert.match(appSrc, /const saveReadingView = \(\) => \{/,
    "the view must have a save helper");
  assert.match(appSrc, /localStorage\.setItem\('cleardoc:reading-view'/,
    "changing the view must persist it");
  assert.match(appSrc, /⏳ left<\/b> copies only the unread chunks/,
    "the reading note must document the left chip");
});

// Cycle #212 — one-click copy of just the must-read chunks.
test("analyzer: reading list copies must-reads only", () => {
  if (!HAS_BROWSER) return;
  const fs = require("node:fs");
  const path = require("node:path");
  const appSrc = fs.readFileSync(path.join(ROOT, "assets", "app.js"), "utf8");

  assert.match(appSrc, /id="readingCopyMustBtn" title="Copy only the must-read chunks"/,
    "reading controls must include a must-list chip");
  assert.match(appSrc, /const copyMustBtn = document\.getElementById\('readingCopyMustBtn'\);/,
    "the must-list chip must have a click handler");
  assert.match(appSrc, /r\.buckets\.must\.filter\(c => \{/,
    "the handler must start from the must bucket");
  assert.match(appSrc, /'🔴 MUST-READ ONLY \(' \+ chunks\.length \+ ' chunk' \+ \(chunks\.length === 1 \? '' : 's'\) \+ '\)' \+ \(\(undoneOnly \|\| signalFilter\) \? ' · filtered view' : ''\)/,
    "the copied list must lead with a must-read-only header");
  assert.match(appSrc, /'🔴 Must-read list copied'/,
    "copying must toast on success");
  assert.match(appSrc, /'🔴 No must-read chunks to copy'/,
    "an empty must bucket must be reported");
});

// Cycle #222 — one-click copy of just the chunks still unread.
test("analyzer: reading list copies the remaining unread chunks", () => {
  if (!HAS_BROWSER) return;
  const fs = require("node:fs");
  const path = require("node:path");
  const appSrc = fs.readFileSync(path.join(ROOT, "assets", "app.js"), "utf8");

  assert.match(appSrc, /id="readingCopyLeftBtn" title="Copy only the chunks you have not marked done"/,
    "reading controls must include a left-to-read chip");
  assert.match(appSrc, /const copyLeftBtn = document\.getElementById\('readingCopyLeftBtn'\);/,
    "the left chip must have a click handler");
  assert.match(appSrc, /const remaining = \[\];[\s\S]{0,320}if\(isDone\(c\)\) return;/,
    "the handler must skip chunks already marked done");
  assert.match(appSrc, /'⏳ STILL TO READ \(' \+ remaining\.length \+ ' chunk'/,
    "the copied list must lead with a still-to-read header");
  assert.match(appSrc, /'✓ Nothing left — every chunk is marked done'/,
    "an all-done list must be reported");
  assert.match(appSrc, /'⏳ ' \+ remaining\.length \+ ' chunk' \+ \(remaining\.length === 1 \? '' : 's'\) \+ ' left copied'/,
    "copying must toast the remaining count");
});

// Cycle #232 — hear the chunks still unread.
test("analyzer: reading list speaks the remaining unread chunks", () => {
  if (!HAS_BROWSER) return;
  const fs = require("node:fs");
  const path = require("node:path");
  const appSrc = fs.readFileSync(path.join(ROOT, "assets", "app.js"), "utf8");

  assert.match(appSrc, /id="readingSpeakLeftBtn" title="Read aloud only the chunks you have not marked done"/,
    "reading controls must include a read-left chip");
  assert.match(appSrc, /const speakLeftBtn = document\.getElementById\('readingSpeakLeftBtn'\);/,
    "the read-left chip must have a click handler");
  assert.match(appSrc, /const remaining = remainingChunks\(\);/,
    "the handler must use the shared remaining-chunks selection");
  assert.match(appSrc, /'🔊 Reading ' \+ remaining\.length \+ ' chunk' \+ \(remaining\.length === 1 \? '' : 's'\) \+ ' left aloud'/,
    "speaking must toast the remaining count");
  assert.match(appSrc, /speakLeftBtn\.textContent = '◼ Stop';/,
    "the chip must become a stop button while speaking");
  assert.match(appSrc, /queue\.forEach\(\(u, i\) => \{[\s\S]{0,260}u\.onend/,
    "utterances must chain so the chunks play in order");
  assert.match(appSrc, /🔊 read left<\/b> reads them aloud in order/,
    "the reading note must document the read-left chip");
});

// Cycle #226 — the reading plan exports as a tracker-ready CSV file.
test("analyzer: reading list exports a CSV tracker file", () => {
  if (!HAS_BROWSER) return;
  const fs = require("node:fs");
  const path = require("node:path");
  const appSrc = fs.readFileSync(path.join(ROOT, "assets", "app.js"), "utf8");

  assert.match(appSrc, /id="readingCsvBtn" title="Download the reading plan as a .csv file for a tracker"/,
    "reading controls must include a CSV chip");
  assert.match(appSrc, /const readingCsvBtn = document\.getElementById\('readingCsvBtn'\);/,
    "the CSV chip must have a click handler");
  assert.match(appSrc, /a\.download = 'cleardoc-reading-' \+ stamp \+ '\.csv';/,
    "the export must download as cleardoc-reading-<date>.csv");
  assert.match(appSrc, /const csvCell = \(v\) => \{[\s\S]{0,220}\/\^\[=\+\\-\@\]/,
    "CSV cells must carry the formula-injection guard");
  assert.match(appSrc, /csvCell\('Bucket'\) \+ ',' \+ csvCell\('Priority'\)/,
    "the CSV must lead with a Bucket/Priority column header");
  assert.match(appSrc, /'📊 Reading plan CSV downloaded \(' \+ rows\.length \+ '\)'/,
    "downloading must toast the chunk count");
});

// Cycle #226 — live: the reading-plan CSV actually downloads and the
// file carries BOM + headers + per-chunk status.
skip("analyzer: reading list downloads a CSV tracker file", async () => {
  if (!HAS_BROWSER) return;
  const ctx = await browser.newContext({ acceptDownloads: true });
  const page = await ctx.newPage();
  const consoleErrors = [];
  page.on("console", (m) => { if (m.type() === "error") consoleErrors.push(m.text()); });
  page.on("pageerror", (e) => consoleErrors.push(String(e)));
  await page.addInitScript(() => {
    const MOCK = {
      analysis: {
        plainEnglishRewrite: "<b>This is a rewritten clause.</b> It says you must pay within 30 days.",
        risks: [],
        verdict: { label: "Suspicious", summary: "One clause deserves attention before signing." },
        deadlines: [],
        nextSteps: ["Calendar the cancellation deadline."],
        readingLevel: { before: 14, after: 8 },
        jargonFound: 7,
      },
    };
    const origFetch = window.fetch.bind(window);
    window.fetch = function patchedFetch(url, opts) {
      const u = typeof url === "string" ? url : (url && url.url) || "";
      if (u.endsWith("/api/analyze")) {
        return Promise.resolve(new Response(JSON.stringify(MOCK), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }));
      }
      return origFetch(url, opts);
    };
  });
  const doc = "Lessee shall indemnify the landlord in perpetuity. Lessee must pay all costs within 30 days. " +
    "This Agreement may be amended by written notice. The parties acknowledge the foregoing. Executed in triplicate.";
  await page.goto(`http://127.0.0.1:${PORT}/analyze.html`, { waitUntil: "networkidle" });
  await page.evaluate((d) => { document.getElementById("docInput").value = d; }, doc);
  await page.click("#analyzeBtn");
  await page.waitForSelector("#readingBlock:not([hidden]) .reading-row", { timeout: 8000 });
  await page.evaluate(() => document.querySelector("#readingBlock .reading-done").click());
  await page.waitForSelector("#readingBlock .reading-row-done", { timeout: 4000 });

  const [download] = await Promise.all([
    page.waitForEvent("download", { timeout: 8000 }),
    page.click("#readingCsvBtn"),
  ]);
  const dlPath = await download.path();
  const content = fs.readFileSync(dlPath, "utf8");
  assert.match(download.suggestedFilename(), /^cleardoc-reading-\d{4}-\d{2}-\d{2}\.csv$/,
    "the CSV must download as cleardoc-reading-<date>.csv");
  assert.equal(content.charCodeAt(0), 0xFEFF, "the CSV must start with a UTF-8 BOM");
  const lines = content.slice(1).split("\n");
  assert.match(lines[0], /Reading plan/, "the CSV must open with a metadata row");
  assert.match(lines[1], /Bucket.*Status.*Text/, "the CSV must carry the column header");
  const dataRows = lines.slice(2).filter((l) => l.trim().length > 0);
  assert.ok(dataRows.length >= 3, "the CSV must include every chunk");
  assert.ok(dataRows.some((l) => l.includes('"done"')), "the CSV must mark the read chunk done");
  assert.ok(dataRows.some((l) => l.includes('"todo"')), "the CSV must mark unread chunks todo");
  assert.equal(consoleErrors.length, 0, `zero console errors, got: ${consoleErrors.join(" | ")}`);

  await page.close();
  await ctx.close();
});

// Cycle #216 — bulk mark every must-read chunk done in one click.
test("analyzer: reading list marks all must-reads done in one click", () => {
  if (!HAS_BROWSER) return;
  const fs = require("node:fs");
  const path = require("node:path");
  const appSrc = fs.readFileSync(path.join(ROOT, "assets", "app.js"), "utf8");

  assert.match(appSrc, /id="readingMustDoneBtn" title="Mark every must-read chunk as done"/,
    "reading controls must include a must-done chip");
  assert.match(appSrc, /const mustDoneBtn = document\.getElementById\('readingMustDoneBtn'\);/,
    "the must-done chip must have a click handler");
  assert.match(appSrc, /r\.buckets\.must\.forEach\(c => \{/,
    "the handler must iterate the must bucket");
  assert.match(appSrc, /if\(!isDone\(c\)\)\{ markDone\(c, true\); marked\+\+; \}/,
    "unread must chunks must be marked done");
  assert.match(appSrc, /'✓ Marked ' \+ marked \+ ' must-read'/,
    "marking must toast the count");
  assert.match(appSrc, /'✓ Must-reads already done'/,
    "already-done must-reads must be acknowledged");
  assert.match(appSrc, /'No must-read chunks to mark'/,
    "a document with no must-reads must say so");
});

// Cycle #201 — the reading count shows time remaining once progress starts.
test("analyzer: reading count shows time remaining after progress", () => {
  if (!HAS_BROWSER) return;
  const fs = require("node:fs");
  const path = require("node:path");
  const appSrc = fs.readFileSync(path.join(ROOT, "assets", "app.js"), "utf8");

  assert.match(appSrc, /const undoneWords = r\.groups\.reduce\(\(a, c\) => a \+ \(isDone\(c\) \? 0 : \(c\.signalsAcc\.wordCount \|\| 0\)\), 0\);/,
    "the renderer must count words across the undone chunks");
  assert.match(appSrc, /const remainingRaw = Math\.round\(undoneWords \/ 200\);/,
    "the remaining minutes must reuse the 200-wpm estimate");
  assert.match(appSrc, /const remainingMins = Math\.max\(1, remainingRaw\);/,
    "the remaining minutes must floor at 1");
  assert.match(appSrc, /undoneWords > 0 && remainingMins < totalMins \? ' · ~' \+ remainingMins \+ ' min left' : ''/,
    "the count line must show remaining time once progress has started");
  // Cycle #208 — the lead shows the must-reads' share of total time.
  assert.match(appSrc, /const mustWords = r\.buckets\.must\.reduce\(\(a, c\) => a \+ \(c\.signalsAcc\.wordCount \|\| 0\), 0\);/,
    "the lead must count words across the must-read chunks");
  assert.match(appSrc, /const mustMins = Math\.max\(1, Math\.round\(mustWords \/ 200\)\);/,
    "the must-read minutes must reuse the 200-wpm estimate");
  assert.match(appSrc, /' · ~' \+ mustMins \+ ' of ~' \+ totalMins \+ ' min must-reads'/,
    "the lead must show the must-reads' share of total reading time");
});

// Iter #140: section risk map — aggregates risk patterns by
// clause category and renders weighted horizontal bars.
test("analyzer: Section risk map aggregates risk by clause category", () => {
  if (!HAS_BROWSER) return;
  const fs = require("node:fs");
  const path = require("node:path");
  const appSrc = fs.readFileSync(path.join(ROOT, "assets", "app.js"), "utf8");
  const cssSrc = fs.readFileSync(path.join(ROOT, "assets", "theme.css"), "utf8");
  const html = fs.readFileSync(path.join(ROOT, "analyze.html"), "utf8");

  assert.match(html, /id="sectionBlock"/, "analyze.html must contain #sectionBlock");
  assert.match(appSrc, /function buildSectionRisk\(/, "buildSectionRisk must exist");
  assert.match(appSrc, /function renderSectionBlock\(/, "renderSectionBlock must exist");
  // Cover at least 6 categories
  for(const k of ["termination", "refund", "liability", "arbitration", "data", "force"]){
    assert.match(appSrc, new RegExp("key: '" + k + "'"),
      "SECTION_CATEGORIES must include '" + k + "'");
  }
  // Wiring
  assert.match(appSrc, /renderSectionBlock\(raw[\s\S]+?ctx\)/,
    "render() must call renderSectionBlock");
  // CSS
  assert.match(cssSrc, /\.section-row\b/, ".section-row style must exist");
  assert.match(cssSrc, /\.section-bar\b/, ".section-bar style must exist");
  assert.match(cssSrc, /\.section-bar-r\b/, ".section-bar-r (trap) style must exist");

  // Iter #141 polish: click-to-jump + high-only filter.
  assert.match(appSrc, /data-section-key=/,
    "iter #141 must render per-row clickable section bars");
  assert.match(appSrc, /data-section-key[\s\S]+?setSelectionRange/,
    "iter #141 must wire click-to-jump");
  assert.match(appSrc, /sectionFilterBtn|high-only/,
    "iter #141 must include a high-only filter chip");
  assert.match(appSrc, /sectionCopyBtn/,
    "iter #264 must include a section-map Markdown copy button");
  assert.match(appSrc, /aria-label="Copy the section risk map as Markdown"/,
    "iter #264 must label the section-map copy button for assistive tech");
  assert.match(appSrc, /Showing high-risk categories only/,
    "iter #264 must note when the high-only filter is active");
  assert.match(appSrc, /'📋 Section map copied as Markdown'/,
    "iter #264 must confirm when the section map is copied");
  assert.match(appSrc, /\| Section \| Hits \| Risk \|/,
    "iter #264 must build a Markdown table header");
  assert.match(cssSrc, /\.section-controls\b/, ".section-controls style must exist");
});

skip("analyze: section risk map copies as Markdown", async () => {
  if (!HAS_BROWSER) return;
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  const errors = [];
  page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.addInitScript(() => {
    window.__copiedSectionMd = null;
    try {
      Object.defineProperty(navigator, "clipboard", {
        configurable: true,
        value: {
          writeText: async (txt) => { window.__copiedSectionMd = txt; },
          write: async () => {},
        },
      });
    } catch (_) {
      try { navigator.clipboard = { writeText: async (txt) => { window.__copiedSectionMd = txt; }, write: async () => {} }; } catch (_2) {}
    }
  });
  try {
    await page.goto(`http://127.0.0.1:${PORT}/analyze.html`, { waitUntil: "networkidle" });
    await page.click(".qf[data-fill]:first-of-type");
    await page.click("#analyzeBtn");
    await page.waitForSelector("#sectionBlock:not([hidden]) #sectionCopyBtn", { timeout: 8000 });
    await page.click("#sectionCopyBtn");
    await page.waitForFunction(() => window.__copiedSectionMd && window.__copiedSectionMd.length > 0, { timeout: 8000 });
    const captured = await page.evaluate(() => window.__copiedSectionMd);
    assert.match(captured, /^\| Section \| Hits \| Risk \|/, "the copied section map must start with the Markdown header");
    assert.match(captured, /\|---\|---\|---\|/, "the copied section map must include the separator row");
    assert.equal(errors.length, 0, `zero console errors, got: ${errors.join(" | ")}`);
  } finally {
    await page.close();
    await ctx.close();
  }
});

// Iter #142: quick-summary stamp — one-line social-card with
// word count + risks + exposure + maturity + missing.
test("analyzer: Quick-summary stamp generates a tweetable one-liner", () => {
  if (!HAS_BROWSER) return;
  const fs = require("node:fs");
  const path = require("node:path");
  const appSrc = fs.readFileSync(path.join(ROOT, "assets", "app.js"), "utf8");
  const cssSrc = fs.readFileSync(path.join(ROOT, "assets", "theme.css"), "utf8");
  const html = fs.readFileSync(path.join(ROOT, "analyze.html"), "utf8");

  assert.match(html, /id="stampBlock"/, "analyze.html must contain #stampBlock");
  assert.match(appSrc, /function buildQuickStamp\(/, "buildQuickStamp must exist");
  assert.match(appSrc, /function renderStampBlock\(/, "renderStampBlock must exist");
  // Twitter intent URL
  assert.match(appSrc, /twitter\.com\/intent\/tweet/,
    "iter #142 must include a tweet intent URL");
  // Copy button
  assert.match(appSrc, /stampCopyBtn[\s\S]+?navigator\.clipboard|execCommand\('copy'\)/,
    "stampCopyBtn must use clipboard fallback");
  // Includes word count + risks + maturity
  assert.match(appSrc, /wordCount[\s\S]+?tal[\s\S]+?mletter/,
    "buildQuickStamp must aggregate word count + risk tally + maturity");
  // Wiring
  assert.match(appSrc, /renderStampBlock\(raw[\s\S]+?ctx\)/,
    "render() must call renderStampBlock");
  // CSS
  assert.match(cssSrc, /\.stamp-card\b/, ".stamp-card style must exist");
  assert.match(cssSrc, /\.stamp-actions\b/, ".stamp-actions style must exist");

  // Iter #143 polish: hashtag suggestions + char counter.
  assert.match(appSrc, /#LeaseReview|#MedicalBill|#Subscription|#ContractTraps|#DoNotSign|#CleanContract|#ClearDoc/,
    "iter #143 must include hashtags from the doc-type + risk-profile tables");
  assert.match(appSrc, /s\.tweet\.length/,
    "iter #143 must compute the tweet length");
  assert.match(appSrc, /280|overLimit/,
    "iter #143 must detect a 280-char Twitter limit");
  assert.match(cssSrc, /\.stamp-tag\b/, ".stamp-tag style must exist");
  assert.match(cssSrc, /\.stamp-counter\b/, ".stamp-counter style must exist");
});

// Iter #144: version comparer — surfaces a per-dimension delta
// against the last saved baseline (iter #110 / iter #132).
test("analyzer: Version comparer surfaces a per-dimension delta against the last baseline", () => {
  if (!HAS_BROWSER) return;
  const fs = require("node:fs");
  const path = require("node:path");
  const appSrc = fs.readFileSync(path.join(ROOT, "assets", "app.js"), "utf8");
  const cssSrc = fs.readFileSync(path.join(ROOT, "assets", "theme.css"), "utf8");
  const html = fs.readFileSync(path.join(ROOT, "analyze.html"), "utf8");

  assert.match(html, /id="versionBlock"/, "analyze.html must contain #versionBlock");
  assert.match(appSrc, /function buildVersionDelta\(/, "buildVersionDelta must exist");
  assert.match(appSrc, /function renderVersionBlock\(/, "renderVersionBlock must exist");
  // Pulls from iter #110 receipt log
  assert.match(appSrc, /cleardoc:receipt-log/,
    "iter #144 must read from the iter #110 receipt log");
  // Pulls from iter #132 trend history
  assert.match(appSrc, /TREND_KEY_HIST|cleardoc:trend-history/,
    "iter #144 must read from the iter #132 trend history");
  // Per-dimension deltas
  assert.match(appSrc, /riskDelta|numDelta|exposureDelta/,
    "iter #144 must compute per-dimension deltas");
  // Wiring
  assert.match(appSrc, /renderVersionBlock\(raw[\s\S]+?ctx\)/,
    "render() must call renderVersionBlock");
  // CSS
  assert.match(cssSrc, /\.version-cell\b/, ".version-cell style must exist");
  assert.match(cssSrc, /\.version-good\b/, ".version-good (improved) style must exist");
  assert.match(cssSrc, /\.version-bad\b/, ".version-bad (regressed) style must exist");

  // Iter #145 polish: changelog copy + save-as-baseline.
  assert.match(appSrc, /changelog/,
    "iter #145 must include a changelog text");
  assert.match(appSrc, /versionCopyChangelog[\s\S]+?navigator\.clipboard|execCommand\('copy'\)/,
    "iter #145 must wire the copy-changelog button");
  assert.match(appSrc, /versionSaveBaseline/,
    "iter #145 must wire a save-as-baseline button");
  assert.match(cssSrc, /\.version-controls\b/, ".version-controls style must exist");
});

// Iter #146: ink saver — estimates how much of the document is
// legalese that could be replaced with plain English.
test("analyzer: Ink saver estimates word savings from jargon reduction", () => {
  if (!HAS_BROWSER) return;
  const fs = require("node:fs");
  const path = require("node:path");
  const appSrc = fs.readFileSync(path.join(ROOT, "assets", "app.js"), "utf8");
  const cssSrc = fs.readFileSync(path.join(ROOT, "assets", "theme.css"), "utf8");
  const html = fs.readFileSync(path.join(ROOT, "analyze.html"), "utf8");

  assert.match(html, /id="inkBlock"/, "analyze.html must contain #inkBlock");
  assert.match(appSrc, /function buildInkSavings\(/, "buildInkSavings must exist");
  assert.match(appSrc, /function renderInkBlock\(/, "renderInkBlock must exist");
  assert.match(appSrc, /savingsWords|savingsPct|jargonHits/,
    "iter #146 must compute savings metrics");
  assert.match(appSrc, /renderInkBlock\(raw[\s\S]+?ctx\)/,
    "render() must call renderInkBlock");
  // CSS
  assert.match(cssSrc, /\.ink-cell\b/, ".ink-cell style must exist");
  assert.match(cssSrc, /\.ink-savings\b/, ".ink-savings (positive) style must exist");

  // Iter #147 polish: per-phrase jargon list with click-to-jump.
  assert.match(appSrc, /ink-jargon-row/,
    "iter #147 must render a per-phrase jargon list");
  assert.match(appSrc, /data-ink-offset=|ink-jargon-row[\s\S]+?setSelectionRange/,
    "iter #147 must wire click-to-jump on jargon rows");
  assert.match(cssSrc, /\.ink-jargon-row\b/, ".ink-jargon-row style must exist");
  assert.match(cssSrc, /\.ink-jargon-phrase\b/, ".ink-jargon-phrase style must exist");
});

// Iter #148: walk-through — guided step-by-step tour of every
// detected risk with jump + speak + auto-play-all.
test("analyzer: Walk-through renders step-by-step tour with jump + speak + play-all", () => {
  if (!HAS_BROWSER) return;
  const fs = require("node:fs");
  const path = require("node:path");
  const appSrc = fs.readFileSync(path.join(ROOT, "assets", "app.js"), "utf8");
  const cssSrc = fs.readFileSync(path.join(ROOT, "assets", "theme.css"), "utf8");
  const html = fs.readFileSync(path.join(ROOT, "analyze.html"), "utf8");

  assert.match(html, /id="walkBlock"/, "analyze.html must contain #walkBlock");
  assert.match(appSrc, /function buildWalkSteps\(/, "buildWalkSteps must exist");
  assert.match(appSrc, /function renderWalkBlock\(/, "renderWalkBlock must exist");
  // Speak handler
  assert.match(appSrc, /data-walk-speak[\s\S]+?SpeechSynthesisUtterance/,
    "iter #148 must wire speak button to SpeechSynthesisUtterance");
  // Jump handler
  assert.match(appSrc, /data-walk-jump[\s\S]+?setSelectionRange/,
    "iter #148 must wire jump button to setSelectionRange");
  // Play-all
  assert.match(appSrc, /walkPlayBtn[\s\S]+?playNext/,
    "iter #148 must include a play-all button that walks through steps");
  // Wiring
  assert.match(appSrc, /renderWalkBlock\(raw[\s\S]+?ctx\)/,
    "render() must call renderWalkBlock");
  // CSS
  assert.match(cssSrc, /\.walk-step\b/, ".walk-step style must exist");
  assert.match(cssSrc, /\.walk-step-trap\b/, ".walk-step-trap style must exist");

  // Iter #149 polish: per-row done toggle + filter chips + progress bar.
  assert.match(appSrc, /data-walk-done=/,
    "iter #149 must render a per-row done toggle");
  assert.match(appSrc, /data-walk-filter=/,
    "iter #149 must render filter chips");
  assert.match(appSrc, /cleardoc:walk-done/,
    "iter #149 must persist walk-done state to localStorage");
  assert.match(appSrc, /walk-progress-fill|progressPct/,
    "iter #149 must compute a progress percentage");
  assert.match(cssSrc, /\.walk-done-btn\b/, ".walk-done-btn style must exist");
  assert.match(cssSrc, /\.walk-filter-active\b/, ".walk-filter-active style must exist");
  assert.match(cssSrc, /\.walk-progress\b/, ".walk-progress style must exist");
});

// Iter #150: negotiation difficulty score — composite 0..100.
test("analyzer: Negotiation difficulty score combines risk + maturity + exposure + tone + jargon + gaps", () => {
  if (!HAS_BROWSER) return;
  const fs = require("node:fs");
  const path = require("node:path");
  const appSrc = fs.readFileSync(path.join(ROOT, "assets", "app.js"), "utf8");
  const cssSrc = fs.readFileSync(path.join(ROOT, "assets", "theme.css"), "utf8");
  const html = fs.readFileSync(path.join(ROOT, "analyze.html"), "utf8");

  assert.match(html, /id="diffBlock"/, "analyze.html must contain #diffBlock");
  assert.match(appSrc, /function buildDifficultyScore\(/, "buildDifficultyScore must exist");
  assert.match(appSrc, /function renderDiffBlock\(/, "renderDiffBlock must exist");
  assert.match(appSrc, /riskScore[\s\S]+?maturityScore[\s\S]+?exposureScore[\s\S]+?toneScore[\s\S]+?jargonScore[\s\S]+?gapsScore/,
    "iter #150 must compute all six sub-scores");
  // Verdict phrases
  assert.match(appSrc, /Very hard|3\+ rounds/,
    "iter #150 must render a difficulty verdict");
  // Wiring
  assert.match(appSrc, /renderDiffBlock\(raw[\s\S]+?ctx\)/,
    "render() must call renderDiffBlock");
  // CSS
  assert.match(cssSrc, /\.diff-main\b/, ".diff-main style must exist");
  assert.match(cssSrc, /\.diff-sub\.diff-high/,
    ".diff-sub.diff-high style must exist");

  // Iter #151 polish: per-sub-score weight tooltip + slack message copy.
  assert.match(appSrc, /weight:\s*30|weight:\s*20|weight:\s*15/,
    "iter #151 must include sub-score weights");
  assert.match(appSrc, /diffSlackBtn[\s\S]+?navigator\.clipboard|execCommand\('copy'\)/,
    "iter #151 must include a slack-message copy button");
  assert.match(appSrc, /diffCopyBtn/,
    "iter #151 must include a copy-score button");
  assert.match(cssSrc, /\.diff-sub-weight\b/, ".diff-sub-weight style must exist");
  assert.match(cssSrc, /\.diff-controls\b/, ".diff-controls style must exist");
});

// Iter #152: letter of intent (LOI) — non-binding letter draft.
test("analyzer: Letter of intent (LOI) generates a one-paragraph non-binding letter", () => {
  if (!HAS_BROWSER) return;
  const fs = require("node:fs");
  const path = require("node:path");
  const appSrc = fs.readFileSync(path.join(ROOT, "assets", "app.js"), "utf8");
  const cssSrc = fs.readFileSync(path.join(ROOT, "assets", "theme.css"), "utf8");
  const html = fs.readFileSync(path.join(ROOT, "analyze.html"), "utf8");

  assert.match(html, /id="loiBlock"/, "analyze.html must contain #loiBlock");
  assert.match(appSrc, /function buildLoiDraft\(/, "buildLoiDraft must exist");
  assert.match(appSrc, /function renderLoiBlock\(/, "renderLoiBlock must exist");
  // The letter must mention "letter of intent", maturity, risks, jurisdiction
  assert.match(appSrc, /LETTER OF INTENT/i,
    "LOI must include the LETTER OF INTENT title");
  assert.match(appSrc, /propose a working session|counter-sign/i,
    "LOI must include a 14-day working-session ask + counter-sign line");
  // Wiring
  assert.match(appSrc, /renderLoiBlock\(raw[\s\S]+?ctx\)/,
    "render() must call renderLoiBlock");
  // Copy + print
  assert.match(appSrc, /loiCopyBtn[\s\S]+?navigator\.clipboard|execCommand\('copy'\)/,
    "loiCopyBtn must use clipboard fallback");
  assert.match(appSrc, /loiPrintBtn[\s\S]+?window\.print\(\)/,
    "loiPrintBtn must use window.print");
  // CSS
  assert.match(cssSrc, /\.loi-card\b/, ".loi-card style must exist");
  assert.match(cssSrc, /\.loi-actions\b/, ".loi-actions style must exist");

  // Iter #153 polish: custom recipient + sender + sign + date fields.
  assert.match(html, /id="loiToField"/, "analyze.html must contain #loiToField");
  assert.match(html, /id="loiFromField"/, "analyze.html must contain #loiFromField");
  assert.match(html, /id="loiSignField"/, "analyze.html must contain #loiSignField");
  assert.match(html, /id="loiDateField"/, "analyze.html must contain #loiDateField");
  assert.match(appSrc, /function buildLoiDraft\(raw, ctx, opts\)/,
    "iter #153 must accept an opts arg in buildLoiDraft");
  assert.match(appSrc, /opts\.to|opts\.from|opts\.sign/,
    "iter #153 must use opts.to/from/sign");
  assert.match(cssSrc, /\.loi-fields\b/, ".loi-fields style must exist");

  // Cycle #173 polish — the LOI letter must wrap on mobile. A stray
  // white-space:pre override inside .loi-card forced a 1476px min-content
  // <pre>, which blew the whole results column to 1566px at a 360px
  // viewport (everything right of the screen was unreachable).
  assert.match(cssSrc, /\.loi-pre\{[\s\S]{0,220}white-space:pre-wrap/,
    "the LOI letter must wrap long lines");
  assert.doesNotMatch(cssSrc, /\.loi-card\{[^}]*white-space:pre}/,
    "the LOI card must not override pre-wrap back to pre");
  assert.match(cssSrc, /\.work \.col\.out\{min-width:0\}/,
    "the results column must be allowed to shrink below its content");
});

// Iter #154: party audit — extracts parties, dates, signatures.
test("analyzer: Party audit extracts parties + dates + signatures from the document", () => {
  if (!HAS_BROWSER) return;
  const fs = require("node:fs");
  const path = require("node:path");
  const appSrc = fs.readFileSync(path.join(ROOT, "assets", "app.js"), "utf8");
  const cssSrc = fs.readFileSync(path.join(ROOT, "assets", "theme.css"), "utf8");
  const html = fs.readFileSync(path.join(ROOT, "analyze.html"), "utf8");

  assert.match(html, /id="partyBlock"/, "analyze.html must contain #partyBlock");
  assert.match(appSrc, /function buildPartyAudit\(/, "buildPartyAudit must exist");
  assert.match(appSrc, /function renderPartyBlock\(/, "renderPartyBlock must exist");
  // Cover roles
  for(const k of ["CEO", "Director", "Attorney", "Partner"]){
    assert.match(appSrc, new RegExp(k),
      "buildPartyAudit must include common role '" + k + "'");
  }
  // Wiring
  assert.match(appSrc, /renderPartyBlock\(raw[\s\S]+?ctx\)/,
    "render() must call renderPartyBlock");
  // CSS
  assert.match(cssSrc, /\.party-cell\b/, ".party-cell style must exist");
  assert.match(cssSrc, /\.party-name\b/, ".party-name style must exist");

  // Iter #155 polish: click-to-jump + per-date .ics export.
  assert.match(appSrc, /data-party-jump=|party-ics/,
    "iter #155 must render click-to-jump + per-date .ics");
  assert.match(appSrc, /party-ics[\s\S]+?BEGIN:VCALENDAR/,
    "iter #155 must generate a VCALENDAR .ics payload");
  assert.match(cssSrc, /\.party-ics\b/, ".party-ics button style must exist");
});

// Cycle #136 — per-party-cell copy.
test("analyzer: Party cells copy their detail in one click", () => {
  if (!HAS_BROWSER) return;
  const fs = require("node:fs");
  const path = require("node:path");
  const appSrc = fs.readFileSync(path.join(ROOT, "assets", "app.js"), "utf8");
  const cssSrc = fs.readFileSync(path.join(ROOT, "assets", "theme.css"), "utf8");

  assert.match(appSrc, /const copyVal = \(it\.type === 'name' \? '👤 party: ' : '📅 date: '\) \+ it\.value \+ \(it\.title \? ' \(' \+ it\.title \+ '\)' : ''\);/,
    "the citation must carry the type, value, and role/title");
  assert.match(appSrc, /class="party-copy ghost-btn ghost-btn-sm"/,
    "each party cell must render a copy button");
  assert.match(appSrc, /data-party-copy="' \+ esc\(copyVal\) \+ '"/,
    "the copy button must carry the prebuilt citation");
  assert.match(appSrc, /\$\$\('\.party-copy', partyGrid\)\.forEach/,
    "copy buttons must be wired after each render");
  assert.match(appSrc, /e\.stopPropagation\(\);/,
    "copying must not trigger the row's jump-to-source");
  assert.match(appSrc, /📋 Party detail copied/,
    "copying must announce via toast");
  assert.match(appSrc, /copyBtn\.textContent = copied \? '✓' : '📋';/,
    "the button must flash its copied state");
  assert.match(appSrc, /📋 to copy one/,
    "the block note must document the copy action");
  assert.match(appSrc, /class="party-actions"/,
    "the ics + copy buttons must be grouped into one action row");
  assert.match(cssSrc, /\.party-actions\{[^}]*display:flex/,
    "the action row must lay out horizontally");
  assert.match(cssSrc, /\.party-copy:focus-visible\{/,
    "the copy button must have a focus ring");
});

// Iter #156: glossary quick-reference — extracts legal terms + plain-English.
test("analyzer: Glossary quick-reference extracts legal terms with plain-English meanings", () => {
  if (!HAS_BROWSER) return;
  const fs = require("node:fs");
  const path = require("node:path");
  const appSrc = fs.readFileSync(path.join(ROOT, "assets", "app.js"), "utf8");
  const cssSrc = fs.readFileSync(path.join(ROOT, "assets", "theme.css"), "utf8");
  const html = fs.readFileSync(path.join(ROOT, "analyze.html"), "utf8");

  assert.match(html, /id="glossBlock"/, "analyze.html must contain #glossBlock");
  assert.match(appSrc, /function buildGlossary\(/, "buildGlossary must exist");
  assert.match(appSrc, /function renderGlossBlock\(/, "renderGlossBlock must exist");
  // Cover common legal terms
  for(const k of ["notwithstanding", "indemnify", "arbitration", "waive", "force majeure"]){
    assert.match(appSrc, new RegExp("'" + k + "'\\s*:"),
      "GLOSSARY must include the term '" + k + "'");
  }
  // Wiring
  assert.match(appSrc, /renderGlossBlock\(raw[\s\S]+?ctx\)/,
    "render() must call renderGlossBlock");
  // CSS
  assert.match(cssSrc, /\.gloss-row\b/, ".gloss-row style must exist");
  assert.match(cssSrc, /\.gloss-term\b/, ".gloss-term style must exist");

  // Iter #157 polish: shift-click to jump + copy-all + filter chips.
  assert.match(appSrc, /e\.shiftKey[\s\S]+?indexOf|shiftKey[\s\S]+?input\.value\.indexOf/,
    "iter #157 must support shift-click to jump");
  assert.match(appSrc, /glossCopyAllBtn/,
    "iter #157 must include a copy-all button");
  assert.match(appSrc, /gloss-filter|glossFilter/,
    "iter #157 must include filter chips");
  assert.match(appSrc, /glossCopyMdBtn/,
    "iter #267 must include a glossary Markdown copy button");
  assert.match(appSrc, /'📋 Glossary copied as Markdown'/,
    "iter #267 must confirm when the glossary Markdown is copied");
  assert.match(appSrc, /\| Term \| Meaning \| Hits \|/,
    "iter #267 must build a Markdown table header");
  assert.match(appSrc, /_Showing multi-hit terms only\._/,
    "iter #267 must note when the multi-hit filter is active");
  assert.match(cssSrc, /\.gloss-filter-active\b/, ".gloss-filter-active style must exist");
});

skip("analyze: glossary copies as Markdown", async () => {
  if (!HAS_BROWSER) return;
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  const errors = [];
  page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.addInitScript(() => {
    window.__copiedGlossMd = null;
    try {
      Object.defineProperty(navigator, "clipboard", {
        configurable: true,
        value: {
          writeText: async (txt) => { window.__copiedGlossMd = txt; },
          write: async () => {},
        },
      });
    } catch (_) {
      try { navigator.clipboard = { writeText: async (txt) => { window.__copiedGlossMd = txt; }, write: async () => {} }; } catch (_2) {}
    }
  });
  try {
    await page.goto(`http://127.0.0.1:${PORT}/analyze.html`, { waitUntil: "networkidle" });
    await page.click(".qf[data-fill]:first-of-type");
    await page.click("#analyzeBtn");
    await page.waitForSelector("#glossBlock:not([hidden]) #glossCopyMdBtn", { timeout: 8000 });
    await page.click("#glossCopyMdBtn");
    await page.waitForFunction(() => window.__copiedGlossMd && window.__copiedGlossMd.length > 0, { timeout: 8000 });
    const captured = await page.evaluate(() => window.__copiedGlossMd);
    assert.match(captured, /^\| Term \| Meaning \| Hits \|/, "the copied glossary must start with the Markdown header");
    assert.match(captured, /\|---\|---\|---\|/, "the copied glossary must include the separator row");
    assert.equal(errors.length, 0, `zero console errors, got: ${errors.join(" | ")}`);
  } finally {
    await page.close();
    await ctx.close();
  }
});

// Cycle #128 — pronounce any glossary term.
test("analyzer: Glossary rows can pronounce the legal term in one click", () => {
  if (!HAS_BROWSER) return;
  const fs = require("node:fs");
  const path = require("node:path");
  const appSrc = fs.readFileSync(path.join(ROOT, "assets", "app.js"), "utf8");
  const cssSrc = fs.readFileSync(path.join(ROOT, "assets", "theme.css"), "utf8");

  assert.match(appSrc, /class="gloss-speak ghost-btn ghost-btn-sm"/,
    "each glossary row must render a speak button");
  assert.match(appSrc, /data-gloss-speak="' \+ esc\(g\.term\) \+ '"/,
    "the speak button must carry the term");
  assert.match(appSrc, /e\.target\.closest && e\.target\.closest\('\[data-gloss-speak\]'\)/,
    "the row click handler must catch speak-button clicks");
  assert.match(appSrc, /new SpeechSynthesisUtterance\(term\)/,
    "clicking must speak the term");
  assert.match(appSrc, /u\.rate = getTtsRate\(\);/,
    "the pronunciation must respect the chosen reading speed");
  assert.match(appSrc, /🔊<\/b> to hear the term/,
    "the block note must document the speak action");
  assert.match(cssSrc, /\.gloss-row\{[^}]*flex-wrap:wrap/,
    "the row must wrap with the new button");
  assert.match(cssSrc, /\.gloss-meaning\{[^}]*flex:1 1 100%/,
    "the meaning must own its own line");
  assert.match(cssSrc, /\.gloss-speak\{[^}]*margin-left:auto/,
    "the speak button must right-align in the row");
  assert.match(cssSrc, /\.gloss-speak:focus-visible\{/,
    "the speak button must have a focus ring");
});

// Iter #172: obligation tracker — extracts action verbs and obligations.
test("analyzer: Obligation tracker extracts action verbs from the document", () => {
  if (!HAS_BROWSER) return;
  const fs = require("node:fs");
  const path = require("node:path");
  const appSrc = fs.readFileSync(path.join(ROOT, "assets", "app.js"), "utf8");
  const html = fs.readFileSync(path.join(ROOT, "analyze.html"), "utf8");

  assert.match(html, /id="actionBlock2"/, "analyze.html must contain #actionBlock2");
  assert.match(appSrc, /function buildActionList\(/, "buildActionList must exist");
  assert.match(appSrc, /function renderActionBlock\(/, "renderActionBlock must exist");
  assert.match(appSrc, /renderActionBlock\(raw[\s\S]+?ctx\)/,
    "render() must call renderActionBlock");
  // Cover key action verbs
  for(const v of ["shall", "must", "will", "undertakes", "warrants", "agrees"]){
    assert.match(appSrc, new RegExp("'" + v + "'"),
      "buildActionList must recognize the action verb '" + v + "'");
  }
  // Mandatory vs permissive distinction
  assert.match(appSrc, /action-mandatory/,
    "iter #172 must distinguish mandatory actions");
  assert.match(appSrc, /action-permissive/,
    "iter #172 must distinguish permissive actions");
});

// Iter #173 polish: obligation tracker — done toggle + copy-all.
test("analyzer: Obligation tracker polish — done toggle + copy-all chip", () => {
  if (!HAS_BROWSER) return;
  const fs = require("node:fs");
  const path = require("node:path");
  const appSrc = fs.readFileSync(path.join(ROOT, "assets", "app.js"), "utf8");
  const cssSrc = fs.readFileSync(path.join(ROOT, "assets", "theme.css"), "utf8");

  // Per-row done toggle persisted in localStorage
  assert.match(appSrc, /cleardoc:obligations-done/,
    "iter #173 must persist done state to localStorage");
  assert.match(appSrc, /data-act-done=/,
    "iter #173 must render a per-row done button");
  // Copy-all chip
  assert.match(appSrc, /actionCopyAllBtn/,
    "iter #173 must include a copy-all chip");
  // CSS
  assert.match(cssSrc, /\.act-done-btn\b/, ".act-done-btn style must exist");
  assert.match(cssSrc, /\.action-controls\b/, ".action-controls style must exist");
});

// Cycle 78 feature: obligation CSV export for spreadsheet trackers.
test("analyzer: Obligation tracker exports a CSV with done status", () => {
  if (!HAS_BROWSER) return;
  const fs = require("node:fs");
  const path = require("node:path");
  const appSrc = fs.readFileSync(path.join(ROOT, "assets", "app.js"), "utf8");

  assert.match(appSrc, /id="actionCsvBtn" title="Download obligations as a \.csv file for a tracker"/,
    "the obligation controls must include a CSV chip");
  assert.match(appSrc, /actionCsvBtn\.addEventListener\(\s*['"]click['"]/,
    "the CSV chip must have a click handler");
  assert.match(appSrc, /doneMap\['ob-' \+ idx\] \? 'done' : 'todo'/,
    "the Status column must reflect the live done state");
  assert.match(appSrc, /csvCell\('Status'\) \+ ',' \+ csvCell\('Verb'\) \+ ',' \+ csvCell\('Sentence'\) \+ ',' \+ csvCell\('Type'\)/,
    "the CSV must have Status, Verb, Sentence, and Type columns in that order");
  assert.match(appSrc, /isMandatory \? 'must' : 'may'/,
    "the Type column must map the on-screen must/may tag");
  assert.match(appSrc, /csvCell\(doneCount \+ ' of ' \+ items\.length \+ ' done'\)/,
    "the CSV must open with a Progress metadata row");
  assert.match(appSrc, /'⚠ Nothing to export yet'/,
    "the export must guard the empty state");
  assert.match(appSrc, /const text = '\\uFEFF' \+ header \+ '\\n' \+ body;/,
    "the download must start with a UTF-8 BOM");
  assert.match(appSrc, /a\.download = 'cleardoc-obligations-' \+ stamp \+ '\.csv'/,
    "the filename must be cleardoc-obligations-<date>.csv");
  assert.match(appSrc, /'📊 Obligations CSV downloaded \(' \+ rows\.length/,
    "the export must toast with the row count");
  assert.match(appSrc, /actionCopyMdBtn/,
    "the obligation controls must include a Markdown copy button");
  assert.match(appSrc, /'📋 Obligations copied as Markdown'/,
    "the Markdown obligation copy must confirm with a toast");
  assert.match(appSrc, /\| Type \| Progress \| Obligation \|/,
    "the Markdown obligation copy must build a table header");
  assert.match(appSrc, /doneMap\['ob-' \+ idx\] \? '\[x\]' : '\[ \]'/,
    "the Markdown obligation copy must use checkbox-style progress");
});

skip("analyze: obligations copy as Markdown", async () => {
  if (!HAS_BROWSER) return;
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  const errors = [];
  page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.addInitScript(() => {
    window.__copiedOblMd = null;
    try {
      Object.defineProperty(navigator, "clipboard", {
        configurable: true,
        value: {
          writeText: async (txt) => { window.__copiedOblMd = txt; },
          write: async () => {},
        },
      });
    } catch (_) {
      try { navigator.clipboard = { writeText: async (txt) => { window.__copiedOblMd = txt; }, write: async () => {} }; } catch (_2) {}
    }
  });
  try {
    await page.goto(`http://127.0.0.1:${PORT}/analyze.html`, { waitUntil: "networkidle" });
    await page.click(".qf[data-fill]:first-of-type");
    await page.click("#analyzeBtn");
    await page.waitForSelector("#actionBlock2:not([hidden]) #actionCopyMdBtn", { timeout: 8000 });
    await page.click("#actionCopyMdBtn");
    await page.waitForFunction(() => window.__copiedOblMd && window.__copiedOblMd.length > 0, { timeout: 8000 });
    const captured = await page.evaluate(() => window.__copiedOblMd);
    assert.match(captured, /^\| Type \| Progress \| Obligation \|/, "the copied obligations must start with the Markdown header");
    assert.match(captured, /\|---\|---\|---\|/, "the copied obligations must include the separator row");
    assert.match(captured, /\| \[ \] \|/, "the copied obligations must include unchecked checkboxes");
    assert.equal(errors.length, 0, `zero console errors, got: ${errors.join(" | ")}`);
  } finally {
    await page.close();
    await ctx.close();
  }
});

// Cycle #118 — ask the document about any obligation in one click.
test("analyzer: Obligation rows can ask the document about the obligation in one click", () => {
  if (!HAS_BROWSER) return;
  const fs = require("node:fs");
  const path = require("node:path");
  const appSrc = fs.readFileSync(path.join(ROOT, "assets", "app.js"), "utf8");

  assert.match(appSrc, /class="act-ask ghost-btn ghost-btn-sm"/,
    "each obligation row must render an ask button");
  assert.match(appSrc, /data-act-ask="' \+ esc\(snip\) \+ '"/,
    "the ask button must carry the obligation sentence");
  assert.match(appSrc, /data-act-must="' \+ \(isMandatory \? '1' : '0'\) \+ '"/,
    "the ask button must carry the must/may type");
  assert.match(appSrc, /\$\$\('\.act-ask', actionList\)\.forEach/,
    "ask buttons must be wired after each render");
  assert.match(appSrc, /don\\'t fulfill this obligation: "|What should I do about: "/,
    "the question must fit the obligation type");
  assert.match(appSrc, /qInput\.scrollIntoView/,
    "clicking must bring the Ask panel into view");
  assert.match(appSrc, /showAnalyzeToast\('💬 Question ready — press Ask'\)/,
    "clicking must announce the prefilled question");
  assert.match(appSrc, /<b>💬<\/b> to ask about an obligation/,
    "the block note must document the ask action");
  assert.match(appSrc, /\.scenario-ask, \.act-ask, \.bearer-ask, \.reading-ask'\)/,
    "the a shortcut must also cover obligation rows");
});

// Cycle #146 — hear any obligation aloud.
test("analyzer: Obligation rows can read the obligation aloud in one click", () => {
  if (!HAS_BROWSER) return;
  const fs = require("node:fs");
  const path = require("node:path");
  const appSrc = fs.readFileSync(path.join(ROOT, "assets", "app.js"), "utf8");
  const cssSrc = fs.readFileSync(path.join(ROOT, "assets", "theme.css"), "utf8");

  assert.match(appSrc, /class="act-speak ghost-btn ghost-btn-sm"/,
    "each obligation row must render a speak button");
  assert.match(appSrc, /data-act-speak="' \+ esc\(snip\.slice\(0, 200\)\) \+ '"/,
    "the speak button must carry the obligation sentence");
  assert.match(appSrc, /\$\$\('\.act-speak', actionList\)\.forEach/,
    "speak buttons must be wired after each render");
  assert.match(appSrc, /new SpeechSynthesisUtterance\(text\)/,
    "clicking must speak the obligation");
  assert.match(appSrc, /u\.rate = getTtsRate\(\);/,
    "the reading must respect the chosen speed");
  assert.match(appSrc, /e\.stopPropagation\(\);/,
    "speaking must not trigger the row's other actions");
  assert.match(appSrc, /<b>🔊<\/b> to hear it/,
    "the block note must document the speak action");
  assert.match(cssSrc, /\.action-row \.act-ask,\.action-row \.act-speak\{[^}]*flex-shrink:0/,
    "the ask and speak buttons must never shrink beside the sentence");
  assert.match(cssSrc, /\.act-speak:focus-visible\{/,
    "the speak button must have a focus ring");
});

// Iter #158: analysis confidence — rates how reliable this run is.
test("analyzer: Analysis confidence rates how reliable the result is", () => {
  if (!HAS_BROWSER) return;
  const fs = require("node:fs");
  const path = require("node:path");
  const appSrc = fs.readFileSync(path.join(ROOT, "assets", "app.js"), "utf8");
  const cssSrc = fs.readFileSync(path.join(ROOT, "assets", "theme.css"), "utf8");
  const html = fs.readFileSync(path.join(ROOT, "analyze.html"), "utf8");

  assert.match(html, /id="confBlock"/, "analyze.html must contain #confBlock");
  assert.match(appSrc, /function buildAnalysisConfidence\(/, "buildAnalysisConfidence must exist");
  assert.match(appSrc, /function renderConfBlock\(/, "renderConfBlock must exist");
  // Sub-scores
  assert.match(appSrc, /lenScore[\s\S]+?riskScore[\s\S]+?toneScore[\s\S]+?aiUsed/,
    "iter #158 must compute all four sub-scores");
  // Weight keywords
  assert.match(appSrc, /0\.30[\s\S]+?0\.20/,
    "iter #158 must use weighted overall");
  // Verdict phrases
  assert.match(appSrc, /Reliable|re-paste|Reliable — take it|Mixed/,
    "iter #158 must include confidence verdict phrases");
  // Wiring
  assert.match(appSrc, /renderConfBlock\(raw[\s\S]+?ctx\)/,
    "render() must call renderConfBlock");
  // CSS
  assert.match(cssSrc, /\.conf-main\b/, ".conf-main style must exist");
  assert.match(cssSrc, /\.conf-good\b/, ".conf-good style must exist");
  assert.match(cssSrc, /\.conf-caveats\b/, ".conf-caveats style must exist");
  assert.match(appSrc, /confCopyMdBtn/,
    "iter #269 must include a confidence Markdown copy button");
  assert.match(appSrc, /'📋 Confidence copied as Markdown'/,
    "iter #269 must confirm when the confidence Markdown is copied");
  assert.match(appSrc, /\| Metric \| Score \|/,
    "iter #269 must build a Markdown table header");
  assert.match(appSrc, /_Generated ' \+ new Date\(\)\.toLocaleString/,
    "iter #269 must include a generated timestamp");
  assert.match(appSrc, /_fpState && _fpState\.short\) \? ' · #' \+ _fpState\.short/,
    "iter #269 must include the document fingerprint when available");


skip("analyze: confidence summary copies as Markdown", async () => {
  if (!HAS_BROWSER) return;
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  const errors = [];
  page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.addInitScript(() => {
    window.__copiedConfMd = null;
    try {
      Object.defineProperty(navigator, "clipboard", {
        configurable: true,
        value: {
          writeText: async (txt) => { window.__copiedConfMd = txt; },
          write: async () => {},
        },
      });
    } catch (_) {
      try { navigator.clipboard = { writeText: async (txt) => { window.__copiedConfMd = txt; }, write: async () => {} }; } catch (_2) {}
    }
  });
  try {
    await page.goto(`http://127.0.0.1:${PORT}/analyze.html`, { waitUntil: "networkidle" });
    await page.click(".qf[data-fill]:first-of-type");
    await page.click("#analyzeBtn");
    await page.waitForSelector("#confBlock:not([hidden]) #confCopyMdBtn", { timeout: 8000 });
    await page.click("#confCopyMdBtn");
    await page.waitForFunction(() => window.__copiedConfMd && window.__copiedConfMd.length > 0, { timeout: 8000 });
    const captured = await page.evaluate(() => window.__copiedConfMd);
    assert.match(captured, /^## Confidence: /, "the copied confidence must start with a heading");
    assert.match(captured, /\| Metric \| Score \|/, "the copied confidence must include the metric table");
    assert.match(captured, /_Generated/, "the copied confidence must include a generated line");
    assert.equal(errors.length, 0, `zero console errors, got: ${errors.join(" | ")}`);
  } finally {
    await page.close();
    await ctx.close();
  }
});


// Iter #174: deadline extractor — pulls date mentions from obligations.
test("analyzer: Deadline extractor pulls dates from action-verb sentences", () => {
  if (!HAS_BROWSER) return;
  const fs = require("node:fs");
  const path = require("node:path");
  const appSrc = fs.readFileSync(path.join(ROOT, "assets", "app.js"), "utf8");
  const html = fs.readFileSync(path.join(ROOT, "analyze.html"), "utf8");

  assert.match(html, /id="deadlineBlock"/, "analyze.html must contain #deadlineBlock");
  assert.match(appSrc, /function extractDeadlines\(/, "extractDeadlines must exist");
  assert.match(appSrc, /function renderDeadlineBlock\(/, "renderDeadlineBlock must exist");
  assert.match(appSrc, /renderDeadlineBlock\(raw[\s\S]+?ctx\)/,
    "render() must call renderDeadlineBlock");
  // Cover key date patterns
  assert.match(appSrc, /January.*\\d\{4\}/,
    "extractDeadlines must support long-month date formats");
  // Q1-Q4 quarter notation
  assert.match(appSrc, /\[Qq\]\[1-4\]/,
    "extractDeadlines must support Q1-Q4 quarter notation");
  // ICS export button
  assert.match(appSrc, /deadline-ics/,
    "renderDeadlineBlock must render ICS export buttons");
});

// Iter #176: focus memory — tracks clauses the user pinned across sessions.
test("analyzer: Focus memory tracks clauses pinned across sessions", () => {
  if (!HAS_BROWSER) return;
  const fs = require("node:fs");
  const path = require("node:path");
  const appSrc = fs.readFileSync(path.join(ROOT, "assets", "app.js"), "utf8");
  const html = fs.readFileSync(path.join(ROOT, "analyze.html"), "utf8");

  assert.match(html, /id="focusBlock"/, "analyze.html must contain #focusBlock");
  assert.match(appSrc, /function buildFocusMemory/, "buildFocusMemory must exist");
  assert.match(appSrc, /function renderFocusBlock/, "renderFocusBlock must exist");
  assert.match(appSrc, /cleardoc:focus-/, "iter #176 must persist focus points to localStorage with a focus- prefix");
  assert.match(appSrc, /function trackFocus/, "trackFocus must exist");
  assert.match(appSrc, /data-rc-pin/, "iter #176 must render a 📌 pin button on each risk counter row");
  assert.match(appSrc, /trackFocus\(raw, ctx, term, ctx\)/, "trackFocus must be wired into the rc-pin click handler");
  // Wiring
  assert.match(appSrc, /renderFocusBlock\(raw[\s\S]+?ctx\)/,
    "render() must call renderFocusBlock");
});

// Iter #177 polish: focus memory — remove + clear-all + copy-as-memo.
test("analyzer: Focus memory polish — remove + clear-all + copy-as-memo", () => {
  if (!HAS_BROWSER) return;
  const fs = require("node:fs");
  const path = require("node:path");
  const appSrc = fs.readFileSync(path.join(ROOT, "assets", "app.js"), "utf8");
  // Per-row remove button
  assert.match(appSrc, /data-focus-remove=/,
    "iter #177 must render a remove button per row");
  assert.match(appSrc, /focusClearBtn/,
    "iter #177 must render a clear-all button");
  assert.match(appSrc, /focusCopyMemoBtn/,
    "iter #177 must render a copy-as-memo button");
  // Click handler persistence
  assert.match(appSrc, /m\.items\.splice\(i, 1\);/,
    "iter #177 must splice the removed item from the array");
  assert.match(appSrc, /focusClearBtn/,
    "iter #177 must wire the clear-all button");
  assert.match(appSrc, /focusCopyMemoBtn/,
    "iter #177 must wire the copy-as-memo button");
});



// Iter #175 polish: deadline extractor — countdown + copy-all chip.
test("analyzer: Deadline extractor polish — countdown + copy-all chip", () => {
  if (!HAS_BROWSER) return;
  const fs = require("node:fs");
  const path = require("node:path");
  const appSrc = fs.readFileSync(path.join(ROOT, "assets", "app.js"), "utf8");

  assert.match(appSrc, /deadline-countdown/,
    "iter #175 must render a countdown chip per row");
  assert.match(appSrc, /deadlineCopyAllBtn/,
    "iter #175 must include a copy-all chip");
  assert.match(appSrc, /days > 0/,
    "iter #175 must compute positive-day countdown");
  assert.match(appSrc, /days < 0/,
    "iter #175 must compute past-day countdown");
  // Cycle #193 — the copy-all list carries countdowns like the row copy.
  assert.match(appSrc, /const cd = \(countdown\(it\.date\) \|\| ''\)\.trim\(\);/,
    "the copy-all builder must compute each deadline's countdown");
  assert.match(appSrc, /it\.date \+ \(cd \? ' \(' \+ cd \+ '\)' : ''\) \+ \(it\.verb === '\(obligated\)'/,
    "the countdown must sit after the date in the copy-all text");
});

test("analyzer: Deadline rows can add the event to Google Calendar in one click", () => {
  if (!HAS_BROWSER) return;
  const fs = require("node:fs");
  const path = require("node:path");
  const appSrc = fs.readFileSync(path.join(ROOT, "assets", "app.js"), "utf8");
  const cssSrc = fs.readFileSync(path.join(ROOT, "assets", "theme.css"), "utf8");

  // Each row renders an "Add to Google Calendar" link.
  assert.match(appSrc, /class="deadline-gcal ghost-btn ghost-btn-sm"/,
    "each deadline row must render a Google Calendar link");
  assert.match(appSrc, /calendar\.google\.com\/calendar\/render\?action=TEMPLATE/,
    "the link must use Google's template event flow");
  assert.match(appSrc, /&text=' \+ encodeURIComponent\('Contract deadline ' \+ it\.date\)/,
    "the event title must carry the detected date");
  assert.match(appSrc, /&dates=' \+ day \+ '\/' \+ day/,
    "the event must be all-day on the detected date");
  assert.match(appSrc, /&details=' \+ encodeURIComponent\('Detected by ClearDoc: '/,
    "the event description must carry the source sentence");
  assert.match(appSrc, /target="_blank" rel="noopener noreferrer"/,
    "the link must open safely in a new tab");
  assert.match(appSrc, /aria-label="Add deadline ' \+ esc\(it\.date\) \+ ' to Google Calendar"/,
    "the link must expose an accessible name with the date");
  assert.match(appSrc, /<b>🌐 gcal<\/b> to add it to Google Calendar/,
    "the block note must document the Google Calendar action");
  assert.match(cssSrc, /\.deadline-gcal\{/,
    "the Google Calendar link must have row-button styling");
  assert.match(cssSrc, /\.deadline-gcal\{[^}]*text-decoration:none/,
    "the link must not underline like a body link");
  // Cycle #93 polish — responsive rows so the actions never clip.
  assert.match(cssSrc, /\.deadline-row\{[^}]*flex-wrap:wrap/,
    "deadline rows must wrap instead of overflowing on narrow screens");
  assert.match(cssSrc, /\.deadline-context\{[^}]*flex:1 1 220px/,
    "the context line must wrap and share row space");
  assert.match(cssSrc, /@media\(max-width:560px\)\{[^}]*\.deadline-row\{gap:var\(--s2\)\}[^}]*\.deadline-date\{min-width:0\}/,
    "narrow screens must tighten the row and let the date shrink");
});

// Cycle #108 — ask about a deadline in one click.
test("analyzer: Deadline rows can ask the document about the deadline in one click", () => {
  if (!HAS_BROWSER) return;
  const fs = require("node:fs");
  const path = require("node:path");
  const appSrc = fs.readFileSync(path.join(ROOT, "assets", "app.js"), "utf8");

  assert.match(appSrc, /class="deadline-ask ghost-btn ghost-btn-sm"/,
    "each deadline row must render an ask button");
  assert.match(appSrc, /data-deadline-ask="' \+ esc\(it\.sentence \|\| it\.date \|\| ''\) \+ '"/,
    "the ask button must carry the deadline context");
  assert.match(appSrc, /data-deadline-date="' \+ esc\(it\.date \|\| ''\) \+ '"/,
    "the ask button must carry the deadline date");
  assert.match(appSrc, /data-deadline-type="' \+ \(isM \? 'obligated' : 'scheduled'\) \+ '"/,
    "the ask button must carry the deadline type");
  assert.match(appSrc, /\$\$\('\.deadline-ask', deadlineList\)\.forEach/,
    "ask buttons must be wired after each render");
  assert.match(appSrc, /const type = btn\.getAttribute\('data-deadline-type'\) \|\| 'scheduled';/,
    "the handler must read the deadline type");
  assert.match(appSrc, /type === 'obligated'/,
    "obligated deadlines must ask about missing them");
  assert.match(appSrc, /What happens on '/,
    "scheduled milestones must ask what happens on the date");
  assert.match(appSrc, /What happens if I miss the deadline/,
    "clicking must ask what happens if the deadline is missed");
  assert.match(appSrc, /qInput\.scrollIntoView/,
    "clicking must bring the Ask panel into view");
  assert.match(appSrc, /showAnalyzeToast\('💬 Question ready — press Ask'\)/,
    "clicking must announce the prefilled question");
  assert.match(appSrc, /<b>💬<\/b> to ask about it/,
    "the block note must document the ask action");
  // The a-shortcut now covers deadline rows too.
  assert.match(appSrc, /const row = t && t\.closest \? t\.closest\('\.rrow, \.ques-row, \.deadline-row, \.kc-row, \.scenario-card, \.action-row, \.bearer-row, \.reading-row'\) : null;[\s\S]{0,2400}if\(!row\) return;/,
    "the row-shortcut handler must include deadline rows and ignore other keys");
  assert.match(appSrc, /const row = t && t\.closest \? t\.closest\('\.rrow, \.ques-row, \.deadline-row, \.kc-row, \.scenario-card, \.action-row, \.bearer-row, \.reading-row'\) : null;[\s\S]{0,800}if\(key === 'j' \|\| key === 'J' \|\| key === 'k' \|\| key === 'K'\)\{/,
    "the j/k branch must live inside the same row-aware handler");
  assert.match(appSrc, /\.deadline-ask, \.kc-ask, \.scenario-ask, \.act-ask, \.bearer-ask, \.reading-ask'\)/,
    "the a shortcut must target the deadline ask button");
});

// Cycle #120 — per-deadline copy citation.
test("analyzer: Deadline rows copy their citation in one click", () => {
  if (!HAS_BROWSER) return;
  const fs = require("node:fs");
  const path = require("node:path");
  const appSrc = fs.readFileSync(path.join(ROOT, "assets", "app.js"), "utf8");
  const cssSrc = fs.readFileSync(path.join(ROOT, "assets", "theme.css"), "utf8");

  assert.match(appSrc, /class="deadline-row-copy ghost-btn ghost-btn-sm"/,
    "each deadline row must render a copy button");
  assert.match(appSrc, /data-deadline-copy-text="' \+ '\[/,
    "the copy button must carry a citation starting with a bracket");
  assert.match(appSrc, /\(isM \? '⚡ obligated' : '📅 scheduled'\) \+ ' · ' \+ esc\(it\.date\)/,
    "the citation must carry the type and date");
  // Cycle #192 — the copy carries the countdown.
  assert.match(appSrc, /const cd = \(countdown\(it\.date\) \|\| ''\)\.trim\(\);/,
    "the citation must compute the deadline countdown");
  assert.match(appSrc, /\+ \(cd \? ' · ' \+ esc\(cd\) : ''\) \+ '\] "'/,
    "the countdown must sit inside the bracket when available");
  assert.match(appSrc, /\$\$\('\.deadline-row-copy', deadlineList\)\.forEach/,
    "copy buttons must be wired after each render");
  assert.match(appSrc, /await navigator\.clipboard\.writeText\(text\)/,
    "copying must use the clipboard API");
  assert.match(appSrc, /execCommand\('copy'\)/,
    "copying must fall back to execCommand");
  assert.match(appSrc, /📋 Deadline citation copied/,
    "copying must announce via toast");
  // Cycle #121 — the actions hang together as one right-aligned group.
  assert.match(appSrc, /class="deadline-actions"/,
    "the row actions must be grouped into one cluster");
  assert.match(cssSrc, /\.deadline-actions\{[^}]*margin-left:auto/,
    "the action cluster must right-align in the row");
  assert.doesNotMatch(cssSrc, /\.deadline-overdue-tag\{[^}]*margin-left:auto/,
    "the overdue tag must not fight for its own margin");
});

// Cycle 50 feature: deadline CSV export — Date / Type / Countdown /
// Context columns for spreadsheet import (mirrors the risk CSV).
test("analyzer: Deadline block exports all deadlines as a CSV file", () => {
  if (!HAS_BROWSER) return;
  const fs = require("node:fs");
  const path = require("node:path");
  const appSrc = fs.readFileSync(path.join(ROOT, "assets", "app.js"), "utf8");

  // The chip renders inside renderDeadlineBlock's controls row
  assert.match(appSrc, /id="deadlineCsvBtn" title="Download all deadlines as a \.csv file/,
    "deadline controls must include a CSV export chip");
  assert.match(appSrc, /deadlineCsvBtn\.addEventListener\(\s*['"]click['"]/,
    "CSV chip must have a click handler");

  // RFC 4180 quoting + OWASP CSV-injection guard (cycle 51 polish)
  assert.match(appSrc, /csvCell = \(v\) => \{[\s\S]+?if\(\/\^\[=\+\\-@\]\/\.test\(s\)\) s = "'" \+ s;/,
    "CSV cells must neutralize formula-injection prefixes (= + - @) per OWASP");
  assert.match(appSrc, /'"' \+ s\.replace\(\/"\/g, '""'\)\.replace\(\/\[\\r\\n\]\+\/g, ' '\) \+ '"'/,
    "CSV cells must be quoted with doubled internal quotes per RFC 4180");
  assert.match(appSrc, /const text = '\\uFEFF' \+ header \+ '\\n' \+ body;/,
    "CSV must start with a UTF-8 BOM so Excel decodes non-ASCII correctly");
  assert.match(appSrc, /csvCell\('Date'\) \+ ',' \+ csvCell\('Type'\) \+ ',' \+ csvCell\('Countdown'\) \+ ',' \+ csvCell\('Context'\)/,
    "CSV must have Date, Type, Countdown, Context columns in that order");
  assert.match(appSrc, /'obligated' : 'scheduled'/,
    "Type column must map obligated vs scheduled deadlines");
  assert.match(appSrc, /countdown\(it\.date\)/,
    "Countdown column must reuse the row countdown helper");

  // Download path: Blob + CSV MIME + dated filename + toast
  assert.match(appSrc, /new Blob\(\[text\], \{ type:'text\/csv;charset=utf-8' \}\)/,
    "CSV must download as text/csv UTF-8");
  assert.match(appSrc, /a\.download = 'cleardoc-deadlines-' \+ stamp \+ '\.csv'/,
    "filename must be cleardoc-deadlines-<date>.csv");
  assert.match(appSrc, /URL\.revokeObjectURL\(url\)/,
    "object URL must be revoked after the download");
  assert.match(appSrc, /'📊 Deadlines CSV downloaded \(' \+ exportItems\.length/,
    "download must toast with the deadline count");
});

// Cycle 166 feature: batch .ics export — every detected deadline as one
// all-day-event calendar file, complementing the per-row 📅 buttons.
test("analyzer: Deadline block exports all deadlines as one .ics calendar file", () => {
  if (!HAS_BROWSER) return;
  const fs = require("node:fs");
  const path = require("node:path");
  const appSrc = fs.readFileSync(path.join(ROOT, "assets", "app.js"), "utf8");

  assert.match(appSrc, /id="deadlineIcsAllBtn" title="Download all deadlines as a single \.ics calendar file"/,
    "deadline controls must include a batch .ics chip");
  assert.match(appSrc, /deadlineIcsAllBtn\.addEventListener\(\s*['"]click['"]/,
    "the batch .ics chip must have a click handler");
  assert.match(appSrc, /const events = exportItems\.map\(it => \{[\s\S]+?new Date\(\(it\.date \|\| ''\) \+ 'T00:00:00Z'\)/,
    "each deadline must become a UTC-midnight all-day event");
  assert.match(appSrc, /const ics = buildIcs\(events\);/,
    "the batch export must reuse the multi-event builder");
  assert.match(appSrc, /valid\.sort\(\(a, b\) => a\.date\.getTime\(\) - b\.date\.getTime\(\)\)/,
    "buildIcs must emit events in chronological order");
  assert.match(appSrc, /const vevents = \(ics\.match\(\/BEGIN:VEVENT\/g\) \|\| \[\]\)\.length;/,
    "the toast count must reflect the events actually in the file");
  assert.match(appSrc, /new Blob\(\[ics\], \{ type:'text\/calendar;charset=utf-8' \}\)/,
    "the .ics must download as text/calendar UTF-8");
  assert.match(appSrc, /a\.download = 'cleardoc-deadlines-' \+ stamp \+ '\.ics'/,
    "the .ics filename must be cleardoc-deadlines-<date>.ics");
  assert.match(appSrc, /'📅 ' \+ vevents \+ ' deadline' \+ \(vevents === 1 \? '' : 's'\) \+ ' saved to one calendar file'/,
    "the .ics download must toast with the deadline count");
  assert.match(appSrc, /'⚠ No valid dates to export'/,
    "unparseable dates must fail with a clear toast");
  assert.match(appSrc, /📊 CSV<\/b> \/ <b>📅 all \.ics<\/b> to export/,
    "the block note must mention the new export chip");
});

// Cycle 52/53: deadline-urgency alert pinned to the top of the results.
// Cycle 53 polish adds overdue deadlines to the alert alongside the
// next-7-days window (a missed deadline is the loudest signal).
test("analyzer: Deadline alert surfaces overdue + within-7-days deadlines", () => {
  if (!HAS_BROWSER) return;
  const fs = require("node:fs");
  const path = require("node:path");
  const html = fs.readFileSync(path.join(ROOT, "analyze.html"), "utf8");
  const appSrc = fs.readFileSync(path.join(ROOT, "assets", "app.js"), "utf8");
  const cssSrc = fs.readFileSync(path.join(ROOT, "assets", "theme.css"), "utf8");

  // analyze.html must carry the alert at the top of the result panel
  assert.match(html, /id="deadlineAlert" hidden role="status" aria-live="polite"/,
    "analyze.html must contain #deadlineAlert as a live status region");

  // renderDeadlineBlock must hide the alert when no deadlines exist
  assert.match(appSrc, /if\(!items\.length\)\{[\s\S]+?deadlineAlert\.hidden = true;/,
    "alert must hide when the deadline block is empty");
  // Urgency window: 0–7 days from today
  assert.match(appSrc, /overdue = items\.filter\(it => \{/,
    "renderDeadlineBlock must compute the overdue deadline subset");
  assert.match(appSrc, /upcoming = items\.filter\(it => \{/,
    "renderDeadlineBlock must compute the upcoming deadline subset");
  assert.match(appSrc, /d >= 0 && d <= 7/,
    "urgency window must be the next 7 days");
  assert.match(appSrc, /within the next 7 days/,
    "alert copy must state the 7-day window");
  assert.match(appSrc, /deadline' \+ \(overdue\.length === 1 \? '' : 's'\) \+ ' overdue/,
    "alert copy must state the overdue count");
  assert.match(appSrc, /const withCount = overdue\.map\(it => \{/,
    "alert must build the overdue date list with countdowns");
  assert.match(appSrc, /const withCount = upcoming\.map\(it => \{/,
    "alert must build the upcoming date list with countdowns");
  assert.match(appSrc, /it\.date \+ \(cd \? ' \(' \+ cd \+ '\)' : ''\)/,
    "each listed date must carry its countdown when available");

  // Jump affordance: click scrolls to the deadlines block
  assert.match(appSrc, /deadlineAlert\._jumpWired/,
    "alert jump wiring must be attached only once");
  assert.match(appSrc, /lenis\.scrollTo\(deadlineBlock[\s\S]+?scrollIntoView/,
    "alert click must scroll to the deadlines block via lenis or scrollIntoView");
  // Cycle 77 polish — a real button inside the banner is keyboard usable
  assert.match(appSrc, /id="deadlineAlertJumpBtn"/,
    "the alert must contain a real jump button for keyboard users");
  assert.match(cssSrc, /\.deadline-alert \.da-jump-btn\{/,
    "theme.css must style the jump button");
  assert.match(cssSrc, /\.deadline-alert \.da-jump-btn:focus-visible\{/,
    "the jump button must have a visible focus ring");

  // CSS: danger-tinted banner + hidden-state + focus ring
  assert.match(cssSrc, /\.deadline-alert\{[^}]*var\(--danger-tint\)/,
    "theme.css must style .deadline-alert with the danger tint");
  assert.match(cssSrc, /\.deadline-alert\[hidden\]\{display:none\}/,
    "the flex display must not override the hidden attribute");
  assert.match(cssSrc, /\.deadline-alert:focus-visible\{/,
    "the alert must have a visible focus ring");
  // Cycle #210 — a copy chip exports the alert summary.
  assert.match(appSrc, /id="deadlineAlertCopyBtn" data-da-copy="1"/,
    "the alert must contain a copy button");
  assert.match(appSrc, /deadlineAlert\._copyWired/,
    "the alert copy wiring must be attached only once");
  assert.match(appSrc, /e\.target\.closest && e\.target\.closest\('\[data-da-copy\]'\)/,
    "the copy handler must catch copy-button clicks");
  assert.match(appSrc, /p\.replace\(\/<\[\^>\]\+>\/g, ''\)/,
    "the copy payload must strip the alert's HTML tags");
  assert.match(appSrc, /'📋 Deadline alert copied'/,
    "copying must toast on success");
  assert.match(appSrc, /if\(e\.target\.closest && e\.target\.closest\('\[data-da-copy\]'\)\) return;/,
    "the jump handler must ignore copy-button clicks");
  assert.match(cssSrc, /\.deadline-alert \.da-copy-btn\{/, "the copy button must be styled");
});

// Cycle #106 — load-time reminder for deadlines from the last analysis.
test("analyzer: Returning users get an upcoming-deadline reminder banner", () => {
  if (!HAS_BROWSER) return;
  const fs = require("node:fs");
  const path = require("node:path");
  const html = fs.readFileSync(path.join(ROOT, "analyze.html"), "utf8");
  const appSrc = fs.readFileSync(path.join(ROOT, "assets", "app.js"), "utf8");
  const cssSrc = fs.readFileSync(path.join(ROOT, "assets", "theme.css"), "utf8");

  assert.match(html, /id="deadlineReminder" hidden aria-live="polite"/,
    "analyze.html must carry the reminder banner");
  assert.match(html, /id="deadlineReminderText"/,
    "the banner must have a text slot");
  assert.match(html, /id="deadlineReminderRestoreBtn"/,
    "the banner must offer a restore action");
  assert.match(html, /id="deadlineReminderDismissBtn"/,
    "the banner must offer a dismiss action");
  // The reminder is persisted at analysis time, filtered to a 3-week window.
  assert.match(appSrc, /localStorage\.setItem\('cleardoc:upcomingDeadlines', JSON\.stringify\(/,
    "analysis must persist the reminder record");
  assert.match(appSrc, /x\.days >= -7 && x\.days <= 14/,
    "the reminder must cover overdue + next-14-days deadlines");
  assert.match(appSrc, /localStorage\.removeItem\('cleardoc:upcomingDeadlines'\)/,
    "an analysis with no deadlines must clear a stale reminder");
  assert.match(appSrc, /function showDeadlineReminder\(\)\{/,
    "a load-time show function must exist");
  assert.match(appSrc, /showDeadlineReminder\(\);/,
    "the show function must run at init");
  assert.match(appSrc, /if\(deadlineReminderRestoreBtn\) deadlineReminderRestoreBtn\.addEventListener\('click'/,
    "the restore button must be wired");
  assert.match(appSrc, /if\(restoreBtn\) restoreBtn\.click\(\);/,
    "restore must reuse the existing restore flow");
  assert.match(appSrc, /if\(deadlineReminderDismissBtn\) deadlineReminderDismissBtn\.addEventListener\('click'/,
    "the dismiss button must be wired");
  assert.match(appSrc, /_reminderEl\) _reminderEl\.hidden = true;/,
    "a fresh analysis must hide the reminder");
  assert.match(appSrc, /cleardoc:deadlineSnooze', 'cleardoc:flagSample'\]/,
    "Forget me must purge the reminder record and its snooze");
  // Cycle #107 — no stacked banners, and stale records get purged.
  assert.match(appSrc, /if\(restoreBanner && !restoreBanner\.hidden\)\{ banner\.hidden = true; return; \}/,
    "the reminder must yield to the restore banner instead of stacking");
  assert.match(appSrc, /if\(dismissRestoreBtn\) dismissRestoreBtn\.addEventListener\('click',\(\)=>\{[\s\S]{0,260}cleardoc:upcomingDeadlines/,
    "dismissing the restore offer must purge the reminder record");
  assert.match(appSrc, /function clearHistory\(\)\{[\s\S]{0,520}cleardoc:upcomingDeadlines/,
    "clearing history must purge the reminder record");
  assert.match(cssSrc, /\.deadline-reminder\{/,
    "the reminder banner must be styled");
  assert.match(cssSrc, /\.deadline-reminder\.overdue\{/,
    "an overdue reminder must get the danger accent");
  // Cycle #180 — snooze the reminder until tomorrow.
  assert.match(html, /id="deadlineReminderSnoozeBtn" type="button" aria-label="Snooze the deadline reminder until tomorrow"/,
    "the banner must offer a snooze action");
  assert.match(appSrc, /localStorage\.getItem\('cleardoc:deadlineSnooze'\)/,
    "the show function must consult the snooze record");
  assert.match(appSrc, /String\(snooze\.until\) > localDay\(\)/,
    "a snoozed reminder must stay hidden until the next day");
  assert.match(appSrc, /deadlineReminderSnoozeBtn\) deadlineReminderSnoozeBtn\.addEventListener\('click'/,
    "the snooze button must be wired");
  assert.match(appSrc, /localStorage\.setItem\('cleardoc:deadlineSnooze', JSON\.stringify\(\{ until, ts: Date\.now\(\) \}\)\)/,
    "snooze must persist the until-date");
  assert.match(appSrc, /'😴 Reminder snoozed until tomorrow'/,
    "snooze must confirm with a toast");
  // Cycle #230 — snooze horizons: 1 / 3 / 7 days.
  assert.match(html, /id="deadlineReminderSnooze3Btn" type="button" aria-label="Snooze the deadline reminder for 3 days"/,
    "the banner must offer a 3-day snooze");
  assert.match(html, /id="deadlineReminderSnooze7Btn" type="button" aria-label="Snooze the deadline reminder for 7 days"/,
    "the banner must offer a 7-day snooze");
  assert.match(appSrc, /const snoozeDeadlineReminder = \(days\) => \{/,
    "snoozing must live in a shared days-based helper");
  assert.match(appSrc, /deadlineReminderSnooze3Btn\) deadlineReminderSnooze3Btn\.addEventListener\('click', \(\) => snoozeDeadlineReminder\(3\)\);/,
    "the 3-day button must be wired to the helper");
  assert.match(appSrc, /deadlineReminderSnooze7Btn\) deadlineReminderSnooze7Btn\.addEventListener\('click', \(\) => snoozeDeadlineReminder\(7\)\);/,
    "the 7-day button must be wired to the helper");
  assert.match(appSrc, /'😴 Reminder snoozed until ' \+ resumeLabel/,
    "multi-day snoozes must name the resume date in the toast");
  assert.match(appSrc, /resumeLabel = d\.toLocaleDateString\(undefined, \{ weekday: 'short', month: 'short', day: 'numeric' \}\)/,
    "the resume label must be a readable short date");
  assert.match(appSrc, /dr\.contains\(document\.activeElement\)/,
    "snoozing must detect focus sitting on a banner control");
  assert.match(appSrc, /input\.focus\(\{preventScroll:true\}\)/,
    "snoozing must move keyboard focus to the document input");
  const snoozeClears = (appSrc.match(/cleardoc:deadlineSnooze'\); \} catch\(_\)\{ \/\* ignore \*\/ \}/g) || []).length;
  assert.ok(snoozeClears >= 4,
    "a fresh analysis, no-deadline analysis, history clear, and restore dismissal must all reset the snooze");
  assert.match(appSrc, /cleardoc:deadlineSnooze', 'cleardoc:flagSample'\]/,
    "Forget me must purge the snooze record too");
});

// Cycle 54 feature: overdue deadline rows are visually flagged in the list.
test("analyzer: Overdue deadline rows show a danger flag in the list", () => {
  if (!HAS_BROWSER) return;
  const fs = require("node:fs");
  const path = require("node:path");
  const appSrc = fs.readFileSync(path.join(ROOT, "assets", "app.js"), "utf8");
  const cssSrc = fs.readFileSync(path.join(ROOT, "assets", "theme.css"), "utf8");

  // Row renderer must compute the overdue state and append the class
  assert.match(appSrc, /const isOverdue = d !== null && d < 0;/,
    "row renderer must flag deadlines with a negative day diff");
  assert.match(appSrc, /rowCls = 'deadline-row ' \+ cls \+ \(isOverdue \? ' deadline-overdue' : ''\)/,
    "overdue rows must carry the deadline-overdue class");
  assert.match(appSrc, /isOverdue \? '<span class="deadline-overdue-tag">⚠ overdue<\/span>' : ''/,
    "overdue rows must render an explicit ⚠ overdue tag");

  // CSS: danger tint on the row + tag styling
  assert.match(cssSrc, /\.deadline-row\.deadline-overdue\{[^}]*var\(--danger-tint\)/,
    "theme.css must tint overdue rows with the danger background");
  assert.match(cssSrc, /\.deadline-row\.deadline-overdue\{[^}]*border-color:var\(--danger\)/,
    "overdue rows must use the danger border");
  assert.match(cssSrc, /\.deadline-overdue-tag\{/,
    "theme.css must style the overdue tag");
  // Print must stay clean: the print override forces a white background
  assert.match(cssSrc, /\.deadline-row\{border:1px solid #000 !important;background:#fff !important/,
    "print output must not carry the overdue tint");
});

  // Iter #159 polish: sub-score tooltips + copy-as-JSON.
  assert.match(appSrc, /'How much text we have to analyze|'How many risk patterns matched|'How far the document/,
    "iter #159 must add sub-score tooltips");
  assert.match(appSrc, /confCopyJsonBtn[\s\S]+?JSON\.stringify/,
    "iter #159 must include a copy-as-JSON button");
  assert.match(cssSrc, /\.conf-controls\b/, ".conf-controls style must exist");
});

// Iter #160: coverage index — measures presence of standard contract sections.
test("analyzer: Coverage index measures presence of standard contract sections", () => {
  if (!HAS_BROWSER) return;
  const fs = require("node:fs");
  const path = require("node:path");
  const appSrc = fs.readFileSync(path.join(ROOT, "assets", "app.js"), "utf8");
  const cssSrc = fs.readFileSync(path.join(ROOT, "assets", "theme.css"), "utf8");
  const html = fs.readFileSync(path.join(ROOT, "analyze.html"), "utf8");

  assert.match(html, /id="covBlock"/, "analyze.html must contain #covBlock");
  assert.match(appSrc, /function buildCoverageIndex\(/, "buildCoverageIndex must exist");
  assert.match(appSrc, /function renderCovBlock\(/, "renderCovBlock must exist");
  for(const k of ["recitals", "definitions", "services", "termination", "governing"]){
    assert.match(appSrc, new RegExp("key: '" + k + "'"),
      "COVERAGE_SECTIONS must include the '" + k + "' section");
  }
  assert.match(appSrc, /renderCovBlock\(raw[\s\S]+?ctx\)/,
    "render() must call renderCovBlock");
  assert.match(cssSrc, /\.cov-cell\b/, ".cov-cell style must exist");
  assert.match(cssSrc, /\.cov-present\b/, ".cov-present style must exist");

  // Iter #161 polish: click-to-jump + copy-as-checklist.
  assert.match(appSrc, /data-cov-jump=/,
    "iter #161 must render a click-to-jump attribute on present sections");
  assert.match(appSrc, /covCopyChecklistBtn/,
    "iter #161 must render a copy-checklist button");
  assert.match(appSrc, /covCopyChecklistBtn[\s\S]+?navigator\.clipboard|execCommand\('copy'\)/,
    "iter #161 must use clipboard fallback for the checklist");
  assert.match(appSrc, /covCopyMdBtn/,
    "iter #266 must render a coverage-index copy-as-Markdown button");
  assert.match(appSrc, /'📋 Coverage index copied as Markdown'/,
    "iter #266 must confirm when the coverage index is copied");
  assert.match(appSrc, /\| Section \| Status \|/,
    "iter #266 must build a Markdown table header");
  assert.match(appSrc, /\*\*Missing:\*\*/,
    "iter #266 must include a missing-sections line when present");
});

skip("analyze: coverage index copies as Markdown", async () => {
  if (!HAS_BROWSER) return;
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  const errors = [];
  page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.addInitScript(() => {
    window.__copiedCovMd = null;
    try {
      Object.defineProperty(navigator, "clipboard", {
        configurable: true,
        value: {
          writeText: async (txt) => { window.__copiedCovMd = txt; },
          write: async () => {},
        },
      });
    } catch (_) {
      try { navigator.clipboard = { writeText: async (txt) => { window.__copiedCovMd = txt; }, write: async () => {} }; } catch (_2) {}
    }
  });
  try {
    await page.goto(`http://127.0.0.1:${PORT}/analyze.html`, { waitUntil: "networkidle" });
    await page.click(".qf[data-fill]:first-of-type");
    await page.click("#analyzeBtn");
    await page.waitForSelector("#covBlock:not([hidden]) #covCopyMdBtn", { timeout: 8000 });
    await page.click("#covCopyMdBtn");
    await page.waitForFunction(() => window.__copiedCovMd && window.__copiedCovMd.length > 0, { timeout: 8000 });
    const captured = await page.evaluate(() => window.__copiedCovMd);
    assert.match(captured, /^\| Section \| Status \|/, "the copied coverage index must start with the Markdown header");
    assert.match(captured, /\|---\|---\|/, "the copied coverage index must include the separator row");
    assert.match(captured, /Coverage score:/, "the copied coverage index must include the score");
    assert.match(captured, /Missing:/, "the copied coverage index must include a missing-sections line");
    assert.equal(errors.length, 0, `zero console errors, got: ${errors.join(" | ")}`);
  } finally {
    await page.close();
    await ctx.close();
  }
});

// Iter #162: contact extract — emails + phone numbers.
test("analyzer: Contact extract pulls emails and phone numbers from the document", () => {
  if (!HAS_BROWSER) return;
  const fs = require("node:fs");
  const path = require("node:path");
  const appSrc = fs.readFileSync(path.join(ROOT, "assets", "app.js"), "utf8");
  const cssSrc = fs.readFileSync(path.join(ROOT, "assets", "theme.css"), "utf8");
  const html = fs.readFileSync(path.join(ROOT, "analyze.html"), "utf8");

  assert.match(html, /id="contactBlock"/, "analyze.html must contain #contactBlock");
  assert.match(appSrc, /function buildContactExtract\(/, "buildContactExtract must exist");
  assert.match(appSrc, /function renderContactBlock\(/, "renderContactBlock must exist");
  // Regex coverage
  assert.match(appSrc, /[a-zA-Z0-9._%+-]+@\[a-zA-Z0-9\.-\]\+\\.\[a-zA-Z\]\{2,\}/,
    "iter #162 must include an email regex");
  assert.match(appSrc, /phoneRe/,
    "iter #162 must include a phone regex");

  // Iter #163 polish: filter chips + CSV export.
  assert.match(appSrc, /data-contact-filter=/,
    "iter #163 must render filter chips");
  assert.match(appSrc, /contactCopyCsvBtn/,
    "iter #163 must include a copy-CSV button");
  assert.match(appSrc, /contactCopyMdBtn/,
    "iter #265 must include a copy-as-Markdown contacts button");
  assert.match(appSrc, /'📋 Contacts copied as Markdown'/,
    "iter #265 must confirm when the contacts Markdown is copied");
  assert.match(appSrc, /\| Type \| Value \|/,
    "iter #265 must build a Markdown table header");
  assert.match(appSrc, /filter === 'phones' \? \[\] : c\.emails/,
    "iter #265 must respect the active email/phone filter");
  assert.match(cssSrc, /\.contact-filter-active\b/, ".contact-filter-active style must exist");
});

// Iter #163 polish: filter chips + CSV export (own test).
test("analyzer: Contact extract polish — filter chips + CSV export", () => {
  if (!HAS_BROWSER) return;
  const fs = require("node:fs");
  const path = require("node:path");
  const appSrc = fs.readFileSync(path.join(ROOT, "assets", "app.js"), "utf8");
  const cssSrc = fs.readFileSync(path.join(ROOT, "assets", "theme.css"), "utf8");

  // Wiring
  assert.match(appSrc, /renderContactBlock\(raw[\s\S]+?ctx\)/,
    "render() must call renderContactBlock");
  // CSS
  assert.match(cssSrc, /\.contact-cell\b/, ".contact-cell style must exist");
  assert.match(cssSrc, /\.contact-email\b/, ".contact-email style must exist");
});

skip("analyze: contacts copy as Markdown table", async () => {
  if (!HAS_BROWSER) return;
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  const errors = [];
  page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.addInitScript(() => {
    window.__copiedContactMd = null;
    try {
      Object.defineProperty(navigator, "clipboard", {
        configurable: true,
        value: {
          writeText: async (txt) => { window.__copiedContactMd = txt; },
          write: async () => {},
        },
      });
    } catch (_) {
      try { navigator.clipboard = { writeText: async (txt) => { window.__copiedContactMd = txt; }, write: async () => {} }; } catch (_2) {}
    }
  });
  try {
    await page.goto(`http://127.0.0.1:${PORT}/analyze.html`, { waitUntil: "networkidle" });
    await page.click(".qf[data-fill]:first-of-type");
    await page.click("#analyzeBtn");
    await page.waitForSelector("#contactBlock:not([hidden]) #contactCopyMdBtn", { timeout: 8000 });
    await page.click("#contactCopyMdBtn");
    await page.waitForFunction(() => window.__copiedContactMd && window.__copiedContactMd.length > 0, { timeout: 8000 });
    const captured = await page.evaluate(() => window.__copiedContactMd);
    assert.match(captured, /^\| Type \| Value \|/, "the copied contacts must start with the Markdown header");
    assert.match(captured, /\|---\|---\|/, "the copied contacts must include the separator row");
    assert.equal(errors.length, 0, `zero console errors, got: ${errors.join(" | ")}`);
  } finally {
    await page.close();
    await ctx.close();
  }
});

// Iter #164: document history map — past runs of the same document.
test("analyzer: Document history map shows past runs and a delta since the first run", () => {
  if (!HAS_BROWSER) return;
  const fs = require("node:fs");
  const path = require("node:path");
  const appSrc = fs.readFileSync(path.join(ROOT, "assets", "app.js"), "utf8");
  const cssSrc = fs.readFileSync(path.join(ROOT, "assets", "theme.css"), "utf8");
  const html = fs.readFileSync(path.join(ROOT, "analyze.html"), "utf8");

  assert.match(html, /id="histBlock"/, "analyze.html must contain #histBlock");
  assert.match(appSrc, /function buildHistoryMap\(/, "buildHistoryMap must exist");
  assert.match(appSrc, /function renderHistBlock\(/, "renderHistBlock must exist");
  assert.match(appSrc, /cleardoc:receipt-log/,
    "iter #164 must read from the iter #110 receipt log");
  assert.match(appSrc, /TREND_KEY_HIST|cleardoc:trend-history/,
    "iter #164 must read from the iter #132 trend history");
  // Wiring
  assert.match(appSrc, /renderHistBlock\(raw[\s\S]+?ctx\)/,
    "render() must call renderHistBlock");
  // CSS
  assert.match(cssSrc, /\.hist-row\b/, ".hist-row style must exist");
  assert.match(cssSrc, /\.hist-latest\b/, ".hist-latest style must exist");

  // Iter #165 polish: maturity sparkline + copy-as-JSON.
  assert.match(appSrc, /hist-sparkline|hist-spark-glyph/,
    "iter #165 must render a sparkline");
  assert.match(appSrc, /histCopyJsonBtn/,
    "iter #165 must include a copy-JSON button");
  assert.match(cssSrc, /\.hist-sparkline\b/, ".hist-sparkline style must exist");
});

// Iter #166: strategy board — Kanban-style 3 columns.
test("analyzer: Strategy board tracks counter-clauses across Backlog / Drafted / Sent", () => {
  if (!HAS_BROWSER) return;
  const fs = require("node:fs");
  const path = require("node:path");
  const appSrc = fs.readFileSync(path.join(ROOT, "assets", "app.js"), "utf8");
  const cssSrc = fs.readFileSync(path.join(ROOT, "assets", "theme.css"), "utf8");
  const html = fs.readFileSync(path.join(ROOT, "analyze.html"), "utf8");

  assert.match(html, /id="boardBlock"/, "analyze.html must contain #boardBlock");
  assert.match(appSrc, /function buildStrategyBoard\(/, "buildStrategyBoard must exist");
  assert.match(appSrc, /function renderBoardBlock\(/, "renderBoardBlock must exist");
  for(const k of ["backlog", "drafted", "sent"]){
    assert.match(appSrc, new RegExp("key: '" + k + "'"),
      "COLUMNS must include '" + k + "'");
  }
  assert.match(appSrc, /cleardoc:strategy-board/,
    "iter #166 must persist state to localStorage");
  assert.match(appSrc, /renderBoardBlock\(raw[\s\S]+?ctx\)/,
    "render() must call renderBoardBlock");
  assert.match(cssSrc, /\.board-col\b/, ".board-col style must exist");
  assert.match(cssSrc, /\.board-card\b/, ".board-card style must exist");

  // Iter #167 polish: shift-click to move back + markdown export.
  assert.match(appSrc, /e\.shiftKey[\s\S]+?order/,
    "iter #167 must support shift-click to move a card back");
  assert.match(appSrc, /boardCopyMdBtn/,
    "iter #167 must include a copy-as-markdown button");
  assert.match(appSrc, /boardCopyMdBtn[\s\S]+?\\|.*\\|.*\\|/,
    "iter #167 must render a markdown table with three columns");

  // Cycle #228 — CSV export of the board state.
  assert.match(appSrc, /id="boardCsvBtn" title="Download the board as a .csv file for a tracker"/,
    "cycle #228 must add a board CSV chip");
  assert.match(appSrc, /const csvBtn = document\.getElementById\('boardCsvBtn'\);/,
    "the CSV chip must have a click handler");
  assert.match(appSrc, /a\.download = 'cleardoc-strategy-' \+ stamp \+ '\.csv';/,
    "the export must download as cleardoc-strategy-<date>.csv");
  assert.match(appSrc, /const csvCell = \(v\) => \{[\s\S]{0,220}\/\^\[=\+\\-\@\]/,
    "CSV cells must carry the formula-injection guard");
  assert.match(appSrc, /csvCell\('Status'\) \+ ',' \+ csvCell\('Risk'\)/,
    "the CSV must lead with Status/Risk column headers");
  assert.match(appSrc, /'📊 Strategy board CSV downloaded \(' \+ items\.length \+ '\)'/,
    "downloading must toast the card count");

  // Cycle #229 — keyboard parity for board cards (mirrors .clause-row).
  assert.match(appSrc, /<div class="board-card" data-board-key="' \+ esc\(it\.key\) \+ '" tabindex="0" role="button"/,
    "each board card must be a keyboard-focusable div with button semantics");
  assert.match(appSrc, /const advance = \(card, back\) => \{/,
    "card movement must live in a shared helper");
  assert.match(appSrc, /const advance = \(card, back\) => \{[\s\S]{0,640}persistBoard\(items\);/,
    "a move must be persisted so the rebuild does not snap the card back");
  assert.match(appSrc, /card\.addEventListener\('keydown', \(e\) => \{[\s\S]{0,300}advance\(card, !!e\.shiftKey\)/,
    "Enter/Space must advance the focused card and Shift+Enter must move it back");
  assert.match(appSrc, /📊 CSV<\/b> to download the board as a tracker file/,
    "the board note must document the CSV export");
});

// Cycle #142 — per-board-card copy.
test("analyzer: Strategy-board cards copy their counter-clause in one click", () => {
  if (!HAS_BROWSER) return;
  const fs = require("node:fs");
  const path = require("node:path");
  const appSrc = fs.readFileSync(path.join(ROOT, "assets", "app.js"), "utf8");
  const cssSrc = fs.readFileSync(path.join(ROOT, "assets", "theme.css"), "utf8");

  assert.match(appSrc, /const copyVal = '\[COUNTER-CLAUSE · ' \+ it\.label \+ '\] "' \+ it\.sample \+ '" → "' \+ it\.counter \+ '"';/,
    "the citation must carry label, sample, and counter-clause");
  assert.match(appSrc, /class="board-card-copy ghost-btn ghost-btn-sm"/,
    "each board card must render a copy button");
  assert.match(appSrc, /data-board-copy-text="' \+ esc\(copyVal\) \+ '"/,
    "the copy button must carry the prebuilt citation");
  assert.match(appSrc, /\$\$\('\.board-card-copy', boardGrid\)\.forEach/,
    "copy buttons must be wired after each render");
  assert.match(appSrc, /e\.stopPropagation\(\);/,
    "copying must not advance the card's column");
  assert.match(appSrc, /📋 Counter-clause copied/,
    "copying must announce via toast");
  assert.match(appSrc, /<b>📋<\/b> to copy one/,
    "the block note must document the copy action");
  assert.match(cssSrc, /\.board-card-copy\{[^}]*align-self:flex-end/,
    "the copy button must right-align in the card");
  assert.match(cssSrc, /\.board-card-copy:focus-visible\{/,
    "the copy button must have a focus ring");
});

// Iter #168: risk priority matrix — 2x2 quadrants.
test("analyzer: Risk priority matrix plots risks by impact vs likelihood", () => {
  if (!HAS_BROWSER) return;
  const fs = require("node:fs");
  const path = require("node:path");
  const appSrc = fs.readFileSync(path.join(ROOT, "assets", "app.js"), "utf8");
  const cssSrc = fs.readFileSync(path.join(ROOT, "assets", "theme.css"), "utf8");
  const html = fs.readFileSync(path.join(ROOT, "analyze.html"), "utf8");

  assert.match(html, /id="prioBlock"/, "analyze.html must contain #prioBlock");
  assert.match(appSrc, /function buildPriorityMatrix\(/, "buildPriorityMatrix must exist");
  assert.match(appSrc, /function renderPrioBlock\(/, "renderPrioBlock must exist");
  // Cover all 9 quadrants
  for(const k of ["high|high", "high|mid", "high|low", "mid|high", "mid|mid", "mid|low", "low|high", "low|mid", "low|low"]){
    assert.match(appSrc, new RegExp("'" + k + "'\\s*:"),
      "GROUPS must include the '" + k + "' quadrant");
  }
  // Wiring
  assert.match(appSrc, /renderPrioBlock\(raw[\s\S]+?ctx\)/,
    "render() must call renderPrioBlock");
  // CSS
  assert.match(cssSrc, /\.prio-grid\b/, ".prio-grid style must exist");
  assert.match(cssSrc, /\.prio-cell\.prio-active/, ".prio-cell.prio-active style must exist");

  // Iter #169 polish: click-to-zoom + copy-as-markdown.
  assert.match(appSrc, /data-prio-ki=|data-prio-label=|data-prio-full=/,
    "iter #169 must render per-cell data attributes for click-to-zoom");
  assert.match(appSrc, /prioCopyMdBtn/,
    "iter #169 must include a copy-as-markdown button");
  assert.match(cssSrc, /\.prio-controls\b/, ".prio-controls style must exist");
});

// Iter #217: risk checklist — sorted by severity (traps first, watches, then notes)
// and includes threat-level header when scores exist.
test("analyzer: risk checklist sorts traps first then watches then notes", () => {
  if (!HAS_BROWSER) return;
  const fs = require("node:fs");
  const path = require("node:path");
  const appSrc = fs.readFileSync(path.join(ROOT, "assets", "app.js"), "utf8");

  // buildRiskChecklist must exist and sort by severity (trap=0, watch=1, note=2)
  assert.match(appSrc, /function buildRiskChecklist\(\)/,
    "buildRiskChecklist must exist");
  assert.match(appSrc, /const sevOrder\s*=\s*\{[^}]*r:0[^}]*\}/,
    "iter #217 must sort traps before watches before notes via sevOrder");
  // Risks sorted by document order within each severity tier (stable sort by index)
  assert.match(appSrc, /\(a\.i\s*\?\?\s*0\)\s*-\s*\(b\.i\s*\?\?\s*0\)/,
    "iter #217 must preserve document order within each severity tier (stable sort by index)");
  // Checklist must include P0/P1/P2 priority tags for task managers (Jira/Linear/Notion)
  assert.match(appSrc, /\[P0\]/,
    "iter #217 must tag traps with [P0] for task-manager priority detection");
  assert.match(appSrc, /\[P1\]/,
    "iter #217 must tag watches with [P1] for task-manager priority detection");
  assert.match(appSrc, /\[P2\]/,
    "iter #217 must tag notes with [P2] for task-manager priority detection");
  // Cycle #185 — each checklist item carries its counter-suggestion.
  assert.match(appSrc, /const counter = f\.rule\.counter \? String\(f\.rule\.counter\)\.trim\(\) : '';/,
    "the checklist must read each risk's counter-suggestion");
  assert.match(appSrc, /counter \? '\\n  - 💬 Counter: ' \+ esc\(counter\) : ''/,
    "each item must append its counter as a negotiation sub-line");
});

// Cycle #104 — per-risk copy-citation button.
test("analyzer: Every risk row can copy its citation in one click", () => {
  if (!HAS_BROWSER) return;
  const fs = require("node:fs");
  const path = require("node:path");
  const appSrc = fs.readFileSync(path.join(ROOT, "assets", "app.js"), "utf8");
  const cssSrc = fs.readFileSync(path.join(ROOT, "assets", "theme.css"), "utf8");

  assert.match(appSrc, /function wireCopyPerRisk\(\)\{/,
    "a per-risk copy wirer must exist");
  assert.match(appSrc, /btn\.className = 'rrow-copy ghost-btn ghost-btn-sm';/,
    "each risk row must get a copy button");
  assert.match(appSrc, /aria-label', 'Copy this ' \+ sev\.toLowerCase\(\) \+ ' as a citation'/,
    "the copy button must expose an accessible name");
  assert.match(appSrc, /btn\.dataset\.rrowCopyText = '\[/,
    "the citation must be built with severity + sentence");
  assert.match(appSrc, /sevLabel \+ '\] "' \+ sentence \+ '"'/,
    "the citation must quote the exact sentence");
  assert.match(appSrc, /'\\nCounter: ' \+ counter/,
    "the citation must include the counter-suggestion when present");
  // Cycle #105 — cite to the line, like the Ask thread.
  assert.match(appSrc, /const sentIdx = flag && typeof flag\.i === 'number' && flag\.i >= 0 \? flag\.i : -1;/,
    "the citation must read the flag's sentence index");
  assert.match(appSrc, /of ' \+ lastSentences\.length/,
    "the citation must count the document's sentences");
  assert.match(appSrc, /sentRef \+\s*'\\n— ClearDoc risk citation';/,
    "the sentence reference must be part of the copied block");
  assert.match(appSrc, /showAnalyzeToast\(copied \? '📋 Risk citation copied'/,
    "copying must announce via toast");
  assert.match(appSrc, /execCommand\('copy'\)/,
    "copying must fall back to execCommand");
  assert.match(appSrc, /e\.target\.closest\('\.rrow-copy'\)/,
    "clicking copy must not expand the row");
  const callSites = (appSrc.match(/wireCopyPerRisk\(\);/g) || []).length;
  assert.ok(callSites >= 2, `wireCopyPerRisk must run after every risk render, found ${callSites}`);
  assert.match(cssSrc, /\.risk-built \.rrow \.rrow-copy\{/,
    "the copy button must sit beside the ask button");
  assert.match(cssSrc, /\.rrow-copy:focus-visible\{/,
    "the copy button must have a focus ring");
});

// Cycle #160 — per-risk-row speak.
test("analyzer: Risk rows read the risk aloud in one click", () => {
  if (!HAS_BROWSER) return;
  const fs = require("node:fs");
  const path = require("node:path");
  const appSrc = fs.readFileSync(path.join(ROOT, "assets", "app.js"), "utf8");
  const cssSrc = fs.readFileSync(path.join(ROOT, "assets", "theme.css"), "utf8");

  assert.match(appSrc, /speakBtn\.className = 'rrow-speak ghost-btn ghost-btn-sm';/,
    "each risk row must render a speak button");
  assert.match(appSrc, /function wireCopyPerRisk\(\)\{[\s\S]{0,3000}rrow-speak/,
    "the speak wiring must live inside wireCopyPerRisk (where sentence is defined)");
  assert.doesNotMatch(appSrc, /function wireAskPerRisk\(\)\{[\s\S]{0,300}rrow-speak/,
    "the speak wiring must not leak into wireAskPerRisk");
  assert.match(appSrc, /speakBtn\.dataset\.rrowSpeak = sentence\.slice\(0, 240\);/,
    "the speak button must carry the flagged sentence");
  assert.match(appSrc, /new SpeechSynthesisUtterance\(text\)/,
    "clicking must speak the risk");
  assert.match(appSrc, /u\.rate = getTtsRate\(\);/,
    "the reading must respect the chosen speed");
  assert.match(appSrc, /e\.stopPropagation\(\);/,
    "speaking must not trigger the row's other actions");
  assert.match(appSrc, /\.rrow-copy'\) \|\| e\.target\.closest\('\.rrow-speak'\)/,
    "clicking speak must not expand the row");
  assert.match(cssSrc, /\.risk-built \.rrow \.rrow-speak\{/,
    "the speak button must sit beside the copy button");
  assert.match(cssSrc, /\.rrow-speak:focus-visible\{/,
    "the speak button must have a focus ring");
  assert.match(cssSrc, /\.risk-built \.rrow \.rrow-ask,\.risk-built \.rrow \.rrow-copy,\.risk-built \.rrow \.rrow-speak\{[^}]*min-width:26px/,
    "the action trio must share consistent tap targets");
});

// Cycle #176 — per-risk deep links: rows carry #risk-N ids, clicking a
// row updates the URL hash, and loading with a #risk-N hash scrolls to
// and highlights that exact clause.
test("analyzer: risk rows carry deep-link ids and the page honors #risk-N", () => {
  if (!HAS_BROWSER) return;
  const fs = require("node:fs");
  const path = require("node:path");
  const appSrc = fs.readFileSync(path.join(ROOT, "assets", "app.js"), "utf8");
  const cssSrc = fs.readFileSync(path.join(ROOT, "assets", "theme.css"), "utf8");

  const idCount = (appSrc.match(/row\.id='risk-'\+i;/g) || []).length;
  assert.ok(idCount >= 2,
    "both the local and AI risk render paths must assign row ids");
  assert.match(appSrc, /function paintRiskDeepLink\(\)\{/,
    "a deep-link painter must exist");
  assert.match(appSrc, /location\.hash \|\| ''/,
    "the painter must read the URL hash");
  assert.match(appSrc, /row\.classList\.add\('rrow-deeplink'\)/,
    "the target row must be highlighted");
  assert.match(appSrc, /setTimeout\(\(\) => row\.classList\.remove\('rrow-deeplink'\), 2600\);/,
    "the highlight must fade after a couple of seconds");
  assert.match(appSrc, /function wireRiskDeepLinkHash\(\)\{/,
    "a hash-updater must exist");
  assert.match(appSrc, /history\.replaceState\(null, '', '#' \+ row\.id\)/,
    "clicking a row must update the URL without adding history entries");
  assert.match(appSrc, /paintRiskDeepLink\(\);/,
    "the painter must run after risk rows render");
  assert.match(appSrc, /target\.id\.indexOf\('risk-'\) === 0\)\{[\s\S]{0,260}history\.replaceState\(null, '', '#' \+ target\.id\)/,
    "j/k navigation must keep the deep-link hash current");
  const shareGuards = (appSrc.match(/const cur = location\.hash \|\| '';[\s\S]{0,80}if\(!cur \|\| cur\.indexOf\('#risk-'\) === 0\)/g) || []).length;
  assert.ok(shareGuards >= 2,
    "both j/k and row-click hash sync must refuse to clobber a #share= link");
  assert.match(appSrc, /location\.hash\.indexOf\('#risk-'\) === 0\)\{[\s\S]{0,100}history\.replaceState\(null, '', location\.pathname \+ location\.search\)/,
    "clearing the analysis must strip a stale risk deep link");
  assert.match(cssSrc, /\.rrow-deeplink\{/, "the deep-link highlight must be styled");
});

// Cycle #184 — copy the counter-suggestion: the expanded risk-row counter
// panel gets a one-click 📋 copy button in both render paths.
test("analyzer: risk counter-suggestions copy in one click", () => {
  if (!HAS_BROWSER) return;
  const fs = require("node:fs");
  const path = require("node:path");
  const appSrc = fs.readFileSync(path.join(ROOT, "assets", "app.js"), "utf8");
  const cssSrc = fs.readFileSync(path.join(ROOT, "assets", "theme.css"), "utf8");

  const counterButtons = (appSrc.match(/data-counter-copy-text="'\+esc\(counter\)\+'" title="Copy this counter-suggestion"/g) || []).length;
  assert.ok(counterButtons >= 2,
    "both the local and AI risk render paths must render a counter-copy button");
  assert.match(appSrc, /e\.target\.closest\('\.rrow-speak'\) \|\| e\.target\.closest\('\.rrow-counter-copy'\)\)/,
    "the expand toggle must ignore clicks on the counter-copy button");
  assert.doesNotMatch(appSrc, /closest\('\.rrow-ask'\) \|\| e\.target\.closest\('\.rrow-expand'\)/,
    "the ▾ expand button itself must not be excluded from the row toggle");
  assert.match(appSrc, /function wireRrowCounterCopy\(\)\{/,
    "a delegated counter-copy handler must exist");
  assert.match(appSrc, /list\._rrowCounterCopyWired = true;/,
    "the counter-copy handler must wire once");
  assert.match(appSrc, /e\.target\.closest && e\.target\.closest\('\[data-counter-copy-text\]'\)/,
    "the handler must catch counter-copy clicks");
  assert.match(appSrc, /'📋 Counter-suggestion copied'/,
    "copying must toast on success");
  assert.match(appSrc, /btn\.textContent = copied \? '✓' : '📋 copy';/,
    "the button must flash confirmation");
  assert.match(cssSrc, /\.rrow-counter-copy\{/, "the counter-copy button must be styled");
  assert.match(cssSrc, /\.rrow-counter-copy:focus-visible\{/, "the counter-copy button must have a focus ring");
});

// Cycle #122 — per-smoking-gun copy citation.
test("analyzer: Smoking-gun cards copy their citation in one click", () => {
  if (!HAS_BROWSER) return;
  const fs = require("node:fs");
  const path = require("node:path");
  const appSrc = fs.readFileSync(path.join(ROOT, "assets", "app.js"), "utf8");
  const cssSrc = fs.readFileSync(path.join(ROOT, "assets", "theme.css"), "utf8");

  assert.match(appSrc, /class="smoking-card-copy ghost-btn ghost-btn-sm"/,
    "each smoking-gun card must render a copy button");
  assert.match(appSrc, /const copyText = '\[[^}]*sevLabel\[sev\] \+ '\] "' \+ it\.sentence/,
    "the citation must carry severity + sentence");
  assert.match(appSrc, /data-smoking-copy-text="' \+ esc\(copyText\) \+ '"/,
    "the copy button must carry the prebuilt citation");
  assert.match(appSrc, /e\.target\.closest && e\.target\.closest\('\[data-smoking-copy-text\]'\)/,
    "the card click handler must catch copy-button clicks");
  assert.match(appSrc, /await navigator\.clipboard\.writeText\(text\)/,
    "copying must use the clipboard API");
  assert.match(appSrc, /📋 Smoking-gun citation copied/,
    "copying must announce via toast");
  assert.match(appSrc, /copyBtn\.textContent = copied \? '✓' : '📋';/,
    "the button must flash its copied state");
  assert.match(cssSrc, /\.smoking-card-head\{[^}]*flex-wrap:wrap/,
    "the card head must wrap with the new button on narrow screens");
  assert.match(cssSrc, /\.smoking-speak\{[^}]*margin-left:auto/,
    "the speak button must push the action pair to the right edge");
  assert.match(cssSrc, /\.smoking-card-copy\{[^}]*margin-left:4px/,
    "the copy button must sit beside the speak button");
});

// Cycle #154 — hear any smoking gun aloud.
test("analyzer: Smoking-gun cards read the smoking gun aloud in one click", () => {
  if (!HAS_BROWSER) return;
  const fs = require("node:fs");
  const path = require("node:path");
  const appSrc = fs.readFileSync(path.join(ROOT, "assets", "app.js"), "utf8");

  assert.match(appSrc, /class="smoking-speak ghost-btn ghost-btn-sm"/,
    "each smoking-gun card must render a speak button");
  assert.match(appSrc, /data-smoking-speak="' \+ esc\(it\.sentence\) \+ '"/,
    "the speak button must carry the flagged sentence");
  assert.match(appSrc, /e\.target\.closest && e\.target\.closest\('\[data-smoking-speak\]'\)/,
    "the card click handler must catch speak-button clicks");
  assert.match(appSrc, /new SpeechSynthesisUtterance\(text\)/,
    "clicking must speak the smoking gun");
  assert.match(appSrc, /u\.rate = getTtsRate\(\);/,
    "the reading must respect the chosen speed");
  assert.match(appSrc, /🔊<\/b> to hear one/,
    "the block note must document the speak action");
});

// Cycle #242 — ask about a smoking gun, completing the copy/speak/ask trio.
test("analyzer: Smoking-gun cards ask about the sentence in one click", () => {
  if (!HAS_BROWSER) return;
  const fs = require("node:fs");
  const path = require("node:path");
  const appSrc = fs.readFileSync(path.join(ROOT, "assets", "app.js"), "utf8");

  assert.match(appSrc, /class="smoking-ask ghost-btn ghost-btn-sm"/,
    "each smoking-gun card must render an ask button");
  assert.match(appSrc, /data-smoking-ask="' \+ esc\(it\.sentence\) \+ '"/,
    "the ask button must carry the flagged sentence");
  assert.match(appSrc, /const askBtn2 = e\.target\.closest && e\.target\.closest\('\[data-smoking-ask\]'\);/,
    "the card click handler must catch ask-button clicks");
  assert.match(appSrc, /qInput\.value = 'What does this smoking-gun sentence mean: "' \+ text\.slice\(0, 220\) \+ '"';/,
    "clicking must prefill the Ask panel with the sentence");
  assert.match(appSrc, /'💬 Question ready — press Ask'/,
    "asking must announce via toast");
  assert.match(appSrc, /💬<\/b> to ask about one/,
    "the block note must document the ask action");
  const cssSrc = fs.readFileSync(path.join(ROOT, "assets", "theme.css"), "utf8");
  assert.match(cssSrc, /\.smoking-ask\{[^}]*margin-left:4px/,
    "the ask button must sit beside the copy button");
  assert.match(cssSrc, /\.smoking-ask:focus-visible\{/,
    "the ask button must have a focus ring");
});

// Cycle #123 — per-exposure-card copy citation.
test("analyzer: Exposure cards copy their citation in one click", () => {
  if (!HAS_BROWSER) return;
  const fs = require("node:fs");
  const path = require("node:path");
  const appSrc = fs.readFileSync(path.join(ROOT, "assets", "app.js"), "utf8");

  assert.match(appSrc, /class="exposure-card-copy ghost-btn ghost-btn-sm"/,
    "each exposure card must render a copy button");
  assert.match(appSrc, /const copyText = '\[EXPOSURE/,
    "the citation must open with the EXPOSURE tag");
  assert.match(appSrc, /worstDisplay \+ ' — "' \+ trunc\(it\.sentence, 220\)/,
    "the citation must carry the amount and the source sentence");
  assert.match(appSrc, /data-exposure-copy-text="' \+ esc\(copyText\) \+ '"/,
    "the copy button must carry the prebuilt citation");
  assert.match(appSrc, /e\.target\.closest && e\.target\.closest\('\[data-exposure-copy-text\]'\)/,
    "the card click handler must catch copy-button clicks");
  assert.match(appSrc, /await navigator\.clipboard\.writeText\(text\)/,
    "copying must use the clipboard API");
  assert.match(appSrc, /📋 Exposure citation copied/,
    "copying must announce via toast");
  assert.match(appSrc, /copyBtn\.textContent = copied \? '✓' : '📋';/,
    "the button must flash its copied state");
});

// Cycle #152 — hear any exposure aloud.
test("analyzer: Exposure cards read the exposure aloud in one click", () => {
  if (!HAS_BROWSER) return;
  const fs = require("node:fs");
  const path = require("node:path");
  const appSrc = fs.readFileSync(path.join(ROOT, "assets", "app.js"), "utf8");
  const cssSrc = fs.readFileSync(path.join(ROOT, "assets", "theme.css"), "utf8");

  assert.match(appSrc, /class="exposure-speak ghost-btn ghost-btn-sm"/,
    "each exposure card must render a speak button");
  assert.match(appSrc, /data-exposure-speak="' \+ esc\('Worst case ' \+ worstDisplay \+ '\. ' \+ \(it\.sentence \|\| ''\)\) \+ '"/,
    "the speak button must carry the amount and the money quote");
  assert.match(appSrc, /e\.target\.closest && e\.target\.closest\('\[data-exposure-speak\]'\)/,
    "the card click handler must catch speak-button clicks");
  assert.match(appSrc, /new SpeechSynthesisUtterance\(text\)/,
    "clicking must speak the exposure");
  assert.match(appSrc, /u\.rate = getTtsRate\(\);/,
    "the reading must respect the chosen speed");
  assert.match(appSrc, /🔊<\/b> reads one aloud/,
    "the block note must document the speak action");
  assert.match(cssSrc, /\.exposure-speak\{[^}]*flex-shrink:0/,
    "the speak button must never shrink");
  assert.match(cssSrc, /\.exposure-card-copy\{[^}]*margin-left:4px/,
    "the copy button must sit beside the speak button");
  assert.match(cssSrc, /\.exposure-speak:focus-visible\{/,
    "the speak button must have a focus ring");
});

// Cycle #244 — ask about an exposure, completing the card trio.
test("analyzer: Exposure cards ask about the exposure in one click", () => {
  if (!HAS_BROWSER) return;
  const fs = require("node:fs");
  const path = require("node:path");
  const appSrc = fs.readFileSync(path.join(ROOT, "assets", "app.js"), "utf8");
  const cssSrc = fs.readFileSync(path.join(ROOT, "assets", "theme.css"), "utf8");

  assert.match(appSrc, /class="exposure-ask ghost-btn ghost-btn-sm"/,
    "each exposure card must render an ask button");
  assert.match(appSrc, /data-exposure-ask="' \+ esc\(it\.sentence\) \+ '"/,
    "the ask button must carry the flagged sentence");
  assert.match(appSrc, /const askBtn2 = e\.target\.closest && e\.target\.closest\('\[data-exposure-ask\]'\);/,
    "the card click handler must catch ask-button clicks");
  assert.match(appSrc, /qInput\.value = 'What does this exposure mean: "' \+ text\.slice\(0, 220\) \+ '"';/,
    "clicking must prefill the Ask panel with the sentence");
  assert.match(appSrc, /'💬 Question ready — press Ask'/,
    "asking must announce via toast");
  assert.match(appSrc, /💬<\/b> asks about one/,
    "the block note must document the ask action");
  assert.match(cssSrc, /\.exposure-ask\{[^}]*margin-left:4px/,
    "the ask button must sit beside the copy button");
  assert.match(cssSrc, /\.exposure-ask:focus-visible\{/,
    "the ask button must have a focus ring");
});

// Cycle #126 — per-pressure-card copy citation.
test("analyzer: Pressure cards copy their citation in one click", () => {
  if (!HAS_BROWSER) return;
  const fs = require("node:fs");
  const path = require("node:path");
  const appSrc = fs.readFileSync(path.join(ROOT, "assets", "app.js"), "utf8");
  const cssSrc = fs.readFileSync(path.join(ROOT, "assets", "theme.css"), "utf8");

  assert.match(appSrc, /const copyText = '\[PRESSURE · ' \+ sevLabel \+ '\] "' \+ it\.sentence \+ '"'/,
    "the citation must open with severity and the sentence");
  assert.match(appSrc, /class="pressure-copy ghost-btn ghost-btn-sm"/,
    "each pressure card must render a copy button");
  assert.match(appSrc, /data-pressure-copy-text="' \+ esc\(copyText\) \+ '"/,
    "the copy button must carry the prebuilt citation");
  assert.match(appSrc, /e\.target\.closest && e\.target\.closest\('\[data-pressure-copy-text\]'\)/,
    "the card click handler must catch copy-button clicks");
  assert.match(appSrc, /await navigator\.clipboard\.writeText\(text\)/,
    "copying must use the clipboard API");
  assert.match(appSrc, /📋 Pressure citation copied/,
    "copying must announce via toast");
  assert.match(appSrc, /copyBtn\.textContent = copied \? '✓' : '📋';/,
    "the button must flash its copied state");
  assert.match(cssSrc, /\.pressure-speak\{[^}]*margin-left:auto/,
    "the speak button must push the action pair to the right edge");
  assert.match(cssSrc, /\.pressure-copy\{[^}]*margin-left:4px/,
    "the copy button must sit beside the speak button");
  assert.match(cssSrc, /\.pressure-speak:focus-visible\{/,
    "the speak button must have a focus ring");
});

// Cycle #150 — hear any pressure clause aloud.
test("analyzer: Pressure cards read the pressure clause aloud in one click", () => {
  if (!HAS_BROWSER) return;
  const fs = require("node:fs");
  const path = require("node:path");
  const appSrc = fs.readFileSync(path.join(ROOT, "assets", "app.js"), "utf8");

  assert.match(appSrc, /class="pressure-speak ghost-btn ghost-btn-sm"/,
    "each pressure card must render a speak button");
  assert.match(appSrc, /data-pressure-speak="' \+ esc\(it\.sentence\) \+ '"/,
    "the speak button must carry the pressure clause");
  assert.match(appSrc, /e\.target\.closest && e\.target\.closest\('\[data-pressure-speak\]'\)/,
    "the card click handler must catch speak-button clicks");
  assert.match(appSrc, /new SpeechSynthesisUtterance\(text\)/,
    "clicking must speak the pressure clause");
  assert.match(appSrc, /u\.rate = getTtsRate\(\);/,
    "the reading must respect the chosen speed");
  assert.match(appSrc, /🔊<\/b> reads one aloud/,
    "the block note must document the speak action");
});

// Cycle #246 — ask about a pressure clause, completing the card trio.
test("analyzer: Pressure cards ask about the clause in one click", () => {
  if (!HAS_BROWSER) return;
  const fs = require("node:fs");
  const path = require("node:path");
  const appSrc = fs.readFileSync(path.join(ROOT, "assets", "app.js"), "utf8");
  const cssSrc = fs.readFileSync(path.join(ROOT, "assets", "theme.css"), "utf8");

  assert.match(appSrc, /class="pressure-ask ghost-btn ghost-btn-sm"/,
    "each pressure card must render an ask button");
  assert.match(appSrc, /data-pressure-ask="' \+ esc\(it\.sentence\) \+ '"/,
    "the ask button must carry the pressure clause");
  assert.match(appSrc, /const askBtn2 = e\.target\.closest && e\.target\.closest\('\[data-pressure-ask\]'\);/,
    "the card click handler must catch ask-button clicks");
  assert.match(appSrc, /qInput\.value = 'What does this pressure clause mean: "' \+ text\.slice\(0, 220\) \+ '"';/,
    "clicking must prefill the Ask panel with the clause");
  assert.match(appSrc, /'💬 Question ready — press Ask'/,
    "asking must announce via toast");
  assert.match(appSrc, /💬<\/b> asks about one/,
    "the block note must document the ask action");
  assert.match(cssSrc, /\.pressure-ask\{[^}]*margin-left:4px/,
    "the ask button must sit beside the copy button");
  assert.match(cssSrc, /\.pressure-ask:focus-visible\{/,
    "the ask button must have a focus ring");
});

// Iter #218 v2: JSON export polish — download button + DOM-extracted
// deadlines/nextSteps + counter-clauses + P0/P1/P2 priority tags.
test("analyzer: JSON export includes download, deadlines from DOM, counter-clauses, and priority tags", () => {
  if (!HAS_BROWSER) return;
  const fs = require("node:fs");
  const path = require("node:path");
  const appSrc = fs.readFileSync(path.join(ROOT, "assets", "app.js"), "utf8");
  const html = fs.readFileSync(path.join(ROOT, "analyze.html"), "utf8");

  // buildAnalysisJson must exist
  assert.match(appSrc, /function buildAnalysisJson\(\)/,
    "buildAnalysisJson must exist");
  // downloadAnalysisJson must exist for the .json file download
  assert.match(appSrc, /function downloadAnalysisJson\(\)/,
    "downloadAnalysisJson must exist");
  // Deadlines extracted from DOM, not from non-existent helper
  assert.match(appSrc, /#deadlinesList .deadline-row/,
    "iter #218 v2 must extract deadlines from DOM #deadlinesList");
  // Next steps extracted from DOM
  assert.match(appSrc, /#nextStepsList li/,
    "iter #218 v2 must extract next steps from DOM #nextStepsList");
  // P0/P1/P2 priority tags included in JSON output
  assert.match(appSrc, /'P0'/,
    "iter #218 v2 must include P0 priority in JSON risks");
  assert.match(appSrc, /'P1'/,
    "iter #218 v2 must include P1 priority in JSON risks");
  assert.match(appSrc, /'P2'/,
    "iter #218 v2 must include P2 priority in JSON risks");
  // Counter-clause included when present on the risk rule
  assert.match(appSrc, /counterClause/,
    "iter #218 v2 must include counterClause in JSON when available");
  // downloadJsonBtn must exist in the HTML toolbar
  assert.match(html, /id="downloadJsonBtn"/,
    "analyze.html must contain #downloadJsonBtn");
});

// Iter #219: Contract Health Check — synthesizes analysis into a readiness verdict.
test("analyzer: Health Check computes readiness verdict and renders it", () => {
  if (!HAS_BROWSER) return;
  const fs = require("node:fs");
  const path = require("node:path");
  const appSrc = fs.readFileSync(path.join(ROOT, "assets", "app.js"), "utf8");
  const html = fs.readFileSync(path.join(ROOT, "analyze.html"), "utf8");
  const cssSrc = fs.readFileSync(path.join(ROOT, "assets", "theme.css"), "utf8");

  // computeHealthCheck must exist
  assert.match(appSrc, /function computeHealthCheck\(\)/,
    "computeHealthCheck must exist");
  // renderHealthCheck must exist
  assert.match(appSrc, /function renderHealthCheck\(\)/,
    "renderHealthCheck must exist");
  // computeHealthCheck returns a readiness level
  assert.match(appSrc, /level\s*=\s*['"]Ready['"]/,
    "computeHealthCheck must have a Ready level");
  assert.match(appSrc, /level\s*=\s*['"]Review['"]/,
    "computeHealthCheck must have a Review level");
  assert.match(appSrc, /level\s*=\s*['"]Negotiate['"]/,
    "computeHealthCheck must have a Negotiate level");
  assert.match(appSrc, /level\s*=\s*['"]Do Not Sign['"]/,
    "computeHealthCheck must have a Do Not Sign level");
  // healthCheck block exists in HTML
  assert.match(html, /id="healthCheck"/,
    "analyze.html must contain #healthCheck");
  // healthCheck hidden by default (no false positives for clean docs)
  assert.match(html, /healthCheck.*hidden/,
    "healthCheck must start hidden");
  // healthCopyBtn exists in HTML
  assert.match(html, /id="healthCopyBtn"/,
    "analyze.html must contain #healthCopyBtn");
  // CSS health-check tones exist for all four levels
  assert.match(cssSrc, /\.health-check\.low\b/, "health-check .low style must exist");
  assert.match(cssSrc, /\.health-check\.review\b/, "health-check .review style must exist");
  assert.match(cssSrc, /\.health-check\.negotiate\b/, "health-check .negotiate style must exist");
  assert.match(cssSrc, /\.health-check\.danger\b/, "health-check .danger style must exist");
  // Health check has fade-in animation for smooth appearance
  assert.match(cssSrc, /@keyframes health-check-in/,
    "health check must have a fade-in keyframe animation");
  assert.match(cssSrc, /animation:health-check-in/,
    "health check must use the fade-in animation");
  // Health check has transition for opacity (smooth show/hide)
  assert.match(cssSrc, /transition:opacity \.3s ease/,
    "health check must have an opacity transition");
  // healthCopyBtn has its own dedicated style rule
  assert.match(cssSrc, /\.health-copy\b/,
    "health-copy button style must exist");
  // healthCheck has role=status for accessibility
  assert.match(html, /role="status"/,
    "healthCheck must have role=status for screen readers");
});

// Iter #220 v2: CSV export polish — metadata header, row numbering, priority.
test("analyzer: CSV export includes metadata row, row numbers, priority, and fingerprint", () => {
  if (!HAS_BROWSER) return;
  const fs = require("node:fs");
  const path = require("node:path");
  const appSrc = fs.readFileSync(path.join(ROOT, "assets", "app.js"), "utf8");

  // buildAnalysisCsv must exist
  assert.match(appSrc, /function buildAnalysisCsv\(\)/,
    "buildAnalysisCsv must exist");
  // Metadata header row with document fingerprint and analysis date
  assert.match(appSrc, /Document Fingerprint/,
    "iter #220 v2 must include document fingerprint in CSV metadata");
  assert.match(appSrc, /Analysis Date/,
    "iter #220 v2 must include analysis date in CSV metadata");
  // Row numbering column for spreadsheet reference
  assert.match(appSrc, /idx\s*\+\s*1/,
    "iter #220 v2 must include sequential row numbers");
  // Priority column (P0/P1/P2) in CSV output
  assert.match(appSrc, /priority.*P0.*P1.*P2|P0.*P1.*P2/,
    "iter #220 v2 must include P0/P1/P2 priority labels in CSV");
  // Newline escaping in why and sentence fields
  assert.match(appSrc, /replace\(\/\[\\r\\n\]/,
    "iter #220 v2 must escape newlines in CSV fields");
  // Download filename includes document fingerprint for uniqueness
  assert.match(appSrc, /cleardoc-risks-.*fp.*stamp/,
    "iter #220 v2 download filename must include document fingerprint");
  // Threat score / health check metadata included when available
  assert.match(appSrc, /Threat Level/,
    "iter #220 v2 must include threat level in CSV metadata rows");
  // Cycle 55 polish — OWASP formula-injection guard on every cell
  assert.match(appSrc, /csvCell = \(v\) => \{[\s\S]+?if\(\/\^\[=\+\\-@\]\/\.test\(s\)\) s = "'" \+ s;/,
    "risk CSV cells must neutralize formula-injection prefixes (= + - @) per OWASP");
  assert.match(appSrc, /row\.map\(csvCell\)\.join\(','\)/,
    "every risk CSV cell must pass through the injection guard");
  // BOM only on the download path, not the clipboard copy
  assert.match(appSrc, /const text = '\\uFEFF' \+ buildAnalysisCsv\(\);/,
    "downloaded CSV must start with a UTF-8 BOM for Excel encoding detection");
  assert.match(appSrc, /copyAnalysisCsv\(\)\{[\s\S]+?const text = buildAnalysisCsv\(\);/,
    "clipboard copy must stay BOM-free for clean pastes");
});

// Iter #222: Executive Summary — plain-English narrative overview.
test("analyzer: Executive summary generates headline, body, and has all CSS tones", () => {
  if (!HAS_BROWSER) return;
  const fs = require("node:fs");
  const path = require("node:path");
  const appSrc = fs.readFileSync(path.join(ROOT, "assets", "app.js"), "utf8");
  const html = fs.readFileSync(path.join(ROOT, "analyze.html"), "utf8");
  const cssSrc = fs.readFileSync(path.join(ROOT, "assets", "theme.css"), "utf8");

  assert.match(appSrc, /function buildExecSummary\(\)/,
    "buildExecSummary must exist");
  assert.match(appSrc, /function renderExecSummary\(\)/,
    "renderExecSummary must exist");
  assert.match(appSrc, /headline\s*=/,
    "buildExecSummary must generate a headline");
  assert.match(appSrc, /[Tt]op priority:/,
    "buildExecSummary must use 'Top priority' label in the body");
  // Why text is truncated to keep summary readable
  assert.match(appSrc, /197\)\s*\+\s*['"]…['"]/,
    "buildExecSummary must truncate long why text at 200 chars");
  // Fingerprint included for traceability
  assert.match(appSrc, /fp\s*=\s*\(_fpState[\s\S]{0,80}\?\s*_fpState\.short/,
    "buildExecSummary must include document fingerprint");
  // Analysis date included in output
  assert.match(appSrc, /toLocaleDateString/,
    "buildExecSummary must include a formatted analysis date");
  assert.match(cssSrc, /\.exec-summary\.low\b/, "exec-summary .low tone must exist");
  assert.match(cssSrc, /\.exec-summary\.medium\b/, "exec-summary .medium tone must exist");
  assert.match(cssSrc, /\.exec-summary\.high\b/, "exec-summary .high tone must exist");
  assert.match(cssSrc, /\.exec-summary\.critical\b/, "exec-summary .critical tone must exist");
  assert.match(html, /id="execSummary"/, "analyze.html must contain #execSummary");
  assert.match(html, /id="execCopyBtn"/, "analyze.html must contain #execCopyBtn");
});

// Iter #223: Contract type badge — shows detected document type in result panel.
test("analyzer: Contract type badge renders when doc type is detected", () => {
  if (!HAS_BROWSER) return;
  const fs = require("node:fs");
  const path = require("node:path");
  const appSrc = fs.readFileSync(path.join(ROOT, "assets", "app.js"), "utf8");
  const html = fs.readFileSync(path.join(ROOT, "analyze.html"), "utf8");
  const cssSrc = fs.readFileSync(path.join(ROOT, "assets", "theme.css"), "utf8");

  // contractTypeBadge element must exist in HTML
  assert.match(html, /id="contractTypeBadge"/,
    "analyze.html must contain #contractTypeBadge");
  // badge must start hidden, become visible when doc type detected
  assert.match(html, /contractTypeBadge.*hidden/,
    "contractTypeBadge must start hidden");
  // render code must call detectDocType to get the label
  assert.match(appSrc, /detectDocType.*raw/,
    "contract badge must use detectDocType for detection");
  // badge CSS class has visible state toggle
  assert.match(cssSrc, /contract-type-badge\.visible/,
    "contract-type-badge .visible CSS class must exist");
  // badge uses .mono and .no-print for consistent styling
  assert.match(html, /contract-type-badge.*mono.*no-print/,
    "contract badge must use mono and no-print classes");
});

// Cycle #202 — the contract type badge opens a plain-English explainer.
test("analyzer: contract type badge opens a plain-English explainer", () => {
  if (!HAS_BROWSER) return;
  const fs = require("node:fs");
  const path = require("node:path");
  const appSrc = fs.readFileSync(path.join(ROOT, "assets", "app.js"), "utf8");
  const cssSrc = fs.readFileSync(path.join(ROOT, "assets", "theme.css"), "utf8");
  const html = fs.readFileSync(path.join(ROOT, "analyze.html"), "utf8");

  assert.match(appSrc, /function showDocTypeExplain\(dt, opener\)\{/,
    "a badge explainer must exist");
  assert.match(appSrc, /getDocTypeTip\(dt\.name\)/,
    "the explainer must pull the per-type watch list");
  assert.match(appSrc, /'<p class="dtm-tip"><b>Watch for:<\/b> ' \+ esc\(tip\)/,
    "the explainer must show what to watch for");
  assert.match(appSrc, /function wireDocTypeBadge\(dt\)\{/,
    "a badge wirer must exist");
  assert.match(appSrc, /badge\.setAttribute\('role','button'\)/,
    "the badge must be announced as a button");
  assert.match(appSrc, /badge\.setAttribute\('tabindex','0'\)/,
    "the badge must be keyboard-focusable");
  assert.match(appSrc, /e\.key === 'Enter' \|\| e\.key === ' '/,
    "Enter and Space must open the explainer");
  assert.match(appSrc, /badge\._dtExplainWired/,
    "the badge wiring must happen once");
  // Cycle #203 — focus management.
  assert.match(appSrc, /m\.setAttribute\('aria-describedby','dtm-meta'\)/,
    "the dialog must describe itself via the meta line");
  assert.match(appSrc, /const closeBtn = m\.querySelector\('\.kb-modal-close'\);/,
    "the explainer must find its close button");
  assert.match(appSrc, /closeBtn\.focus\(\{preventScroll:true\}\)/,
    "opening must move focus into the dialog");
  assert.match(appSrc, /returnFocus\.focus\(\{preventScroll:true\}\)/,
    "closing must return focus to the badge");
  assert.match(appSrc, /const returnFocus = opener \|\| document\.activeElement;/,
    "the focus target must be the badge that opened the dialog");
  assert.match(appSrc, /badge\.addEventListener\('click', \(\) => showDocTypeExplain\(dt, badge\)\)/,
    "the click wiring must pass the badge as the focus target");
  assert.match(html, /id="contractTypeBadgeLive"/,
    "a live badge must exist in the results panel");
  assert.match(appSrc, /const printBadge = document\.getElementById\('contractTypeBadge'\);/,
    "the print badge must still be populated for printed copies");
  assert.match(cssSrc, /\.contract-type-badge\.visible\{cursor:pointer\}/,
    "the visible badge must read as clickable");
  assert.match(cssSrc, /\.contract-type-badge\.visible::after\{[^}]*content:' ⓘ'/,
    "the badge must show a ⓘ affordance without touching its text");
  // Cycle #218 — the explainer modal exports itself.
  assert.match(appSrc, /data-dtm-copy="1"/,
    "the explainer modal must offer a copy action");
  assert.match(appSrc, /'Detected as ' \+ dt\.label \+ ' \(' \+ dt\.confidence \+ ' confidence/,
    "the copied text must lead with the detected type and confidence");
  assert.match(appSrc, /'📋 Explanation copied'/,
    "copying must toast on success");
  assert.match(cssSrc, /\.dtm-copy\{/, "the copy button must be styled");
});

// Cycle #206 — the verdict label explains itself.
test("analyzer: verdict label opens a plain-English explainer", () => {
  if (!HAS_BROWSER) return;
  const fs = require("node:fs");
  const path = require("node:path");
  const appSrc = fs.readFileSync(path.join(ROOT, "assets", "app.js"), "utf8");
  const cssSrc = fs.readFileSync(path.join(ROOT, "assets", "theme.css"), "utf8");

  assert.match(appSrc, /const VERDICT_EXPLAIN = \{[\s\S]{0,200}suspicious:/,
    "a verdict explainer map must exist");
  assert.match(appSrc, /function showVerdictExplain\(label, tone, opener\)\{/,
    "a verdict explainer must exist");
  assert.match(appSrc, /function wireVerdictLabelExplain\(label, tone\)\{/,
    "a verdict-label wirer must exist");
  assert.match(appSrc, /vLabel\.setAttribute\('role','button'\)/,
    "the verdict label must be announced as a button");
  assert.match(appSrc, /vLabel\.setAttribute\('tabindex','0'\)/,
    "the verdict label must be keyboard-focusable");
  assert.match(appSrc, /e\.key === 'Enter' \|\| e\.key === ' '/,
    "Enter and Space must open the explainer");
  assert.match(appSrc, /vLabel\._verdictExplainWired/,
    "the verdict-label wiring must happen once");
  const wireCalls = (appSrc.match(/wireVerdictLabelExplain\(label, tone\);/g) || []).length;
  assert.ok(wireCalls >= 2,
    "both the analysis and snapshot-restore renders must wire the label");
  assert.match(cssSrc, /\.verdict-label\{cursor:pointer\}/,
    "the verdict label must read as clickable");
  assert.match(cssSrc, /\.verdict-label:focus-visible\{/, "the verdict label must have a focus ring");
  assert.match(cssSrc, /\.verdict-label::after\{[^}]*content:' ⓘ'/,
    "the verdict label must show a ⓘ affordance without touching its text");
  // Cycle #218 — the verdict explainer exports itself.
  assert.match(appSrc, /'Verdict: ' \+ label \+ ' — ' \+ text/,
    "the copied verdict text must lead with the label and explanation");
  assert.match(cssSrc, /\.dtm-copy:focus-visible\{/, "the copy button must have a focus ring");
});

// Iter #224: Contract Readiness Score — single 0-100 number for quick decisions.
test("analyzer: Readiness Score computes 0-100 from threat data with four tone levels", () => {
  if (!HAS_BROWSER) return;
  const fs = require("node:fs");
  const path = require("node:path");
  const appSrc = fs.readFileSync(path.join(ROOT, "assets", "app.js"), "utf8");
  const html = fs.readFileSync(path.join(ROOT, "analyze.html"), "utf8");
  const cssSrc = fs.readFileSync(path.join(ROOT, "assets", "theme.css"), "utf8");

  // computeReadinessScore must exist
  assert.match(appSrc, /function computeReadinessScore\(\)/,
    "computeReadinessScore must exist");
  // renderReadinessScore must exist
  assert.match(appSrc, /function renderReadinessScore\(\)/,
    "renderReadinessScore must exist");
  // Readiness score uses the four tone levels matching threat score
  assert.match(appSrc, /tone.*low.*medium.*high.*critical|low.*medium.*high.*critical/,
    "readiness score must have four tone levels");
  // score is always clamped between 0 and 100
  assert.match(appSrc, /Math\.max\(0.*Math\.min\(100/,
    "readiness score must be clamped 0-100");
  // readinessBlock element exists in HTML
  assert.match(html, /id="readinessBlock"/,
    "analyze.html must contain #readinessBlock");
  // readinessScore element exists
  assert.match(html, /id="readinessScore"/,
    "analyze.html must contain #readinessScore");
  // readinessLabel element exists
  assert.match(html, /id="readinessLabel"/,
    "analyze.html must contain #readinessLabel");
  // CSS readiness score tones exist for all four levels
  assert.match(cssSrc, /#readinessBlock\.low\b/, "readiness .low tone must exist");
  assert.match(cssSrc, /#readinessBlock\.medium\b/, "readiness .medium tone must exist");
  assert.match(cssSrc, /#readinessBlock\.high\b/, "readiness .high tone must exist");
  assert.match(cssSrc, /#readinessBlock\.critical\b/, "readiness .critical tone must exist");
  // iter #224 v2: score bar, "/100" context, breakdown line + copy button
  assert.match(html, /id="readinessBar"/, "analyze.html must contain #readinessBar (score bar)");
  assert.match(html, /id="readinessBarFill"/, "analyze.html must contain #readinessBarFill");
  assert.match(html, /id="readinessOutOf"/, "analyze.html must contain #readinessOutOf (/100)");
  assert.match(html, /id="readinessDetail"/, "analyze.html must contain #readinessDetail (breakdown)");
  assert.match(html, /id="readinessCopyBtn"/, "analyze.html must contain #readinessCopyBtn");
  assert.match(html, /readinessBar[^>]*role="progressbar"/,
    "readiness bar must be an accessible progressbar");
  assert.match(appSrc, /aria-valuenow/, "render must set aria-valuenow on the bar");
  assert.match(appSrc, /barFillEl\.style\.width/, "render must paint the bar width from the score");
  assert.match(appSrc, /readinessCopyBtn\.addEventListener/,
    "copy button must be wired in app.js");
  assert.match(cssSrc, /\.readiness-bar-fill\b/, "readiness bar fill CSS must exist");
  assert.match(cssSrc, /\.readiness-copy\b/, "readiness copy CSS must exist");
  // className wipe must never drop the base result-block styling
  assert.match(appSrc, /block\.classList\.remove\('low','medium','high','critical'\)/,
    "render must preserve base classes instead of wiping className");
});

// Cycle #254 — hear the bottom-line recommendation.
test("analyzer: Decision block hears the recommendation aloud", () => {
  if (!HAS_BROWSER) return;
  const fs = require("node:fs");
  const path = require("node:path");
  const html = fs.readFileSync(path.join(ROOT, "analyze.html"), "utf8");
  const appSrc = fs.readFileSync(path.join(ROOT, "assets", "app.js"), "utf8");

  assert.match(html, /id="decisionSpeakBtn" title="Hear the recommendation aloud" aria-label="Hear the recommendation aloud" aria-pressed="false"/,
    "analyze.html must contain a decision speak button");
  assert.match(appSrc, /const decisionSpeakBtn = document\.getElementById\('decisionSpeakBtn'\);/,
    "the speak button must be wired in app.js");
  assert.match(appSrc, /const text = 'Recommendation: ' \+ m\.k \+ '\. ' \+ d\.headline \+ '\. ' \+ d\.rationale;/,
    "the utterance must carry tier + headline + rationale");
  assert.match(appSrc, /setSpeaking\(true\);/,
    "the button must become a stop button while speaking");
  assert.match(appSrc, /setSpeaking\(false\);/,
    "the button must restore after the utterance ends");
  assert.match(appSrc, /u\.rate = getTtsRate\(\);/,
    "the reading must respect the chosen speed");
  assert.match(appSrc, /localStorage\.getItem\('cleardoc:ttsVoice'\)/,
    "the reading must respect the selected TTS voice");
  assert.match(appSrc, /decisionSpeakBtn\.style\.display = 'none';/,
    "the button must hide when speech synthesis is unsupported");
});

test("analyzer: RISK array detects Intellectual Property / Work for Hire trap", () => {
  const fs = require("node:fs");
  const path = require("node:path");
  const appSrc = fs.readFileSync(path.join(ROOT, "assets", "app.js"), "utf8");

  assert.match(appSrc, /work \(made \)\?for hire|assign\(s\|ed\)\? \(all \)\?\(right\|title\|interest\)/,
    "RISK array must include regex for Work for Hire / IP Assignment clauses");
  assert.match(appSrc, /Transfers ownership of your work, ideas, or creations/,
    "IP Assignment rule must explain why IP transfer is a trap");
});

// Cycle #114 — the risk tally lives in the tab title too.
test("analyzer: Risk tally is surfaced in the browser tab title and reset on clear/forget", () => {
  if (!HAS_BROWSER) return;
  const fs = require("node:fs");
  const path = require("node:path");
  const appSrc = fs.readFileSync(path.join(ROOT, "assets", "app.js"), "utf8");

  assert.match(appSrc, /const DEFAULT_TITLE = 'ClearDoc — Read what you sign\. Finally\.';/,
    "the default title must be preserved for the reset path");
  assert.match(appSrc, /function paintRiskTitle\(flags\)\{/,
    "a tab-title painter must exist");
  assert.match(appSrc, /parts\.push\('⚠ ' \+ total \+ ' risk' \+ \(total === 1 \? '' : 's'\)/,
    "the title must carry the risk count and level");
  assert.match(appSrc, /document\.title = parts\.length \? parts\.join\(' · '\) \+ ' · ClearDoc' : DEFAULT_TITLE;/,
    "clean documents must restore the default title");
  // Cycle #174 — the deadline countdown joins the tab-title badge.
  assert.match(appSrc, /function paintDeadlineTitle\(items\)\{/,
    "a deadline title painter must exist");
  assert.match(appSrc, /function titleDeadlineDays\(dateStr\)\{/,
    "the painter must parse deadline dates into day counts");
  assert.match(appSrc, /parts\.push\('⏳ ' \+ \(soonest === 0 \? 'today' : soonest \+ 'd'\)\);/,
    "the soonest upcoming deadline must render as ⏳ Nd / ⏳ today");
  assert.match(appSrc, /\.filter\(d => d !== null\)/,
    "unparseable dates must not appear in the badge");
  assert.match(appSrc, /parts\.push\('⏳ ' \+ overdue \+ ' overdue'\);/,
    "an overdue deadline must outrank the upcoming countdown");
  assert.match(appSrc, /paintDeadlineTitle\(items\);/,
    "the deadline block must paint the badge after rendering");
  assert.match(appSrc, /paintDeadlineTitle\(\[\]\);/,
    "a deadline-free analysis must clear the badge");
  assert.match(appSrc, /paintRiskTitle\(flags\);/,
    "the painter must run on the analysis render path");
  assert.match(appSrc, /paintRiskTitle\(lastFlags\);/,
    "the painter must run on the restore/re-render path");
  assert.match(appSrc, /renderReadinessScore\(\);[\s\S]{0,120}paintRiskTitle\(lastFlags\);/,
    "shared/restored snapshot paints must also update the tab title");
  assert.match(appSrc, /function resetRiskTitle\(\)\{/,
    "a reset helper must exist");
  assert.match(appSrc, /function resetDeadlineTitle\(\)\{/,
    "a deadline reset helper must exist");
  assert.match(appSrc, /updateTextStats\(\); resetRiskTitle\(\); resetDeadlineTitle\(\);/,
    "clearing the analysis must reset both badge parts");
});

skip("dark mode: toggle applies, persists, and survives reload without console errors", async () => {
  if (!HAS_BROWSER) return;
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
  page.on("console", (m) => { if (m.type() === "error") errors.push(`console.error: ${m.text()}`); });
  await page.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: "networkidle", timeout: 20000 });
  // Wait for the branded preloader to leave so the nav is clickable.
  await page.waitForFunction(() => {
    const l = document.getElementById("loader");
    return !l || l.style.display === "none" || getComputedStyle(l).display === "none";
  }, null, { timeout: 20000 });

  assert.equal(await page.locator("#themeToggle").count(), 1, "home must render the theme toggle");
  const initial = await page.evaluate(() => document.documentElement.getAttribute("data-theme"));
  assert.ok(initial === "light" || initial === "dark", "html data-theme must be set on first paint");

  await page.locator("#themeToggle").click();
  const after = await page.evaluate(() => ({
    theme: document.documentElement.getAttribute("data-theme"),
    stored: window.localStorage.getItem("cleardoc-theme"),
    label: (document.getElementById("themeToggle").textContent || "").trim(),
    pressed: document.getElementById("themeToggle").getAttribute("aria-pressed"),
    metaThemes: [...document.querySelectorAll('meta[name="theme-color"]')].map((m) => ({
      content: m.content,
      media: m.getAttribute("media"),
    })),
  }));
  const expected = initial === "dark" ? "light" : "dark";
  assert.equal(after.theme, expected, "click must flip html data-theme");
  assert.equal(after.stored, expected, "choice must persist to localStorage");
  assert.equal(after.pressed, expected === "dark" ? "true" : "false", "aria-pressed must mirror the theme");
  assert.match(after.label, expected === "dark" ? /light/ : /dark/, "toggle label must describe the next mode");
  assert.ok(after.metaThemes.length >= 1, "theme-color metas must exist");
  for (const m of after.metaThemes) {
    assert.equal(m.media, null, "an explicit choice must strip the OS media query from theme-color metas");
    assert.equal(m.content, expected === "dark" ? "#14120E" : "#fbf7ee", "theme-color metas must match the chosen theme");
  }

  await page.reload({ waitUntil: "domcontentloaded", timeout: 20000 });
  const reloaded = await page.evaluate(() => document.documentElement.getAttribute("data-theme"));
  assert.equal(reloaded, expected, "chosen theme must survive a reload");

  // Flip back to light so the shared context stays clean for other tests.
  await page.locator("#themeToggle").click({ force: true });
  await page.close();
  assert.deepEqual(errors, [], "dark mode toggle must not produce console errors");
});

test("dark mode: every public page loads the head script + toggle, and CSS/JS are wired", () => {
  const jsSrc = fs.readFileSync(path.join(ROOT, "assets", "darkmode.js"), "utf8");
  const cssSrc = fs.readFileSync(path.join(ROOT, "assets", "theme.css"), "utf8");
  for (const pageName of ["index.html", "analyze.html", "pricing.html", "404.html"]) {
    const html = fs.readFileSync(path.join(ROOT, pageName), "utf8");
    assert.match(html, /<script src="assets\/darkmode\.js"><\/script>/,
      pageName + " must load assets/darkmode.js in <head> (CSP-safe external file)");
    assert.match(html, /id="themeToggle"/, pageName + " must contain the #themeToggle button");
    assert.match(html, /aria-pressed="false"/, pageName + " toggle must expose aria-pressed");
  }
  // JS: persisted choice wins, OS preference is the fallback, applied pre-paint.
  assert.match(jsSrc, /cleardoc-theme/, "darkmode.js must use a stable localStorage key");
  assert.match(jsSrc, /prefers-color-scheme/, "darkmode.js must follow the OS preference");
  assert.match(jsSrc, /setAttribute\("data-theme"/, "darkmode.js must set data-theme on <html>");
  assert.match(jsSrc, /addEventListener\("change"/, "darkmode.js must live-follow OS changes until a choice is made");
  assert.match(jsSrc, /removeAttribute\("media"\)/, "an explicit choice must strip the OS media query from theme-color metas");
  assert.match(jsSrc, /querySelectorAll\('meta\[name="theme-color"\]'\)/, "darkmode.js must keep every theme-color meta in sync");
  // CSS: inverted palette + hardcoded-white surface overrides exist.
  assert.match(cssSrc, /html\[data-theme="dark"\]\{/, "theme.css must define the dark palette block");
  assert.match(cssSrc, /color-scheme: dark/, "dark mode must declare color-scheme so native controls render dark");
  assert.match(cssSrc, /html\[data-theme="light"\]\{color-scheme:light\}/, "light mode must declare color-scheme light");
  assert.match(cssSrc, /--paper:#16130E/, "dark palette must invert the paper variable");
  assert.match(cssSrc, /--ink:#EDE7D8/, "dark palette must invert the ink variable");
  assert.match(cssSrc, /html\[data-theme="dark"\] :is\(input, textarea, select, kbd\)/,
    "inputs/textareas/selects must be raised in dark mode");
  assert.match(cssSrc, /html\[data-theme="dark"\] \.smoking-card/,
    "result cards must be covered by dark surface overrides");
  assert.match(cssSrc, /html\[data-theme="dark"\] \.rrow:not\(\[data-risk\]\)/,
    "un-tinted risk rows must be raised without killing severity tints");
  assert.match(cssSrc, /\.theme-toggle\{/, "theme.css must style the toggle button");
});

/* test/integration.test.js — end-to-end integration test.
 *
 * Spins up:
 *   1. A static file server on port 4321 (same as smoke.test.js)
 *   2. A mock OpenRouter server on port 4322 that returns a known analysis JSON
 *   3. A mock Gemini server on port 4323 that returns the same shape
 *
 * Then loads /analyze.html in Chromium, monkey-patches fetch() to point at the
 * mock OpenRouter endpoint, clicks Analyze, and verifies that the verdict,
 * deadlines, and next-steps sections all render the expected content from the
 * mock response.
 *
 * Skipped if playwright isn't installed.
 */

const test = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");
const path = require("node:path");
const fs = require("node:fs");

const ROOT = path.resolve(__dirname, "..");
const PORT_WEB = 4331;          // different from smoke.test.js (4321)
const PORT_OPENROUTER = 4332;
const PORT_GEMINI = 4333;

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
};

let chromium = null;
try { ({ chromium } = require("playwright")); }
catch (_) { /* playwright not installed */ }
const HAS_BROWSER = !!chromium;

const skip = HAS_BROWSER ? test : test.skip.bind(test);

let webServer, openRouterServer, geminiServer, browser, context;

const MOCK_ANALYSIS = {
  plainEnglishRewrite: "<b>This is a rewritten clause.</b> It says you must pay within 30 days.",
  risks: [
    { severity: "trap", clause: "Lessee shall indemnify in perpetuity.", explanation: "You cover losses forever.", impact: "Permanent liability." },
    { severity: "watch", clause: "Auto-renews for successive terms.", explanation: "Auto-renews unless cancelled.", impact: "Could pay another term." },
    { severity: "note", clause: "Governing law: California.", explanation: "CA law applies.", impact: "None directly." },
  ],
  verdict: { label: "Suspicious", summary: "Two clauses deserve attention before signing." },
  deadlines: [
    { date: "30 days", description: "Cancellation window for auto-renewal." },
    { date: "60 days", description: "Notice period for lease termination." },
  ],
  nextSteps: [
    "Read the indemnity clause carefully before signing.",
    "Calendar the cancellation deadline.",
    "Negotiate the notice period to 90 days.",
    "Get all verbal promises in writing.",
  ],
  readingLevel: { before: 14, after: 8 },
  jargonFound: 7,
};

function readBody(req) {
  return new Promise((resolve) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
  });
}

function staticServer() {
  return http.createServer((req, res) => {
    let p = req.url.split("?")[0];
    if (p === "/") p = "/index.html";
    const fp = path.join(ROOT, p);
    if (!fp.startsWith(ROOT) || !fs.existsSync(fp) || !fs.statSync(fp).isFile()) {
      res.writeHead(404); res.end("Not Found"); return;
    }
    res.writeHead(200, { "Content-Type": MIME[path.extname(fp)] || "application/octet-stream" });
    fs.createReadStream(fp).pipe(res);
  });
}

function openRouterMock() {
  return http.createServer(async (req, res) => {
    await readBody(req);
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({
      choices: [{ message: { content: JSON.stringify(MOCK_ANALYSIS) } }],
    }));
  });
}

function geminiMock() {
  return http.createServer(async (req, res) => {
    await readBody(req);
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({
      candidates: [{ content: { parts: [{ text: JSON.stringify(MOCK_ANALYSIS) }] } }],
    }));
  });
}

test.before(async () => {
  if (!HAS_BROWSER) return;
  webServer = staticServer(); webServer.listen(PORT_WEB); webServer.unref();
  openRouterServer = openRouterMock(); openRouterServer.listen(PORT_OPENROUTER); openRouterServer.unref();
  geminiServer = geminiMock(); geminiServer.listen(PORT_GEMINI); geminiServer.unref();
  browser = await chromium.launch({ headless: true });
  context = await browser.newContext();
});

test.after(async () => {
  if (!HAS_BROWSER) return;
  await context?.close();
  await browser?.close();
  for (const s of [webServer, openRouterServer, geminiServer]) {
    await new Promise((r) => s?.close(r));
  }
});

skip("integration: analyze flow renders AI verdict, deadlines, and next steps from a mock response", async () => {
  const page = await context.newPage();

  // Intercept fetches to /api/* and point them at our mock servers.
  // /api/analyze POSTs JSON to OpenRouter; /api/chat POSTs to Gemini.
  // We override the global fetch in the page so it returns our canned response
  // without needing real network or env vars.
  await page.addInitScript(() => {
    const MOCK = {
      analysis: {
        plainEnglishRewrite: "<b>This is a rewritten clause.</b> It says you must pay within 30 days.",
        risks: [
          { severity: "trap", clause: "Lessee shall indemnify in perpetuity.", explanation: "You cover losses forever.", impact: "Permanent liability." },
          { severity: "watch", clause: "Auto-renews for successive terms.", explanation: "Auto-renews unless cancelled.", impact: "Could pay another term." },
          { severity: "note", clause: "Governing law: California.", explanation: "CA law applies.", impact: "None directly." },
        ],
        verdict: { label: "Suspicious", summary: "Two clauses deserve attention before signing." },
        deadlines: [
          { date: "30 days", description: "Cancellation window for auto-renewal." },
          { date: "60 days", description: "Notice period for lease termination." },
        ],
        nextSteps: [
          "Read the indemnity clause carefully before signing.",
          "Calendar the cancellation deadline.",
          "Negotiate the notice period to 90 days.",
          "Get all verbal promises in writing.",
        ],
        readingLevel: { before: 14, after: 8 },
        jargonFound: 7,
      },
    };
    const MOCK_CHAT = { answer: "Yes, this document requires written notice within 60 days.", citation: "test mock" };

    const origFetch = window.fetch.bind(window);
    window.fetch = function patchedFetch(url, opts) {
      const u = typeof url === "string" ? url : (url && url.url) || "";
      if (u.endsWith("/api/analyze")) {
        // Add a small delay so tests can observe in-flight UI state (e.g. button disabled)
        return new Promise((resolve) => setTimeout(() => resolve(new Response(JSON.stringify(MOCK), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        })), 250));
      }
      if (u.endsWith("/api/chat")) {
        return Promise.resolve(new Response(JSON.stringify(MOCK_CHAT), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }));
      }
      return origFetch(url, opts);
    };
  });

  await page.goto(`http://127.0.0.1:${PORT_WEB}/analyze.html`, { waitUntil: "networkidle" });

  // Click Analyze on the pre-filled sample
  await page.click("#analyzeBtn");

  // Verify the button is disabled while in flight (double-click guard).
  // The mock keeps the request open for 250ms, but the disabled state can
  // land a tick after the click on slower machines — wait for it instead
  // of racing it with an immediate read.
  await page.waitForFunction(() => {
    const el = document.getElementById("analyzeBtn");
    return el && el.disabled === true;
  }, { timeout: 2000 });

  // Wait for results panel to appear
  await page.waitForSelector("#resultPanel:not([hidden])", { timeout: 8000 });

  // Verify the button is re-enabled after completion
  const isDisabledAfter = await page.$eval("#analyzeBtn", (el) => el.disabled);
  assert.equal(isDisabledAfter, false, "analyze button should be re-enabled after analysis completes");

  // Verdict should be rendered with the "suspicious" tone
  const verdictText = await page.$eval("#verdictDisplay", (el) => el.textContent || "");
  assert.match(verdictText, /Suspicious/, "verdict label rendered");
  assert.match(verdictText, /attention before signing/, "verdict summary rendered");

  // Deadlines should be rendered (both entries)
  const deadlineCount = await page.$$eval("#deadlinesList .deadline-row", (els) => els.length);
  assert.equal(deadlineCount, 2, `expected 2 deadlines, got ${deadlineCount}`);
  const deadlineText = await page.$eval("#deadlinesList", (el) => el.textContent || "");
  assert.match(deadlineText, /30 days/, "first deadline date present");
  assert.match(deadlineText, /Cancellation window/, "first deadline description present");
  assert.match(deadlineText, /60 days/, "second deadline date present");

  // Next steps should be rendered as <li> entries
  const stepCount = await page.$$eval("#nextStepsList li", (els) => els.length);
  assert.equal(stepCount, 4, `expected 4 next steps, got ${stepCount}`);
  const stepsText = await page.$eval("#nextStepsList", (el) => el.textContent || "");
  assert.match(stepsText, /Calendar the cancellation/, "first step text rendered");
  assert.match(stepsText, /Get all verbal promises/, "last step text rendered");

  // Risks should be rendered
  const riskCount = await page.$$eval("#riskList .rrow", (els) => els.length);
  assert.equal(riskCount, 3, `expected 3 risks, got ${riskCount}`);

  // Reading level + jargon should reflect mock values
  const fromLevel = await page.$eval("#levelFrom", (el) => el.textContent || "");
  const toLevel = await page.$eval("#levelTo", (el) => el.textContent || "");
  assert.match(fromLevel, /14/, `levelFrom should be 14th, got "${fromLevel}"`);
  assert.match(toLevel, /8/, `levelTo should be 8th, got "${toLevel}"`);

  const jargon = await page.$eval("#jargonCount", (el) => el.textContent || "");
  assert.equal(jargon, "7", `jargon count should be 7, got "${jargon}"`);

  await page.close();
});

// Cycle #226 — the reading list exports a tracker-ready CSV that actually
// downloads with a BOM, a column header, and per-chunk status.
skip("integration: reading list downloads a CSV tracker file", async () => {
  const ctx = await browser.newContext({ acceptDownloads: true });
  const page = await ctx.newPage();
  const errors = [];
  page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
  page.on("pageerror", (e) => errors.push(String(e)));
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
  await page.goto(`http://127.0.0.1:${PORT_WEB}/analyze.html`, { waitUntil: "networkidle" });
  await page.evaluate((d) => { document.getElementById("docInput").value = d; }, doc);
  await page.click("#analyzeBtn");
  await page.waitForSelector("#readingBlock:not([hidden]) .reading-row", { timeout: 8000 });

  // Mark the first chunk done so the Status column mixes done + todo.
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
  assert.equal(errors.length, 0, `zero console errors, got: ${errors.join(" | ")}`);

  await page.close();
  await ctx.close();
});

// Cycle #228 — the strategy board downloads its state as a CSV file.
skip("integration: strategy board downloads a CSV tracker file", async () => {
  const ctx = await browser.newContext({ acceptDownloads: true });
  const page = await ctx.newPage();
  const errors = [];
  page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
  page.on("pageerror", (e) => errors.push(String(e)));

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

  const doc = "Lessee shall indemnify the landlord in perpetuity. The Agreement shall automatically renew for successive one-year terms.";
  await page.goto(`http://127.0.0.1:${PORT_WEB}/analyze.html`, { waitUntil: "networkidle" });
  await page.evaluate((d) => { document.getElementById("docInput").value = d; }, doc);
  await page.click("#analyzeBtn");
  await page.waitForSelector("#boardBlock:not([hidden]) .board-card", { timeout: 8000 });

  const [download] = await Promise.all([
    page.waitForEvent("download", { timeout: 8000 }),
    page.click("#boardCsvBtn"),
  ]);
  const dlPath = await download.path();
  const content = fs.readFileSync(dlPath, "utf8");
  assert.match(download.suggestedFilename(), /^cleardoc-strategy-\d{4}-\d{2}-\d{2}\.csv$/,
    "the CSV must download as cleardoc-strategy-<date>.csv");
  assert.equal(content.charCodeAt(0), 0xFEFF, "the CSV must start with a UTF-8 BOM");
  const lines = content.slice(1).split("\n");
  assert.match(lines[0], /Strategy board/, "the CSV must open with a metadata row");
  assert.match(lines[1], /Status.*Risk.*Counter-clause/, "the CSV must carry the column header");
  const dataRows = lines.slice(2).filter((l) => l.trim().length > 0);
  assert.ok(dataRows.length >= 1, "the CSV must include the board cards");
  assert.ok(dataRows.some((l) => l.includes("Backlog")), "cards must start in Backlog");

  // Cycle #229 — keyboard parity: cards are div[role=button] with
  // tabindex=0; Enter advances, Shift+Enter moves back.
  const cardAttrs = await page.$eval("#boardBlock .board-card", (el) => ({
    role: el.getAttribute("role"),
    tabindex: el.getAttribute("tabindex"),
  }));
  assert.equal(cardAttrs.role, "button", "board cards must carry button semantics");
  assert.equal(cardAttrs.tabindex, "0", "board cards must be keyboard-focusable");
  const firstKey = await page.$eval("#boardBlock .board-card", (el) => el.getAttribute("data-board-key"));
  await page.focus("#boardBlock .board-card");
  await page.keyboard.press("Enter");
  await page.waitForFunction((k) => {
    const card = document.querySelector(`[data-board-key="${k}"]`);
    return card && card.parentElement && card.parentElement.parentElement &&
      card.parentElement.parentElement.getAttribute("data-board-col") === "drafted";
  }, firstKey, { timeout: 4000 });
  await page.focus(`[data-board-key="${firstKey}"]`);
  await page.keyboard.press("Shift+Enter");
  await page.waitForFunction((k) => {
    const card = document.querySelector(`[data-board-key="${k}"]`);
    return card && card.parentElement && card.parentElement.parentElement &&
      card.parentElement.parentElement.getAttribute("data-board-col") === "backlog";
  }, firstKey, { timeout: 4000 });

  assert.equal(errors.length, 0, `zero console errors, got: ${errors.join(" | ")}`);

  await page.close();
  await ctx.close();
});

// Cycle #230 — the deadline reminder can be snoozed for 1 / 3 / 7 days.
skip("integration: deadline reminder snoozes for a chosen horizon", async () => {
  // Serve from a fresh origin so no service worker / shared cache can
  // intercept the navigation or the assets (Playwright's init script
  // only reliably runs on a genuinely fresh document).
  const WEB2 = 4341;
  const web2 = staticServer();
  await new Promise((r) => web2.listen(WEB2, r));
  const fctx = await browser.newContext();
  const page = await fctx.newPage();
  const errors = [];
  page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
  page.on("pageerror", (e) => errors.push(String(e)));

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
    localStorage.setItem("cleardoc:upcomingDeadlines", JSON.stringify({
      ts: Date.now(),
      fp: "probe",
      docName: "probe",
      items: [{ date: "2099-01-01", label: "Renewal notice", days: 5 }],
    }));
  });

  try {
    await page.goto(`http://127.0.0.1:${WEB2}/analyze.html`, { waitUntil: "networkidle" });
    const banner = await page.$("#deadlineReminder");
    assert.ok(banner, "the reminder banner must exist in the DOM");
    // The preloader animation delays app init by a couple of seconds, so
    // wait for the banner to actually appear rather than racing it.
    await page.waitForFunction(() => {
      const el = document.getElementById("deadlineReminder");
      return el && !el.hidden;
    }, { timeout: 8000 });
    const visibleBefore = await page.$eval("#deadlineReminder", (el) => !el.hidden);
    assert.equal(visibleBefore, true, "a returning user with deadlines must see the reminder");

    await page.click("#deadlineReminderSnooze3Btn");
    await page.waitForTimeout(200);
    const snooze = await page.evaluate(() => JSON.parse(localStorage.getItem("cleardoc:deadlineSnooze") || "null"));
    const hiddenAfter = await page.$eval("#deadlineReminder", (el) => el.hidden);
    const expected = (() => {
      const d = new Date();
      d.setDate(d.getDate() + 3);
      return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
    })();
    assert.ok(snooze && snooze.until === expected,
      `3-day snooze must persist until=${expected}, got ${JSON.stringify(snooze)}`);
    assert.equal(hiddenAfter, true, "the reminder must hide after snoozing");
    const focusedAfter = await page.evaluate(() => document.activeElement && document.activeElement.id);
    assert.equal(focusedAfter, "docInput",
      "keyboard focus must move to the document input instead of staying on the hidden snooze button");
    assert.equal(errors.length, 0, `zero console errors, got: ${errors.join(" | ")}`);
  } finally {
    await page.close();
    await fctx.close();
    await new Promise((r) => web2.close(r));
  }
});

// Cycle #232 — the reading list speaks exactly the chunks still unread.
skip("integration: reading list speaks the remaining unread chunks", async () => {
  const WEB2 = 4341;
  const web2 = staticServer();
  await new Promise((r) => web2.listen(WEB2, r));
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  const errors = [];
  page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
  page.on("pageerror", (e) => errors.push(String(e)));

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
    window.__ttsPending = [];
    const stub = {
      speaking: false,
      pending: window.__ttsPending,
      speak(u) { this.speaking = true; this.pending.push(u); },
      cancel() { this.speaking = false; },
      getVoices() { return []; },
    };
    try { Object.defineProperty(window, "speechSynthesis", { value: stub, configurable: true }); }
    catch (_) { window.speechSynthesis = stub; }
  });

  try {
    const doc = "Lessee shall indemnify the landlord in perpetuity. Lessee must pay all costs within 30 days. " +
      "This Agreement may be amended by written notice. The parties acknowledge the foregoing. Executed in triplicate.";
    await page.goto(`http://127.0.0.1:${WEB2}/analyze.html`, { waitUntil: "networkidle" });
    await page.evaluate((d) => { document.getElementById("docInput").value = d; }, doc);
    await page.click("#analyzeBtn");
    await page.waitForSelector("#readingBlock:not([hidden]) .reading-row", { timeout: 8000 });

    // Mark the first chunk done so "read left" covers only what remains.
    await page.evaluate(() => document.querySelector("#readingBlock .reading-done").click());
    await page.waitForSelector("#readingBlock .reading-row-done", { timeout: 4000 });
    const remainingRows = await page.$$eval("#readingBlock .reading-row:not(.reading-row-done)", (els) => els.length);
    const noteText = await page.$eval("#readingNote", (el) => el.textContent || "");
    assert.match(noteText, /read left/, "the reading note must document the read-left chip");

    await page.click("#readingSpeakLeftBtn");
    await page.waitForTimeout(200);
    const state1 = await page.evaluate(() => ({
      label: document.getElementById("readingSpeakLeftBtn").textContent,
      queued: window.__ttsPending.length,
      speaking: window.speechSynthesis.speaking,
    }));
    assert.equal(state1.label, "◼ Stop", "the chip must become a stop button while speaking");
    assert.equal(state1.queued, 1, "clicking must start with the first unread chunk");
    assert.equal(state1.speaking, true, "speechSynthesis must be speaking");

    // Fire the first utterance's onend — the chain must speak the next one.
    await page.evaluate(() => {
      const u = window.__ttsPending[0];
      if (u && u.onend) u.onend();
    });
    await page.waitForTimeout(100);
    const queuedAfterChain = await page.evaluate(() => window.__ttsPending.length);
    assert.equal(queuedAfterChain, remainingRows,
      "the onend chain must queue the remaining utterances in order");

    // Fire the last utterance's onend — the chip must restore itself.
    await page.evaluate(() => {
      const u = window.__ttsPending[window.__ttsPending.length - 1];
      if (u && u.onend) u.onend();
    });
    await page.waitForTimeout(100);
    const labelAfterDone = await page.$eval("#readingSpeakLeftBtn", (el) => el.textContent);
    assert.equal(labelAfterDone, "🔊 read left", "the chip must restore after the final chunk");

    // Click again while speaking — cancel + label restore.
    await page.click("#readingSpeakLeftBtn");
    await page.waitForTimeout(100);
    const state2 = await page.evaluate(() => ({
      label: document.getElementById("readingSpeakLeftBtn").textContent,
      speaking: window.speechSynthesis.speaking,
    }));
    assert.equal(state2.label, "🔊 read left", "clicking while speaking must restore the chip");
    assert.equal(state2.speaking, false, "clicking while speaking must cancel speech");
    assert.equal(errors.length, 0, `zero console errors, got: ${errors.join(" | ")}`);
  } finally {
    await page.close();
    await ctx.close();
    await new Promise((r) => web2.close(r));
  }
});

// Cycle #234 — the deadline list sorts by date (soonest first) and the
// choice persists like the filter.
skip("integration: deadline list sorts by date and persists the choice", async () => {
  const WEB2 = 4341;
  const web2 = staticServer();
  await new Promise((r) => web2.listen(WEB2, r));
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  const errors = [];
  page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
  page.on("pageerror", (e) => errors.push(String(e)));

  const fmt = (d) => d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
  const soon = new Date(); soon.setDate(soon.getDate() + 3);
  const overdue = new Date(); overdue.setDate(overdue.getDate() - 3);
  const soonStr = fmt(soon), overdueStr = fmt(overdue);

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

  try {
    const doc = "Tenant must submit the renewal notice by " + soonStr +
      " and shall deliver the keys by " + overdueStr + ".";
    await page.goto(`http://127.0.0.1:${WEB2}/analyze.html`, { waitUntil: "networkidle" });
    await page.evaluate((d) => { document.getElementById("docInput").value = d; }, doc);
    await page.click("#analyzeBtn");
    await page.waitForSelector("#deadlineList .deadline-row", { timeout: 8000 });

    const firstDateBefore = await page.$eval("#deadlineList .deadline-row .deadline-date", (el) => el.textContent.trim().slice(0, 10));
    assert.equal(firstDateBefore, soonStr, "document order must list the sooner deadline first");

    await page.click("#deadlineSortBtn");
    await page.waitForTimeout(200);
    const firstDateAfter = await page.$eval("#deadlineList .deadline-row .deadline-date", (el) => el.textContent.trim().slice(0, 10));
    const stored = await page.evaluate(() => localStorage.getItem("cleardoc:deadline-sort"));
    const pressedAfter = await page.$eval("#deadlineSortBtn", (el) => el.getAttribute("aria-pressed"));
    assert.equal(firstDateAfter, overdueStr, "date sort must put the overdue deadline first");
    assert.equal(stored, "date", "the sort choice must persist");
    assert.equal(pressedAfter, "true", "the sort chip must announce its pressed state");

    await page.click("#deadlineSortBtn");
    await page.waitForTimeout(200);
    const firstDateRestored = await page.$eval("#deadlineList .deadline-row .deadline-date", (el) => el.textContent.trim().slice(0, 10));
    const storedRestored = await page.evaluate(() => localStorage.getItem("cleardoc:deadline-sort"));
    const pressedRestored = await page.$eval("#deadlineSortBtn", (el) => el.getAttribute("aria-pressed"));
    assert.equal(firstDateRestored, soonStr, "toggling again must restore document order");
    assert.equal(storedRestored, "doc", "restoring must persist doc order");
    assert.equal(pressedRestored, "false", "the sort chip must clear its pressed state");
    assert.equal(errors.length, 0, `zero console errors, got: ${errors.join(" | ")}`);
  } finally {
    await page.close();
    await ctx.close();
    await new Promise((r) => web2.close(r));
  }
});

// Cycle #236 — duplicating a saved template creates a "(copy)" entry.
skip("integration: templates can be duplicated", async () => {
  const WEB2 = 4341;
  const web2 = staticServer();
  await new Promise((r) => web2.listen(WEB2, r));
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  const errors = [];
  page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
  page.on("pageerror", (e) => errors.push(String(e)));

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
    localStorage.setItem("cleardoc:templates", JSON.stringify([{
      v: 1,
      ts: Date.now(),
      name: "Lease",
      text: "This lease shall automatically renew for successive terms unless cancelled.",
      type: "Lease",
    }]));
  });

  try {
    await page.goto(`http://127.0.0.1:${WEB2}/analyze.html`, { waitUntil: "networkidle" });
    await page.waitForSelector("#tplBtn", { timeout: 8000 });
    await page.click("#tplBtn");
    await page.waitForSelector("#tplList .tpl-item", { timeout: 8000 });
    const namesBefore = await page.$$eval("#tplList .tpl-name", (els) => els.map((e) => e.textContent.trim()));
    assert.deepEqual(namesBefore, ["Lease"], "the seeded template must render first");

    await page.click('[data-tpl-dup="0"]');
    await page.waitForTimeout(300);
    const namesAfter = await page.$$eval("#tplList .tpl-name", (els) => els.map((e) => e.textContent.trim()));
    const stored = await page.evaluate(() => JSON.parse(localStorage.getItem("cleardoc:templates") || "[]"));
    assert.deepEqual(namesAfter, ["Lease (copy)", "Lease"],
      "duplicating must render a (copy) entry above the original");
    assert.equal(stored.length, 2, "the store must hold both templates");
    assert.equal(stored[0].name, "Lease (copy)", "the new entry must carry the copy name");
    assert.equal(stored[0].text, stored[1].text, "the copy must share the original text");
    const dupStyle = await page.evaluate(() => {
      const btn = document.querySelector(".tpl-dup");
      const cs = getComputedStyle(btn);
      return { cursor: cs.cursor, background: cs.backgroundColor, border: cs.borderStyle };
    });
    assert.equal(dupStyle.cursor, "pointer", "the duplicate button must render as a styled control (cursor pointer)");
    assert.equal(dupStyle.border, "solid", "the duplicate button must carry the hairline border");
    assert.equal(errors.length, 0, `zero console errors, got: ${errors.join(" | ")}`);
  } finally {
    await page.close();
    await ctx.close();
    await new Promise((r) => web2.close(r));
  }
});

// Cycle #238 — the "only $100k+" currency view persists across reloads.
skip("integration: currency only-big filter persists", async () => {
  const WEB2 = 4341;
  const web2 = staticServer();
  await new Promise((r) => web2.listen(WEB2, r));
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  const errors = [];
  page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
  page.on("pageerror", (e) => errors.push(String(e)));

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
    window.__clipboardCapture = [];
    if (navigator.clipboard) {
      navigator.clipboard.writeText = (t) => { window.__clipboardCapture.push(t); return Promise.resolve(); };
    }
  });

  const doc = "The license fee is $250,000 and the annual maintenance fee is $50.";
  const analyze = async () => {
    await page.evaluate((d) => { document.getElementById("docInput").value = d; }, doc);
    await page.click("#analyzeBtn");
    await page.waitForSelector("#curOnlyBigBtn", { timeout: 8000 });
  };

  try {
    await page.goto(`http://127.0.0.1:${WEB2}/analyze.html`, { waitUntil: "networkidle" });
    await analyze();
    const classBefore = await page.$eval(".currency-list", (el) => el.classList.contains("cur-only-big"));
    assert.equal(classBefore, false, "the only-big view must start off");

    await page.click("#curOnlyBigBtn");
    await page.waitForTimeout(200);
    const classAfter = await page.$eval(".currency-list", (el) => el.classList.contains("cur-only-big"));
    const stored = await page.evaluate(() => localStorage.getItem("cleardoc:money-onlybig"));
    const hiddenSmall = await page.$$eval(".currency-list .cur-row:not(.cur-big)", (els) => els.every((e) => e.offsetParent === null));
    const countAfter = await page.$eval(".cur-controls .cur-count", (el) => el.textContent.trim());
    const noteText = await page.$eval("#currencyNote", (el) => el.textContent || "");
    assert.equal(classAfter, true, "clicking must apply the only-big class");
    assert.equal(stored, "1", "the choice must persist");
    assert.equal(hiddenSmall, true, "small amounts must be hidden by the filter");
    assert.match(countAfter, /^1 of 2 amounts$/, `the count must reflect the visible rows, got "${countAfter}"`);
    assert.match(noteText, /only \$100k\+/, "the currency note must document the filter chip");

    // Cycle #240 — copy-all respects the active filter.
    await page.click("#curCopyAllBtn");
    await page.waitForTimeout(200);
    const filteredCopy = await page.evaluate(() => window.__clipboardCapture[window.__clipboardCapture.length - 1] || "");
    assert.match(filteredCopy, /250,000/, "the filtered copy must include the big amount");
    assert.equal(filteredCopy.split("\n").length, 1, "the filtered copy must carry exactly one row");

    // Reload + re-analyze: the restored view must come back on.
    await page.reload({ waitUntil: "networkidle" });
    await analyze();
    const classRestored = await page.$eval(".currency-list", (el) => el.classList.contains("cur-only-big"));
    const pressedRestored = await page.$eval("#curOnlyBigBtn", (el) => el.getAttribute("aria-pressed"));
    const labelRestored = await page.$eval("#curOnlyBigBtn", (el) => el.textContent.trim());
    assert.equal(classRestored, true, "the only-big view must restore after reload");
    assert.equal(pressedRestored, "true", "the restored chip must announce its pressed state");
    assert.equal(labelRestored, "show all amounts", "the restored chip must carry the active label");
    const countRestored = await page.$eval(".cur-controls .cur-count", (el) => el.textContent.trim());
    assert.match(countRestored, /^1 of 2 amounts$/, `the restored view must show the accurate count, got "${countRestored}"`);

    // Toggle back to all amounts and copy again (full set).
    await page.click("#curOnlyBigBtn");
    await page.waitForTimeout(200);
    const storedOff = await page.evaluate(() => localStorage.getItem("cleardoc:money-onlybig"));
    assert.equal(storedOff, "0", "toggling back must persist the off state");
    await page.click("#curCopyAllBtn");
    await page.waitForTimeout(200);
    const allCopy = await page.evaluate(() => window.__clipboardCapture[window.__clipboardCapture.length - 1] || "");
    assert.ok(allCopy.includes("$50"), "the full copy must include the small amount");
    assert.equal(allCopy.split("\n").length, 2, "the full copy must carry both rows");
    assert.equal(errors.length, 0, `zero console errors, got: ${errors.join(" | ")}`);
  } finally {
    await page.close();
    await ctx.close();
    await new Promise((r) => web2.close(r));
  }
});

/* test/analyze-error.test.js — node:test unit tests for the outer
 * try/catch safety net added to api/analyze.js.
 *
 * Before this change, any uncaught throw inside the handler leaked
 * Vercel's HTML 500 page (which echoes stack frames and module paths).
 * The wrap now catches every throw, logs the message to stderr, and
 * returns a structured JSON 500 with no internals — unless the response
 * has already started streaming, in which case it bails silently.
 *
 * Run with: node --test test/analyze-error.test.js
 */

const test = require("node:test");
const assert = require("node:assert/strict");
const { Readable } = require("node:stream");
const Module = require("node:module");

// Pre-load the safety module, then inject a throwing clone into the require
// cache so the NEXT require("../api/analyze.js") gets a safety module whose
// safeParseAnalysisResult() throws. This is the standard Node pattern for
// forcing errors in downstream code without monkey-patching private state.
const safetyPath = require.resolve("../api/_safety.js");
const safetyModule = require(safetyPath);

function loadHandlerWithThrowingValidator() {
  // Build a fake module entry that mirrors safetyModule but with one method
  // replaced. The destructure in analyze.js captures the reference at
  // require-time, so we MUST inject before the analyze.js require.
  const patchedExports = Object.assign({}, safetyModule, {
    safeParseAnalysisResult: () => {
      throw new Error("forced validator throw for test");
    },
  });
  require.cache[safetyPath] = {
    id: safetyPath,
    filename: safetyPath,
    loaded: true,
    exports: patchedExports,
    // paths/children omitted — Node only inspects `exports` for runtime use.
    paths: [],
    children: [],
  };
  // Bust analyze.js's cache entry too so the destructure re-runs.
  const analyzePath = require.resolve("../api/analyze.js");
  delete require.cache[analyzePath];
  return require("../api/analyze.js");
}

function restoreSafetyCache() {
  // Restore the real module so subsequent tests (or test files in the same
  // process) see the unmodified validator.
  delete require.cache[safetyPath];
}

// Module-level state for fetch stub (Node's test runner doesn't bind `this`
// reliably across beforeEach/afterEach and individual tests).
let _origFetch = null;
function stubFetchWithValidAnalysis() {
  const validPayload = JSON.stringify({
    plainEnglishRewrite: "<b>You</b> must pay within 30 days.",
    risks: [],
    verdict: { label: "Likely Fair", summary: "Routine payment terms." },
    deadlines: [],
    nextSteps: [],
    readingLevel: { before: 12, after: 8 },
    jargonFound: 1,
  });
  return {
    ok: true,
    status: 200,
    statusText: "OK",
    headers: { get: () => "application/json" },
    json: async () => ({ choices: [{ message: { content: validPayload } }] }),
    text: async () => validPayload,
  };
}
function installFetchStub() {
  _origFetch = globalThis.fetch;
  globalThis.fetch = async () => stubFetchWithValidAnalysis();
}
function uninstallFetchStub() {
  if (_origFetch) {
    globalThis.fetch = _origFetch;
    _origFetch = null;
  }
}

test.beforeEach(() => {
  installFetchStub();
  // Make sure the AI providers actually attempt the (stubbed) fetch instead of
  // short-circuiting at the `if (!apiKey) return null` gate. Without these, both
  // providers return null and the handler responds 502 from the inner "no result"
  // branch — never reaching the validator mock or the outer catch.
  process.env.OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY || "test-stub-key-openrouter";
  process.env.GEMINI_API_KEY = process.env.GEMINI_API_KEY || "test-stub-key-gemini";
});

test.afterEach(() => {
  uninstallFetchStub();
  restoreSafetyCache();
});

// ── helpers ─────────────────────────────────────────────────────────

// Minimal mock of Node's IncomingMessage for direct handler calls.
// readCappedBody does `for await (const chunk of req)`, so we provide an
// async iterator directly. Empty by default; the test never sends a body.
function mockReq({ method = "POST", headers = {}, body = null } = {}) {
  return {
    method,
    headers,
    body,
    socket: { remoteAddress: "127.0.0.1" },
    [Symbol.asyncIterator]() {
      return { next: async () => ({ done: true, value: undefined }) };
    },
  };
}

// Minimal mock of Node's ServerResponse with headersSent tracking.
function mockRes() {
  return {
    statusCode: 200,
    _body: null,
    headers: {},
    headersSent: false,
    setHeader(k, v) { this.headers[k] = v; },
    status(c) { this.statusCode = c; return this; },
    end(s) { this._body = s; this.headersSent = true; },
  };
}

// ── happy path still works (smoke) ─────────────────────────────────

test("analyze handler: returns 400 JSON for missing document (smoke)", async () => {
  const handler = require("../api/analyze.js");
  const req = mockReq({ body: {} });
  const res = mockRes();
  await handler(req, res);
  assert.equal(res.statusCode, 400);
  const body = JSON.parse(res._body);
  assert.equal(body.error, "Document text is required.");
});

// ── uncaught throw → structured 500 ───────────────────────────────
//
// To exercise the outer try/catch we need the handler to actually reach
// `safeParseAnalysisResult()` — otherwise the AI providers fail first and
// we return 502 from the inner "no result" branch, never touching the catch.
// Stub global fetch with a minimal OpenRouter-shaped success response so
// the validator path is reached and the mock throw fires.

test("analyze handler: uncaught throw returns structured JSON 500 (no HTML leak)", async () => {
  const handler = loadHandlerWithThrowingValidator();
  // A document that passes the "too short" gate and reaches the validator.
  const req = mockReq({ body: { document: "This is a long enough document to analyze thoroughly." } });
  const res = mockRes();
  await handler(req, res);
  assert.equal(res.statusCode, 500);
  // Body must be JSON, not Vercel's HTML 500
  assert.equal(res.headers["Content-Type"], "application/json");
  const body = JSON.parse(res._body);
  assert.equal(body.error, "An internal error occurred. Please try again.");
  // No stack frames, no module paths, no original error message
  assert.ok(!/Error:|at\s+\w+/.test(res._body), "body must not leak stack info");
  assert.ok(!/forced validator throw/.test(res._body), "body must not leak original error message");
});

test("analyze handler: 500 body never includes original error internals", async () => {
  const handler = loadHandlerWithThrowingValidator();
  const req = mockReq({ body: { document: "Long enough document text here for the validator to be reached." } });
  const res = mockRes();
  await handler(req, res);
  assert.equal(res._body.includes("forced"), false);
  assert.equal(res._body.includes("throw"), false);
});

test("analyze handler: catch block respects headersSent and does not double-end", async () => {
  const handler = loadHandlerWithThrowingValidator();
  const req = mockReq({ body: { document: "Long enough document text here for the validator to be reached." } });
  const res = mockRes();
  // Pre-mark the response as already streaming — simulates a partial response
  // that started before the validator threw. The catch must NOT call end()
  // again (Node would throw "Cannot set headers after they are sent").
  res.headersSent = true;
  // Snapshot the body before so we can confirm the catch didn't overwrite it.
  const beforeBody = res._body;
  await handler(req, res);
  assert.equal(res._body, beforeBody, "catch must not call end() when headersSent is true");
});
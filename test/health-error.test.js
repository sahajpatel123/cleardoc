/* test/health-error.test.js — node:test source-pattern tests for the outer
 * try/catch safety net added to api/health.js (parity with api/analyze.js
 * and api/chat.js).
 *
 * Same approach as test/analyze-error.test.js and test/chat-error.test.js:
 * read the source file once at module load and assert structural invariants,
 * rather than forcing an uncaught throw at runtime.
 *
 *   - Test 1: handler still returns structured 200 JSON for the happy path.
 *   - Test 2: the handler body is wrapped in try/catch.
 *   - Test 3: the catch block guards with `res.headersSent`.
 *   - Test 4: the 500 body is the documented sanitized string.
 *
 * Run with: node --test test/health-error.test.js
 */

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const HEALTH_SOURCE = fs.readFileSync(
  path.resolve(__dirname, "../api/health.js"),
  "utf8"
);

// ── happy path still works (smoke) ─────────────────────────────────

test("health handler: returns 200 JSON for GET happy path (smoke)", async () => {
  // /api/health short-circuits to 503 only when NEITHER provider is
  // configured. With OPENROUTER_API_KEY set in the shell (the local dev
  // default), it returns 200.
  if (!process.env.OPENROUTER_API_KEY && !process.env.GEMINI_API_KEY && !process.env.GOOGLE_GEMINI_API_KEY) {
    process.env.OPENROUTER_API_KEY = "test-stub-key-health";
  }
  const handler = require("../api/health.js");
  const res = {
    statusCode: 200,
    _body: null,
    headers: {},
    headersSent: false,
    setHeader(k, v) { this.headers[k] = v; },
    end(s) { this._body = s; this.headersSent = true; },
  };
  const req = {
    method: "GET",
    headers: {},
    socket: { remoteAddress: "127.0.0.1" },
  };
  await handler(req, res);
  assert.equal(res.statusCode, 200);
  const body = JSON.parse(res._body);
  assert.equal(body.status, "ok");
  assert.equal(body.ok, true);
});

// ── source-pattern checks ──────────────────────────────────────────

test("health handler: body is wrapped in try/catch (safety net exists)", () => {
  const fnStart = HEALTH_SOURCE.indexOf("module.exports = async function handler");
  assert.ok(fnStart > -1, "handler function must be defined");
  const tryOffset = HEALTH_SOURCE.indexOf("try {", fnStart);
  assert.ok(tryOffset > -1, "handler body must begin with `try {`");
  const catchOffset = HEALTH_SOURCE.indexOf("} catch (err)", fnStart);
  assert.ok(catchOffset > -1, "handler must have a `catch (err)` block");
  assert.ok(catchOffset > tryOffset, "catch must follow the try block");
});

test("health handler: catch block guards on res.headersSent (no double-end)", () => {
  const fnStart = HEALTH_SOURCE.indexOf("module.exports = async function handler");
  assert.ok(fnStart > -1);
  const catchStart = HEALTH_SOURCE.indexOf("} catch (err)", fnStart);
  assert.ok(catchStart > fnStart);
  const guardRegion = HEALTH_SOURCE.slice(catchStart, catchStart + 400);
  assert.match(
    guardRegion,
    /res\.headersSent/,
    "catch block must check `res.headersSent` to avoid double-end"
  );
});

test("health handler: 500 body is a literal sanitized string (no leak)", () => {
  const fnStart = HEALTH_SOURCE.indexOf("module.exports = async function handler");
  assert.ok(fnStart > -1);
  const catchStart = HEALTH_SOURCE.indexOf("} catch (err)", fnStart);
  assert.ok(catchStart > fnStart);
  const catchBody = HEALTH_SOURCE.slice(catchStart);
  const expected = 'json(res, 500, { error: "An internal error occurred. Please try again." })';
  assert.ok(
    catchBody.includes(expected),
    "catch block must respond with the documented sanitized 500 message"
  );
  const json500Match = catchBody.match(/json\(res,\s*500,\s*\{([^}]*)\}/);
  assert.ok(json500Match, "catch block must call json(res, 500, {...})");
  assert.equal(
    /err\.message/.test(json500Match[1]),
    false,
    "500 response body must not interpolate err.message"
  );
});

// ── AI provider reachability probe (source-pattern) ───────────────

test("health handler: wires up probeProviderCached for both providers", () => {
  // Both Gemini and OpenRouter must be probed through the cached helper so
  // health polls don't translate into 60 outbound requests/min.
  assert.match(HEALTH_SOURCE, /probeProviderCached\(\s*"gemini"/, "Gemini probe must use cached helper");
  assert.match(HEALTH_SOURCE, /probeProviderCached\(\s*"openrouter"/, "OpenRouter probe must use cached helper");
});

test("health handler: payload reports configured + reachable + latencyMs per provider", () => {
  // The providers payload object must include the new reachability fields.
  assert.match(HEALTH_SOURCE, /configured:\s*(true|false)/, "providers payload must report configured");
  assert.match(HEALTH_SOURCE, /reachable:\s*\w+\.ok/, "providers payload must report reachable (from probe.ok)");
  assert.match(HEALTH_SOURCE, /latencyMs:/, "providers payload must report probe latencyMs");
});

test("health handler: 503 condition requires all configured providers unreachable", () => {
  // The 503 path must trigger when EVERY configured provider is unreachable.
  // (A single-reachable deployment should stay 200 — at least one working
  // AI provider means the analyzer can still respond.)
  assert.match(HEALTH_SOURCE, /All configured AI providers are unreachable/, "503 reason must reference the all-unreachable condition");
  // The `allUnreachable` variable must gate the 503 response
  assert.match(HEALTH_SOURCE, /allUnreachable/, "must compute allUnreachable before deciding 503");
});

// ── Git SHA deployment marker ──────────────────────────────────────

test("health handler: payload includes gitSha from VERCEL_GIT_COMMIT_SHA", () => {
  // Vercel sets VERCEL_GIT_COMMIT_SHA on every production deploy. The
  // health payload must surface it so ops can correlate a health-check
  // response with a specific commit SHA via `git rev-parse HEAD`.
  assert.match(
    HEALTH_SOURCE,
    /VERCEL_GIT_COMMIT_SHA/,
    "payload must read the Vercel-injected git SHA env var"
  );
  assert.match(
    HEALTH_SOURCE,
    /gitSha\s*:/,
    "payload must include a gitSha field"
  );
  // Must fall back to null in local dev (env var unset)
  assert.match(HEALTH_SOURCE, /\|\| null/, "gitSha must default to null when env var is unset");
});
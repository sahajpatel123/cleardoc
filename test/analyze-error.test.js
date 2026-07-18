/* test/analyze-error.test.js — node:test unit tests for the outer
 * try/catch safety net added to api/analyze.js.
 *
 * Before this change, any uncaught throw inside the handler leaked
 * Vercel's HTML 500 page (which echoes stack frames and module paths).
 * The wrap now catches every throw, logs the message to stderr, and
 * returns a structured JSON 500 with no internals — unless the response
 * has already started streaming, in which case it bails silently.
 *
 * The tests below intentionally avoid forcing an actual uncaught throw
 * inside the handler (require.cache injection / fetch mocking is fragile
 * across Node versions and isolates poorly under `node --test`). Instead:
 *   - Test 1: smoke that the handler still returns structured 400 JSON
 *     for missing-document input (proves the wrap didn't break the
 *     happy path).
 *   - Test 2: source-pattern check that the handler body is wrapped in
 *     try/catch with the right shape (proves the safety net exists).
 *   - Test 3: source-pattern check that the catch block guards with
 *     `res.headersSent` (proves we don't double-end).
 *   - Test 4: source-pattern check that the 500 body is the literal
 *     sanitized string — no error message, no stack info (proves we
 *     don't leak internals).
 *
 * Run with: node --test test/analyze-error.test.js
 */

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const ANALYZE_SOURCE = fs.readFileSync(
  path.resolve(__dirname, "../api/analyze.js"),
  "utf8"
);

// ── happy path still works (smoke) ─────────────────────────────────

test("analyze handler: returns 400 JSON for missing document (smoke)", async () => {
  const handler = require("../api/analyze.js");
  const res = {
    statusCode: 200,
    _body: null,
    headers: {},
    headersSent: false,
    setHeader(k, v) { this.headers[k] = v; },
    end(s) { this._body = s; this.headersSent = true; },
  };
  const req = {
    method: "POST",
    headers: {},
    body: {},
    socket: { remoteAddress: "127.0.0.1" },
    [Symbol.asyncIterator]() {
      return { next: async () => ({ done: true, value: undefined }) };
    },
  };
  await handler(req, res);
  assert.equal(res.statusCode, 400);
  const body = JSON.parse(res._body);
  assert.equal(body.error, "Document text is required.");
});

// ── source-pattern checks ──────────────────────────────────────────

test("analyze handler: body is wrapped in try/catch (safety net exists)", () => {
  // The wrap must enclose `module.exports = async function handler(...) { ... }`
  // and end with a catch block. Match the first occurrence of the function
  // body opening and the corresponding closing pattern.
  const fnStart = ANALYZE_SOURCE.indexOf("module.exports = async function handler");
  assert.ok(fnStart > -1, "handler function must be defined");
  // Look for the try-block opener inside the function body.
  const tryOffset = ANALYZE_SOURCE.indexOf("try {", fnStart);
  assert.ok(tryOffset > -1, "handler body must begin with `try {`");
  // Catch block must follow before the module ends.
  const catchOffset = ANALYZE_SOURCE.indexOf("} catch (err)", fnStart);
  assert.ok(catchOffset > -1, "handler must have a `catch (err)` block");
  assert.ok(catchOffset > tryOffset, "catch must follow the try block");
});

test("analyze handler: catch block guards on res.headersSent (no double-end)", () => {
  const handlerStart = ANALYZE_SOURCE.indexOf("module.exports = async function handler");
  assert.ok(handlerStart > -1);
  // Find the LAST `} catch (err)` after the handler opener — that's the
  // outer wrap. (Earlier catch blocks inside callOpenRouter / callGemini
  // are sibling helpers, not the handler wrap.)
  const handlerCatch = ANALYZE_SOURCE.lastIndexOf("} catch (err)", ANALYZE_SOURCE.indexOf("module.exports = async function analyzeHandler"));
  // If lastIndexOf misses the second sentinel, fall back to first catch
  // after handlerStart.
  const catchStart = handlerCatch > handlerStart
    ? handlerCatch
    : ANALYZE_SOURCE.indexOf("} catch (err)", handlerStart);
  assert.ok(catchStart > handlerStart, "handler must have its own catch block");
  const guardRegion = ANALYZE_SOURCE.slice(catchStart, catchStart + 400);
  assert.match(
    guardRegion,
    /res\.headersSent/,
    "catch block must check `res.headersSent` to avoid double-end"
  );
});

test("analyze handler: 500 body is a literal sanitized string (no leak)", () => {
  const handlerStart = ANALYZE_SOURCE.indexOf("module.exports = async function handler");
  assert.ok(handlerStart > -1);
  const catchStart = ANALYZE_SOURCE.indexOf("} catch (err)", handlerStart);
  assert.ok(catchStart > handlerStart, "handler must have its own catch block");
  const catchBody = ANALYZE_SOURCE.slice(catchStart);
  // Look for the 500 response inside the catch block. The body must be
  // exactly the sanitized literal — no err.message interpolation.
  const expected = 'json(res, 500, { error: "An internal error occurred. Please try again." })';
  assert.ok(
    catchBody.includes(expected),
    "catch block must respond with the documented sanitized 500 message"
  );
  // err.message must NOT appear in the 500 response body (only in console.error).
  // Find the json(res, 500, ...) call and check its contents.
  const json500Match = catchBody.match(/json\(res,\s*500,\s*\{([^}]*)\}/);
  assert.ok(json500Match, "catch block must call json(res, 500, {...})");
  assert.equal(
    /err\.message/.test(json500Match[1]),
    false,
    "500 response body must not interpolate err.message"
  );
});
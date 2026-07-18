/* test/chat-error.test.js — node:test source-pattern tests for the outer
 * try/catch safety net added to api/chat.js (parity with api/analyze.js).
 *
 * Same approach as test/analyze-error.test.js: read the source file once at
 * module load and assert structural invariants, rather than forcing an
 * uncaught throw at runtime (which is fragile across Node versions and
 * isolates poorly under `node --test`).
 *
 *   - Test 1: handler still returns structured 400 JSON for missing fields
 *     (proves the wrap didn't break the happy path).
 *   - Test 2: the handler body is wrapped in try/catch with the right shape.
 *   - Test 3: the catch block guards with `res.headersSent` (no double-end).
 *   - Test 4: the 500 body is a literal sanitized string (no err.message leak).
 *
 * Run with: node --test test/chat-error.test.js
 */

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const CHAT_SOURCE = fs.readFileSync(
  path.resolve(__dirname, "../api/chat.js"),
  "utf8"
);

// Ensure the API-key gate passes so the smoke test can exercise the
// validation path. The handler short-circuits with 503 if GEMINI_API_KEY
// is missing — we don't want that here.
test.beforeEach(() => {
  process.env.GEMINI_API_KEY = process.env.GEMINI_API_KEY || "test-stub-key-chat";
});
test.afterEach(() => {
  // Restore only if we set it — leave existing CI env vars alone.
  if (process.env.GEMINI_API_KEY === "test-stub-key-chat") delete process.env.GEMINI_API_KEY;
});

// ── happy path still works (smoke) ─────────────────────────────────

test("chat handler: returns 400 JSON for missing question (smoke)", async () => {
  const handler = require("../api/chat.js");
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
    body: { document: "Some long enough document text for the validation gate." },
    socket: { remoteAddress: "127.0.0.1" },
    [Symbol.asyncIterator]() {
      return { next: async () => ({ done: true, value: undefined }) };
    },
  };
  await handler(req, res);
  assert.equal(res.statusCode, 400);
  const body = JSON.parse(res._body);
  assert.match(body.error, /Question and analyzed document/);
});

// ── source-pattern checks ──────────────────────────────────────────

test("chat handler: body is wrapped in try/catch (safety net exists)", () => {
  const fnStart = CHAT_SOURCE.indexOf("module.exports = async function handler");
  assert.ok(fnStart > -1, "handler function must be defined");
  // Look for the try-block opener inside the function body.
  const tryOffset = CHAT_SOURCE.indexOf("try {", fnStart);
  assert.ok(tryOffset > -1, "handler body must begin with `try {`");
  // The outer catch must come AFTER the inner try/catch/finally that wraps
  // the Gemini fetch. There are two `try {` blocks in chat.js (outer + inner),
  // and the LAST `} catch (` after the handler opener is the outer safety net.
  const lastCatch = CHAT_SOURCE.lastIndexOf("} catch (err)");
  assert.ok(lastCatch > fnStart, "handler must have at least one catch block");
  assert.ok(lastCatch > tryOffset, "outer catch must follow the outer try block");
});

test("chat handler: outer catch block guards on res.headersSent (no double-end)", () => {
  const fnStart = CHAT_SOURCE.indexOf("module.exports = async function handler");
  assert.ok(fnStart > -1, "handler function must be defined");
  // Take the LAST catch after the handler opener — that's the outer wrap.
  const catchStart = CHAT_SOURCE.lastIndexOf("} catch (err)");
  assert.ok(catchStart > fnStart, "handler must have an outer catch block");
  const guardRegion = CHAT_SOURCE.slice(catchStart, catchStart + 400);
  assert.match(
    guardRegion,
    /res\.headersSent/,
    "outer catch block must check `res.headersSent` to avoid double-end"
  );
});

test("chat handler: 500 body is a literal sanitized string (no leak)", () => {
  const fnStart = CHAT_SOURCE.indexOf("module.exports = async function handler");
  assert.ok(fnStart > -1, "handler function must be defined");
  // Inspect the WHOLE handler body (not just the outer catch) so we can
  // verify both the outer safety-net 500 AND the inner Gemini failure 502/504
  // still exist (the wrap must not shadow the inner catch's specific copy).
  const handlerBody = CHAT_SOURCE.slice(fnStart);
  const outerCatchStart = CHAT_SOURCE.lastIndexOf("} catch (err)");
  const outerCatchBody = CHAT_SOURCE.slice(outerCatchStart);

  // The outer catch must respond with the same sanitized 500 body that
  // analyze.js uses — single source of truth for "internal error" copy.
  const expected = 'json(res, 500, { error: "An internal error occurred. Please try again." })';
  assert.ok(
    outerCatchBody.includes(expected),
    "outer catch must respond with the documented sanitized 500 message"
  );
  // Inner Gemini try/catch returns 502/504 with specific copy — still reachable.
  assert.match(handlerBody, /Gemini timed out/, "inner timeout message must still be reachable");
  assert.match(handlerBody, /Chat failed\./, "inner failure message must still be reachable");
  // err.message must NOT appear in any 500 response body.
  const all500Calls = [...outerCatchBody.matchAll(/json\(res,\s*500,\s*\{([^}]*)\}/g)];
  assert.ok(all500Calls.length >= 1, "at least one 500 response must be in the outer catch");
  for (const m of all500Calls) {
    assert.equal(
      /err\.message/.test(m[1]),
      false,
      "500 response body must not interpolate err.message"
    );
  }
});

test("chat handler: wires the multi-turn Ask history through to buildPrompt", () => {
  // The frontend's multi-turn Ask thread sends `history: [{ q, a }]` to
  // /api/chat so each turn has conversational context. The handler must
  // forward `history` to buildPrompt so the prompt includes the prior
  // turns. Without this the multi-turn feature would be silently broken.
  assert.match(
    CHAT_SOURCE,
    /buildPrompt\(\s*\{[^}]*history:\s*body\?\.history/,
    "buildPrompt call must forward body?.history so prior turns reach the prompt"
  );
});

test("chat handler: buildPrompt caps history at MAX_HISTORY_TURNS and trims field lengths", () => {
  // Defense-in-depth: a malicious client could send thousands of turns
  // or megabyte-long strings in `history`. buildPrompt must slice and
  // slice-by-length so the Gemini prompt can't be padded past reason.
  assert.match(
    CHAT_SOURCE,
    /MAX_HISTORY_TURNS/,
    "MAX_HISTORY_TURNS constant must exist for the history cap"
  );
  assert.match(
    CHAT_SOURCE,
    /MAX_HISTORY_FIELD_CHARS/,
    "MAX_HISTORY_FIELD_CHARS constant must exist for per-field cap"
  );
  // buildPrompt must slice the history array and slice each field's length.
  const buildPromptMatch = CHAT_SOURCE.match(/function buildPrompt\([\s\S]+?\n  return \[/);
  assert.ok(buildPromptMatch, "buildPrompt function must be present");
  const body = buildPromptMatch[0];
  assert.match(body, /\.slice\(0,\s*MAX_HISTORY_TURNS\)/, "must slice history to MAX_HISTORY_TURNS");
  assert.match(body, /\.slice\(0,\s*MAX_HISTORY_FIELD_CHARS\)/, "must slice each history field to MAX_HISTORY_FIELD_CHARS");
});
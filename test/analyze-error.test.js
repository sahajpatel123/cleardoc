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

test("analyze handler: wires applyAiResponseHeaders with provider + latency on every AI-touched response", () => {
  // The /api/analyze handler reports per-request provider + latency via
  // X-AI-Provider / X-AI-Response-Time-Ms headers. Must be called BEFORE
  // json() on every path that actually invoked the AI (success, both-fail,
  // invalid_ai_response). For 400/413/429 paths the helper is skipped (no AI).
  assert.match(
    ANALYZE_SOURCE,
    /applyAiResponseHeaders/,
    "applyAiResponseHeaders must be imported from _safety.js"
  );
  const fnStart = ANALYZE_SOURCE.indexOf("module.exports = async function handler");
  const handlerBody = ANALYZE_SOURCE.slice(fnStart);

  // Capture the wall-clock latency once around the chain
  assert.match(handlerBody, /aiStart\s*=\s*Date\.now\(\)/, "must capture aiStart before the AI chain");
  assert.match(handlerBody, /aiLatencyMs\s*=\s*Date\.now\(\)\s*-\s*aiStart/, "must compute aiLatencyMs after the chain");

  // The three AI-touched json() responses (success, both-fail, invalid_ai)
  // must each be preceded by an applyAiResponseHeaders call.
  for (const providerStr of ["\"none\"", "provider", "provider"]) {
    assert.ok(
      handlerBody.includes(providerStr),
      `handler body must reference provider ${providerStr}`
    );
  }

  // The 502 "both-fail" path must report provider "none". The optional
  // 4th (model), 5th (fallbackUsed), and 6th (perProviderMs) args may or
  // may not be present — both forms are accepted.
  assert.match(
    handlerBody,
    /applyAiResponseHeaders\(res,\s*"none"\s*,\s*aiLatencyMs(?:,\s*[^,)]+)?(?:,\s*(?:true|false|fallbackUsed))?(?:,\s*perProviderMs)?\)/,
    "502 both-fail path must call applyAiResponseHeaders with provider='none'"
  );
  // The 502 invalid_ai path must report the actual provider that answered.
  assert.match(
    handlerBody,
    /applyAiResponseHeaders\(res,\s*provider\s*,\s*aiLatencyMs(?:,\s*[^,)]+)?(?:,\s*(?:true|false|fallbackUsed))?(?:,\s*perProviderMs)?\)/,
    "502 invalid_ai path must call applyAiResponseHeaders with the actual provider"
  );
  // The 200 success path must also set the headers
  assert.match(
    handlerBody,
    /applyAiResponseHeaders\(res,\s*provider\s*,\s*aiLatencyMs(?:,\s*[^,)]+)?(?:,\s*(?:true|false|fallbackUsed))?(?:,\s*perProviderMs)?\)/,
    "200 success path must call applyAiResponseHeaders with the provider"
  );
});

test("analyze handler: emits Retry-After on both 502 paths so clients back off", () => {
  // Mirrors /api/health's 503 behavior: when the AI is unreachable or the
  // schema fails, the response includes `Retry-After: 60` so monitoring
  // systems and the Ask-thread UI can back off instead of hot-loop retrying.
  const fnStart = ANALYZE_SOURCE.indexOf("module.exports = async function handler");
  assert.ok(fnStart > -1);
  const handlerBody = ANALYZE_SOURCE.slice(fnStart);

  // 502 both-fail (provider chain exhausted)
  assert.match(
    handlerBody,
    /res\.setHeader\("Retry-After",\s*"60"\)/,
    "must set Retry-After: 60 on at least one 502 path"
  );
  // Each 502 path's Retry-After must come BEFORE the matching json() call.
  // Find both Retry-After calls and verify the next json( res, 502, ... ) follows.
  const retryAfterPositions = [...handlerBody.matchAll(/res\.setHeader\("Retry-After",\s*"60"\)/g)];
  assert.ok(retryAfterPositions.length >= 2, "must set Retry-After on both 502 paths (both-fail + invalid_ai)");
  // The success 200 path must NOT set Retry-After (only 502/503 paths do)
  const ok200Match = handlerBody.match(/return\s+json\(res,\s*200,\s*\{/);
  assert.ok(ok200Match, "200 happy-path return must exist");
  const between502and200 = handlerBody.slice(0, ok200Match.index);
  const retryAfterInSuccessRegion = retryAfterPositions.some(
    (m) => m.index > between502and200.length - 1
  );
  assert.equal(retryAfterInSuccessRegion, false, "Retry-After must not appear in the 200 success region");
});

test("analyze handler: passes fallbackUsed to applyAiResponseHeaders (OpenRouter primary, Gemini fallback)", () => {
  // For /api/analyze the PRIMARY is OpenRouter. Fallback activated iff the
  // answering provider is Gemini. The handler must compute and pass that.
  const fnStart = ANALYZE_SOURCE.indexOf("module.exports = async function handler");
  assert.ok(fnStart > -1);
  const handlerBody = ANALYZE_SOURCE.slice(fnStart);

  // The computation must be present (used at every AI-touched response site)
  assert.match(
    handlerBody,
    /fallbackUsed\s*=\s*provider\s*===\s*"gemini"/,
    "must compute fallbackUsed = provider === 'gemini' (OpenRouter is primary)"
  );
  // All three AI-touched applyAiResponseHeaders calls must pass fallbackUsed
  // as the 5th argument (both-fail, invalid_ai, success) AND perProviderMs
  // as the 6th argument (so the per-provider latency breakdown headers fire).
  const callsWithFallback = [...handlerBody.matchAll(/applyAiResponseHeaders\(res,\s*[^,]+,\s*[^,]+(?:,\s*[^,]+)?,\s*(true|false|undefined|fallbackUsed)\s*,\s*perProviderMs\s*\)/g)];
  assert.ok(callsWithFallback.length >= 3, "must pass fallbackUsed + perProviderMs on all 3 AI-touched applyAiResponseHeaders call sites");
});
// ── format=verdict-only (iter #46) ─────────────────────────────────

test("analyze handler: detects ?format=verdict-only in the request URL", () => {
  // The compact-mode flag is parsed from req.url (not the JSON body) so it
  // doesn't change the body contract. Easy URL needle check — locks the
  // exact query name ops will use.
  assert.match(
    ANALYZE_SOURCE,
    /\[?&]format=verdict-only/,
    "must detect `?format=verdict-only` in req.url"
  );
  assert.match(
    ANALYZE_SOURCE,
    /compactMode/,
    "must stash detection in a `compactMode` local"
  );
});

test("analyze handler: compact mode routes to callOpenRouterCompact + callGeminiCompact", () => {
  // The compact helpers exist as separate callers — not just a flag on
  // the existing full-mode functions — so the prompt engineering and
  // schema validation stay unambiguous per mode.
  assert.match(ANALYZE_SOURCE, /function\s+callOpenRouterCompact\(/, "callOpenRouterCompact helper must exist");
  assert.match(ANALYZE_SOURCE, /function\s+callGeminiCompact\(/, "callGeminiCompact helper must exist");
  assert.match(ANALYZE_SOURCE, /function\s+buildCompactPrompt\(/, "buildCompactPrompt helper must exist");
  // The chain must use the compact callers in compact mode. Use [\s\S]
  // (the JS equivalent of "match anything including newlines") to span
  // the formatting gap between `compactMode` and the call site — `\s`
  // alone works in theory but `\s*` greedy matching can pick up the
  // wrong section of code when multiple `compactMode` mentions exist
  // (e.g. the regex literal declaration vs the call-site ternary).
  assert.match(
    ANALYZE_SOURCE,
    /compactMode[\s\S]{0,80}?callOpenRouterCompact/,
    "GET-phase must call compact variant when compactMode"
  );
  assert.match(
    ANALYZE_SOURCE,
    /compactMode[\s\S]{0,80}?callGeminiCompact/,
    "FALLBACK phase must call compact variant when compactMode"
  );
});

test("analyze handler: compact mode validates via safeParseCompactAnalysisResult", () => {
  // The compact helper has its own strict validator with a slimmer schema
  // (no rewrite / deadlines / nextSteps / reading-level / jargon).
  assert.match(
    ANALYZE_SOURCE,
    /compactMode\s*\?\s*safeParseCompactAnalysisResult/,
    "200 path must invoke the compact validator when compactMode"
  );
});

test("analyze handler: compact mode response includes format: 'verdict-only'", () => {
  // Marks the response shape so callers can branch on it without
  // inspecting the (smaller) analysis object.
  assert.match(
    ANALYZE_SOURCE,
    /format\s*:\s*["']verdict-only["']/,
    "200 compact-mode response must declare `format: 'verdict-only'`"
  );
});

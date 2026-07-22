/* test/chat-error.test.js — node:test source-pattern tests for the outer
 * try/catch safety net AND the provider-fallback chain in api/chat.js
 * (parity with api/analyze.js).
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
 *   - Test 5: buildPrompt wires multi-turn history through.
 *   - Test 6: buildPrompt caps history length and per-field length.
 *   - Test 7: provider-fallback chain exists (Gemini → OpenRouter).
 *   - Test 8: response includes `provider` field for ops visibility.
 *   - Test 9: 503 returned when NEITHER provider is configured.
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
// validation path. The handler short-circuits with 503 if NEITHER provider
// is configured — we don't want that here.
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

// ── source-pattern checks: error safety net ────────────────────────

test("chat handler: body is wrapped in try/catch (safety net exists)", () => {
  const fnStart = CHAT_SOURCE.indexOf("module.exports = async function handler");
  assert.ok(fnStart > -1, "handler function must be defined");
  // Look for the try-block opener inside the function body.
  const tryOffset = CHAT_SOURCE.indexOf("try {", fnStart);
  assert.ok(tryOffset > -1, "handler body must begin with `try {`");
  // The outer catch must come AFTER the inner try/catch/finally that wraps
  // the provider call. There are two `try {` blocks in chat.js (outer + inner),
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
  // verify both the outer safety-net 500 AND the inner provider failure 502
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
  // Inner provider-orchestrator path returns 502 with specific copy — still
  // reachable. The "Both providers were unreachable" string is the unified
  // failure copy that replaced the old "Chat failed." inner catch.
  assert.match(handlerBody, /Both providers were unreachable/, "orchestrator failure message must still be reachable");
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

// ── source-pattern checks: multi-turn history ──────────────────────

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

// ── source-pattern checks: provider-fallback chain ─────────────────

test("chat handler: defines callGeminiChat and callOpenRouterChat callers", () => {
  // After the fallback-chain refactor, the handler must isolate per-provider
  // fetches in callable helpers so the orchestrator can route between them.
  assert.match(
    CHAT_SOURCE,
    /async function callGeminiChat\(/,
    "callGeminiChat helper must exist"
  );
  assert.match(
    CHAT_SOURCE,
    /async function callOpenRouterChat\(/,
    "callOpenRouterChat helper must exist"
  );
});

test("chat handler: callChatWithFallback exists and tries Gemini first, OpenRouter second", () => {
  // The orchestrator is the bridge between the two provider callers — it
  // must try Gemini first (the configured primary) and only fall through
  // to OpenRouter if Gemini returned null (missing key, errored, timed
  // out, empty content). Source-order proves the chain direction.
  assert.match(
    CHAT_SOURCE,
    /async function callChatWithFallback\(/,
    "callChatWithFallback orchestrator must exist"
  );

  // The handler delegates the provider chain to callChatWithFallback so
  // the two-call shape (Gemini → OpenRouter) is centralized in one helper.
  assert.match(
    CHAT_SOURCE,
    /callChatWithFallback\(\s*\n?\s*buildPrompt\(/,
    "handler must delegate provider chain via callChatWithFallback(buildPrompt(...))"
  );

  // Within callChatWithFallback, Gemini MUST come before OpenRouter so the
  // primary provider is preferred for latency and cost when both are up.
  const orchestratorMatch = CHAT_SOURCE.match(/async function callChatWithFallback[\s\S]+?\n\}/);
  assert.ok(orchestratorMatch, "callChatWithFallback function body must be present");
  const body = orchestratorMatch[0];
  const geminiIdx = body.indexOf("callGeminiChat");
  const openrouterIdx = body.indexOf("callOpenRouterChat");
  assert.ok(geminiIdx > -1, "orchestrator must invoke callGeminiChat");
  assert.ok(openrouterIdx > -1, "orchestrator must invoke callOpenRouterChat as fallback");
  assert.ok(geminiIdx < openrouterIdx, "Gemini must be attempted BEFORE OpenRouter in the orchestrator");
});

test("chat handler: response includes provider field for ops visibility", () => {
  // Parity with /api/analyze: when the call succeeds, the response payload
  // must identify which provider actually answered so ops can correlate
  // latency and errors with provider health.
  const fnStart = CHAT_SOURCE.indexOf("module.exports = async function handler");
  assert.ok(fnStart > -1);
  const handlerBody = CHAT_SOURCE.slice(fnStart);
  assert.match(
    handlerBody,
    /Object\.assign\(\s*\{\}\s*,\s*parsed\.value\s*,\s*\{\s*provider:\s*out\.provider\s*\}\s*\)/,
    "successful response must include `provider` via Object.assign onto validated payload"
  );
});

test("chat handler: returns 503 when NEITHER provider is configured", () => {
  // A config-level problem (no provider keys at all) should fail fast with
  // a clear 503 instead of burning a request slot on a guaranteed 502.
  // The check must run AFTER rate-limit + body-cap gates so a flood of
  // misconfigured requests can't bypass the limiter either.
  const fnStart = CHAT_SOURCE.indexOf("module.exports = async function handler");
  assert.ok(fnStart > -1);
  const handlerBody = CHAT_SOURCE.slice(fnStart);
  assert.match(
    handlerBody,
    /hasGemini[\s\S]+?hasOpenRouter[\s\S]+?json\(res,\s*503/,
    "handler must check hasGemini && hasOpenRouter → 503 before any provider call"
  );
  assert.match(
    handlerBody,
    /No AI provider is configured\./,
    "503 body must say 'No AI provider is configured.' so ops can self-diagnose"
  );
});

test("chat handler: wires applyAiResponseHeaders with provider + latency on every AI-touched response", () => {
  // Parity with /api/analyze: every response that actually called the AI
  // reports the provider and wall-clock latency via response headers. The
  // three AI-touched paths in chat are: 200 success, 502 both-fail, 502
  // invalid_ai_response. The 503 neither-configured path skips AI entirely
  // (no headers needed; absence is itself a signal).
  assert.match(
    CHAT_SOURCE,
    /applyAiResponseHeaders/,
    "applyAiResponseHeaders must be imported from _safety.js"
  );
  const fnStart = CHAT_SOURCE.indexOf("module.exports = async function handler");
  const handlerBody = CHAT_SOURCE.slice(fnStart);

  // Capture the wall-clock latency once around the orchestrator
  assert.match(handlerBody, /aiStart\s*=\s*Date\.now\(\)/, "must capture aiStart before callChatWithFallback");
  assert.match(handlerBody, /aiLatencyMs\s*=\s*Date\.now\(\)\s*-\s*aiStart/, "must compute aiLatencyMs after the chain");

  // 502 both-fail must report provider "none". Optional 4th/5th/6th args allowed.
  assert.match(
    handlerBody,
    /applyAiResponseHeaders\(res,\s*"none"\s*,\s*aiLatencyMs(?:,\s*[^,)]+)?(?:,\s*(?:true|false|fallbackUsed))?(?:,\s*[^,)]+)?\)/,
    "502 both-fail path must call applyAiResponseHeaders with provider='none'"
  );
  // 502 invalid_ai and 200 success must report out.provider
  assert.match(
    handlerBody,
    /applyAiResponseHeaders\(res,\s*out\.provider\s*,\s*aiLatencyMs(?:,\s*[^,)]+)?(?:,\s*(?:true|false|fallbackUsed))?(?:,\s*[^,)]+)?\)/,
    "success / invalid_ai paths must call applyAiResponseHeaders with out.provider"
  );
});

test("chat handler: emits Retry-After on both 502 paths so clients back off", () => {
  // Parity with /api/analyze: when the chat AI is unreachable or the
  // schema fails, the response includes `Retry-After: 60` so monitoring
  // systems and the Ask-thread UI can back off instead of hot-loop retrying.
  const fnStart = CHAT_SOURCE.indexOf("module.exports = async function handler");
  assert.ok(fnStart > -1);
  const handlerBody = CHAT_SOURCE.slice(fnStart);

  // Both 502 paths must set Retry-After (orchestrator failure + invalid schema)
  const retryAfterMatches = [...handlerBody.matchAll(/res\.setHeader\("Retry-After",\s*"60"\)/g)];
  assert.ok(retryAfterMatches.length >= 2, "must set Retry-After on both 502 paths");

  // The 200 success path must NOT set Retry-After
  const ok200Match = handlerBody.match(/return\s+json\(res,\s*200,\s*Object\.assign/);
  assert.ok(ok200Match, "200 happy-path return must exist");
  // None of the Retry-After calls should appear after the 200 return
  const retryAfterInSuccessRegion = retryAfterMatches.some(
    (m) => m.index > ok200Match.index
  );
  assert.equal(retryAfterInSuccessRegion, false, "Retry-After must not appear in the 200 success region");

  // The 503 neither-configured path must NOT set Retry-After either — the
  // entire response is `application/json` "No AI provider is configured.",
  // not an outage the client should back off for. Source-position check.
  const noProvider503Match = handlerBody.match(/json\(res,\s*503,\s*\{\s*error:\s*"No AI provider is configured\."/);
  if (noProvider503Match) {
    // Look for Retry-After within the 503 block — should NOT be present.
    const searchRegion = handlerBody.slice(noProvider503Match.index, noProvider503Match.index + 400);
    assert.equal(/Retry-After/.test(searchRegion), false, "503 neither-configured path must NOT set Retry-After (config, not outage)");
  }
});

test("chat handler: passes fallbackUsed to applyAiResponseHeaders (Gemini primary, OpenRouter fallback)", () => {
  // For /api/chat the PRIMARY is Gemini. Fallback activated iff the
  // answering provider is OpenRouter. (Mirror of /api/analyze where the
  // primary/fallback roles are reversed.)
  const fnStart = CHAT_SOURCE.indexOf("module.exports = async function handler");
  assert.ok(fnStart > -1);
  const handlerBody = CHAT_SOURCE.slice(fnStart);

  // The computation must match — derived from the orchestrator's out.provider
  assert.match(
    handlerBody,
    /fallbackUsed\s*=\s*out\.provider\s*===\s*"openrouter"/,
    "must compute fallbackUsed = out.provider === 'openrouter' (Gemini is primary)"
  );
  // All three AI-touched applyAiResponseHeaders calls must pass fallbackUsed
  // as the 5th arg and SOMETHING expression-providing per-provider latency
  // as the 6th (e.g. out.perProviderMs, or a ternary that builds an object
  // literal when the orchestrator returned null).
  const callsWithFallback = [...handlerBody.matchAll(/applyAiResponseHeaders\(res,\s*[^,]+,\s*[^,]+(?:,\s*[^,]+)?,\s*(true|false|undefined|fallbackUsed)\s*,\s*[^)]*\)/g)];
  assert.ok(callsWithFallback.length >= 3, "must pass fallbackUsed + per-provider latency on all 3 AI-touched applyAiResponseHeaders call sites");
});

// ── Content-Type enforcement (iter #53) ───────────────────────────

test("chat handler: 415s non-JSON Content-Type before parsing the body", () => {
  // Same defense as /api/analyze — fail early with a precise 415
  // before letting JSON.parse produce a confusing 400.
  assert.match(CHAT_SOURCE, /application\/json\b/i, "must enforce application/json");
  assert.match(CHAT_SOURCE, /json\(res,\s*415/, "must respond 415");
});

// ── extractGeminiText behavioral (iter #140) ────────────────

test("extractGeminiText: joins text parts from a valid Gemini response", () => {
  // First code path: data has the canonical Gemini response shape
  // { candidates: [{ content: { parts: [{ text: "..." }, ...] } }] }.
  // Multiple parts are joined; non-string part.text values are skipped.
  const { extractGeminiText } = require("../api/chat.js");
  const data = {
    candidates: [
      {
        content: {
          parts: [
            { text: "Hello, " },
            { text: "world!" },
            { text: 42 },                // non-string → skipped
            { noTextField: "ignored" },  // no .text → skipped
            { text: "" },                // empty string → contributes nothing
          ],
        },
      },
    ],
  };
  assert.equal(extractGeminiText(data), "Hello, world!",
    "must join text parts and skip non-string / empty entries");
});

test("extractGeminiText: returns empty string for malformed input (defensive)", () => {
  // Second code path: anything that doesn't match the expected shape
  // returns "" without throwing. The caller treats "" as "no usable
  // response" and falls through to the OpenRouter fallback.
  const { extractGeminiText } = require("../api/chat.js");
  assert.equal(extractGeminiText(null), "", "null → \"\"");
  assert.equal(extractGeminiText(undefined), "", "undefined → \"\"");
  assert.equal(extractGeminiText({}), "", "empty object → \"\"");
  assert.equal(extractGeminiText({ candidates: [] }), "", "empty candidates → \"\"");
  assert.equal(extractGeminiText({ candidates: [{}] }), "", "candidate without content → \"\"");
  assert.equal(extractGeminiText({ candidates: [{ content: {} }] }), "",
    "content without parts → \"\"");
  assert.equal(extractGeminiText({ candidates: [{ content: { parts: "not array" } }] }), "",
    "parts not an array → \"\"");
  // parts is an empty array → "" (Array.isArray passes, map yields [])
  assert.equal(extractGeminiText({ candidates: [{ content: { parts: [] } }] }), "",
    "empty parts array → \"\"");
});

test("extractGeminiText: trims surrounding whitespace from joined output", () => {
  // The helper applies .trim() on the joined result so callers don't
  // need to re-trim before using the text. Inner whitespace between
  // parts is preserved (only outer whitespace is trimmed).
  const { extractGeminiText } = require("../api/chat.js");
  const data = {
    candidates: [
      { content: { parts: [{ text: "  hello  " }, { text: "  world  " }] } },
    ],
  };
  const result = extractGeminiText(data);
  // parts: ["  hello  ", "  world  "] → joined: "  hello    world  " → trimmed: "hello    world"
  assert.equal(result, "hello    world",
    "must trim outer whitespace only (inner between parts preserved)");
  // Verify no leading/trailing whitespace
  assert.equal(result, result.trim(), "result must equal its own trim()");
});

// ── buildPrompt behavioral (iter #141) ───────────────────────

test("buildPrompt: basic structure includes question, document, fileName", () => {
  // First code path: minimal valid input. The prompt must surface
  // every input field somewhere in the joined string.
  const { buildPrompt } = require("../api/chat.js");
  const result = buildPrompt({
    question: "What is the termination clause?",
    document: "This agreement terminates on Dec 31.",
    rewrite: "The deal ends in December.",
    risks: [],
    fileName: "contract.pdf",
    history: [],
  });
  assert.equal(typeof result, "string", "must return a string");
  assert.ok(result.includes("What is the termination clause?"),
    "must include the user's question");
  assert.ok(result.includes("This agreement terminates on Dec 31."),
    "must include the document text");
  assert.ok(result.includes("The deal ends in December."),
    "must include the plain-English rewrite");
  assert.ok(result.includes("contract.pdf"),
    "must include the file name when provided");
  // System prompt header is preserved
  assert.ok(result.includes("ClearDoc"),
    "must include the ClearDoc system prompt header");
});

test("buildPrompt: slices risks to a max of 12 entries", () => {
  // buildPrompt must cap risks at 12 so a malicious client can't pad
  // the prompt. With 15 risks, only the first 12 are emitted.
  const { buildPrompt } = require("../api/chat.js");
  const manyRisks = Array.from({ length: 15 }, (_, i) => ({
    label: `R${i + 1}`,
    reason: `reason-${i + 1}`,
    sentence: `sentence-${i + 1}`,
  }));
  const result = buildPrompt({
    question: "Q", document: "D", rewrite: "R", risks: manyRisks,
    fileName: null, history: [],
  });
  // Risks 1-12 should appear, 13-15 should NOT
  assert.ok(result.includes("R12"), "must include risk 12");
  assert.ok(result.includes("sentence-12"), "must include sentence-12");
  assert.ok(!result.includes("R13"), "must NOT include risk 13");
  assert.ok(!result.includes("R15"), "must NOT include risk 15");
  assert.ok(!result.includes("sentence-15"), "must NOT include sentence-15");
});

test("buildPrompt: slices history to MAX_HISTORY_TURNS (10) and truncates fields to MAX_HISTORY_FIELD_CHARS (500)", () => {
  // Prompt-injection defense: cap history turns AND per-field length.
  const { buildPrompt } = require("../api/chat.js");
  const manyTurns = Array.from({ length: 15 }, (_, i) => ({
    q: `Q${i + 1}`,
    a: "A".repeat(1000) + i,  // 1001-char response, should be truncated to 500
  }));
  const result = buildPrompt({
    question: "latest", document: "D", rewrite: "R", risks: [],
    fileName: null, history: manyTurns,
  });
  // Turns 1-10 should appear, 11-15 should NOT
  assert.ok(result.includes("Q10"), "must include history turn 10");
  assert.ok(!result.includes("Q11"), "must NOT include history turn 11");
  assert.ok(!result.includes("Q15"), "must NOT include history turn 15");
  // Per-field truncation: each "A" block should be ≤ 500 chars.
  // The test just checks the marker "AAAA" (4+ chars) is present in
  // the prompt — proving SOME history made it through — and that the
  // 1001-char raw value doesn't appear as-is (would need 1001 A's).
  assert.ok(result.includes("AAAA"), "history content reached the prompt");
  // Verify by looking for a 500+ char run of A's and a 1001+ char run
  // of A's — only the former should be present.
  assert.ok(/(?:A){500,}/.test(result), "must include a 500-char A run (truncation cap)");
  assert.ok(!(/(?:A){1001,}/.test(result)), "must NOT include a 1001-char A run (cap is 500)");
});

test("buildPrompt: defensive against malformed / missing inputs", () => {
  // The function must not throw on missing or wrong-typed fields.
  // The handler relies on these guards before forwarding user data
  // to the AI provider.
  const { buildPrompt } = require("../api/chat.js");
  // No args at all → must not throw, must return a string
  const empty = buildPrompt({});
  assert.equal(typeof empty, "string", "empty input → string");
  // Non-array risks → empty risk block
  const noRisks = buildPrompt({
    question: "Q", document: "D", risks: "not an array",
    fileName: null, history: [],
  });
  assert.equal(typeof noRisks, "string");
  assert.ok(!noRisks.includes("Source:"), "non-array risks → no risk lines emitted");
  // Non-array history → empty history block
  const noHistory = buildPrompt({
    question: "Q", document: "D", risks: [],
    fileName: null, history: "not an array",
  });
  assert.equal(typeof noHistory, "string");
  // History with non-string fields → those fields become ""
  const junkHistory = buildPrompt({
    question: "Q", document: "D", risks: [],
    fileName: null, history: [{ q: 42, a: null }, { q: "valid q", a: "valid a" }],
  });
  assert.equal(typeof junkHistory, "string");
  assert.ok(junkHistory.includes("valid q"), "valid history turn must pass through");
  // The invalid entry is filtered (both q and a are empty after coercion)
  assert.ok(!junkHistory.includes("Q: \n   A: "), "invalid turn (both fields empty) must be filtered");
});

test("buildPrompt: fileName omitted → \"Attached file name:\" line is also omitted", () => {
  // When fileName is null/empty/undefined, the prompt must skip the
  // "Attached file name:" header entirely (not emit an empty one).
  const { buildPrompt } = require("../api/chat.js");
  const noFile = buildPrompt({
    question: "Q", document: "D", risks: [], fileName: null, history: [],
  });
  assert.ok(!noFile.includes("Attached file name:"),
    "null fileName → no \"Attached file name:\" line");
  const undefFile = buildPrompt({
    question: "Q", document: "D", risks: [], history: [],
  });
  assert.ok(!undefFile.includes("Attached file name:"),
    "undefined fileName → no \"Attached file name:\" line");
});

/* test/chat-schema.test.js — node:test unit tests for the strict
 * chat-response schema validator in api/_safety.js (safeParseChatResult).
 *
 * Project RULES.md, STRICT RULE #3: "Strict zod validation (fail-closed) for
 * AI responses. Partial legal data is more dangerous than no data. Never add
 * tolerance for malformed fields."
 *
 * This is the chat-side companion to test/analyze-schema.test.js. The
 * /api/chat response shape is simpler than /api/analyze, but the same
 * principle applies: malformed fields fail closed rather than ship degraded
 * data to the user.
 *
 * Run with: node --test test/chat-schema.test.js
 */

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  CHAT_LIMITS,
  safeParseChatResult,
} = require("../api/_safety.js");

function validChat(overrides = {}) {
  return Object.assign(
    {
      answer: "Yes, the indemnity clause covers losses for the full term.",
      citation: "Gemini answer · based on analyzed document",
      model: "gemini-2.5-flash",
    },
    overrides
  );
}

// ── top-level shape ────────────────────────────────────────────────

test("safeParseChatResult: rejects null, undefined, primitives, and arrays at top level", () => {
  for (const bad of [null, undefined, "string", 42, true, [], [{}]]) {
    const r = safeParseChatResult(bad);
    assert.equal(r.ok, false, `should reject ${JSON.stringify(bad)}`);
    assert.ok(Array.isArray(r.errors) && r.errors.length > 0);
  }
});

test("safeParseChatResult: accepts a fully valid input and returns cleaned value", () => {
  const r = safeParseChatResult(validChat());
  assert.equal(r.ok, true);
  assert.equal(r.value.answer, validChat().answer);
  assert.equal(r.value.citation, validChat().citation);
  assert.equal(r.value.model, validChat().model);
});

// ── answer ──────────────────────────────────────────────────────────

test("safeParseChatResult: rejects answer that is not a string", () => {
  for (const bad of [null, undefined, 42, true, [], { a: 1 }]) {
    const r = safeParseChatResult(validChat({ answer: bad }));
    assert.equal(r.ok, false, `should reject answer=${JSON.stringify(bad)}`);
    assert.ok(r.errors.some((e) => /answer: must be a string/.test(e)));
  }
});

test("safeParseChatResult: rejects empty answer (whitespace-only or zero-length)", () => {
  for (const empty of ["", "   ", "\n\t  \n"]) {
    const r = safeParseChatResult(validChat({ answer: empty }));
    assert.equal(r.ok, false, `should reject whitespace-only answer ${JSON.stringify(empty)}`);
    assert.ok(r.errors.some((e) => /answer: must not be empty/.test(e)));
  }
});

test("safeParseChatResult: truncates answer to CHAT_LIMITS.answerMax", () => {
  const huge = "x".repeat(CHAT_LIMITS.answerMax * 3);
  const r = safeParseChatResult(validChat({ answer: huge }));
  assert.equal(r.ok, true);
  assert.equal(r.value.answer.length, CHAT_LIMITS.answerMax);
});

// ── model ──────────────────────────────────────────────────────────

test("safeParseChatResult: rejects model that is not a string", () => {
  for (const bad of [null, 42, [], {}]) {
    const r = safeParseChatResult(validChat({ model: bad }));
    assert.equal(r.ok, false, `should reject model=${JSON.stringify(bad)}`);
    assert.ok(r.errors.some((e) => /model: must be a string/.test(e)));
  }
});

test("safeParseChatResult: rejects empty model string", () => {
  const r = safeParseChatResult(validChat({ model: "   " }));
  assert.equal(r.ok, false);
  assert.ok(r.errors.some((e) => /model: must not be empty/.test(e)));
});

test("safeParseChatResult: truncates model to CHAT_LIMITS.modelMax", () => {
  const long = "m".repeat(CHAT_LIMITS.modelMax * 2);
  const r = safeParseChatResult(validChat({ model: long }));
  assert.equal(r.ok, true);
  assert.equal(r.value.model.length, CHAT_LIMITS.modelMax);
});

// ── citation ───────────────────────────────────────────────────────

test("safeParseChatResult: rejects citation that is not a string", () => {
  for (const bad of [null, 99, [], { x: 1 }]) {
    const r = safeParseChatResult(validChat({ citation: bad }));
    assert.equal(r.ok, false, `should reject citation=${JSON.stringify(bad)}`);
    assert.ok(r.errors.some((e) => /citation: must be a string/.test(e)));
  }
});

test("safeParseChatResult: rejects empty citation string", () => {
  const r = safeParseChatResult(validChat({ citation: "" }));
  assert.equal(r.ok, false);
  assert.ok(r.errors.some((e) => /citation: must not be empty/.test(e)));
});

test("safeParseChatResult: truncates citation to CHAT_LIMITS.citationMax", () => {
  const long = "c".repeat(CHAT_LIMITS.citationMax * 2);
  const r = safeParseChatResult(validChat({ citation: long }));
  assert.equal(r.ok, true);
  assert.equal(r.value.citation.length, CHAT_LIMITS.citationMax);
});

// ── multi-field error collection ───────────────────────────────────

test("safeParseChatResult: collects errors across all bad fields at once", () => {
  const r = safeParseChatResult({
    answer: 42,
    model: null,
    citation: [],
  });
  assert.equal(r.ok, false);
  assert.ok(r.errors.length >= 3, `expected ≥3 errors, got ${r.errors.length}`);
  const joined = r.errors.join(" | ");
  for (const hint of ["answer", "model", "citation"]) {
    assert.ok(joined.includes(hint), `error list should mention ${hint}: ${joined}`);
  }
});

// ── CHAT_LIMITS sanity ─────────────────────────────────────────────

test("CHAT_LIMITS: is frozen and exposes the documented caps", () => {
  assert.equal(Object.isFrozen(CHAT_LIMITS), true, "CHAT_LIMITS must be frozen");
  for (const k of ["answerMin", "answerMax", "modelMax", "citationMax"]) {
    assert.ok(k in CHAT_LIMITS, `CHAT_LIMITS should expose ${k}`);
    assert.equal(typeof CHAT_LIMITS[k], "number");
    assert.ok(Number.isFinite(CHAT_LIMITS[k]));
    assert.ok(CHAT_LIMITS[k] > 0);
  }
});
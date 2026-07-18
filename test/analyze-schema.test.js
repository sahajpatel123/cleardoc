/* test/analyze-schema.test.js — node:test unit tests for the strict
 * AI-response schema validator in api/_safety.js (safeParseAnalysisResult).
 *
 * Project RULES.md, STRICT RULE #3: "Strict zod validation (fail-closed) for
 * AI responses. Partial legal data is more dangerous than no data. Never add
 * tolerance for malformed fields."
 *
 * These tests lock in that behavior: malformed shapes fail with descriptive
 * errors, capped shapes round-trip cleanly, valid enum values pass, unknown
 * severities / verdict labels fail closed.
 *
 * Run with: node --test test/analyze-schema.test.js
 */

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  ANALYSIS_LIMITS,
  VALID_SEVERITIES,
  VALID_VERDICT_LABELS,
  validSeverity,
  validVerdictLabel,
  safeParseAnalysisResult,
} = require("../api/_safety.js");

// ── helpers ────────────────────────────────────────────────────────

function validAnalysis(overrides = {}) {
  return Object.assign(
    {
      plainEnglishRewrite: "You must pay within 30 days. <b>This is important.</b>",
      risks: [
        {
          severity: "trap",
          clause: "Lessee shall indemnify in perpetuity.",
          explanation: "You cover losses forever.",
          impact: "Permanent liability.",
        },
        {
          severity: "watch",
          clause: "Auto-renews for successive terms.",
          explanation: "Auto-renews unless cancelled.",
          impact: "Could pay another term.",
        },
        {
          severity: "note",
          clause: "Governing law: California.",
          explanation: "CA law applies.",
          impact: "None directly.",
        },
      ],
      verdict: {
        label: "Suspicious",
        summary: "Two clauses deserve attention before signing.",
      },
      deadlines: [
        { date: "30 days", description: "Cancellation window for auto-renewal." },
        { date: "60 days", description: "Notice period for lease termination." },
      ],
      nextSteps: [
        "Read the indemnity clause carefully before signing.",
        "Calendar the cancellation deadline.",
        "Get all verbal promises in writing.",
      ],
      readingLevel: { before: 14, after: 8 },
      jargonFound: 7,
    },
    overrides
  );
}

// ── enum guards ────────────────────────────────────────────────────

test("validSeverity: accepts exactly the three known severities", () => {
  for (const s of VALID_SEVERITIES) {
    assert.equal(validSeverity(s), s, `"${s}" should be valid`);
  }
});

test("validSeverity: rejects unknown strings, casing variants, and non-strings", () => {
  assert.equal(validSeverity("alert"), null);
  assert.equal(validSeverity("Trap"), null);    // wrong case is rejected (strict)
  assert.equal(validSeverity(""), null);
  assert.equal(validSeverity(null), null);
  assert.equal(validSeverity(undefined), null);
  assert.equal(validSeverity(1), null);
  assert.equal(validSeverity({}), null);
});

test("validVerdictLabel: accepts exactly the four known labels", () => {
  const expected = ["Likely Fair", "Needs Review", "Suspicious", "Likely Illegal"];
  for (const l of expected) {
    assert.equal(validVerdictLabel(l), l, `"${l}" should be valid`);
  }
});

test("validVerdictLabel: rejects unknown labels, lowercased variants, and non-strings", () => {
  assert.equal(validVerdictLabel("suspicious"), null);
  assert.equal(validVerdictLabel("Fair"), null);
  assert.equal(validVerdictLabel(""), null);
  assert.equal(validVerdictLabel(null), null);
  assert.equal(validVerdictLabel(undefined), null);
  assert.equal(validVerdictLabel(42), null);
});

// ── top-level shape ────────────────────────────────────────────────

test("safeParseAnalysisResult: rejects null, undefined, primitives, and arrays at top level", () => {
  for (const bad of [null, undefined, "string", 42, true, [], [{}]]) {
    const r = safeParseAnalysisResult(bad);
    assert.equal(r.ok, false, `should reject ${JSON.stringify(bad)}`);
    assert.ok(Array.isArray(r.errors) && r.errors.length > 0);
  }
});

test("safeParseAnalysisResult: accepts a fully valid input and returns cleaned value with caps", () => {
  const r = safeParseAnalysisResult(validAnalysis());
  assert.equal(r.ok, true);
  assert.equal(r.value.plainEnglishRewrite, validAnalysis().plainEnglishRewrite);
  assert.equal(r.value.risks.length, 3);
  assert.equal(r.value.verdict.label, "Suspicious");
  assert.equal(r.value.deadlines.length, 2);
  assert.equal(r.value.nextSteps.length, 3);
  assert.deepEqual(r.value.readingLevel, { before: 14, after: 8 });
  assert.equal(r.value.jargonFound, 7);
});

test("safeParseAnalysisResult: allows empty risks and deadlines arrays", () => {
  const input = validAnalysis({ risks: [], deadlines: [] });
  const r = safeParseAnalysisResult(input);
  assert.equal(r.ok, true);
  assert.deepEqual(r.value.risks, []);
  assert.deepEqual(r.value.deadlines, []);
});

// ── length caps (single source of truth in ANALYSIS_LIMITS) ────────

test("safeParseAnalysisResult: truncates long strings to ANALYSIS_LIMITS caps", () => {
  const longClause = "x".repeat(ANALYSIS_LIMITS.riskClause * 3);
  const longSummary = "y".repeat(ANALYSIS_LIMITS.verdictSummary * 3);
  const longPER = "z".repeat(ANALYSIS_LIMITS.plainEnglishRewrite * 2);
  const input = validAnalysis({
    plainEnglishRewrite: longPER,
    risks: [
      { severity: "trap", clause: longClause, explanation: "ok", impact: "ok" },
    ],
    verdict: { label: "Suspicious", summary: longSummary },
  });
  const r = safeParseAnalysisResult(input);
  assert.equal(r.ok, true);
  assert.equal(r.value.plainEnglishRewrite.length, ANALYSIS_LIMITS.plainEnglishRewrite);
  assert.equal(r.value.risks[0].clause.length, ANALYSIS_LIMITS.riskClause);
  assert.equal(r.value.verdict.summary.length, ANALYSIS_LIMITS.verdictSummary);
});

test("safeParseAnalysisResult: rejects when risks exceed the cap", () => {
  const tooMany = Array.from({ length: ANALYSIS_LIMITS.risks + 1 }, () => ({
    severity: "note", clause: "ok", explanation: "ok", impact: "ok",
  }));
  const r = safeParseAnalysisResult(validAnalysis({ risks: tooMany }));
  assert.equal(r.ok, false);
  assert.ok(r.errors.some((e) => /risks: at most/.test(e)));
});

test("safeParseAnalysisResult: rejects when deadlines exceed the cap", () => {
  const tooMany = Array.from({ length: ANALYSIS_LIMITS.deadlines + 1 }, () => ({
    date: "ok", description: "ok",
  }));
  const r = safeParseAnalysisResult(validAnalysis({ deadlines: tooMany }));
  assert.equal(r.ok, false);
  assert.ok(r.errors.some((e) => /deadlines: at most/.test(e)));
});

test("safeParseAnalysisResult: rejects when nextSteps exceed the cap", () => {
  const tooMany = Array.from({ length: ANALYSIS_LIMITS.nextSteps + 1 }, () => "step");
  const r = safeParseAnalysisResult(validAnalysis({ nextSteps: tooMany }));
  assert.equal(r.ok, false);
  assert.ok(r.errors.some((e) => /nextSteps: at most/.test(e)));
});

// ── plainEnglishRewrite ────────────────────────────────────────────

test("safeParseAnalysisResult: fails when plainEnglishRewrite is not a string", () => {
  const r = safeParseAnalysisResult(validAnalysis({ plainEnglishRewrite: 123 }));
  assert.equal(r.ok, false);
  assert.ok(r.errors.some((e) => /plainEnglishRewrite: must be a string/.test(e)));
});

test("safeParseAnalysisResult: fails when plainEnglishRewrite is missing", () => {
  const input = validAnalysis();
  delete input.plainEnglishRewrite;
  const r = safeParseAnalysisResult(input);
  assert.equal(r.ok, false);
  assert.ok(r.errors.some((e) => /plainEnglishRewrite/.test(e)));
});

test("safeParseAnalysisResult: accepts empty plainEnglishRewrite (still a string)", () => {
  const r = safeParseAnalysisResult(validAnalysis({ plainEnglishRewrite: "" }));
  assert.equal(r.ok, true);
  assert.equal(r.value.plainEnglishRewrite, "");
});

// ── risks array ────────────────────────────────────────────────────

test("safeParseAnalysisResult: rejects non-array risks", () => {
  for (const bad of [null, "string", 42, {}]) {
    const r = safeParseAnalysisResult(validAnalysis({ risks: bad }));
    assert.equal(r.ok, false);
    assert.ok(r.errors.some((e) => /risks: must be an array/.test(e)), `risks=${JSON.stringify(bad)}`);
  }
});

test("safeParseAnalysisResult: rejects risks entries with unknown severity", () => {
  const input = validAnalysis({
    risks: [
      { severity: "alert", clause: "x", explanation: "x", impact: "x" },
    ],
  });
  const r = safeParseAnalysisResult(input);
  assert.equal(r.ok, false);
  assert.ok(r.errors.some((e) => /risks\[0\]\.severity/.test(e)));
  assert.ok(r.errors.some((e) => /trap\/watch\/note/.test(e)));
});

test("safeParseAnalysisResult: rejects risks entries with wrong-type fields", () => {
  const cases = [
    { severity: "trap", clause: 1, explanation: "ok", impact: "ok" },
    { severity: "trap", clause: "ok", explanation: null, impact: "ok" },
    { severity: "trap", clause: "ok", explanation: "ok", impact: { a: 1 } },
    "not-an-object",
    [1, 2, 3],
  ];
  for (const bad of cases) {
    const r = safeParseAnalysisResult(validAnalysis({ risks: [bad] }));
    assert.equal(r.ok, false, `should reject risks entry: ${JSON.stringify(bad)}`);
    assert.ok(r.errors.length > 0);
  }
});

test("safeParseAnalysisResult: collects multiple errors across multiple fields", () => {
  const input = validAnalysis({
    plainEnglishRewrite: 42,
    risks: "not-array",
    verdict: { label: "Unknown", summary: 99 },
    deadlines: [{ date: 1, description: "ok" }],
    nextSteps: [42],
    readingLevel: { before: "high", after: 50 },
    jargonFound: "lots",
  });
  const r = safeParseAnalysisResult(input);
  assert.equal(r.ok, false);
  // Expect at least one error per problematic field
  assert.ok(r.errors.length >= 5, `expected ≥5 errors, got ${r.errors.length}: ${JSON.stringify(r.errors)}`);
  const joined = r.errors.join(" | ");
  for (const hint of [
    "plainEnglishRewrite",
    "risks",
    "verdict",
    "deadlines",
    "nextSteps",
    "readingLevel",
    "jargonFound",
  ]) {
    assert.ok(joined.includes(hint), `error list should mention ${hint}: ${joined}`);
  }
});

// ── verdict ────────────────────────────────────────────────────────

test("safeParseAnalysisResult: rejects verdict with unknown label", () => {
  const r = safeParseAnalysisResult(validAnalysis({
    verdict: { label: "Totally Fine", summary: "ok" },
  }));
  assert.equal(r.ok, false);
  assert.ok(r.errors.some((e) => /verdict\.label/.test(e)));
});

test("safeParseAnalysisResult: rejects verdict with non-object shape", () => {
  for (const bad of [null, "string", 99, ["a", "b"]]) {
    const r = safeParseAnalysisResult(validAnalysis({ verdict: bad }));
    assert.equal(r.ok, false);
    assert.ok(r.errors.some((e) => /verdict: must be an object/.test(e)), `verdict=${JSON.stringify(bad)}`);
  }
});

test("safeParseAnalysisResult: rejects verdict.summary that is not a string", () => {
  const r = safeParseAnalysisResult(validAnalysis({
    verdict: { label: "Suspicious", summary: 123 },
  }));
  assert.equal(r.ok, false);
  assert.ok(r.errors.some((e) => /verdict\.summary/.test(e)));
});

// ── deadlines ──────────────────────────────────────────────────────

test("safeParseAnalysisResult: rejects non-array deadlines and wrong-shape entries", () => {
  const r1 = safeParseAnalysisResult(validAnalysis({ deadlines: "soon" }));
  assert.equal(r1.ok, false);
  assert.ok(r1.errors.some((e) => /deadlines: must be an array/.test(e)));

  const r2 = safeParseAnalysisResult(validAnalysis({
    deadlines: [{ date: 42, description: "ok" }],
  }));
  assert.equal(r2.ok, false);
  assert.ok(r2.errors.some((e) => /deadlines\[0\]\.date/.test(e)));

  const r3 = safeParseAnalysisResult(validAnalysis({
    deadlines: [{ date: "ok", description: null }],
  }));
  assert.equal(r3.ok, false);
  assert.ok(r3.errors.some((e) => /deadlines\[0\]\.description/.test(e)));
});

// ── nextSteps ──────────────────────────────────────────────────────

test("safeParseAnalysisResult: rejects nextSteps with non-string entries", () => {
  for (const bad of [[1, 2, 3], [{ a: 1 }], [null]]) {
    const r = safeParseAnalysisResult(validAnalysis({ nextSteps: bad }));
    assert.equal(r.ok, false, `should reject nextSteps: ${JSON.stringify(bad)}`);
    assert.ok(r.errors.some((e) => /nextSteps\[0\]: must be a string/.test(e)));
  }
});

// ── readingLevel ───────────────────────────────────────────────────

test("safeParseAnalysisResult: rejects readingLevel out of range and non-numeric", () => {
  const cases = [
    { before: 0, after: 5 },     // below min
    { before: 21, after: 5 },    // above max
    { before: 5, after: -1 },    // after below min
    { before: "high", after: 5 },// non-numeric
    { before: 5, after: NaN },   // NaN
    { before: 5.7, after: 5 },   // non-integer numeric
  ];
  for (const rl of cases) {
    const r = safeParseAnalysisResult(validAnalysis({ readingLevel: rl }));
    assert.equal(r.ok, false, `should reject readingLevel ${JSON.stringify(rl)}`);
  }
});

test("safeParseAnalysisResult: accepts integer readingLevel values within range", () => {
  const r = safeParseAnalysisResult(validAnalysis({
    readingLevel: { before: 1, after: 20 },
  }));
  assert.equal(r.ok, true);
  assert.deepEqual(r.value.readingLevel, { before: 1, after: 20 });
});

// ── jargonFound ────────────────────────────────────────────────────

test("safeParseAnalysisResult: rejects jargonFound out of range and non-integer", () => {
  for (const j of [-1, 999, "lots", 3.5, null, undefined]) {
    const r = safeParseAnalysisResult(validAnalysis({ jargonFound: j }));
    assert.equal(r.ok, false, `should reject jargonFound=${JSON.stringify(j)}`);
  }
});

test("safeParseAnalysisResult: accepts boundary jargonFound values", () => {
  assert.equal(safeParseAnalysisResult(validAnalysis({ jargonFound: 0 })).ok, true);
  assert.equal(safeParseAnalysisResult(validAnalysis({
    jargonFound: ANALYSIS_LIMITS.jargonFoundMax,
  })).ok, true);
});

// ── ANALYSIS_LIMITS sanity ────────────────────────────────────────

test("ANALYSIS_LIMITS: is frozen and contains the documented caps", () => {
  assert.equal(Object.isFrozen(ANALYSIS_LIMITS), true, "ANALYSIS_LIMITS must be frozen");
  for (const k of [
    "plainEnglishRewrite",
    "risks", "riskClause", "riskExplanation", "riskImpact",
    "verdictLabel", "verdictSummary",
    "deadlines", "deadlineDate", "deadlineDescription",
    "nextSteps", "nextStepItem",
    "readingLevelMin", "readingLevelMax",
    "jargonFoundMin", "jargonFoundMax",
  ]) {
    assert.ok(k in ANALYSIS_LIMITS, `ANALYSIS_LIMITS should expose ${k}`);
    assert.equal(typeof ANALYSIS_LIMITS[k], "number");
    assert.ok(Number.isFinite(ANALYSIS_LIMITS[k]));
  }
});

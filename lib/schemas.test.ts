import { describe, it } from "node:test"
import assert from "node:assert/strict"
import {
  AnalysisResultSchema,
  safeParseAnalysisResult,
  ChatRequestSchema,
  RephraseRequestSchema,
  parseOrError,
} from "./schemas"

const valid = {
  plain_summary: "Summary.",
  red_flags: [
    {
      issue: "Bad clause",
      severity: "high" as const,
      explanation: "Not allowed.",
      source_text: "pay now",
    },
  ],
  response_letter: "Dear Sir,",
  next_steps: [{ action: "Call", reason: "Fast", priority: 1 }],
  overall_verdict: "suspicious" as const,
}

describe("AnalysisResultSchema (zod strict)", () => {
  it("accepts a valid payload", () => {
    const out = safeParseAnalysisResult(valid)
    assert.ok(out, "valid payload should parse")
    assert.equal(out!.overall_verdict, "suspicious")
  })

  // The previous validate-analysis.ts allowed NaN and Infinity for numeric
  // fields. The strict zod schema explicitly rejects both. This is the
  // regression for the C-tier "NaN priority sorts to non-deterministic
  // order" bug.
  it("rejects NaN priority", () => {
    assert.equal(
      safeParseAnalysisResult({
        ...valid,
        next_steps: [{ action: "a", reason: "r", priority: Number.NaN }],
      }),
      null,
    )
  })

  it("rejects Infinity priority", () => {
    assert.equal(
      safeParseAnalysisResult({
        ...valid,
        next_steps: [{ action: "a", reason: "r", priority: Number.POSITIVE_INFINITY }],
      }),
      null,
    )
  })

  it("rejects negative priority (out of range)", () => {
    assert.equal(
      safeParseAnalysisResult({
        ...valid,
        next_steps: [{ action: "a", reason: "r", priority: -1 }],
      }),
      null,
    )
  })

  it("rejects non-integer priority", () => {
    assert.equal(
      safeParseAnalysisResult({
        ...valid,
        next_steps: [{ action: "a", reason: "r", priority: 1.5 }],
      }),
      null,
    )
  })

  it("rejects oversized red_flags (DoS guard)", () => {
    const tooMany = {
      ...valid,
      red_flags: Array.from({ length: 51 }, () => valid.red_flags[0]),
    }
    assert.equal(safeParseAnalysisResult(tooMany), null)
  })

  it("accepts empty next_steps array (edge-case illegible documents)", () => {
    const out = safeParseAnalysisResult({ ...valid, next_steps: [] })
    assert.ok(out, "empty next_steps should parse — avoids unnecessary retry cost on edge-case docs")
    assert.equal(out!.next_steps.length, 0)
  })

  it("rejects extra unknown fields on the root (strict mode)", () => {
    assert.equal(
      safeParseAnalysisResult({ ...valid, smuggled: "injection" }),
      null,
    )
  })

  it("rejects extra unknown fields on a red flag (strict mode)", () => {
    assert.equal(
      safeParseAnalysisResult({
        ...valid,
        red_flags: [{ ...valid.red_flags[0], leaked: true }],
      }),
      null,
    )
  })

  it("rejects relative deadline missing anchor_date", () => {
    const bad = {
      ...valid,
      deadlines: [
        {
          label: "l",
          description: "d",
          urgency: "high" as const,
          date_type: "relative" as const,
          relative_rule: "30 days from notice",
          source_text: "x",
        },
      ],
    }
    assert.equal(safeParseAnalysisResult(bad), null)
  })

  it("rejects absolute deadline with bogus date", () => {
    const bad = {
      ...valid,
      deadlines: [
        {
          label: "l",
          description: "d",
          urgency: "high" as const,
          date_type: "absolute" as const,
          absolute_date: "not-a-date",
          source_text: "x",
        },
      ],
    }
    assert.equal(safeParseAnalysisResult(bad), null)
  })

  it("accepts a well-formed absolute deadline", () => {
    const ok = {
      ...valid,
      deadlines: [
        {
          label: "Hearing",
          description: "Court date",
          urgency: "critical" as const,
          date_type: "absolute" as const,
          absolute_date: "2026-07-01",
          source_text: "on July 1",
        },
      ],
    }
    const out = safeParseAnalysisResult(ok)
    assert.ok(out)
    assert.equal(out!.deadlines!.length, 1)
  })

  it("rejects priority as string", () => {
    assert.equal(
      safeParseAnalysisResult({
        ...valid,
        next_steps: [{ action: "a", reason: "r", priority: "1" as unknown as number }],
      }),
      null,
    )
  })
})

describe("ChatRequestSchema", () => {
  it("accepts a valid chat request", () => {
    const out = parseOrError(ChatRequestSchema, {
      analysisId: "clp1234567890abcdefghij",
      message: "What should I say on the call?",
    })
    assert.equal(out.ok, true)
  })

  it("rejects empty message", () => {
    const out = parseOrError(ChatRequestSchema, {
      analysisId: "clp1234567890abcdefghij",
      message: "",
    })
    assert.equal(out.ok, false)
  })

  it("rejects over-long message (DoS guard)", () => {
    const out = parseOrError(ChatRequestSchema, {
      analysisId: "clp1234567890abcdefghij",
      message: "x".repeat(2_001),
    })
    assert.equal(out.ok, false)
  })

  it("rejects non-cuid analysisId", () => {
    const out = parseOrError(ChatRequestSchema, {
      analysisId: "not-a-cuid",
      message: "hi",
    })
    assert.equal(out.ok, false)
  })
})

describe("RephraseRequestSchema", () => {
  it("accepts a valid tone", () => {
    const out = parseOrError(RephraseRequestSchema, {
      analysisId: "clp1234567890abcdefghij",
      tone: "firm",
    })
    assert.equal(out.ok, true)
  })

  it("rejects an unknown tone", () => {
    const out = parseOrError(RephraseRequestSchema, {
      analysisId: "clp1234567890abcdefghij",
      tone: "aggressive",
    })
    assert.equal(out.ok, false)
  })
})

describe("AnalysisResultSchema is a discriminated union for deadlines", () => {
  it("rejects a deadline with both absolute and relative fields", () => {
    // The discriminated union means a relative deadline MUST NOT have
    // absolute_date and vice versa. This is impossible to express with the
    // hand-rolled guard in the old validate-analysis.ts.
    const hybrid = {
      ...valid,
      deadlines: [
        {
          label: "x",
          description: "d",
          urgency: "high" as const,
          date_type: "relative" as const,
          relative_rule: "30 days",
          anchor_date: "2026-01-01",
          absolute_date: "2026-02-01", // extra; should fail
          source_text: "x",
        },
      ],
    }
    assert.equal(safeParseAnalysisResult(hybrid), null)
  })
})

// Sanity: schema is exported as a Zod schema (typed) — verifies the schema
// itself parses without throwing.
describe("schema introspection", () => {
  it("AnalysisResultSchema is a zod object schema", () => {
    assert.equal(typeof AnalysisResultSchema.safeParse, "function")
  })
})

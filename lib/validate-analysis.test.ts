import { describe, it } from "node:test"
import assert from "node:assert/strict"
import { parseAnalysisResult } from "./validate-analysis"

const valid = {
  plain_summary: "Summary.",
  red_flags: [
    {
      issue: "Bad clause",
      severity: "high",
      explanation: "Not allowed.",
      source_text: "pay now",
    },
  ],
  response_letter: "Dear Sir,",
  next_steps: [{ action: "Call", reason: "Fast", priority: 1 }],
  overall_verdict: "suspicious",
}

describe("parseAnalysisResult", () => {
  it("accepts a valid payload", () => {
    const parsed = parseAnalysisResult(valid)
    assert.ok(parsed)
    assert.equal(parsed?.overall_verdict, "suspicious")
  })

  it("rejects invalid verdict and severity", () => {
    assert.equal(parseAnalysisResult({ ...valid, overall_verdict: "bad" }), null)
    assert.equal(
      parseAnalysisResult({
        ...valid,
        red_flags: [{ ...valid.red_flags[0], severity: "critical" }],
      }),
      null,
    )
  })

  it("accepts optional deadlines", () => {
    const withDeadlines = {
      ...valid,
      deadlines: [
        {
          label: "Appeal",
          description: "Must appeal within 30 days",
          urgency: "critical",
          date_type: "relative",
          relative_rule: "30 days from notice date",
          anchor_date: "2026-05-01",
          source_text: "You have 30 days to appeal",
        },
      ],
    }
    const parsed = parseAnalysisResult(withDeadlines)
    assert.ok(parsed)
    assert.equal(parsed?.deadlines?.length, 1)
  })

  it("accepts analyses without deadlines (backward compatible)", () => {
    const parsed = parseAnalysisResult(valid)
    assert.ok(parsed)
    assert.equal(parsed?.deadlines, undefined)
  })
})

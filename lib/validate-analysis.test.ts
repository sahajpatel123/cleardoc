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

  it("rejects non-objects", () => {
    assert.equal(parseAnalysisResult(null), null)
    assert.equal(parseAnalysisResult("text"), null)
  })
})

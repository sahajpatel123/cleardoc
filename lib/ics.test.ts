import { describe, it } from "node:test"
import assert from "node:assert/strict"
import { computeDeadlineDate, parseIsoDate, parseRelativeDays } from "./ics"

describe("ics utilities", () => {
  it("parses ISO dates", () => {
    const d = parseIsoDate("2026-05-26")
    assert.ok(d)
    assert.equal(d!.getUTCFullYear(), 2026)
  })

  it("parses relative day counts", () => {
    assert.equal(parseRelativeDays("30 days from notice date"), 30)
  })

  it("computes relative deadline dates", () => {
    const date = computeDeadlineDate(
      {
        date_type: "relative",
        relative_rule: "30 days from notice date",
        anchor_date: "2026-05-01",
      },
      "2026-05-01",
    )
    assert.ok(date)
    assert.equal(date!.toISOString().slice(0, 10), "2026-05-31")
  })
})

import { describe, it } from "node:test"
import assert from "node:assert/strict"
import {
  buildFreeDailyQuotaStatus,
  FREE_DAILY_ANALYSIS_LIMIT,
  nextUtcMidnight,
  startOfUtcDay,
} from "./free-quota"

describe("free daily quota", () => {
  it("builds remaining count from used analyses", () => {
    const status = buildFreeDailyQuotaStatus(1)
    assert.equal(status.limit, FREE_DAILY_ANALYSIS_LIMIT)
    assert.equal(status.used, 1)
    assert.equal(status.remaining, 2)
  })

  it("clamps used at limit", () => {
    const status = buildFreeDailyQuotaStatus(99)
    assert.equal(status.used, FREE_DAILY_ANALYSIS_LIMIT)
    assert.equal(status.remaining, 0)
  })

  it("startOfUtcDay zeroes time", () => {
    const d = startOfUtcDay(new Date("2026-05-26T15:30:00.000Z"))
    assert.equal(d.getUTCHours(), 0)
    assert.equal(d.getUTCMinutes(), 0)
  })

  it("nextUtcMidnight is after start of day", () => {
    const start = startOfUtcDay(new Date("2026-05-26T15:30:00.000Z"))
    const next = nextUtcMidnight(new Date("2026-05-26T15:30:00.000Z"))
    assert.ok(next.getTime() > start.getTime())
    assert.equal(next.getUTCDate(), 27)
  })
})

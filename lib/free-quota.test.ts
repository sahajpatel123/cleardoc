import { describe, it } from "node:test"
import assert from "node:assert/strict"
import {
  buildFreeDailyQuotaStatus,
  FREE_DAILY_ANALYSIS_LIMIT,
  nextUtcMidnight,
  startOfUtcDay,
} from "./free-quota"

/**
 * FAILURE INJECTION / STRESS REGRESSION SUITE (Failure Injection Swarm)
 * These pure-function tests + the "MENTAL EXECUTABLE TEST CASES" below
 * must pass before any quota/AI/atomic-save change ships.
 *
 * Real concurrency stress (N parallel /api/analyze for same free userId hitting
 * the pg_advisory_xact_lock path in saveFreeAnalysisWithQuota) requires a
 * test DB + load harness. Use the cases below as the spec for the Concurrency
 * swarm / Red Team to attack proposed fixes.
 */
describe("free daily quota", () => {
  it("builds remaining count from used analyses", () => {
    const status = buildFreeDailyQuotaStatus(0)
    assert.equal(status.limit, FREE_DAILY_ANALYSIS_LIMIT)
    assert.equal(status.used, 0)
    assert.equal(status.remaining, FREE_DAILY_ANALYSIS_LIMIT)
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

  // Regression for quota math under burst conditions (pre-check + save gate)
  it("exactly at limit reports zero remaining", () => {
    const status = buildFreeDailyQuotaStatus(FREE_DAILY_ANALYSIS_LIMIT)
    assert.equal(status.remaining, 0)
    assert.equal(status.used, FREE_DAILY_ANALYSIS_LIMIT)
  })

  it("negative used is clamped (defensive against corrupt counts)", () => {
    const status = buildFreeDailyQuotaStatus(-5)
    assert.equal(status.used, 0)
    assert.equal(status.remaining, FREE_DAILY_ANALYSIS_LIMIT)
  })
})

/**
 * ═══════════════════════════════════════════════════════════════════════════
 * EXECUTABLE MENTAL TEST CASES — QUOTA / AI CONCURRENCY (for Red Team attack)
 * These must be executed (manually, via k6/artillery, or dedicated integration
 * test binary) against any proposed change to free-quota, db.ts saveFree*,
 * analyze route pre-check, or AI retry budget.
 *
 * CASE Q1: Concurrent quota burst (4 free users, 0 used, start of UTC day)
 *   - Fire 4 simultaneous POST /api/analyze (same userId, valid small PDF)
 *   - All 4 must pass the pre-check (checkFreeDailyQuota sees used<3)
 *   - Exactly 3 analyses must be saved (the 4th saveFreeAnalysisWithQuota
 *     returns {ok:false} under the advisory lock serialization)
 *   - The loser MUST receive 402 FREE_DAILY_LIMIT_REACHED (never a saved id)
 *   - AI cost for the 4th call is burned (acceptable per current design;
 *     any fix claiming "zero waste" must prove it without weakening atomicity)
 *   - Verify via direct countUserAnalysesSince + dashboard that limit held.
 *
 * CASE Q2: Pre-check / save TOCTOU with day rollover mid-flight
 *   - Start 2 requests 1s before UTC midnight (both pass pre-check at used=2)
 *   - One AI finishes before rollover, one after.
 *   - Both saves must succeed or one correctly sees new-day count=0.
 *   - No over-limit row created; advisory lock protects per tx.
 *
 * CASE Q3: AI failure after pre-check (no quota burn)
 *   - Force NVIDIA to return invalid JSON or timeout on a free user at used=2.
 *   - Request returns 5xx/JSON error; no Analysis row created.
 *   - Subsequent request still sees remaining=1 (no phantom decrement).
 *
 * CASE Q4: Mixed Pro + Free concurrent (Pro bypasses quota path entirely)
 *   - 10 concurrent from Pro (should all save), 4 from Free (3 save).
 *   - No cross-contamination of counts.
 *
 * Attack vectors for Red Team:
 *   - Remove the pg_advisory_xact_lock → expect 4/4 saves on burst (FAIL)
 *   - Make pre-check the only gate → easy bypass with 2 parallel tabs
 *   - Any change that refunds on AI error using a counter (re-introduces
 *     the legacy reserve/refund races that were removed)
 *
 * Property-based thinking: for any starting `used` in 0..3, for any N in 1..20
 * concurrent attempts, final saved count for the day must be min(used + N, 3)
 * and every loser must have seen the 402 at save time (or pre if perfectly timed).
 * ═══════════════════════════════════════════════════════════════════════════
 */

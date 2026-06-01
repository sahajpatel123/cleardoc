import { describe, it } from "node:test"
import assert from "node:assert/strict"
import { isProUser } from "./user-plan"

describe("isProUser", () => {
  it("returns false for null/undefined", () => {
    assert.equal(isProUser(null), false)
    assert.equal(isProUser(undefined), false)
  })

  it("requires plan pro and subscription active", () => {
    assert.equal(isProUser({ plan: "pro", subscriptionStatus: "active" }), true)
    assert.equal(isProUser({ plan: "pro", subscriptionStatus: "trialing" }), false)
    assert.equal(isProUser({ plan: "pro", subscriptionStatus: "inactive" }), false)
    assert.equal(isProUser({ plan: "free", subscriptionStatus: "active" }), false)
  })

  // Hardening: null/undefined DB rows (deleted user, blip) must never grant Pro
  it("treats missing subscriptionStatus as non-pro", () => {
    assert.equal(
      isProUser({ plan: "pro", subscriptionStatus: undefined as unknown as string }),
      false,
    )
  })
})

/**
 * STRESS NOTE (Failure Injection Swarm): isProUser is called on every
 * authenticated request + usage + analyze gate. Any change here must survive
 * concurrent calls with every combination of plan/status from real User rows
 * (including during webhook partial updates). Add property test if this grows.
 */

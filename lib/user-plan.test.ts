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
})

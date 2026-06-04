/**
 * Pro access requires both plan label and a non-delinquent subscription
 * record. A subscription is considered "Pro-granting" when its status is
 * `active` OR `trialing` — both mean the user is currently entitled to
 * Pro features (Stripe grants access during a free trial). The webhook
 * in app/api/stripe/webhook/route.ts writes `subscriptionStatus: "active"`
 * for both statuses, so reading back from the DB this function must
 * accept the same set, otherwise a trialing user would be silently
 * downgraded to free at the gate despite their DB row saying "pro".
 *
 * `past_due` is treated as NON-Pro: the user has a payment failure, the
 * webhook has revoked the label via `plan: "free"`, and even if a stale
 * row still says `plan: "pro"`, we must not grant access until payment
 * recovers. `inactive` and `canceled` are also NON-Pro.
 *
 * Split-brain mitigation: when the webhook receives a `subscription.deleted`
 * or `past_due` event, it sets `plan: "free"`. So in practice the
 * `plan === "pro"` check is the primary gate; this status check is a
 * belt-and-braces defense in case the label was somehow updated without
 * a corresponding status change.
 */
export function isProUser(user: {
  plan: string
  subscriptionStatus: string
} | null | undefined): boolean {
  if (!user || user.plan !== "pro") return false
  return user.subscriptionStatus === "active" || user.subscriptionStatus === "trialing"
}

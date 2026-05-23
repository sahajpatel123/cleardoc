/** Pro access requires both plan label and an active subscription record. */
export function isProUser(user: {
  plan: string
  subscriptionStatus: string
} | null | undefined): boolean {
  return user?.plan === "pro" && user.subscriptionStatus === "active"
}

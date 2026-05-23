/** Required environment variables for production API routes. */
export const REQUIRED_SERVER_ENV = [
  "DATABASE_URL",
  "NEXTAUTH_SECRET",
  "ANTHROPIC_API_KEY",
] as const

export const REQUIRED_STRIPE_ENV = [
  "STRIPE_SECRET_KEY",
  "STRIPE_WEBHOOK_SECRET",
  "NEXT_PUBLIC_APP_URL",
] as const

export function getMissingEnv(keys: readonly string[]): string[] {
  return keys.filter((key) => !process.env[key]?.trim())
}

export function assertServerEnv(): void {
  const missing = getMissingEnv(REQUIRED_SERVER_ENV)
  if (missing.length > 0) {
    throw new Error(`Missing required environment variables: ${missing.join(", ")}`)
  }
}

export function assertStripeEnv(): void {
  const missing = getMissingEnv(REQUIRED_STRIPE_ENV)
  if (missing.length > 0) {
    throw new Error(`Missing Stripe environment variables: ${missing.join(", ")}`)
  }
}

export function getAppUrl(): string {
  const url = process.env.NEXT_PUBLIC_APP_URL?.trim()
  if (!url) throw new Error("NEXT_PUBLIC_APP_URL is not set")
  return url.replace(/\/$/, "")
}

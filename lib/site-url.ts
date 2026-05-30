/**
 * Canonical public origin for the site, resolved robustly for both local dev
 * and Vercel. Used by metadata (metadataBase), robots, sitemap, and OG images.
 *
 * Priority:
 *  1. NEXT_PUBLIC_APP_URL — the explicit production URL (also used for Stripe).
 *  2. VERCEL_PROJECT_PRODUCTION_URL / VERCEL_URL — auto-injected on Vercel.
 *  3. http://localhost:3000 — local fallback.
 *
 * Always returns an absolute origin with no trailing slash.
 */
export function resolveSiteUrl(): string {
  const explicit = process.env.NEXT_PUBLIC_APP_URL?.trim()
  if (explicit) return stripTrailingSlash(withProtocol(explicit))

  const prod = process.env.VERCEL_PROJECT_PRODUCTION_URL?.trim()
  if (prod) return `https://${stripTrailingSlash(prod)}`

  const vercel = process.env.VERCEL_URL?.trim()
  if (vercel) return `https://${stripTrailingSlash(vercel)}`

  return "http://localhost:3000"
}

function withProtocol(url: string): string {
  return /^https?:\/\//i.test(url) ? url : `https://${url}`
}

function stripTrailingSlash(url: string): string {
  return url.replace(/\/+$/, "")
}

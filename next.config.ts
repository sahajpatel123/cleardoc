import type { NextConfig } from "next"
// Build-time security headers. These are the ONLY active CSP because the
// previous middleware (proxy.ts) was removed as dead code. Every path gets
// these headers. 'unsafe-inline' for scripts is required without a nonce-
// generating middleware; Next.js bootstrap emits inline scripts that would
// be blocked otherwise.
const SECURITY_HEADERS: ReadonlyArray<{ key: string; value: string }> = [
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Strict-Transport-Security", value: "max-age=31536000; includeSubDomains; preload" },
  { key: "X-XSS-Protection", value: "1; mode=block" },
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=(), payment=(), usb=(), interest-cohort=()",
  },
  // Hardened CSP — the only active source since middleware was removed.
  // frame-ancestors blocks clickjacking; upgrade-insecure-requests forces
  // HTTPS for any mixed-content subresources.
  {
    key: "Content-Security-Policy",
    value: [
      "default-src 'self'",
      "script-src 'self' 'unsafe-inline' https://js.stripe.com",
      "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
      "img-src 'self' data: blob:",
      "font-src 'self' https://fonts.gstatic.com",
      "connect-src 'self' https://integrate.api.nvidia.com https://api.stripe.com",
      "frame-src 'self' https://js.stripe.com https://hooks.stripe.com",
      "object-src 'none'",
      "base-uri 'self'",
      "form-action 'self'",
      "frame-ancestors 'none'",
      "upgrade-insecure-requests",
    ].join("; "),
  },
]

const nextConfig: NextConfig = {
  poweredByHeader: false,
  productionBrowserSourceMaps: false,
  serverExternalPackages: ["pdf2json"],
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [...SECURITY_HEADERS],
      },
    ]
  },
}

// Wrap with Sentry config when SENTRY_DSN is configured. We require it
// lazily so dev runs without Sentry installed still work.
let withSentry: (cfg: NextConfig) => NextConfig = (c) => c
try {
  if (process.env.SENTRY_DSN?.trim()) {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    withSentry = require("@sentry/nextjs").withSentryConfig
  }
} catch {
  if (process.env.SENTRY_DSN?.trim()) {
    throw new Error(
      "SENTRY_DSN is set but @sentry/nextjs failed to load. " +
      "Install the package or unset SENTRY_DSN."
    )
  }
  // Sentry not installed and no DSN — proceed without wrapper
}

export default withSentry(nextConfig)

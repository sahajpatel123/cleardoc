import type { NextConfig } from "next"
// Build-time security headers. Middleware (middleware.ts) is the canonical
// path: it sets a per-request nonce and emits the active CSP. These build-
// time headers are the FALLBACK for static export / middleware-bypassed
// paths only. They are intentionally strict (no 'unsafe-inline' for scripts)
// so any successful XSS cannot run arbitrary JS even on a static path.
// See D003.
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
  // Strict CSP fallback. The active runtime CSP is generated per-request in
  // middleware.ts with a fresh nonce. The fallback uses a fixed empty nonce
  // directive so any inline script will be blocked — there is no path on
  // which 'unsafe-inline' is honoured.
  {
    key: "Content-Security-Policy",
    value: [
      "default-src 'self'",
      // No 'unsafe-inline' — middleware.ts generates a per-request nonce for
      // the canonical path. The empty nonce here is intentional: any inline
      // script on a static-exported path will be blocked, not bypassed.
      "script-src 'self' 'nonce-' https://js.stripe.com",
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
  experimental: {
    optimizePackageImports: ["framer-motion", "lucide-react"],
  },
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

import { NextResponse } from "next/server"
import type { NextRequest } from "next/server"

/**
 * Edge proxy (formerly `middleware.ts` in Next.js ≤ 15) that protects
 * authenticated surfaces and enforces a strict CSP. Two responsibilities:
 *
 *   1. Auth gate for /dashboard, /analyze, /analyze/session, /analyze/[id].
 *      Unauthenticated requests get a 302 to /login?redirect=… instead of
 *      receiving the full HTML shell. This closes the client-only auth-guard
 *      anti-pattern where a curl/Googlebot/non-JS client could read the
 *      protected page layout.
 *
 *   2. Per-request CSP nonce generation. Removes the 'unsafe-inline' fallback
 *      from `next.config.ts` so any successful XSS cannot run arbitrary JS
 *      (see D003). The nonce is exposed via `x-csp-nonce` request header for
 *      server components / <Script nonce={…}/> in the app.
 *
 * Why this runs on the Edge runtime: auth check is cookie-based (no DB), and
 * CSP nonce generation must be deterministic per request. NextAuth's `auth()`
 * is supported in middleware; we use a lightweight cookie probe here to avoid
 * pulling the Edge-incompatible Prisma adapter into the runtime.
 *
 * Verification: NextAuth v5 sets `authjs.session-token` (or `__Secure-…` on
 * https). A present cookie is necessary but not sufficient for a valid session
 * (the JWT can be revoked via tokenVersion). The middleware only rejects
 * requests with no cookie; final validity is enforced server-side in
 * /api/* routes and in the page's useAuth() check on the client.
 */
const PROTECTED_PREFIXES = [
  "/dashboard",
  "/analyze",
  "/api/analyses",
  "/api/usage",
  "/api/chat",
  "/api/rephrase-letter",
]
const SESSION_COOKIE_NAMES = [
  "authjs.session-token",
  "__Secure-authjs.session-token",
  "next-auth.session-token",
  "__Secure-next-auth.session-token",
]

function hasSessionCookie(req: NextRequest): boolean {
  for (const name of SESSION_COOKIE_NAMES) {
    if (req.cookies.get(name)?.value) return true
  }
  return false
}

function isProtectedPath(pathname: string): boolean {
  for (const p of PROTECTED_PREFIXES) {
    if (pathname === p || pathname.startsWith(`${p}/`)) return true
  }
  return false
}

// Paths that must NOT be blocked even though they match a protected prefix.
// These handle their own auth internally (e.g. NextAuth, cron bearer tokens).
const AUTH_EXEMPT_PREFIXES = ["/api/auth", "/api/cron", "/api/health"]

function base64Encode(bytes: Uint8Array): string {
  // Edge runtime lacks Buffer; use btoa on a binary string.
  let binary = ""
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]!)
  return btoa(binary)
}

const IS_DEV = process.env.NODE_ENV !== "production"

export function proxy(req: NextRequest) {
  const { pathname, search } = req.nextUrl

  const isExempt = AUTH_EXEMPT_PREFIXES.some((p) => pathname === p || pathname.startsWith(`${p}/`))

  if (isProtectedPath(pathname) && !isExempt && !hasSessionCookie(req)) {
    // API routes return 401 JSON; page routes redirect to login.
    if (pathname.startsWith("/api/")) {
      return NextResponse.json(
        { error: "Unauthorized" },
        { status: 401 },
      )
    }
    const url = req.nextUrl.clone()
    url.pathname = "/login"
    url.search = `?redirect=${encodeURIComponent(pathname + search)}`
    return NextResponse.redirect(url)
  }

  // Per-request CSP nonce. Generated from crypto.getRandomValues which is
  // available in both Node and Edge runtimes. The nonce is exposed on the
  // request as `x-csp-nonce` so server components can attach it to
  // <Script nonce={headers().get('x-csp-nonce')} />.
  const nonceBytes = new Uint8Array(16)
  crypto.getRandomValues(nonceBytes)
  const nonce = base64Encode(nonceBytes)

  // React 19 dev mode uses `eval()` to reconstruct call stacks from
  // a different environment. Blocking it crashes the browser console
  // with "eval() is not supported in this environment" and breaks
  // dev-only debugging features. Production CSP must NOT include
  // 'unsafe-eval' (XSS mitigation per D003). The dev-only branch below
  // adds it back so `next dev` is usable out of the box.
  const scriptSrc = IS_DEV
    ? `script-src 'self' 'nonce-${nonce}' 'unsafe-eval' 'unsafe-inline' https://js.stripe.com`
    : `script-src 'self' 'nonce-${nonce}' https://js.stripe.com`

  const csp = [
    "default-src 'self'",
    scriptSrc,
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
  ].join("; ")

  const requestHeaders = new Headers(req.headers)
  requestHeaders.set("x-csp-nonce", nonce)
  requestHeaders.set("x-nonce", nonce)

  const response = NextResponse.next({ request: { headers: requestHeaders } })
  response.headers.set("Content-Security-Policy", csp)
  return response
}

export const config = {
  // Run on everything except static assets, image optimizer, and favicon. The
  // _next paths handle the framework's own static chunks.
  matcher: ["/((?!_next/static|_next/image|favicon.ico|robots.txt|sitemap.xml|opengraph-image).*)"],
}

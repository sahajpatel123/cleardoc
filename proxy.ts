import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'

export function proxy(request: NextRequest) {
  void request
  const response = NextResponse.next()

  // Content Security Policy.
  // NOTE: this runtime proxy header OVERRIDES the duplicate CSP in
  // next.config.ts (proxy runs per-request and wins), so the two MUST stay in
  // sync. 'unsafe-eval' is intentionally NOT granted — the app uses no eval/new
  // Function and Next's production bundles don't need it. 'unsafe-inline' for
  // scripts is still required because Next 16 + React 19 streaming SSR emits
  // inline bootstrap scripts and there is no nonce mechanism yet (nonce-based
  // CSP is a tracked follow-up).
  const csp = [
    "default-src 'self'",
    "script-src 'self' 'unsafe-inline' https://js.stripe.com",
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "img-src 'self' data: blob:",
    "font-src 'self' https://fonts.gstatic.com",
    "connect-src 'self' https://integrate.api.nvidia.com https://api.stripe.com",
    "frame-src 'self' https://js.stripe.com https://hooks.stripe.com",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'"
  ].join('; ')

  response.headers.set('Content-Security-Policy', csp)
  response.headers.set('X-Frame-Options', 'DENY')
  response.headers.set('X-Content-Type-Options', 'nosniff')
  response.headers.set('Referrer-Policy', 'strict-origin-when-cross-origin')
  response.headers.set('Permissions-Policy', 'interest-cohort=()')
  response.headers.set('Strict-Transport-Security', 'max-age=31536000; includeSubDomains; preload')

  return response
}

export const config = {
  matcher: '/:path*',
}

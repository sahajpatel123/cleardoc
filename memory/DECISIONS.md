# Decisions

Architectural and product decisions with rationale. Newest first.

---

## D008: Prioritize Remediation of Swarm Audit Vulnerabilities (VULN-01 to VULN-06)
**Date:** 2026-06-02
**Decision:** Prioritized the immediate patching of the six newly identified security and logical vulnerabilities in coming development sessions before proceeding with feature additions.
**Why:** The silent 2k character PDF truncation (VULN-01) and Redis quota leak (VULN-02) represent severe service degradation paths that undermine the core UX and customer trust.
**Impact:** Backlog updated; subsequent sprints will execute patches for text sanitization, catching routing leaks, log scrubbing, and connection pools.

## D007: Prisma $extends() over $use() middleware
**Date:** 2026-06-02
**Decision:** Migrated from Prisma `$use()` middleware to `$extends()` Client Extensions.
**Why:** `$use()` is deprecated in Prisma 6. `$extends()` is the supported extension API.
**Impact:** `lib/db.ts`, `lib/prisma.ts` — all middleware logic now uses client extensions.

## D006: Scrypt with explicit maxmem parameter
**Date:** 2026-06-02
**Decision:** Added `maxmem` parameter to scrypt hash/verify calls in `lib/password.ts`.
**Why:** Raising scrypt N without maxmem caused `ERR_CRYPTO_INVALID_SCRYPT_PARAMS` in production, breaking ALL signup and login.
**Impact:** Critical auth fix — all password hashing now has explicit memory bounds.

## D005: Framer Reveal uses scroll-listener, not whileInView
**Date:** 2026-06-02
**Decision:** Replaced `whileInView` with manual scroll-listener for Reveal animations.
**Why:** `whileInView` caused "blank below fold" bug in production builds on mobile. The issue only reproduces in prod, not dev.
**Impact:** Homepage scrollytelling works correctly in production on all devices.

## D004: overflow-x: clip on html/body, never hidden
**Date:** 2026-06-02
**Decision:** Use `overflow-x: clip` instead of `overflow-x: hidden` on html/body.
**Why:** `overflow-x: hidden` kills `position: sticky` site-wide. This is a STRICT rule — never revert.
**Impact:** All sticky positioning (navigation, scrollytelling) depends on this.

## D003: Nonced CSP without 'unsafe-inline'
**Date:** 2026-06-01
**Decision:** Per-request base64 nonce for CSP `script-src`; removed `'unsafe-inline'`.
**Why:** `'unsafe-inline'` defeated CSP purpose — any XSS could run arbitrary JS. Stripe redirect-only checkout (no `loadStripe`) makes this safe.
**Impact:** `proxy.ts` generates nonce, exposes via `x-csp-nonce` header. Build-time fallback retains `'unsafe-inline'` for static export paths only.

## D002: Distributed token-version cache (Redis + 5s in-memory)
**Date:** 2026-06-01
**Decision:** Token-version cache lives in Upstash Redis (30s TTL) with 5s in-memory hot path per instance.
**Why:** Previous process-local `Map` caused 60s+ revocation lag across serverless instances. User upgrading to Pro on instance A could be denied on instance B.
**Impact:** `lib/token-version-cache.ts` — errors fall through to DB; Redis outage cannot pin stale values.

## D001: Strict zod validation for AI responses (fail-closed)
**Date:** 2026-06-01
**Decision:** `safeParseAnalysisResult` rejects entire analysis on any malformed field. No partial data.
**Why:** Partial legal-adjacent data is more dangerous than no data. Previous `as AnalysisResult` cast laundered bad data into the type system.
**Impact:** `lib/schemas.ts` — strict zod schema with bounded arrays, finite integers, discriminated deadline union. Terminal type cast removed from `lib/ai.ts`.

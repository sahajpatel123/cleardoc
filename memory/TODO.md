# TODO

Current backlog, priorities, and blockers. Organized by priority.

---

## Critical (Do Before Next Production Deploy)

- [ ] Replace `sk_test_` keys with `sk_live_` in `.env.vercel.prod` — boot guard will block production otherwise
- [ ] Verify Upstash Redis is configured in Vercel environment variables (rate limiting is disabled without it)
- [ ] **Remove `lib/rate-limit.ts` in-memory prod fallback** — fail-closed when Upstash missing (P0)
- [ ] **Move `lib/circuit-breaker.ts` to Redis** — `@upstash/redis` INCR + TTL replaces per-instance Map (P0)
- [ ] **Re-add `proxy.ts`/`middleware.ts` with nonce-based CSP** — remove `'unsafe-inline'` from `next.config.ts` (P0, contradicts D003)
- [ ] **Fix `lib/pending-analysis-store.ts` destructive `take()`** — replace with server-side pending-analysis table (P0)
- [ ] **Replace `app/dashboard/page.tsx` localStorage Pro with `useSession().user.isPro`** (P0)
- [ ] **Convert `app/page.tsx` sections to RSC, lazy-load framer-motion** — fix 41KB client-only landing (P0)
- [ ] **Remove `lib/db.ts` placeholder mode in prod** — throw on missing `DATABASE_URL` (P0)
- [ ] **Move `pg-bouncer-params.mjs` import in `lib/env.ts` to `lib/pooler.ts`** — wrong layer dependency (P0)
- [ ] **Make `lib/observability.ts` redaction deep-walk with allowlist** — current path-list leaks nested fields (P0)
- [ ] **Add timing-safe verify path for missing users in `auth.ts`** (P0)

## High Priority

- [ ] **Add image dimension cap in `/api/analyze` vision path** (P0, 2026-06-02) — Reject images >2048×2048 with 413, or resize to 1024×1024 max before base64-encoding. Currently 100% failing on oversize images with `rawLength: 0` empty completions. **Verdict: image size exhaustion is the most likely primary cause**, not trial quota or thinking mode. See `KNOWLEDGE/vision-empty-completion-diagnosis.md` for full root-cause analysis and confirmation test.
- [ ] **Demote env-safety log noise** (P1, 2026-06-02) — `assertProductionEnvSafety` fires a Sentry exception + 2 error-level pino lines on every `/api/analyze` request. The privacy concern is real but a known boot-time configuration, not a per-request error. Fix: change `log.error` → `log.warn` and gate `captureException` on first-failure-only (pattern used in `lib/rate-limit.ts:8`). 10-line change in `lib/env.ts` and `lib/observability.ts`. Burns Sentry free tier unnecessarily.
- [ ] Sign enterprise DPA with NVIDIA OR self-host NIM OR switch AI provider — trial endpoint sends documents to third party under their terms
- [ ] Add PII redaction to Vercel function logs (turn off `requestBody` and `responseBody` in Vercel → Project → Logs)
- [ ] Enable `noUncheckedIndexedAccess` in tsconfig.json (requires 20+ file refactor with array index guards)
- [ ] **Pin Stripe to stable `apiVersion`** — drop `2026-02-25.clover` preview (P1)
- [ ] **Lower scrypt `maxmem` from 256MB to 64MB** — DoS amplifier, or switch to argon2id (P1)
- [ ] **Add `formData()` body cap in `app/api/analyze/route.ts`** — Vercel silently truncates at 4.5MB (P1)
- [ ] **Document or fix `lib/free-quota.ts` UTC-day semantics** — users in PT see misleading "resets in 1h" (P1)
- [ ] **Cache AI system prompt** — 18KB sent on every chat/rephrase call (P1)
- [ ] **Wrap Stripe webhook side-effects in single Prisma transaction** — `lib/stripe-events.ts` claim race (P1)
- [ ] **Add `requestId` propagation to all API routes** (P1)
- [ ] **Add E2E tests (Playwright) for `/analyze`, `/dashboard`, `/pricing`** (P1)
- [ ] **Add unit tests for `lib/ai.ts`, `lib/ai-retry.ts`, `lib/rate-limit.ts`, `lib/circuit-breaker.ts`, `auth.ts`** (P1)
- [ ] **Add `useBilling.ts` URL allowlist** — regex-only is open-redirect risk (P1)
- [ ] **Move Sentry breadcrumb add to after redaction** — pre-redaction leaks (P1)
- [ ] **Delete stray `/1` file at repo root**

## Medium Priority

- [ ] Extract `app/page.tsx` (869 lines) into smaller components
- [ ] Add integration tests — currently only 4 pure utility test files, no integration/component coverage
- [ ] Add proper CI/CD pipeline (currently minimal GitHub Actions: lint, typecheck, test only)
- [ ] Set up Sentry DSN for production error tracking (currently opt-in, no-op without env vars)

## Low Priority

- [ ] Add Dockerfile for containerized deployment option
- [ ] Add rate limiting to `/api/chat` and `/api/rephrase-letter` endpoints
- [ ] Improve test coverage for API routes (currently no integration tests)
- [ ] Add E2E tests for critical flows (upload → analyze → view results)

## Completed (Recent)

- [x] Fix scrypt maxmem breaking auth in production (2026-06-02)
- [x] Migrate Prisma $use() to $extends() (2026-06-02)
- [x] Fix mobile blank-below-fold in production builds (2026-06-02)
- [x] Comprehensive security hardening — 85 fixes (2026-06-01)
- [x] Production-grade remediation — 46/46 tests (2026-06-01)
- [x] Fix Supabase pooler migration failures (2026-06-01)

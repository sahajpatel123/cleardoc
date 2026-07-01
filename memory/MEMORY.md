# ClearDoc — Central Memory

This directory is the shared memory system for all CLI agents working on ClearDoc. Read these files at the start of every session.

## Index

| File | Purpose |
|------|---------|
| [MEMORY.md](MEMORY.md) | This file — project overview and index |
| [DECISIONS.md](DECISIONS.md) | Architectural and product decisions with rationale |
| [CHANGES.md](CHANGES.md) | Chronological change log of significant work |
| [TODO.md](TODO.md) | Current backlog, priorities, and blockers |
| [RULES.md](RULES.md) | Mandatory rules for all agents + project conventions |
| [LOGBOOK.md](LOGBOOK.md) | Multi-agent work log (append-only) |
| [KNOWLEDGE/](KNOWLEDGE/) | Deep-dive reference docs on specific subsystems |

## KNOWLEDGE Index

- [architecture-mental-model.md](KNOWLEDGE/architecture-mental-model.md) — Comprehensive mental model: systems, flows, risks, dependencies, and cautions (2026-06-04 ultracode analysis)
- [vision-empty-completion-diagnosis.md](KNOWLEDGE/vision-empty-completion-diagnosis.md) — Root cause analysis of `rawLength: 0` failures in `/api/analyze` vision path (2026-06-02). Verdict: image size exhaustion, not trial quota or thinking mode.
- [comprehensive-analysis-2026-06-06.md](KNOWLEDGE/comprehensive-analysis-2026-06-06.md) — 16-agent ultracode analysis: architecture, systems, runtime flow, state/data flow, P0-P2 risks, fragile areas, security, performance, 13 STRICT rules (2026-06-06)

## Project Overview

**ClearDoc** is a Next.js 16 web app that helps everyday people understand intimidating official documents (insurance denials, medical bills, eviction notices, IRS letters, debt collection, visa rejections). Users upload a document and receive:

- Plain-English summary
- Red flags with severity and triggering sentences
- Ready-to-send response letter
- Ranked next steps with free resources
- Overall verdict (legitimate / suspicious / likely illegal)
- Extracted deadlines with calendar export

**Monetization:** Free tier (3 saved analyses/day) → Pro $9/month (unlimited use, case linking, higher chat/letter limits).

## Tech Stack

| Layer | Choice |
|-------|--------|
| Framework | Next.js 16 (App Router, Turbopack), React 19, TypeScript strict |
| Styling | Tailwind CSS v4 (`@import "tailwindcss"` — no config file) |
| Auth | NextAuth v5 (Credentials: email + password, scrypt) |
| Database | PostgreSQL + Prisma 6 (Supabase in production) |
| AI | OpenRouter (`openai` SDK, `google/gemma-4-31b-it:free` primary, configurable fallback chains) |
| PDF / image | `pdf2json` for text PDFs; images analyzed via OpenRouter vision models |
| Payments | Stripe subscriptions (Checkout + Billing Portal + webhook) |
| Rate limit | Upstash Redis (optional but required for production) |
| Observability | Pino (structured logging) + Sentry (opt-in via env) |

## Key Files

- `auth.ts` — NextAuth config (Credentials, JWT, token-version invalidation)
- `middleware.ts` — Auth gate (cookie check) + CSP nonce generation (Edge runtime)
- `app/` — App Router pages + API routes
- `app/api/analyze/` — Core: extract → AI → save (auth + quota + rate limit)
- `app/api/chat/` — Per-analysis call-prep chat
- `app/api/stripe/*` — Checkout, portal, idempotent webhook
- `lib/` — db, ai-client, ai-model, ai-completion, ai-parse, ai-provider, ai-provider-errors, ai-errors, ai-retry, analysis-ai, normalize-analysis, validate-analysis, stripe, stripe-events, env, rate-limit, redis-circuit, circuit-breaker, free-quota, schemas, observability, semaphore, image-cap, pdf-parser, pending-analysis-store, token-version-cache, user-plan, webhook-inflight, case-context, db-timeout, ics, password, types, verdict-ui, faq-content, site-url, prisma, redis
- `prisma/schema.prisma` — Data model (User, Analysis, Case, Session, ProcessedStripeEvent)
- `REVIEW.md` — Full production-grade remediation record (read first for context)
- `DESIGN.md` — Design system spec (colors, typography, spacing)

## Current State (as of 2026-06-06)

- **Prod readiness:** 5/10 (comprehensive analysis 2026-06-06)
- **Security:** 6/10 (middleware added, CSP nonce-based, most VULNs patched)
- **Scalability:** 5/10
- **Test coverage:** 46 tests passing (node:test, not Jest), ~3-5% line coverage
- **CI:** GitHub Actions (lint, typecheck, test, build, npm audit)
- **Deploy:** Vercel auto-deploy from git (Hobby plan); Supabase for DB; OpenRouter for AI
- **Recent work:** NVIDIA→OpenRouter migration, AI pipeline refactor (9-file split), semaphore rewrite, model chain system with fallback budgets, middleware.ts auth gate + CSP nonce

### Latest Audit (2026-06-02, condensed 38-section review)

Re-ran full-spectrum forensic review via dynamic-workflow-emulator skill (swarm orchestration simulated inline since Task tool unavailable). Condensed 38-section report delivered. Sections marked `[partial]` had unread regions.

- **P0 (10):** in-memory `lib/rate-limit.ts` prod fallback; per-instance `lib/circuit-breaker.ts`; destructive `lib/pending-analysis-store.ts` `take()`; `next.config.ts` CSP `'unsafe-inline'` (contradicts D003); `app/dashboard/page.tsx` Pro-from-localStorage; `lib/observability.ts` path-list redaction; `app/page.tsx` 41KB `"use client"`; `lib/env.ts` imports `scripts/pg-bouncer-params.mjs`; `lib/db.ts` placeholder mode; `auth.ts` missing-user timing.
- **P1 (13):** Stripe `2026-02-25.clover` preview API; scrypt `maxmem: 256MB` (DoS amplifier); `app/api/analyze/route.ts` 120s `maxDuration` + retry blow-up; no `formData()` body cap (silent 4.5MB truncation); IDB + memory + sessionStorage triple-source in pending-analysis; 30s Redis TTL on token-version; `lib/free-quota.ts` UTC-day timezone lies; AI 18KB prompt re-sent every call; `lib/stripe-events.ts` non-atomic claim; `hooks/useBilling.ts` regex-only URL validation; Sentry breadcrumb pre-redaction; `auth.ts` `signIn` callback on JWT validation; `instrumentation.ts` swallows Sentry init errors.
- **P2 (16):** `lib/validate-analysis.ts` tolerant parser; `lib/pdf-parser.ts` `pdf2json` memory spike; `lib/ics.ts` no string escape; `lib/ensure-schema.ts` runtime DDL; `lib/env.ts` unusual env precedence; `app/error.tsx` vs `app/global-error.tsx` coverage; `app/api/cron/cleanup/route.ts` GET for mutations; `app/dashboard/page.tsx` 15KB client; `app/login/page.tsx` 18KB client; `components/ui/Atmosphere.tsx` and `Kinetic.tsx` framer-motion per component; missing `Permissions-Policy`; `lib/db-timeout.ts` × `lib/circuit-breaker.ts` uncoordinated; `lib/types.ts` Prisma coupling; `lib/free-quota.ts` clock skew; `app/sitemap.ts` lists client-only `/`; disclaimer/privacy/terms not fully read.
- **P3 (8):** stray `/1` file; self-deprecating comments in `lib/pending-analysis-store.ts`; suspected DRY violation `lib/user-plan.ts` vs `lib/db.ts`; `lib/verdict-ui.ts` / `lib/faq-content.ts` misfiled; `lib/site-url.ts` origin disagreement; `DESIGN.md` drift; `eslint.config.mjs` flat-config new; `next-auth.d.ts` at repo root.
- **REVIEW.md cross-check:** at least 6 claimed fixes do not hold against current source — in-memory rate-limit fallback, per-instance circuit-breaker, dashboard localStorage Pro, `app/page.tsx` SSR, scrypt `maxmem` still 256MB, and `lib/ai.ts` system prompt size all remain.

## Known Critical Issues (Updated 2026-06-06)

### P0 — Production Blockers
1. **Vercel Hobby maxDuration silent cap**: `/api/analyze` sets 120s but Hobby caps at 60s. Vision chains can exceed this.
2. **Redis SPOF**: All rate-limited routes return 503 when Redis circuit opens. In-memory fallback is per-instance only.
3. **Free quota drift**: Redis optimistic counter drifts from DB on timeout/kill. Daily reconciliation cron only runs once/day.
4. **No middleware auth for `/api/auth/signup`**: Only rate-limited, not cookie-checked by middleware.
5. **Missing rate limiting on read routes**: `/api/analyses`, `/api/analyses/[id]`, `/api/analyses/case/[caseId]`, `/api/chat GET` have no rate limiting.

### P1 — High Impact
6. **`ensure-schema.ts` incomplete**: Missing `paymentFailedAttempts` and `Case` columns from REQUIRED_COLUMNS check.
7. **Untracked migration**: `prisma/migrations/20260604180000_user_payment_failed_attempts/` not in git.
8. **AI free model dependency**: `google/gemma-4-31b-it:free` on OpenRouter has rate limits and availability risks.
9. **Stripe `stripeSubscriptionId` not unique**: Same subscription could be linked to multiple users.
10. **Per-instance circuit breaker**: No cross-instance coordination; each serverless instance opens/closes independently.

### P2 — Medium Impact (Carried from prior analysis)
11. **`withDbTimeout` doesn't cancel queries**: Advisory locks persist after timeout.
12. **PDF parser blocks event loop**: `pdf2json` is synchronous; worker path reverted for Vercel.
13. **41KB landing page**: `app/page.tsx` is mostly `"use client"` with framer-motion.
14. **No email verification, password reset, account deletion** (GDPR).
15. **No E2E tests**: 1 Playwright spec, not in CI.
16. **CSP `connect-src` hardcoded**: Only `openrouter.ai` and `api.stripe.com`.
17. **Node version confusion**: `.nvmrc` says 22, package.json says 22.x, runtime v24.4.1.

### FIXED (Previously P0, now resolved)
- ✅ VULN-01: `sanitizeUserInput` now caps at 80K chars (was 2K)
- ✅ VULN-02: `/api/analyze` now releases quota on all failure paths including abort
- ✅ CSP `'unsafe-inline'`: middleware.ts now generates per-request nonces (D003)
- ✅ Middleware auth gate: `middleware.ts` added, protects `/dashboard`, `/analyze`, `/api/*` routes
- ✅ Semaphore permit leak: Rewritten in `lib/semaphore.ts` with proper abort/timeout cleanup
- ✅ NVIDIA NIM: Migrated to OpenRouter (privacy concern resolved)
- ✅ `lib/db.ts` placeholder mode: Now throws on missing `DATABASE_URL` in production

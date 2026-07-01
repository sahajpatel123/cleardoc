---
name: cleardoc-comprehensive-analysis-2026-06-06
description: "16-agent comprehensive analysis of ClearDoc codebase — architecture, systems, risks, cautions"
metadata: 
  node_type: memory
  type: project
  originSessionId: b7a61a57-9016-45d2-ab18-2562d377f816
---

# ClearDoc Comprehensive Analysis (2026-06-06)

16-agent ultracode analysis — architecture, backend, frontend, cross-cutting dimensions.

## Overall Architecture

Next.js 16 App Router on Vercel (Hobby) + Supabase PostgreSQL + Prisma 6 + OpenRouter AI (google/gemma-4-31b-it:free) + Stripe + Upstash Redis. 194 files, 15 API routes, ~3-5% test coverage.

## Key Architecture Changes Since Last Analysis

- **AI provider**: Migrated from NVIDIA NIM → OpenRouter (commits 983355f, 248ce53, e4747a9)
- **AI pipeline refactored**: Split god-module `ai.ts` into 9 focused files (ai-client, ai-model, ai-completion, ai-parse, ai-provider, ai-provider-errors, ai-errors, normalize-analysis, validate-analysis)
- **Semaphore rewritten**: New `lib/semaphore.ts` properly handles abort signals and timeouts with cleanup
- **Model chain system**: Text path (primary + fallbacks) and vision path (primary + fallbacks) with `perModelTimeoutMs` fair-share budget splitting
- **Middleware added**: `middleware.ts` with auth cookie gate + CSP nonce generation
- **Payment failed attempts**: New `User.paymentFailedAttempts` field + downshift evaluation logic

## Runtime Flow (Core: POST /api/analyze)

1. `UV_THREADPOOL_SIZE=8` set as first executable line
2. Origin CSRF check → auth() → rate limit (IP + user) → free quota reserve (Redis INCR)
3. File extraction (PDF via pdf2json sync / image via Sharp)
4. Cache check (Redis GET SHA-256) → AI call (semaphore 5 concurrent, circuit breaker, model chain)
5. Zod validation → cache set (Redis SETEX 24h) → DB save (advisory-locked for free tier)
6. Release quota on failure paths including abort

## P0 Risks (Production Blockers)

1. **Vercel Hobby maxDuration silent cap**: 120s configured → 60s actual on Hobby
2. **Redis SPOF**: All rate-limited routes 503 when circuit opens
3. **Free quota drift**: Redis counter drifts from DB; daily reconciliation only
4. **No middleware auth for /api/auth/signup**: Only rate-limited, not cookie-checked
5. **Missing rate limiting** on several read routes (analyses GET, chat GET, case GET)

## P1 Risks (High Impact)

6. **ensure-schema.ts incomplete**: Missing `paymentFailedAttempts` and `Case` columns
7. **Untracked migration**: `20260604180000_user_payment_failed_attempts` not in git
8. **AI free model dependency**: `google/gemma-4-31b-it:free` has rate limits and availability risks
9. **Stripe `stripeSubscriptionId` not unique**: Same sub could be on multiple users
10. **Per-instance circuit breaker**: No cross-instance coordination

## Strict NEVER Rules (Production Outage Causes)

1. NEVER overflow-x:hidden on html/body
2. NEVER revert Reveal to whileInView
3. NEVER raise scrypt N without maxmem
4. NEVER _comment keys in vercel.json
5. NEVER revert prebuild-migrate.mjs to FATAL on DB unreachability
6. NEVER hourly crons on Vercel Hobby
7. NEVER check user.plan directly (use isProUser())
8. NEVER add useEffect-setState sync in AnalysisResultsView/ResponseLetter
9. NEVER change chat append to read-then-write
10. NEVER remove assertProductionRateLimiter/assertProductionEnvSafety
11. NEVER change AI provider URL without privacy review
12. NEVER add password change without incrementTokenVersion
13. NEVER trust freeUsesRemaining/lastResetAt (ghost fields)

## Fragile Areas (Extreme Touch Risk)

- AI system prompt (113 lines, monolithic, schema-coupled)
- Free quota enforcement (Redis + DB + advisory lock coordination)
- AI client singleton + semaphore (process-local state)
- Auth token version cache (Redis 30s + in-memory 5s)
- Middleware CSP nonce (must coordinate with next.config.ts)
- pg-bouncer-params.mjs (shared between build and runtime)
- ensure-schema.ts (must mirror Prisma migrations)
- Vision/image processing (UV_THREADPOOL_SIZE dependency)

## Cross-references

- [[project-cleardoc-codebase-analysis]] — prior architecture analysis
- [[project-cleardoc-exhaustive-analysis-2026-06-04]] — 36-agent deep dive
- [[project-cleardoc-security-findings]] — security audit results
- [[project-ai-semaphore-permit-leak]] — semaphore bug (now fixed in rewrite)
- [[project-cleardoc-deploy-incident-2026-06-04]] — deployment gotchas
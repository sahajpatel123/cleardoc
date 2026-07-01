---
name: architecture-mental-model
description: Comprehensive architecture understanding for ClearDoc — systems, flows, risks, and cautions
metadata:
  type: project
---

# ClearDoc Architecture Mental Model

Generated: 2026-06-04 (via ultracode analysis)

## 1. Overall Architecture

ClearDoc is a Next.js 16 App Router application deployed on Vercel with Supabase PostgreSQL. It accepts document uploads (PDF/text or images), analyzes them via NVIDIA NIM AI for legal/consumer insights, and persists results with a free-tier/pro subscription model.

## 2. Main Systems and Responsibilities

| System | Files | Purpose |
|--------|-------|---------|
| **AI Analysis** | `lib/ai.ts` | Core analysis engine with text/vision modes, fallback chains, observability |
| **AI Client** | `lib/ai-client.ts` | Singleton OpenAI-compatible client to NVIDIA NIM with semaphore concurrency control |
| **Auth** | `auth.ts`, `lib/password.ts`, `lib/token-version-cache.ts` | NextAuth v5 Credentials provider with scrypt hashing, token invalidation |
| **Database** | `lib/db.ts`, `lib/prisma.ts` | Prisma 6 client with $extends() extensions, advisory locks, cached queries |
| **Rate Limiting** | `lib/rate-limit.ts` | Upstash Redis sliding window + in-memory fallback (prod alert on) |
| **Free Quota** | `lib/free-quota.ts` | Redis optimistic counter + DB transaction for free tier limit enforcement |
| **API Routes** | `app/api/*/route.ts` | Analyze, chat, stripe webhooks, usage endpoints |
| **PDF Processing** | `lib/pdf-parser.ts` | `pdf2json` extraction, image detection |
| **Image Processing** | `lib/image-cap.ts` | Sharp-based image resizing/quality reduction for vision |
| **Observability** | `lib/observability.ts` | Pino logging with redaction, Sentry capture, metrics |
| **Frontend** | `app/*.tsx`, `components/ui/*` | App Router pages with React 19, Tailwind CSS v4 |

## 3. Runtime Flow (POST /api/analyze)

```
1. Request arrives → CSRF check (Origin header)
2. Auth check via NextAuth JWT → get user profile
3. Rate limit checks (IP + user) → 503 on Redis error
4. Free quota reserve (Redis incr + TTL) → release on any downstream failure
5. File extraction (pdf2json / image buffer) → release quota on extract failure
6. Cache check (Redis) → skip AI if hit
7. AI call via semaphore-protected client → text OR vision path
   - Text: sanitizeUserInput(docText) → system prompt → NVIDIA NIM
   - Vision: capImageForVision(buffer) → image → vision fallback chain
8. Parse/validate response (zod schema) → free quota release on parse failure
9. Cache set (Redis TTL 24h)
10. Save analysis (DB transaction with advisory lock) → release quota on save failure
11. Return result + analysisId
```

## 4. State/Data Flow

| State | Storage | Lifespan | Consistency |
|-------|---------|----------|-------------|
| **JWT Session** | Token `ver` field + DB `tokenVersion` | 7 days | Redis cache + DB source of truth |
| **Free Quota Counter** | Redis key `cleardoc:quota-reserve:${userId}:${date}` | UTC day | Optimistic, released on DB rejection |
| **Cached Analysis** | Redis key `cleardoc:ai-result:${userId}:${sha256}` | 24 hours | Validated against zod schema on read |
| **Analysis Records** | PostgreSQL JSONB | Permanent | Advisory lock for race-free writes |
| **Chat Messages** | Analysis.chatMessages JSONB | Permanent | JSONB concatenation with length guard |
| **Semaphore Permits** | In-memory Map | Process lifetime | Per-instance cap (5), NOT distributed |
| **Rate Limit Windows** | Upstash Redis sliding | Window duration | Distributed across instances |

## 5. Important Dependencies

| Dependency | Version | Why Critical |
|------------|---------|--------------|
| `openai` SDK | ^4.104.0 | NVIDIA NIM adapter (Vision feature) |
| `@upstash/redis` | ^1.35.8 | Required for production rate limiting + quota |
| `@upstash/ratelimit` | ^2.0.7 | Sliding window rate limiting |
| `next-auth` | 5.0.0-beta.30 | Auth infrastructure (beta!) |
| `@auth/prisma-adapter` | ^2.7.4 | NextAuth-DB bridge |
| `prisma` | ^6.19.0 | Database ORM + extensions API |
| `sharp` | ^0.34.5 | Image processing for vision |
| `pdf2json` | ^3.2.2 | PDF text extraction |
| `stripe` | ^20.14.1 | Subscription payments |
| `@sentry/nextjs` | ^10.55.0 | Error tracking |
| `framer-motion` | ^12.36.0 | Animations (scroll-listener fix in place) |

## 6. Major Risk Areas

| Risk | File(s) | Mitigation Status |
|------|---------|------------------|
| **Semaphore permit leak** | `lib/semaphore.ts` (CRITICAL) | Timeout path DOES call `release()` but timeout + abort race can leak permits |
| **Vision fallback unbounded** | `lib/ai.ts` | Bounded by `deadlineMs` check, but secondary fallback can still consume time |
| **Redis quota not released** | `app/api/analyze/route.ts` | Most paths fixed, but any uncaught exception path leaks quota |
| **In-memory rate limit fallback** | `lib/rate-limit.ts` | Logs warning in production, but permissive instead of blocking |
| **Per-instance circuit breaker** | `lib/circuit-breaker.ts` | Admits "useless at scale" in comments — no distributed coordination |
| **Image size exhaustion** | `lib/image-cap.ts` | Bounded, but very large images can still fail vision models |

## 7. Fragile / Tightly Coupled Areas

| Area | Why Fragile | Notes |
|------|-------------|-------|
| `lib/ai.ts` SYSTEM_PROMPT (89 lines) | Large monolithic prompt, aggressive sanitization strips legitimate legal phrasing | Consider extraction to `lib/prompts.ts` |
| `app/page.tsx` (41KB client component) | Everything in one file kills SEO, needs component extraction | See REVIEW.md P0 item |
| `lib/free-quota.ts` Redis + DB coordination | Complex compensating transaction logic | Must audit all catch blocks |
| `lib/ai-client.ts` singleton + timeout | Timeout without semaphore release on abort race | See semaphore issue |
| `auth.ts` token version handling | Complex retry logic with timing attack mitigations | Critical path for security |
| `lib/pending-analysis-store.ts` destructive `take()` | Double-mount footgun if take() called twice | See RULES.md for pattern |

## 8. Performance-Sensitive Areas

| Area | Why Critical |
|------|--------------|
| **Vision image processing** | Sharp resize/encode can spike memory/CPU on large images |
| **PDF parsing** | `pdf2json` loads entire document into memory; text capped at 80k chars |
| **AI semaphore (5 concurrent)** | Per-instance cap, NOT distributed — can starve warm instances under load |
| **Advisory locks on quota** | Held during DB query + insert — can starve connections under concurrency |
| **Redis quota reservations** | Every analyze call hits Redis twice (incr/decr) |
| **System prompt size** | 18KB re-sent every call — consider caching |

## 9. Security-Sensitive Areas

| Area | Concern |
|------|---------|
| **Input sanitization** | `sanitizeUserInput()` slices to 2000 chars (VULN-01: silent PDF truncation) |
| **CSP** | `next.config.ts` has `'unsafe-inline'` — contradicts D003 decision |
| **PII in logs** | Redaction list in `observability.ts` may miss nested fields |
| **Vision model** | NVIDIA NIM trial endpoint may send docs to third party |
| **Webhook signature** | Stripe webhook uses raw body verification |
| **Origin validation** | CSRF defense on multipart/form-data routes |

## 10. Recommended Engineering Cautions

### Before Any Changes:
1. **Never trust the semaphore** — always verify permits are released after timeout/abortion
2. **Check CSP config** — rule: `overflow-x: clip`, not hidden; CSP nonce without `unsafe-inline`
3. **Validate all AI paths** — vision fallback timeouts must respect `deadlineMs`
4. **Free quota release** — is your code change inserting an early return path that bypasses the release?
5. **Don't touch prompt sanitization without care** — "act as an" stripping corrupts legal docs

### Testing Patterns:
- Run `npm test` (node:test, not Jest)
- Check `maxDuration` compatibility (120s route limit)
- Verify Redis connectivity in production paths
- Test image rejection paths (oversize, decode errors)
- Validate cache key stability (same buffer → same hash)

### Deployment Considerations:
- `scripts/prebuild-migrate.mjs` applies migrations before Vercel build
- Never assume Vercel auto-runs migrations
- Stripe test keys may still be in `.env.vercel.prod`
- Sentry DSN optional but recommended for production
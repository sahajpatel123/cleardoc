# Architecture

> Last verified: 2026-05-31 against code. Trust code over this note.

## One-paragraph mental model

A Next.js 16 App Router app. The landing page collects a document + optional user context, gates on login (NextAuth Credentials), and hands the file to `/api/analyze` via an IndexedDB-backed pending-analysis store (so a login redirect doesn't lose the upload). The API authenticates, enforces a daily free quota (reserve-before-AI), extracts text (`pdf2json`) or sends an image to NVIDIA NIM vision, calls the Nemotron Omni model with a strict JSON-only system prompt, validates the result, saves it to Postgres, and returns it. Saved analyses appear in the dashboard; Stripe drives the Free→Pro upgrade.

## End-to-end analysis flow

```
Home (app/page.tsx)
  └─ setPendingAnalysis(file + context)         lib/pending-analysis-store.ts (memory + IndexedDB)
  └─ if not logged in → /login → back to /analyze
  └─ if logged in → /analyze
/analyze (app/analyze/page.tsx)
  └─ POST /api/analyze  (FormData: file + context)
       1. auth() → 401 if no session
       2. free user? checkFreeDailyQuota()  (lib/free-quota.ts, 3/UTC day)  → reserve credit
       3. PDF → pdf2json text  |  image → base64 vision payload  (lib/pdf-parser.ts)
       4. analyzeDocument()  (lib/ai.ts → lib/ai-model.ts)   3× retry, temp 0
       5. parseAnalysisResult()  (lib/validate-analysis.ts)  — reject bad JSON
       6. success → save Analysis JSON  |  failure → refund credit
       └─ returns { result, analysisId }
/analyze/[id]  → reload a saved analysis (auth + ownership)
/dashboard     → history list; ?upgraded=true after Stripe success
```

## Modules by responsibility

**Auth & session**
- `auth.ts` — NextAuth v5, Credentials provider, JWT sessions, `user.id` callback, **login throttle**, **`tokenVersion`** (bump to invalidate existing sessions).
- `app/api/auth/[...nextauth]/route.ts`, `app/api/auth/signup/route.ts`.
- `lib/password.ts` — scrypt hash/verify, `validateEmail`/`validatePassword`.
- Client: `context/AuthContext.tsx` (wraps `useSession`, loads `/api/usage`), `hooks/useAuth.ts`.

**AI**
- `lib/ai-model.ts` — model id, NIM `extra_body` (`enable_thinking:false`), `nimCompletionParams()`.
- `lib/ai.ts` — system prompt (the JSON contract), text & vision paths, 3× exponential-backoff retry, 80k-char truncation, parse + validate.
- `lib/analysis-ai.ts`, `lib/case-context.ts` — analysis/case helpers.
- `lib/validate-analysis.ts` — runtime `AnalysisResult` schema check.

**Data**
- `lib/prisma.ts` — singleton client. `lib/db.ts` / `lib/db-client.ts` — queries: users, analyses, reserve/refund free credit, Stripe updates, `countUserAnalysesSince`.
- `lib/ensure-schema.ts` — runtime DDL self-heal (see [[KNOWLEDGE/deployment-and-schema]]).
- `prisma/schema.prisma` + `prisma/migrations/`.

**Features**
- `lib/free-quota.ts` — UTC-day quota math (limit 3).
- `lib/ics.ts` — turn extracted deadlines into calendar `.ics` events.
- `lib/stripe.ts` / `lib/stripe-events.ts` — checkout + idempotent webhooks.
- `lib/rate-limit.ts` — optional Upstash IP/user limits.
- `lib/pdf-parser.ts` — pdf2json + image→vision payload.

**Edge / cross-cutting**
- `proxy.ts` — CSP + security headers (Next 16 proxy, replaces `middleware.ts`).
- `lib/env.ts` — env access/validation. `lib/site-url.ts` — canonical URL. `lib/verdict-ui.ts`, `lib/faq-content.ts` — UI helpers.

## API surface (verified files)

```
auth/[...nextauth]   auth/signup
analyze              chat                 rephrase-letter
analyses             analyses/[id]        analyses/[id]/delete   analyses/case/[caseId]
usage                health
stripe/create-checkout   stripe/portal    stripe/webhook
```

## Data model

See [[MEMORY]] §4 for the authoritative field list. Key relations:
- `User 1—* Analysis` (cascade delete).
- `Analysis.parentId → Analysis.id` self-relation `AnalysisChain` (ON DELETE SET NULL) — analysis follow-ups.
- `Analysis.caseId` groups related analyses into a "case".
- `ProcessedStripeEvent.id = evt_...` — webhook dedupe.

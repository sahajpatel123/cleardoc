# CLAUDE.md Drift Report

> Last verified: 2026-05-31. Root `CLAUDE.md` is the project's stated source of truth but has drifted from the
> code in several places. **Trust the code.** Fixing CLAUDE.md is tracked in [[TODO]] (🔴). This note is the diff.

## 1. AI model — STALE ❌

- CLAUDE.md says: `meta/llama-3.2-90b-vision-instruct` (in `lib/ai.ts`).
- **Actual:** `nvidia/nemotron-3-nano-omni-30b-a3b-reasoning`, defined in **`lib/ai-model.ts`** (not inline in `ai.ts`), with `enable_thinking:false`. Swap happened in commit `533aa4a`.

## 2. Data model — INCOMPLETE ❌

CLAUDE.md's `User` and `Analysis` tables omit columns that exist in `prisma/schema.prisma`:

| Model | Missing in CLAUDE.md | Purpose |
|-------|----------------------|---------|
| `User` | `lastResetAt` | daily-quota reset anchor |
| `User` | `tokenVersion` | JWT/session invalidation |
| `Analysis` | `chatMessages` (Json?) | per-analysis chat history (`/api/chat`) |
| `Analysis` | `parentId` (+ self-relation `AnalysisChain`) | analysis follow-ups / chains |
| `Analysis` | `caseId` | grouping analyses into a "case" |

Also: CLAUDE.md doesn't mention `freeUsesRemaining`'s default (`3`) is largely vestigial now that quota is a **derived daily count** (`countUserAnalysesSince`).

## 3. lib/ files — UNDER-DOCUMENTED ❌

CLAUDE.md's repo map predates several modules now in `lib/`:
`ai-model.ts`, `analysis-ai.ts`, `case-context.ts`, `db-client.ts`, `env.ts`, `faq-content.ts`, `ics.ts`, `site-url.ts`, `verdict-ui.ts`, plus tests `free-quota.test.ts`, `ics.test.ts`, `user-plan.test.ts`, `validate-analysis.test.ts`.

CLAUDE.md implies **2** test files ("user-plan, validate-analysis"); there are **4**.

## 4. API routes — MOSTLY OK, one addition ⚠️

CLAUDE.md's route table includes `chat`, `rephrase-letter`, and `analyses/case/[caseId]` (good). Add:
- `app/api/analyses/[id]/delete/route.ts` — explicit delete endpoint.

## 5. Migrations — ADD TWO ⚠️

CLAUDE.md mentions `add_user_password`. The full set is 5: `init`, `add_user_password`, `stripe_event_idempotency`, `analysis_features`, `daily_free_quota_and_token_version`.

## 6. Build/migration story — UPDATED ⚠️

CLAUDE.md says "production DB migrations: `npx prisma migrate deploy`" and that postinstall runs prisma generate (true). But it doesn't capture that **builds no longer run migrations** and that **`lib/ensure-schema.ts` self-heals at runtime**. See [[KNOWLEDGE/deployment-and-schema]].

## 7. Security — PARTLY OUTDATED ⚠️

CLAUDE.md/earlier notes implied "no login rate limiting." That's **resolved** (login throttle, `tokenVersion`, atomic quota, delete TOCTOU fix — commit `35fe033`). See [[KNOWLEDGE/security]].

## What's still ACCURATE in CLAUDE.md ✅

Auth.js v5 + Credentials (no Firebase), Postgres+Prisma, `proxy.ts` (not middleware), Stripe $9/mo, 10MB upload limit, free=3/day, Pro=`pro`+`active`, quota-before-AI, "Atelier" dark design tokens in `globals.css`, no document blob storage, 80k-char truncation. Keep these.

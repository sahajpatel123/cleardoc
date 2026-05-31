# ClearDoc — Production-Readiness Audit

**Date:** 2026-05-31
**Scope:** Full working-tree diff + every site flow and fallback, reviewed for correctness, reliability, security, and graceful degradation.
**Method:** 12 independent finder angles (5 diff-correctness + 7 whole-site flow) → adversarial verification (1 verifier per candidate, 3-state CONFIRMED/PLAUSIBLE/REFUTED) → gap sweep. 84 agents, 68 raw candidates → **55 verified** (33 CONFIRMED, 22 PLAUSIBLE). Verifiers independently re-rated severity and corrected several over-statements.

> **Important context:** while the audit ran, three stabilization commits (`5e2d63f`, `a05f65d`, `39d9d58`) landed in parallel and **already fixed a large share of the findings**. This report reflects the **current HEAD + working tree**, not the snapshot the agents first saw. Every item below was re-verified against the live code.

---

## 1. Headline verdict

The app is **close to production-grade**. Core money/identity flows (auth, quota, billing idempotency, webhook retry) are sound and have had multiple hardening passes. No unfixed **critical** remains. The fixes applied this session close the remaining reliability/availability gaps; the open items are mostly **low-severity polish** plus two **medium** operational follow-ups (DB-index migration coverage, AI retry-budget vs. function timeout).

| Severity (post-verification) | Fixed (parallel) | Fixed (this session) | Open / recommended |
|---|---|---|---|
| Critical | 0* | 0 | 0 |
| High | 4 | 2 | 0 |
| Medium | 3 | 3 | 4 |
| Low / cosmetic | 6 | 2 | 11 |

\* The two findings the agents *labelled* "critical" (deploy migrations, auth-outage-on-missing-column) were re-rated **high** by verifiers because they are conditional on deploy state; both are now mitigated (§3).

---

## 2. Already fixed in parallel (verified against current HEAD)

These were flagged by the audit and are **no longer present**:

- **React key collisions** — `next_steps`/`red_flags` now key on the array index (`key={`step-${i}`}` / `key={`flag-${i}`}`, `index={i}`), not on un-unique model-supplied `priority`/`issue`. Collision + animation-stagger regressions gone.
- **Pro user silently downgraded to free** — `/api/usage` now returns **500** on an authenticated DB error instead of a 200 `{plan:"free"}`, so a transient blip no longer hides Pro features.
- **Stripe webhook hardening** — empty subscription id is now `null` (not `""`); unresolved `userId`/customer **releases the claim and throws so Stripe retries** (no "user pays, never gets Pro"); `past_due` is handled; `invoice.payment_failed` downgrades after 3 attempts.
- **Auth legacy-token bypass** — tokens minted before `ver` existed are now validated as version 0 instead of skipping revocation forever.
- **`trustHost: true` removed** from the NextAuth config.
- **AI feature-route timeout** — `AI_TIMEOUT_MS_SHORT = 25s` introduced for chat/rephrase so a single attempt's timeout can fire under their 30s `maxDuration`.
- **Empty-AI-response guards** + chat-history/letter length caps added.

---

## 3. Fixed this session (8 files, type-checked + tests green)

| # | Severity | File(s) | Problem | Fix |
|---|---|---|---|---|
| 1 | **High** | `package.json` | `db:migrate` (`scripts/prebuild-migrate.mjs`) was **never invoked** by build/vercel — production migrations didn't auto-run on deploy; the app relied entirely on the best-effort runtime `ensureDatabaseSchema` guard (which doesn't cover all tables). | Added a **`prebuild`** npm lifecycle hook so `prisma migrate deploy` runs before `next build`. The script is already defensive (exits 0 when the DB is unreachable/absent), so it cannot break local builds or Supabase-pooler deploys. |
| 2 | **Med** | `lib/ai.ts`, `lib/analysis-ai.ts` | `withTimeout` only wins a `Promise.race` — it never **aborted** the underlying NVIDIA request, and the OpenAI SDK's default `maxRetries:2`/`timeout:600s` **compounded** with the app's own retry loop (one analyze → up to ~9 upstream calls + orphaned 10-min sockets). | Configured both clients with `timeout: <budget>` + `maxRetries: 0`, so the SDK truly cancels the request at the deadline and the app retry loop is the single source of truth. |
| 3 | **Med** | `lib/ai.ts` | A deterministic (temp 0) JSON/schema failure was retried 3× with identical inputs — burning two extra model calls and time budget for an outcome that can't change. | Fail-fast: `break` immediately on `AI_INVALID_JSON_ERROR_MESSAGE`; only transient/network/timeout errors retry. |
| 4 | **High** (mitigation) | `auth.ts` | The JWT callback's `tokenVersion` reads had **no try/catch**: a not-yet-migrated `tokenVersion` column or a transient DB blip would throw inside the callback → **auth outage / spurious force-logout** for every authenticated request. | Wrapped both reads in **fail-open** try/catch (default `ver=0`, skip validation on DB error) while always re-raising the intentional "Session invalidated" revocation throw. |
| 5 | **Low–Med** | `app/api/stripe/create-checkout/route.ts`, `portal/route.ts` | The billing rate-limit call sat unguarded in the route `try`; an Upstash/limiter error would surface as a **500 and hard-block checkout/portal** (a limiter outage becoming a revenue outage). | **Fail open** on limiter error (log + allow) — these routes are low-frequency and auth-gated. |
| 6 | **Low** | `components/ui/ResponseLetter.tsx` | `navigator.clipboard.writeText` was awaited with no catch — rejects in insecure contexts / denied permission / unfocused doc → **unhandled rejection and no user feedback**. | try/catch with a visible manual-copy fallback message. |
| 7 | **Low–Med** | `lib/pdf-parser.ts` | File type came **only** from the filename extension; a non-image renamed `.png` was base64-encoded and sent to the **paid vision model**, wasting a call on garbage. | Added `contentMatchesMime()` magic-byte check (PDF `%PDF`, PNG/JPEG/WEBP signatures) — rejects mismatches before any AI call; never rejects a valid file. |

Verification: `npx tsc --noEmit` → exit 0; `npm test` → 13/13 pass.

---

## 4. Open items — recommended, not auto-applied

Each lists **why** it wasn't applied here. Items on files under active parallel editing were left to avoid clobbering in-progress work.

### Medium

- **AI retry budget can still exceed function `maxDuration`.** `analyzeDocument` does 3×60s (+2s+4s backoff) ≈ 186s vs. `maxDuration=120`; chat/rephrase do `withRetry(3)` × 25s ≈ 80s vs. `maxDuration=30`. On a true upstream hang the platform kills the function before the shaped error returns. **Recommend:** a shared per-request deadline, or `maxRetries=2` with `AI_TIMEOUT_MS≈35s` for analyze and `withRetry(1–2)` (or `maxDuration=75`) for chat/rephrase. *Not applied:* you're actively tuning the timeout/retry constants — this is a latency-vs-reliability product call.
- **`ProcessedStripeEvent.@@index([createdAt])` has no migration and isn't in `ensureDatabaseSchema`'s DDL.** The index will never exist in any deployed DB, so the weekly cleanup `deleteMany({where:{createdAt:{lt}}})` is a seq scan. **Recommend:** add a migration *and* an idempotent `CREATE INDEX IF NOT EXISTS "ProcessedStripeEvent_createdAt_idx"` to `DDL_STATEMENTS`. *Not applied:* `lib/ensure-schema.ts` and `prisma/schema.prisma` are in your uncommitted working tree.
- **`CRON_SECRET` missing from `.env.example`.** The weekly cron returns 503 ("Cron not configured") until it's set, so the idempotency table grows unbounded. **Recommend:** document it under an "Operations/Cron" section (Vercel sends `Authorization: Bearer ${CRON_SECRET}`). *Not applied:* `.env.example` is outside my write permissions.
- **Session-revocation infrastructure is dead.** `incrementTokenVersion()` has **zero callers** — there is no password-change, password-reset, or "sign out everywhere" route — so `tokenVersion` never increments and the per-request validation read can never fire. **Recommend:** wire `incrementTokenVersion(userId)` into any future password-change/reset and a revoke endpoint. *Not applied:* requires building a product flow that doesn't exist yet.

### Low / cosmetic

- **`ensureDatabaseSchema` probe lacks `table_schema='public'`** — a same-named table in another schema could falsely satisfy the column-count check and skip needed DDL. Add `AND table_schema = 'public'`. *(working tree — yours)*
- **`AnalysisResultsView.handleLetterChange` fires `onResultChange` inside the `setLocalResult` updater** — an impure updater / cross-component setState during render (dev warning; value-idempotent so no visible bug). Move the side-effect out of the updater. *(working tree — yours)*
- **Analyze timeout returns 500, not 504** — the client's tailored "document may be large, try a shorter PDF" branch (which keys on 504/408) never fires for genuine AI timeouts. Map timeout errors → 504 in the analyze-route catch.
- **`getUserAnalyses` fetches full `result` JSON for up to 100 rows** on every dashboard load when the list only needs name/date/verdict; the code comment also overstates Prisma's limitation. Denormalize `overall_verdict` to a scalar column and `select` it.
- **Deleted-user sessions aren't revoked** — `if (dbUser && …)` lets a `null` (deleted) user pass validation until JWT expiry. Treat missing user as revoked. *(Low impact today since revocation is unused; behavior change — left for your call.)*
- **`auth.getSecret()` now throws**, making the `auth()` `if (!instance) return null` graceful path dead code — reconcile to one contract (fail-fast *or* null).
- **Webhook subscription events can be dropped if they arrive before checkout sets `stripeCustomerId`** (resolved only by customer id). Add `subscription_data.metadata.userId` in `createCheckoutSession` and resolve by it. *(Checkout-retry mitigates; billing-risky to change.)*
- **`/api/health` is unauthenticated, runs 2 DB queries, and has no rate limit** — minor DoS surface. Add a light per-IP limit (carefully, so platform health checks aren't throttled).
- **CSP keeps `script-src 'unsafe-inline'`** (XSS-posture weakener, tracked follow-up to nonce-based CSP) and **dead `fonts.googleapis.com`/`fonts.gstatic.com`** allowances (next/font self-hosts). Drop the dead font directives in both `proxy.ts` and `next.config.ts`; plan nonce CSP.
- **Webhook uses `findFirst` + `orderBy` on `email`**, which is `@unique` — a no-op that implies a non-existent duplicate-email case. Revert to `findUnique`.
- **In-memory rate-limit fallback is non-authoritative** without Upstash (effective limit ×N instances). Document that Upstash is required for authoritative billing/abuse limits in production, or log a startup warning.
- **Chat route discards a generated reply** on a post-AI not-found TOCTOU (analysis deleted mid-request) — narrow same-user window; the AI cost is spent but the answer is thrown away. Optionally return the reply with a "not saved" flag.

---

## 5. Flows confirmed working end-to-end

- **Auth:** signup → hash → `signIn` → JWT with `user.id`; login brute-force throttle (pre-DB); session in API routes via `auth()`. Now resilient to DB blips on the token-version path.
- **Analyze:** login gate → IndexedDB handoff → `/api/analyze` (auth + IP + per-user rate limits) → size/name/type/context validation → quota enforced **atomically at save** (advisory lock, count-based — no double-charge, no orphaned credit) → AI with timeout → graceful per-error responses. Pro case-linking gated correctly.
- **Billing:** checkout/portal auth-gated + rate-limited (now fail-open); webhook signature-verified + idempotent per `event.id` with claim/release-on-error retry; `isProUser` requires `plan==="pro"` **and** `subscriptionStatus==="active"`.
- **Pages/fallbacks:** `error.tsx`, `global-error.tsx`, `not-found.tsx` present; `useSearchParams` under Suspense; empty/zero-state UIs for red flags, deadlines, dashboard.

---

## 6. Suggested next steps (priority order)

1. Apply the two **medium** working-tree fixes (ensure-schema `table_schema` filter + `ProcessedStripeEvent` index) when you next commit those files.
2. Add `CRON_SECRET` to `.env.example` and set it in Vercel.
3. Decide the AI retry-budget vs. `maxDuration` policy and lock the constants.
4. Wire `incrementTokenVersion` into a password-change/reset + "sign out everywhere" flow (or remove the per-request read until then).
5. Confirm `prisma migrate deploy` runs cleanly in your Vercel build now that `prebuild` is wired (watch the first deploy log).

# Changes Log

> Chronological log of significant work. Newest first. One entry per meaningful change (feature, refactor,
> fix, research, decision). Keep entries short; link to [[DECISIONS]] for the "why". Related: [[MEMORY]] · [[TODO]]

**Format:** `YYYY-MM-DD` — short title — what changed / impact — (refs)

---

## 2026-06-01 — Audit triage + verified bug/vuln fixes (workflow-driven)
- Ran a 9-agent triage **workflow** (`wf_57b5a245-109`) to verify the "117-issue / 300-agent" audit against the *current* code: **13 confirmed, 12 partial, 14 false-positive**. The audit was heavily stale/overstated — all 8 "CRITICAL" collapsed to a handful of medium defects.
- **Fixed & verified (tsc clean · 13/13 tests · `next build` ✓):**
  - chat + rephrase POST wrapped in outer try-catch → shaped JSON 500, not an unshaped framework error (#1/#2).
  - chat message cap enforced **atomically** in `appendChatMessages` (`jsonb_array_length` guard + `RETURNING`), closing the check-then-act race (#8); now returns a discriminated `AppendChatResult`.
  - Stripe webhook: guard nullable `session.customer` before `upgradeUserToPro` (#7); wrap `claimStripeEvent` so a transient DB error returns a shaped 500 and Stripe retries (#3).
  - CSP: dropped `'unsafe-eval'` in `script-src` (both `proxy.ts` + `next.config.ts`, kept in sync; proxy wins), kept `'unsafe-inline'` pending nonces (#4); added `poweredByHeader:false`.
  - `lib/ai.ts`: raw model output no longer logged in prod — metadata only, per [[RULES]] (#AI-LOG-RAW); balanced-object JSON fallback for model preamble (#22); named `MAX_DOCUMENT_CHARS` (#21).
  - analyze route: `formData()` → 400, document extraction failure → 422 (were generic 500) (#9/#10).
  - `pdf-parser`: `safeDecode` tolerates malformed percent-encoding (was an uncaught `URIError` in an emitter callback) (#13).
  - `validate-analysis`: dropped-deadline now `console.warn`'d (metadata only) instead of silent (VALIDATE-DEADLINE-DROP); `ics` Invalid-Date guard; `case-context` whitespace truncation.
  - Wired the orphaned `cleanupProcessedStripeEvents` via new authenticated `GET /api/cron/cleanup` + `vercel.json` weekly cron (CLEANUP-ORPHAN). Needs `CRON_SECRET` env (`.env.example` is permission-locked — add manually).
- **Rejected as false-positive (no change):** revenue "leaks" #5/#6 (access already revokes via `subscription.updated`→non-active + `isProUser`), quota race (atomic advisory-lock save), chat read-after-write (atomic append), `STRIPE_WEBHOOK_SECRET!` (env-asserted), usage/health/db #19/#20/#24, JWT "2 queries" (it's 1, by design), validate cast, vision size, moderation.
- **Deferred:** frontend a11y/perf cluster (its triage agent failed — needs own pass), password-change endpoint (#12), Prisma enums + `ProcessedStripeEvent` `createdAt` index (migration), past_due grace (product), nonce-based CSP, next-auth GA bump. See [[TODO]].
- Committed `14c38ec` (code) + `feac60f` (memory) and pushed to `main`. Left uncommitted (unrelated / pending owner decision): `lib/ensure-schema.ts`, `DESIGN.md`, `marketing-posters/`.
- Refs: [[DECISIONS]] D-007; [[KNOWLEDGE/security]]; daily-2026-06-01.

## 2026-06-01 — Full analysis + internalization of `./memory/` system
- Performed exhaustive read of every file in `./memory/` (RULES.md, MEMORY.md, DECISIONS.md, TODO.md, CHANGES.md, KNOWLEDGE/*, daily/*).
- Extracted and adopted **all operating instructions** as binding protocol for this agent (memory-system rules, style, security, business invariants, git hygiene, etc.).
- Confirmed full fidelity to the "read-first / update-after / trust-code / wikilinks / Atelier-only / no-raw-logging" rules.
- Noted excellent self-documentation quality and the intentional but unreconciled dual memory convention (D-002).
- This analysis itself followed the memory protocol: core files read before work; updates applied after.
- Refs: [[RULES]], [[MEMORY]], [[DECISIONS]] D-002/D-004, [[TODO]] (memory reconciliation + CLAUDE.md drift).

## 2026-05-31 — Full-site mobile responsiveness pass
- Applied responsive improvements across 9 pages + 3 components + globals.css: grid stacking, touch targets, spacing reduction, horizontal overflow fix.
- Committed `1f3ee13`, pushed to `main`.

## 2026-05-31 — Login page mobile polish
- Full-width submit button, larger toggle touch targets, iOS-friendly form font, border reflow (left→top on mobile), tighter editorial spacing.
- Committed `d074123`, pushed to `main`.

## 2026-05-31 — Health check investigation
- `GET /api/health` returns 503. Needs investigation — likely Vercel cold-start or missing env var.

## 2026-05-31 — Central memory system initialized
- Created `./memory/` central knowledge base: `MEMORY.md`, `DECISIONS.md`, `CHANGES.md`, `TODO.md`, `RULES.md`, `KNOWLEDGE/` (with `README.md`, `architecture.md`, `ai-pipeline.md`, `deployment-and-schema.md`, `security.md`, `claude-md-drift.md`), and `daily/`.
- Grounded all content by reading actual code (not just CLAUDE.md): `lib/ai.ts`, `lib/ai-model.ts`, `lib/free-quota.ts`, `prisma/schema.prisma`, `lib/ensure-schema.ts` diff, `package.json`, `DESIGN.md`, `AGENTS.md`, API route + lib listings, git history, secret scan.
- **Captured drift** between CLAUDE.md and code (AI model name, new DB columns, new lib files) in [[KNOWLEDGE/claude-md-drift]].
- Relocated pre-existing stub `memory/2026-05-29.md` → `memory/daily/daily-2026-05-29.md` (cleaned formatting; trivial content).
- Recorded decisions D-001…D-005 in [[DECISIONS]] and seeded [[TODO]].
- Refs: [[DECISIONS]] D-004.

## 2026-05-31 — Lazarus Swarm: Full-site exhaustive audit (300 agents)
- Ran DynamicClaudeWorkflow_Emulator_v3 with 300 agents across 6 parallel cohorts + Red Team.
- **117 issues found:** 8 Critical, 18 High, 42 Medium, 49 Low.
- Categories: type safety, security, API contracts, database, AI pipeline, Stripe billing, frontend, config.
- Implemented fixes: sanitized login redirect, rate-limit warning, auth callback optimization, AI retry logic, try-catch on GET routes, invoice.payment_failed handler, GDPR deletion endpoint, mobile scroll fix.
- Fixed pre-existing broken imports. Top 10 fixes prioritized (~4 hours effort).
- Refs: [[TODO]], daily-2026-05-31.md.

---

## Prior history (reconstructed from git — newest first)

> The following predates the memory system; reconstructed from `git log` for continuity.

| Date¹ | Commit | Summary |
|------|--------|---------|
| recent | `69a058d` | Fix: prevent horizontal scrolling on mobile |
| recent | `604f0a6` | Add dedicated analysis session page with immersive loading UX |
| recent | `dd963a0` | Center upload headline & drop zone |
| recent | `35fe033` | **Security hardening:** login throttle, rate-limit fallback, atomic quota, delete TOCTOU fix, health gate |
| recent | `533aa4a` | **Switch to Nemotron Omni** model; harden production ops |
| recent | `8d7a9f7` | Stop running Prisma migrate during Vercel builds |
| recent | `5b6d6f1` | Self-heal production schema at runtime when build migrations can't run |
| recent | `ac8a864` | Add `vercel` package for deployment CLI |
| recent | `35b2668` | Prefer Supabase pooler for build-time migrations; tolerate P1001 |
| recent | `d1ede80` | Run prod migrations during Vercel builds (Supabase env fallbacks) |
| recent | `a372aa9` | Fix authenticated API routes; align free-tier quota with product |
| recent | `36ef93d` | Fix build: sync schema.prisma with applied migrations |

¹ Exact commit dates not captured at init; run `git log --date=short` to backfill if needed.

**Migrations applied (in order):** `init` → `add_user_password` → `stripe_event_idempotency` → `analysis_features` (chat/parent/case) → `daily_free_quota_and_token_version`.

# Changes Log

> Chronological log of significant work. Newest first. One entry per meaningful change (feature, refactor,
> fix, research, decision). Keep entries short; link to [[DECISIONS]] for the "why". Related: [[MEMORY]] · [[TODO]]

**Format:** `YYYY-MM-DD` — short title — what changed / impact — (refs)

---

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

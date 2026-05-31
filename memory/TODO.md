# TODO & Backlog

> Current priorities and tasks. Mark done with `[x]` and move to a dated "Done" note in [[CHANGES]] when significant.
> Related: [[MEMORY]] · [[DECISIONS]] · [[KNOWLEDGE/README]]

**Legend:** `[ ]` open · `[~]` in progress · `[x]` done · 🔴 high · 🟡 medium · 🟢 low

---

## 🔴 Needs owner decision (blocking clarity)

- [ ] 🔴 **Resolve the DESIGN.md vs Atelier conflict.** `DESIGN.md` (white + `#0066FF` blue) contradicts the shipped dark "Atelier" theme. Decide: keep Atelier, adopt DESIGN.md (full re-skin), or merge. See [[DECISIONS]] D-003.
- [ ] 🔴 **Reconcile the two memory conventions.** Root autonomous-agent framework (`AGENTS.md`) writes daily notes to `memory/YYYY-MM-DD.md`; this system uses `memory/daily/`. Decide whether to unify (point AGENTS.md at `memory/daily/`) or keep separate by design. See [[DECISIONS]] D-002.

## 🔴 Correctness / docs accuracy

- [ ] 🔴 **Update CLAUDE.md** to match code: AI model is `nvidia/nemotron-3-nano-omni-30b-a3b-reasoning` (not llama-3.2-90b); add `User.lastResetAt`, `User.tokenVersion`, `Analysis.chatMessages/parentId/caseId`; add new lib files & the `/api/analyses/[id]/delete` route. Full diff in [[KNOWLEDGE/claude-md-drift]].
- [ ] 🟡 Commit or revert the uncommitted working-tree changes (`lib/ensure-schema.ts`, `DESIGN.md`, `marketing-posters/`) — currently sitting un-tracked/modified.

## 🟡 Security follow-ups (see [[KNOWLEDGE/security]])

- [ ] 🟡 **Audit git history for leaked secrets.** Current tree is clean, but a prior memory flagged committed API keys. Run history scan (e.g. `git log -p -- .env*`, `gitleaks`); rotate any keys found.
- [x] 🟡 ~~Raw model output logged in prod~~ — DONE 2026-06-01: `lib/ai.ts` logs metadata only in prod (gated on `NODE_ENV`). See [[CHANGES]].
- [x] 🟢 ~~`proxy.ts` CSP overly broad~~ — DONE 2026-06-01: dropped `'unsafe-eval'`, synced with `next.config.ts`. Nonce CSP (to also drop `'unsafe-inline'`) tracked below.

## 🟡 Product / features

- [ ] 🟡 Document & test the **analysis chain / case** feature (`parentId`, `caseId`, `/api/analyses/case/[caseId]`) — newer than CLAUDE.md, undocumented.
- [ ] 🟡 Document the **per-analysis chat** feature (`/api/chat`, `Analysis.chatMessages`).
- [ ] 🟢 Document the **deadline → `.ics` export** path (`lib/ics.ts`).
- [ ] 🟢 OCR for scanned (text-less) PDFs — known gap; today only user context helps.
- [ ] 🟢 Wire Google OAuth (env placeholders exist; not in `auth.ts`).

## 🟡 Audit-fix follow-ups (deferred from 2026-06-01 triage — see [[DECISIONS]] D-007)

- [ ] 🟡 **Frontend a11y/perf pass** — the triage agent for the frontend cluster failed; PricingModal focus-return, AnalysisChat aria-label, RedFlagItem aria-expanded, UploadZone/DeadlinesPanel label wiring, FaqAccordion arrow-keys, memoization, effect cleanup. Needs its own verified pass.
- [ ] 🟡 **Password-change endpoint** (#12) — `incrementTokenVersion` exists but is unused; no route consumes it. Needs route + UI + auth regression testing.
- [ ] 🟢 Add `CRON_SECRET` to `.env.example` (was permission-locked) and set it in Vercel so `/api/cron/cleanup` runs.
- [ ] 🟢 Nonce-based CSP to drop `'unsafe-inline'` from `script-src` (proxy generates nonce → Next reads it). Larger change; test hydration.
- [ ] 🟢 Prisma: `plan`/`subscriptionStatus` String→enum and `@@index([createdAt])` on `ProcessedStripeEvent` — needs a migration + `ensure-schema` DDL.
- [ ] 🟢 Product: past_due grace period before downgrade (currently immediate); `trial_will_end` handler only if trials are offered.
- [ ] 🟢 Monitor next-auth v5 GA to replace the `5.0.0-beta.30` pin (deliberate exact pin for now).

## 🟢 Health / maintenance

- [ ] 🟢 Investigate `GET /api/health` returning 503 on Vercel (cold-start? missing env?).
- [ ] 🟢 Build: `next build` passed locally 2026-06-01 (module-load `new OpenAI()` doesn't throw on an undefined key). Re-verify in CI without secrets if the earlier failure recurs.
- [ ] 🟢 Backfill exact commit dates into [[CHANGES]] (`git log --date=short`).
- [x] 🟢 ~~Confirm test coverage / `npm test` green~~ — DONE 2026-06-01: 13/13 pass (free-quota, ics, user-plan, validate-analysis).
- [ ] 🟢 Decide whether both `pnpm-lock.yaml` and `package-lock.json` should be tracked (pick one package manager).

---

## ✅ Recently done

- [x] 2026-06-01 — **Audit triage + fixes:** verified the 117-issue audit via workflow (13 confirmed / 14 false-positive); implemented & verified (tsc + 13/13 tests + build) the confirmed defects across chat/rephrase/webhook/analyze routes, `lib/ai`, `db`, `pdf-parser`, `validate-analysis`, `proxy`/`next.config`, + new cron cleanup. See [[CHANGES]], [[DECISIONS]] D-007.
- [x] 2026-05-31 — Lazarus Swarm full-site audit (300 agents, 117 issues found). [[TODO]] prioritized.
- [x] 2026-05-31 — Security hardening: login redirect sanitization, rate-limit warning, auth callback optimization, AI retry logic, try-catch on GET routes, invoice.payment_failed handler, GDPR deletion endpoint.
- [x] 2026-05-31 — Fixed mobile horizontal scrolling.
- [x] 2026-05-31 — Fixed pre-existing broken imports (FREE_TIER_CREDITS_PER_DAY, reserveFreeAnalysisCredit, refundFreeAnalysisCredit).
- [x] 2026-05-31 — Initialize central memory system under `./memory/`. (See [[CHANGES]].)
- [x] 2026-06-01 — Full analysis + internalization of the entire `./memory/` system by agent (all files read, every instruction extracted and adopted as binding protocol going forward). Updates applied to [[CHANGES]], [[MEMORY]], this file. Dual-convention (D-002) and CLAUDE.md drift (🔴) remain top open items.

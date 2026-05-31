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
- [ ] 🟡 Confirm sensitive document text / raw model output is **not** logged in production (`lib/ai.ts` logs raw output on parse failure — verify it's scrubbed or gated).
- [ ] 🟢 Verify `proxy.ts` CSP still allows NVIDIA NIM + Stripe and has no overly-broad directives.

## 🟡 Product / features

- [ ] 🟡 Document & test the **analysis chain / case** feature (`parentId`, `caseId`, `/api/analyses/case/[caseId]`) — newer than CLAUDE.md, undocumented.
- [ ] 🟡 Document the **per-analysis chat** feature (`/api/chat`, `Analysis.chatMessages`).
- [ ] 🟢 Document the **deadline → `.ics` export** path (`lib/ics.ts`).
- [ ] 🟢 OCR for scanned (text-less) PDFs — known gap; today only user context helps.
- [ ] 🟢 Wire Google OAuth (env placeholders exist; not in `auth.ts`).

## 🟢 Health / maintenance

- [ ] 🟢 Investigate `GET /api/health` returning 503 on Vercel (cold-start? missing env?).
- [ ] 🟢 Fix build without `OPENAI_API_KEY` — `/api/chat` eagerly inits OpenAI client at module load; fails during `next build` page-data collection.
- [ ] 🟢 Backfill exact commit dates into [[CHANGES]] (`git log --date=short`).
- [ ] 🟢 Confirm test coverage: 4 test files exist (`free-quota`, `ics`, `user-plan`, `validate-analysis`). Run `npm test` to confirm green.
- [ ] 🟢 Decide whether both `pnpm-lock.yaml` and `package-lock.json` should be tracked (pick one package manager).

---

## ✅ Recently done

- [x] 2026-05-31 — Lazarus Swarm full-site audit (300 agents, 117 issues found). [[TODO]] prioritized.
- [x] 2026-05-31 — Security hardening: login redirect sanitization, rate-limit warning, auth callback optimization, AI retry logic, try-catch on GET routes, invoice.payment_failed handler, GDPR deletion endpoint.
- [x] 2026-05-31 — Fixed mobile horizontal scrolling.
- [x] 2026-05-31 — Fixed pre-existing broken imports (FREE_TIER_CREDITS_PER_DAY, reserveFreeAnalysisCredit, refundFreeAnalysisCredit).
- [x] 2026-05-31 — Initialize central memory system under `./memory/`. (See [[CHANGES]].)

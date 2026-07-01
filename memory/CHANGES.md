# Changes

Chronological record of significant changes. Newest first.

---

## 2026-06-02 (session 2)

- **Production failure root cause analysis** — Investigated 100% image-upload failure in production. Root cause: NVIDIA trial endpoint (`integrate.api.nvidia.com`) returns empty 200 completion (`rawLength:0`) for vision requests — likely quota exhaustion or `enable_thinking:false` silencing the reasoning model on image-to-JSON tasks. No code changes made; findings documented in TODO.md.
- **Memory model name corrected** — MEMORY.md had stale model name `meta/llama-3.2-90b-vision-instruct`; corrected to actual `nvidia/nemotron-3-nano-omni-30b-a3b-reasoning`.

## 2026-06-02

- **Condensed 38-section forensic re-audit** — Re-ran full-spectrum review via dynamic-workflow-emulator skill (swarm orchestration simulated inline). Produced 38-section condensed report: 10 P0, 13 P1, 16 P2, 8 P3 (47 total). Key new findings: in-memory rate-limit prod fallback (P0), per-instance circuit-breaker (P0), destructive `lib/pending-analysis-store.ts` `take()` (P0), CSP `'unsafe-inline'` still present despite D003 (P0), dashboard Pro from localStorage (P0), `app/page.tsx` 41KB `"use client"` (P0), Stripe preview apiVersion (P1), scrypt `maxmem: 256MB` (P1), no `formData()` body cap (P1), 30s Redis TTL on token-version (P1). Cross-checked REVIEW.md and found ≥6 claimed fixes do not hold against current source. Sections marked `[partial]` had unread regions.
- **Coordinate Analysis Swarm Audit** — Executed a complete deep workspace audit using coordinated analysis swarms. Uncovered 6 new critical/high security and logic vulnerabilities (VULN-01 to VULN-06) across raw text extraction, quota limits, prompt injection, and database transaction lock paths.
- **scrypt maxmem fix** — Added explicit `maxmem` to scrypt hash/verify in `lib/password.ts`. Was breaking ALL signup + login in production (`ERR_CRYPTO_INVALID_SCRYPT_PARAMS`). Commit `c8330a4`.
- **Mobile VOICES cards fix** — Cards now use top hairline (not stray left border) when stacked on mobile. Commit `88353b2`.
- **Stripe guard scoping** — Scoped Stripe guard to Stripe routes only; quieted Turbopack + build warnings. Commit `23330a9`.
- **Notice-to-Quit reader unification** — Unified mobile + desktop Notice-to-Quit reader into one scrolly component. Commit `249159e`.
- **Prisma $extends() migration** — Migrated from deprecated `$use()` middleware to `$extends()` Client Extensions. Commit `6d208d6`.
- **directUrl fix** — Removed invalid `directUrl` from PrismaClient constructor. Commit `0b4e04c`.
- **Mobile blank-below-demo fix** — Fixed mobile blank-below-demo + frozen reveals in production build. Commit `608355a`.
- **Mobile NTQ reader upgrade** — Drastically upgraded mobile Notice-to-Quit reader to match desktop. Commit `93cb6c3`.
- **Sticky scrollytelling restore** — Restored homepage sticky scrollytelling — overflow-x clip not hidden. Commit `31773c2`.

## 2026-06-01

- **Supabase pooler migration fix** — Session-mode rewrite + failed-migration recovery. Commit `db6c8cb`.
- **Comprehensive security hardening** — 85 fixes across 5 tiers. Commit `afb63f6`.
- **Memory docs update** — Removed memory/ from tracking, added audit report + design docs + marketing materials. Commit `6c3c87c`.
- **Production-grade remediation** — Full workspace critical remediation: 11 critical, 7 high, 16 medium issues closed. 46/46 tests passing. Commit `a8077d0` (referenced in REVIEW.md).
- **Dead code cleanup** — Removed dead code + Stripe client caching. Commit `b6b6896`.
- **Critical security + reliability stabilization** — Multiple rounds of security and reliability fixes. Commits `39d9d58`, `5e2d63f`.

## 2026-05-31

- **Bug hunt** — 10-agent audit found 106 issues: 6 critical, 20 high, 26 medium, 37 low, 17 cosmetic.
- **Security findings** — Most critical/high issues fixed in commit `a8077d0`.

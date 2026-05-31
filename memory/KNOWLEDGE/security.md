# Security Posture

> Last verified: 2026-05-31. Status reflects the **current working tree**, not git history.
> Trust code over this note; re-verify before relying on any "resolved" item.

## Current posture (verified 2026-05-31)

| Area | Status | Evidence |
|------|--------|----------|
| Secrets in tracked tree | ✅ Clean | Only `.env.example` tracked; `.gitignore` has `.env*` + `!.env.example`. Grep for `sk_live`/`sk_test`/`nvapi-`/`AKIA` in tracked source = none. |
| Login brute-force | ✅ Throttled | Login throttle added in `auth.ts` (commit `35fe033`). |
| Session invalidation | ✅ Present | `User.tokenVersion` — bump to invalidate issued JWTs. |
| Free-quota race | ✅ Hardened | "Atomic quota" + reserve/refund (commit `35fe033`). |
| Delete TOCTOU | ✅ Fixed | `/api/analyses/[id]/delete` hardened (commit `35fe033`). |
| Auth on data routes | ✅ Required | `auth()` → 401; ownership enforced by `userId` in fetch-by-id. |
| Stripe webhooks | ✅ Idempotent | Signature verify + `ProcessedStripeEvent` dedupe. |
| CSP / headers | ✅ Centralized | `proxy.ts` sets CSP (NIM + Stripe allow-listed). |
| Passwords | ✅ scrypt | `scrypt:<salt>:<hash>` in `lib/password.ts`; never logged. |

## Open items (need action) — see [[TODO]]

1. **Audit git HISTORY for leaked secrets.** A prior memory flagged *committed API keys*. The current tree is clean, but secrets may persist in history. Run `git log -p -- '.env*'` / `gitleaks detect`. **If anything is found, rotate the keys immediately** (NVIDIA, Stripe, NextAuth secret, Upstash) — rotation matters more than rewriting history. *(Still open.)*
2. ✅ **Sensitive-data logging — FIXED 2026-06-01.** `lib/ai.ts` parse/validation failures now log metadata only in production (gated on `NODE_ENV`); full raw output only in dev. Confirmed `lib/analysis-ai.ts` logs only `Error` objects, not raw content.
3. ✅ **CSP — TIGHTENED 2026-06-01.** Dropped `'unsafe-eval'` from `script-src` in both `proxy.ts` and `next.config.ts` (now kept in sync; proxy wins at runtime). `'unsafe-inline'` retained pending nonce adoption (Next streaming SSR). No wildcard origins beyond NIM + Stripe. Also added `poweredByHeader:false`. Remaining: nonce-based CSP to drop `'unsafe-inline'` (tracked in [[TODO]]).

## Notes

- The "dead `middleware.ts`" concern from earlier notes is moot: request handling is in **`proxy.ts`** (Next 16). Confirm no stray `middleware.ts` exists.
- This file supersedes the older standalone security-findings notes for items marked ✅ above — those are resolved in the current tree. Keep #1 and #2 open until verified.

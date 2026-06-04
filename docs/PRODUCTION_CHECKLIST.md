# Production Deployment Checklist

Pre-launch and post-launch verification for ClearDoc deployments.

---

## Pre-Launch Checklist

### Environment Variables (Required)

- [ ] `DATABASE_URL` — Supabase transaction pooler URL (port 6543) with `?pgbouncer=true&connection_limit=5`
- [ ] `DIRECT_URL` — Supabase session pooler URL (port 6543) for Prisma migrations. **Must be session-mode, not transaction-mode**, or DDL operations will fail.
- [ ] `NEXTAUTH_SECRET` — ≥ 32 characters. Generate with `openssl rand -base64 32`
- [ ] `NEXTAUTH_URL` — Production URL (e.g., `https://cleardoc.vercel.app`)
- [ ] `NVIDIA_API_KEY` — Valid NVIDIA NIM API key
- [ ] `NVIDIA_API_BASE_URL` — **Must be a private/enterprise endpoint, NOT the trial endpoint** (`integrate.api.nvidia.com` logs inputs/outputs, which is a HIPAA/GDPR violation for document analysis)
- [ ] `STRIPE_SECRET_KEY` — Must be `sk_live_...` (not `sk_test_...`). The boot guard refuses to start in production with test keys.
- [ ] `STRIPE_WEBHOOK_SECRET` — Must be `whsec_...` from a live-mode webhook endpoint
- [ ] `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` — Must be `pk_live_...` (not `pk_test_...`). The boot guard refuses production startup with a key mismatch.
- [ ] `NEXT_PUBLIC_APP_URL` — Production URL
- [ ] `UPSTASH_REDIS_REST_URL` — Required for distributed rate limiting and token-version cache
- [ ] `UPSTASH_REDIS_REST_TOKEN` — Required alongside Upstash URL

### Environment Variables (Recommended)

- [ ] `HEALTH_CHECK_SECRET` — Required for canary health gates and authenticated `/api/health` diagnostics. Generate with `openssl rand -hex 32`
- [ ] `SENTRY_DSN` — Server-side Sentry for error and transaction capture
- [ ] `NEXT_PUBLIC_SENTRY_DSN` — Client-side Sentry for Web Vitals and error capture
- [ ] `SENTRY_TRACES_SAMPLE_RATE` — Recommended `0.1` (10% of transactions) for production

### Build Verification

- [ ] `npm run typecheck` passes with zero errors
- [ ] `npm test` passes all 71 tests
- [ ] `npm run build` succeeds without errors
- [ ] CI pipeline (lint, typecheck, test, build, migration dry-run) passes on the target branch

### Database

- [ ] `prisma migrate deploy` has been run against the production database (or `scripts/prebuild-migrate.mjs` will run it during the Vercel build)
- [ ] No pending migrations that would break backward compatibility (additive only)

### Vercel Configuration

- [ ] **Rolling Releases** enabled in Vercel dashboard > Settings > Git > Deployment Policies for `main`
- [ ] Preview environment variables configured for staging (see `docs/STAGING_DEPLOYMENT.md`)
- [ ] `HEALTH_CHECK_SECRET` set in Vercel environment variables (Production scope)
- [ ] Function memory and duration overrides match `vercel.json`

---

## Post-Launch Verification

### Immediate (within 5 minutes)

- [ ] `curl -sf https://cleardoc.vercel.app/api/health | jq .status` returns `"ok"`
- [ ] With auth: `curl -sf -H "x-health-token: $HEALTH_CHECK_SECRET" https://cleardoc.vercel.app/api/health | jq .` shows all subsystems healthy
- [ ] Sentry dashboard shows the new release (filter by `VERCEL_GIT_COMMIT_SHA`)
- [ ] No spike in 5xx errors on Vercel dashboard

### Short-Term (within 30 minutes)

- [ ] Login flow works end-to-end (sign up, sign in, session persistence)
- [ ] Document upload and analysis works (test with a real PDF)
- [ ] Chat feature works (send a message and receive a reply)
- [ ] Stripe checkout flow works (test with a real card in test mode first, then live)
- [ ] Dashboard loads and displays analysis history

### Canary Monitoring (if using Rolling Releases)

- [ ] Vercel dashboard shows gradual traffic shift (10% → 25% → 50% → 100%)
- [ ] Error rate stays below 1% during each traffic shift
- [ ] p95 latency stays within 2x of baseline
- [ ] `/api/health` returns healthy throughout the canary period
- [ ] No circuit breaker openings (`aiUpstream` not `"error"`)

---

## Rollback Procedure

If any post-launch check fails:

```bash
# Quick rollback to previous deploy
vercel rollback

# Verify health on the rolled-back deploy
curl -sf https://cleardoc.vercel.app/api/health | jq .status
# Expected: "ok"
```

See `docs/MIGRATION_ROLLBACK.md` for database rollback procedures and `docs/CANARY_DEPLOYMENTS.md` for canary-specific rollback.
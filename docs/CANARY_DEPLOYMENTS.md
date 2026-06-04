# Canary & Rolling Deployments Guide

ClearDoc runs on Vercel's serverless platform. This document covers canary deployment strategies using Vercel's built-in features, gradual rollout configuration, health-gated validation, and automatic rollback.

---

## 1. Vercel Built-In Canary Deployments

Vercel provides **Rolling Releases** (GA since June 2025) for gradual traffic shifting to new deployments. This is the recommended canary deployment strategy for ClearDoc.

### How Rolling Releases Work

When a production deployment is promoted with rolling release enabled:

1. Vercel routes a small percentage of traffic to the new deploy (starting at ~10%)
2. The platform monitors error rates and response times on both old and new deploys
3. Traffic is gradually increased (10% to 25% to 50% to 100%)
4. If error rates spike on the new deploy, the rollout automatically pauses or rolls back to the previous deploy

This means that during a canary period, a fraction of real users hit the new code while the majority continue on the stable deploy. If the canary shows elevated error rates, Vercel shifts traffic back to the previous deploy without manual intervention.

### Preview Deploys as Pre-Canary Validation

Before reaching the canary stage, every PR gets a full preview deployment. This is the first validation layer:

1. Open a PR -- Vercel builds and deploys to `cleardoc-git-<branch>-sahajpatel123.vercel.app`
2. The preview deploy runs the full build pipeline including `scripts/prebuild-migrate.mjs`
3. Test the preview URL before merging
4. Merge to `main` triggers the production deploy (with or without rolling release)

---

## 2. Configuring Gradual Rollout Percentages

### Enabling Rolling Releases in vercel.json

Add a `git` section to `vercel.json` to enable deployment policies:

```json
{
  "git": {
    "deploymentEnabled": true
  }
}
```

Then enable Rolling Releases in the Vercel dashboard under **Settings > Git > Deployment Policies** for the production branch (`main`).

### Current vercel.json Configuration

The existing `vercel.json` configures function-level settings but does not yet have deployment policies enabled. The current configuration:

```json
{
  "$schema": "https://openapi.vercel.sh/vercel.json",
  "crons": [
    { "path": "/api/cron/cleanup", "schedule": "0 4 * * 0" },
    { "path": "/api/cron/quota-reconcile", "schedule": "0 * * * *" }
  ],
  "functions": {
    "app/api/analyze/route.ts": { "maxDuration": 120, "memory": 2048 },
    "app/api/chat/route.ts": { "maxDuration": 60, "memory": 1024 },
    "app/api/rephrase-letter/route.ts": { "maxDuration": 60, "memory": 1024 },
    "app/api/stripe/webhook/route.ts": { "maxDuration": 30, "memory": 512 }
  }
}
```

To add canary rollout configuration, add a `git` key alongside the existing `crons` and `functions` keys.

### Gradual Rollout via Vercel Dashboard

In the Vercel dashboard (**Settings > Git > Deployment Policies**):

- **Enable Rolling Releases** for the `main` branch
- **Set step percentages**: 10% to 25% to 50% to 100% (recommended defaults)
- **Set monitoring window**: 5 minutes per step before advancing (recommended)
- **Set automatic rollback threshold**: Roll back if error rate exceeds 5% or p95 latency exceeds 30 seconds (matching the `maxDuration` of the analyze route)

### Manual Promotion via Vercel CLI

For manual control over the rollout:

```bash
# Deploy to production
vercel --prod

# Check current deployment status
vercel ls --prod

# Inspect a specific deployment
vercel inspect <deployment-url>

# Roll back if issues are detected
vercel rollback
```

---

## 3. Monitoring Canary Health via /api/health

The `/api/health` endpoint (implemented in `app/api/health/route.ts`) is the primary health gate for canary validation. It runs all subsystem probes in parallel and returns a comprehensive status.

### Unauthenticated Health Check

Without the `x-health-token` header, the endpoint returns only an HTTP status code:

- **200** = all subsystems healthy
- **503** = one or more subsystems degraded

```bash
# Quick health check — just the status code
curl -s -o /dev/null -w "%{http_code}" https://cleardoc.vercel.app/api/health
# Expected: 200
```

### Authenticated Health Check

With the `HEALTH_CHECK_SECRET` environment variable set, send the token in the `x-health-token` header to get the full diagnostic response:

```bash
curl -s -H "x-health-token: $HEALTH_CHECK_SECRET" \
  https://cleardoc.vercel.app/api/health | jq .
```

Response structure:

```json
{
  "status": "ok",
  "database": "ok",
  "tables": "ok",
  "rateLimiter": "distributed",
  "aiUpstream": "ok",
  "stripeApi": "ok",
  "env": {
    "core": "ok",
    "stripe": "ok"
  },
  "timestamp": "2026-06-04T12:00:00.000Z"
}
```

Possible values for each field:

| Field | Values | Meaning |
|-------|--------|---------|
| `status` | `"ok"`, `"degraded"` | Overall health |
| `database` | `"ok"`, `"error"` | Supabase connectivity |
| `tables` | `"ok"`, `"schema_incomplete"`, `"error"` | Schema completeness (checks `lastResetAt`, `tokenVersion`, `caseId`, `parentId`, `chatMessages`) |
| `rateLimiter` | `"distributed"`, `"distributed-unreachable"`, `"in-memory-fallback"`, `"error"` | Upstash Redis reachability |
| `aiUpstream` | `"ok"`, `"unconfigured"`, `"unreachable"`, `"error"` | NVIDIA NIM API reachability |
| `stripeApi` | `"ok"`, `"unconfigured"`, `"error"` | Stripe key validity |
| `env.core` | `"ok"`, `"missing"` | Required server env vars (`DATABASE_URL`, `NEXTAUTH_SECRET`, `NVIDIA_API_KEY`) |
| `env.stripe` | `"ok"`, `"missing"` | Required Stripe env vars |

### Health Gate Criteria for Canary Promotion

A canary deployment is considered healthy and safe to promote when:

1. `/api/health` returns HTTP 200 (all subsystems ok)
2. Sentry error rate for the new deploy is below 1%
3. No increase in 5xx responses compared to the baseline deploy
4. p95 latency is within 2x of the baseline
5. No circuit breakers opened (`aiUpstream` not `"error"`)
6. No schema incompleteness (`tables` is `"ok"`, not `"schema_incomplete"`)

### Monitoring During Rollout

Check these signals during a canary period:

```bash
# 1. Health endpoint
curl -s -H "x-health-token: $HEALTH_CHECK_SECRET" \
  https://cleardoc.vercel.app/api/health | jq '.status'
# Expected: "ok"

# 2. Vercel real-time logs
vercel logs --follow

# 3. Sentry — filter by Vercel commit SHA
# In Sentry dashboard, filter releases by VERCEL_GIT_COMMIT_SHA
```

---

## 4. Automatic Rollback on Health Check Failure

### Vercel's Built-In Rollback

Vercel Rolling Releases can automatically roll back when error rates spike. Configure in the Vercel dashboard under **Settings > Git > Deployment Policies**:

- **Error rate threshold**: Roll back if the error rate exceeds 5% (recommended for ClearDoc)
- **Response time threshold**: Roll back if p95 latency exceeds 30 seconds (matching the `maxDuration` of the `/api/analyze` route)
- **Monitoring window**: 5 minutes of observation before advancing to the next traffic percentage

### Health-Gated Rollback Script

For environments where Vercel's built-in rollback is not sufficient, use the health endpoint to gate promotion:

```bash
#!/bin/bash
# canary-gate.sh — Check /api/health before promoting a canary

HEALTH_URL="${1:-https://cleardoc.vercel.app/api/health}"
TOKEN="${HEALTH_CHECK_SECRET}"

STATUS=$(curl -s -H "x-health-token: $TOKEN" "$HEALTH_URL" | jq -r '.status')

if [ "$STATUS" != "ok" ]; then
  echo "HEALTH CHECK FAILED: status=$STATUS"
  echo "Rolling back..."
  vercel rollback
  exit 1
fi

echo "Health check passed: status=$STATUS"
exit 0
```

### Manual Rollback

```bash
# Quick rollback to previous deploy
vercel rollback

# Roll back to a specific deploy
vercel rollback --to <deployment-id>
```

### Important: Rollback Does Not Reverse Migrations

`vercel rollback` redeploys the previous code but does NOT reverse any Prisma migrations that were applied by `scripts/prebuild-migrate.mjs`. If a migration was applied during the canary deploy:

- **Additive migrations** (new columns, new tables): Safe -- old code ignores the new columns
- **Destructive migrations** (dropped columns, renamed tables): Unsafe -- old code expects the old schema

This is why all ClearDoc migrations should be additive. See [MIGRATION_ROLLBACK.md](./MIGRATION_ROLLBACK.md) for database-level rollback procedures.

---

## 5. Deployment Strategies

### Strategy A: Rolling Release (Default)

Best for most deployments. Vercel gradually shifts traffic 10% to 25% to 50% to 100%.

1. Merge PR to `main`
2. Vercel creates a production deployment with rolling release
3. Monitor `/api/health` and Sentry at each traffic percentage
4. If error rate spikes, Vercel pauses and rolls back automatically

### Strategy B: Blue-Green (Manual Promotion)

Best for high-risk changes (schema migrations, API contract changes).

1. Deploy to a preview URL first (automatic on PR creation)
2. Test thoroughly on the preview URL, including `/api/health` with auth token
3. Promote to production via Vercel dashboard or CLI
4. Monitor `/api/health` and Sentry for 15 minutes post-promotion
5. If issues arise, run `vercel rollback`

### Strategy C: Feature-Flag Gated

Best for large features that need gradual exposure.

1. Deploy the feature behind an environment variable (e.g. `NEXT_PUBLIC_ENABLE_X=true`)
2. Enable for internal users on the preview deployment
3. Enable for a percentage of production users
4. Enable for all users

---

## 6. Incident Response During Canary

### Deployment Incident Checklist

1. **Detect**: Sentry alert or Vercel dashboard shows elevated error rate on the new deploy
2. **Assess**: Check `/api/health` with auth token and recent Vercel deploy logs
3. **Rollback**: Run `vercel rollback` if the new deploy is causing issues
4. **Investigate**: Check Sentry for the specific error pattern, filter by `VERCEL_GIT_COMMIT_SHA`
5. **Fix**: Create a hotfix branch from `main`, apply the fix, merge
6. **Verify**: Monitor `/api/health` (HTTP 200) and error rates for 15 minutes after the fix deploy

### Key Metrics

| Metric | Healthy Threshold | Action if Exceeded |
|--------|------------------|-------------------|
| `/api/health` HTTP status | `200` | Roll back immediately |
| `/api/health` `status` field | `"ok"` | Investigate which subsystem is degraded |
| `tables` field | `"ok"` | Schema incomplete -- check `lib/ensure-schema.ts` and migrations |
| `rateLimiter` field | `"distributed"` | If `"in-memory-fallback"`, Upstash Redis is unreachable |
| `aiUpstream` field | `"ok"` | If `"unreachable"`, NVIDIA NIM endpoint is down |
| Sentry error rate | < 1% | Investigate, roll back if > 5% |
| p95 latency | < 10s | Optimize, roll back if > 30s (matches `maxDuration`) |
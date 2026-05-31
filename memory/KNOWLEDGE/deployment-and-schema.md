# Deployment & Runtime Schema Self-Heal

> Last verified: 2026-05-31 against `lib/ensure-schema.ts` (uncommitted refactor), `scripts/prebuild-migrate.mjs`,
> `package.json`, git history. Trust code over this note.

## The deployment shape

- **Host:** Vercel. **DB:** Supabase Postgres, accessed through the **pooler** role.
- The Vercel **build container cannot reach Supabase's direct database port**, so `prisma migrate deploy` **cannot run during build** (history: `d1ede80` tried it → `35b2668` preferred pooler + tolerate `P1001` → `8d7a9f7` stopped running migrate in builds entirely).
- `npm run db:migrate` → `scripts/prebuild-migrate.mjs` exists as a helper, but builds no longer depend on it.

## Why runtime self-heal exists

Because migrations can't be guaranteed at build time, `lib/ensure-schema.ts` provides a **best-effort runtime guard** (`ensureDatabaseSchema()`) that adds columns/indexes introduced by later migrations if they're missing. It's safe to call on every request and runs once per server instance.

### Two safety properties (the whole point)

1. **Read-first.** It checks `information_schema` for the required columns first. A `SELECT` on `information_schema` needs **no table ownership**, so it can never fail with `42501 must be owner of table` — which matters because the **pooler role does not own the tables**. If all required columns exist (the normal prod state), it runs **zero DDL**.
2. **Never fatal.** Any DDL failure (insufficient privilege, already applied, transient) is logged and **swallowed**; the request proceeds. If a column were truly missing, the *real* query surfaces a precise error instead of every request dying inside the guard. On failure it nulls its cached promise so a later cold start can retry.

### Columns/indexes it guards (the slow path)

- `User.lastResetAt` (TIMESTAMP, default now), `User.tokenVersion` (INT default 0)
- `Analysis.chatMessages` (JSONB), `Analysis.parentId` (TEXT), `Analysis.caseId` (TEXT)
- Indexes `Analysis_caseId_idx`, `Analysis_parentId_idx`
- FK `Analysis_parentId_fkey` (added via a guarded `DO $$ ... $$` block; ON DELETE SET NULL)

All DDL uses `IF NOT EXISTS` / existence checks → idempotent.

## Migrations (source of truth is `prisma/migrations/`)

```
20260330140000_init
20260523070000_add_user_password
20260526120000_stripe_event_idempotency
20260526180000_analysis_features                 # chatMessages, parentId, caseId
20260529000000_daily_free_quota_and_token_version # lastResetAt, tokenVersion
```

## Operating rules

- **Schema changes still go through Prisma migrations.** The runtime guard is a **safety net, not the migration mechanism** — when you add a column, also add its `IF NOT EXISTS` DDL + `REQUIRED_COLUMNS` entry to `ensure-schema.ts`, and run `prisma migrate deploy` out-of-band against prod.
- Keep `prisma/schema.prisma` in sync with applied migrations (build TS errors otherwise — see `36ef93d`).
- `/api/health` gates deploys on DB + env (commit `35fe033`).

## Prior incident (context)

Production once threw "column does not exist" errors because migrations weren't applied during builds. The self-heal guard + stopping build-time migrate is the resolution. Don't reintroduce build-time `migrate deploy` against Supabase's direct port.

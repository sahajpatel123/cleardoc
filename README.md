# ClearDoc

**A second pair of eyes on the document that scares you.**

ClearDoc helps everyday people understand intimidating official documents —
insurance denials, medical bills, eviction notices, IRS letters, debt
collection, visa rejections, and more. Upload a document and get back:

- a **plain-English summary**,
- **red flags** with severity and the exact triggering sentence,
- a **ready-to-send response letter**,
- **ranked next steps** with free resources,
- an **overall verdict** (legitimate / suspicious / likely illegal), and
- extracted **deadlines** with calendar export.

**Monetization:** Free tier = a few saved analyses per day → **Pro $9/month**
for unlimited use, follow-up case linking, and higher chat/letter limits.

---

## Tech stack

| Layer       | Choice                                                            |
| ----------- | ----------------------------------------------------------------- |
| Framework   | Next.js 16 (App Router, Turbopack), React 19, TypeScript strict   |
| Styling     | Tailwind CSS v4 (`@import "tailwindcss"` — no config file)         |
| Auth        | NextAuth v5 (Credentials: email + password, scrypt)               |
| Database    | PostgreSQL + Prisma 6 (Supabase in production)                    |
| AI          | NVIDIA NIM (`openai` SDK, `meta/llama-3.2-90b-vision-instruct`)   |
| PDF / image | `pdf2json` for text PDFs; images analyzed via NVIDIA NIM vision    |
| Payments    | Stripe subscriptions (Checkout + Billing Portal + webhook)        |
| Rate limit  | Upstash Redis (optional — see note below)                         |

---

## Local development

```bash
npm install                 # runs `prisma generate` via postinstall
cp .env.example .env.local  # then fill in the values below
npx prisma migrate deploy   # apply migrations to your database
npm run dev                 # http://localhost:3000
```

Other scripts:

```bash
npm run build   # production build (what Vercel runs)
npm test        # unit tests (free-quota, ics, user-plan, validate-analysis)
npm run lint    # eslint
```

For Stripe webhooks locally:

```bash
stripe listen --forward-to localhost:3000/api/stripe/webhook
```

---

## Environment variables

Set these in `.env.local` (local) and in Vercel → Project → Settings →
Environment Variables (production). See `.env.example` for the full list.

**Required**

| Variable                | Purpose                                                     |
| ----------------------- | ----------------------------------------------------------- |
| `DATABASE_URL`          | PostgreSQL connection (Supabase **pooled** URL for the app) |
| `DIRECT_URL`            | Supabase **direct** (non-pooled) URL — used for `migrate`   |
| `NEXTAUTH_SECRET`       | `openssl rand -base64 32`                                   |
| `NEXTAUTH_URL`          | e.g. `https://yourdomain.com`                               |
| `NVIDIA_API_KEY`        | NVIDIA NIM API key                                          |
| `STRIPE_SECRET_KEY`     | Stripe secret key                                           |
| `STRIPE_WEBHOOK_SECRET` | From the Stripe webhook endpoint you create                 |
| `NEXT_PUBLIC_APP_URL`   | Public origin, e.g. `https://yourdomain.com` (Stripe + SEO) |

**Optional (strongly recommended for launch)**

| Variable                   | Purpose                                                 |
| -------------------------- | ------------------------------------------------------- |
| `UPSTASH_REDIS_REST_URL`   | Enables rate limiting on `/api/analyze`, chat, rephrase |
| `UPSTASH_REDIS_REST_TOKEN` | ↑ paired token                                          |

> ⚠️ **Rate limiting is disabled when Upstash is not configured.** The
> `/api/analyze` route calls the NVIDIA NIM API (real cost per request). Without
> Upstash env vars set, `lib/rate-limit.ts` allows every request. **Set the
> Upstash variables before going live** to cap per-IP and per-account usage.

---

## Deploying to Vercel + Supabase

1. **Database (Supabase).** Use the **pooled** connection string (port 6543,
   `pgbouncer=true`) for `DATABASE_URL`, and the **direct** string (port 5432)
   for `DIRECT_URL`. Prisma uses `DIRECT_URL` for migrations and `DATABASE_URL`
   at runtime.

2. **Run migrations against production** before/at deploy:

   ```bash
   npx prisma migrate deploy
   ```

   Run this from your machine (pointed at the prod DB) or in your deploy
   pipeline. Vercel does **not** run migrations automatically — only
   `prisma generate` runs via `postinstall`.

3. **Environment variables.** Add every Required variable above to Vercel (plus
   the Upstash pair). Point `NEXTAUTH_URL` and `NEXT_PUBLIC_APP_URL` at your
   real domain.

4. **Stripe webhook.** Add an endpoint at
   `https://yourdomain.com/api/stripe/webhook` for events
   `checkout.session.completed`, `customer.subscription.created`,
   `customer.subscription.updated`, `customer.subscription.deleted`. Copy the
   signing secret into `STRIPE_WEBHOOK_SECRET`.

5. **Health check.** After deploy, hit `GET /api/health` — it reports DB
   connectivity and any missing core environment variables.

6. **Package manager.** Only `package-lock.json` is committed (pnpm lock /
   workspace files are gitignored), so Vercel builds with npm. No action needed.

---

## Project layout

```
auth.ts            NextAuth config (Credentials, JWT, token-version invalidation)
proxy.ts           CSP + security headers (Next.js request proxy)
app/               App Router pages + API routes
  api/analyze      Core: extract → Claude → save (auth + quota + rate limit)
  api/chat         Per-analysis call-prep chat
  api/rephrase-letter  Re-tone the response letter
  api/stripe/*     Checkout, portal, idempotent webhook
  error.tsx, global-error.tsx, not-found.tsx   Branded error + 404 boundaries
  robots.ts, sitemap.ts, opengraph-image.tsx   SEO + social
components/ui/     Editorial "Atelier" UI components
lib/               db, claude, stripe, env, rate-limit, quota, validation
prisma/            schema.prisma + migrations
```

See `CLAUDE.md` for the detailed architecture, data model, and product rules.

---

## Disclaimer

ClearDoc provides general information only and is **not** legal, financial, or
professional advice. See `/disclaimer` for the full terms.

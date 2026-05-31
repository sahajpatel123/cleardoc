# ClearDoc — Project Brain 🧠

> **The single source of truth for project context.** Keep this dense, high-signal, and current.
> Last updated: **2026-05-31**. If this conflicts with code, **trust the code** and fix this file.
> Related: [[DECISIONS]] · [[CHANGES]] · [[TODO]] · [[RULES]] · [[KNOWLEDGE/README]]

---

## 1. What ClearDoc is

ClearDoc helps everyday people understand and fight back against scary official documents — insurance denials, medical bills, eviction notices, IRS letters, etc.

**Per analysis, the AI returns:**
- Plain-English summary
- Red flags with severity (`high` / `medium` / `low`) + verbatim source text
- A ready-to-send formal response letter
- Ranked next steps (1–5)
- Overall verdict (`legitimate` / `suspicious` / `likely_illegal`)
- Extracted **deadlines** (absolute or relative + anchor date) → exportable as `.ics`

**Monetization:** Free = **3 saved analyses / UTC day** → **Pro = $9/month** (Stripe subscription, unlimited).

---

## 2. Current state (2026-05-31)

- **Branch:** `main`. Recently pushed:
  - `d362788` — GDPR analysis deletion endpoint
  - `69a058d` — Mobile horizontal scroll fix
  - Security hardening (login throttle, auth optimization, AI retry, try-catch on GET routes)
- **Product works end-to-end:** upload → login gate → analyze → save → dashboard history → Stripe upgrade.
- **Recently shipped:** Nemotron Omni model swap, security hardening, dedicated analysis session page, mobile horizontal-scroll fix, GDPR deletion endpoint.
- **Audit triaged + fixed (2026-06-01):** the "117-issue" audit was verified by workflow — 13 confirmed, 14 false-positive, severities overstated. Confirmed defects fixed & verified green (tsc + tests + build): chat/rephrase error-shape, atomic chat cap, webhook null-customer guard, CSP `unsafe-eval` drop + `poweredByHeader`, prod raw-log gating, analyze error codes, pdf decode safety, Stripe-event cleanup cron. Uncommitted on `main`. See [[CHANGES]] + [[DECISIONS]] D-007.
- **Deploy target:** Vercel + Supabase Postgres (pooler). Build does **not** run migrations; schema self-heals at runtime. See [[KNOWLEDGE/deployment-and-schema]].

---

## 3. Tech stack (verified against code)

| Layer | Choice |
|-------|--------|
| Framework | Next.js **16.1.6** App Router, React **19.2.3**, TypeScript strict |
| Styling | Tailwind CSS **v4** (`@import "tailwindcss"`, no config file) |
| Auth | NextAuth **v5** (`5.0.0-beta.30`), Credentials provider (email/password, scrypt) + login throttle + `tokenVersion` session invalidation |
| DB | PostgreSQL + Prisma **6.19** (Supabase in prod) |
| AI | NVIDIA NIM — **`nvidia/nemotron-3-nano-omni-30b-a3b-reasoning`** (multimodal, thinking disabled) via `openai` SDK. Defined in `lib/ai-model.ts`. ⚠️ CLAUDE.md still says llama-3.2-90b — stale. See [[KNOWLEDGE/claude-md-drift]]. |
| PDF | `pdf2json` server-side; images → NIM vision |
| Payments | Stripe subscriptions (`stripe ^20.4.1`), $9/mo (`unit_amount: 900`) |
| Rate limit | Upstash Redis — optional (only when `UPSTASH_REDIS_*` set) |
| UI/motion | framer-motion 12, lucide-react, react-dropzone 15; Syne + DM Sans fonts |

Auth is **NOT** Firebase. DB is **NOT** Firestore. Request handling is **`proxy.ts`**, not `middleware.ts`. Never reintroduce Firebase.

---

## 4. Data model (Prisma — verified)

- **User**: `id`, `email` (unique), `password?` (scrypt), `plan` (`free`|`pro`), `subscriptionStatus` (`active`|`inactive`|`cancelled`), `stripeCustomerId?`, `stripeSubscriptionId?`, `freeUsesRemaining`, **`lastResetAt`**, **`tokenVersion`**, Auth.js relations.
- **Analysis**: `id`, `userId`, `documentName`, `documentType`, `result` (JSON `AnalysisResult`), **`chatMessages?`** (JSON), **`parentId?`** + self-relation `AnalysisChain`, **`caseId?`**. Indexed on `[userId, createdAt]`, `caseId`, `parentId`.
- **ProcessedStripeEvent**: Stripe `evt_` id → webhook idempotency.

> Bold fields (`lastResetAt`, `tokenVersion`, `chatMessages`, `parentId`, `caseId`) are **newer than CLAUDE.md** — they enable daily-quota reset, session invalidation, per-analysis chat, and analysis chains/cases.

**No document blobs stored** — only the AI `result` JSON is persisted.

---

## 5. Hard product rules (implement exactly)

| Rule | Source |
|------|--------|
| Homepage requires login before analyze | `app/page.tsx` |
| `/api/analyze` requires auth (401 otherwise) | `app/api/analyze/route.ts` |
| Free quota checked **before** AI call; **3/UTC day** | `lib/free-quota.ts` (`FREE_DAILY_ANALYSIS_LIMIT=3`) |
| Pro = `plan==="pro"` **AND** `subscriptionStatus==="active"` | `lib/user-plan.ts` |
| Max upload 10MB; PDF, PNG, JPG, WEBP | analyze route + `lib/pdf-parser.ts` |
| Rate limits (if Upstash set): 15/hr/IP, 10/hr free, 60/hr Pro | `lib/rate-limit.ts` |
| Stripe webhooks idempotent per `event.id` | `lib/stripe-events.ts` |
| Quota reserved before AI; refunded on failure | `app/api/analyze/route.ts` + `lib/db.ts` |

Full rules & conventions live in [[RULES]].

---

## 6. Key files (orientation)

- `auth.ts` — NextAuth (Credentials, JWT, login throttle, tokenVersion)
- `proxy.ts` — CSP + security headers (Next 16 proxy)
- `lib/ai.ts` + `lib/ai-model.ts` — analysis prompt, retry (3× exp backoff), 80k-char truncation, JSON parse/validate
- `lib/free-quota.ts` — daily quota (UTC day, limit 3)
- `lib/ensure-schema.ts` — runtime DDL self-heal (Supabase build can't migrate)
- `lib/ics.ts` — deadline → calendar export
- `lib/db.ts`, `lib/prisma.ts`, `lib/db-client.ts` — data access
- `scripts/prebuild-migrate.mjs` — migration helper (not run in Vercel build)
- API routes under `app/api/*` (analyze, chat, rephrase-letter, analyses[/case/delete], usage, health, stripe/*, auth/*)

Deeper maps: [[KNOWLEDGE/architecture]], [[KNOWLEDGE/ai-pipeline]].

---

## 7. ⚠️ Important context & gotchas

1. **CLAUDE.md is partly stale** (model name, data model). The drift is catalogued in [[KNOWLEDGE/claude-md-drift]]. Trust code first.
2. **A separate autonomous-agent framework lives at the repo root** (`AGENTS.md`, `SOUL.md`, `IDENTITY.md`, `USER.md`, `HEARTBEAT.md`, `TOOLS.md`). It *also* uses `memory/` for daily notes and a root `MEMORY.md` concept. This central-memory system (the user's request) lives entirely under `./memory/` and is the project knowledge base. **Coexistence is intentional but unreconciled** — see [[DECISIONS]] (D-002) and [[RULES]].
3. **Secrets:** none committed in current tree (`.gitignore` covers `.env*`, only `.env.example` tracked). Git *history* not yet audited. See [[KNOWLEDGE/security]].
4. **Schema in prod self-heals** but the pooler role doesn't own tables — DDL is best-effort and read-first so it never breaks requests.

---

## 8. Where to look next

- Priorities & backlog → [[TODO]]
- Why things are the way they are → [[DECISIONS]]
- Conventions & standards → [[RULES]]
- Deep technical notes → [[KNOWLEDGE/README]]
- What changed and when → [[CHANGES]]

## 9. Agent / AI protocol adoption (2026-06-01)
The full `./memory/` operating system (RULES + MEMORY + DECISIONS + TODO + KNOWLEDGE) has been analyzed in depth and its instructions adopted as **binding** for all future work by this agent. See [[CHANGES]] 2026-06-01 entry. The dual-convention tension with root `AGENTS.md` (D-002) remains open per owner decision.

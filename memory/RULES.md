# Rules

Mandatory rules and conventions for all agents and contributors.

---

## Agent Memory Protocol (Strict - Append Only to Logbook)

All CLI agents must follow these rules every session:

1. At the start of every session, before any work:
   - Read: MEMORY.md, DECISIONS.md, RULES.md, TODO.md

2. After completing any meaningful work:
   - Update only the LOGBOOK.md by appending one new entry using the exact format defined in LOGBOOK.md.
   - Do NOT edit MEMORY.md, DECISIONS.md, RULES.md, TODO.md, or CHANGES.md.

3. The main memory files (MEMORY.md, etc.) are read-only for agents. Only the user or a dedicated memory manager can edit them.

4. Purpose of LOGBOOK.md is to let all CLI agents see what others have worked on.

Never create memory outside the memory/ folder.

---

## Code Rules

### Strict Rules (Never Violate)

1. **overflow-x: clip on html/body, NEVER hidden** — `overflow-x: hidden` kills `position: sticky` site-wide. This broke the entire homepage scrollytelling once. Never revert.

2. **Framer Reveal uses scroll-listener, not whileInView** — `whileInView` causes "blank below fold" in production builds on mobile. Don't revert.

3. **Strict zod validation (fail-closed)** — AI responses must pass `safeParseAnalysisResult`. Partial legal data is more dangerous than no data. Never add tolerance for malformed fields.

4. **Stripe routes fail-closed on rate-limit error** — Return 503 with `Retry-After`, never silent pass. A paying customer getting 503 for 30s is less harmful than unlimited Checkout creation.

5. **Never log PII** — pino redact list covers `password|token|secret|email|documentText|file|filename|content|body|cookie|authorization|x-health-token`. Don't add new log points without redaction.

6. **Prisma migrations must be applied before deploy** — `scripts/prebuild-migrate.mjs` handles this in Vercel build. Never assume Vercel runs migrations automatically.

### Conventions

- **Testing:** Uses `node:test` (not Jest). Run with `npm test`. Only 4 pure utility test files exist.
- **Package manager:** npm (only `package-lock.json` is committed).
- **Node version:** 22.x (engines field in package.json).
- **TypeScript:** strict mode enabled. `noUncheckedIndexedAccess` is currently disabled.
- **Styling:** Tailwind CSS v4 with no config file (`@import "tailwindcss"`).
- **Auth:** NextAuth v5 beta with Credentials provider (email + password, scrypt hashing).
- **Database:** PostgreSQL via Prisma 6. Supabase in production with pooled + direct URLs.
- **AI:** NVIDIA NIM via `openai` SDK. `lib/ai.ts` is the only consumer.
- **Error boundaries:** `app/error.tsx`, `app/global-error.tsx`, `app/not-found.tsx` — branded error pages.

### File Organization

- `app/` — App Router pages and API routes
- `components/ui/` — UI components ("Atelier" design system)
- `lib/` — Business logic, utilities, database, AI client
- `prisma/` — Schema and migrations
- `scripts/` — Build and migration scripts
- `memory/` — Agent memory system (this directory)

### API Routes

- `POST /api/analyze` — Core document analysis (auth + quota + rate limit)
- `POST /api/chat` — Per-analysis chat
- `POST /api/rephrase-letter` — Re-tone response letter
- `GET/POST /api/stripe/*` — Checkout, portal, webhook
- `GET /api/health` — Public 200/503; deep state gated on `x-health-token`
- `GET /api/analyses` — List user analyses
- `GET /api/usage` — Usage stats

### Data Model (Prisma)

- **User** — auth, plan (free/pro), Stripe IDs, quota, token version
- **Analysis** — document, result (JSON), linked to User and optionally Case
- **Case** — groups related analyses (e.g., one legal matter with multiple docs)
- **ProcessedStripeEvent** — webhook idempotency
- **Session/Account/VerificationToken** — NextAuth tables

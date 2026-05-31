# Project Rules & Conventions

> Standards, conventions, and constraints for ClearDoc. Read before writing code.
> Related: [[MEMORY]] · [[DECISIONS]] · [[KNOWLEDGE/README]]

---

## 1. Memory-system rules (operating protocol)

1. **Read first.** Before any meaningful change, read [[MEMORY]], [[DECISIONS]], [[RULES]], [[TODO]].
2. **Update after work.** After significant work, update [[MEMORY]] (current state), [[CHANGES]] (new entry), [[TODO]] (mark done / add new), and [[DECISIONS]] (if a real decision was made).
3. **Keep [[MEMORY]] concise and high-signal** — it must never bloat. Push detail down into [[KNOWLEDGE/README]] files.
4. **All project memory lives only under `./memory/`.** Never create project memory/context files elsewhere.
5. **Use `[[wikilinks]]`** to reference other memory files.
6. **Trust the code over the docs.** When [[MEMORY]] or CLAUDE.md conflicts with source, the code wins — then fix the doc.
7. At the end of any response where work was done, state: *"Central memory updated: …"*.

> Note: a separate root autonomous-agent framework (`AGENTS.md` etc.) has its own memory conventions. Those root files are **out of scope** for this system — do not delete or rewrite them. See [[DECISIONS]] D-002.

---

## 2. TypeScript & code style

- **Strict TypeScript.** No implicit `any`; prefer interfaces in `lib/types.ts`.
- Prisma `Analysis.result` is `Json` — **cast to `AnalysisResult`** when reading.
- Always **validate model output at runtime** (`lib/validate-analysis.ts`) — never trust raw LLM JSON.
- Match the surrounding file's idiom, naming, and comment density. No drive-by reformatting.
- Comments explain **why**, not what. The codebase uses dense doc-comments on non-obvious guards (see `lib/ensure-schema.ts`) — follow that bar for tricky code.

## 3. Components & UI

- `"use client"` on interactive pages/components.
- `useSearchParams()` must be inside `<Suspense>` (see `login`, `dashboard`).
- **Style against the live "Atelier" tokens in `app/globals.css`** (`--ink`, `--ember`, `--bone`, `--text*`, `--red/--amber/--moss`). Do **not** use the `DESIGN.md` blue/white palette unless a re-skin is formally decided (see [[DECISIONS]] D-003).
- Reusable building blocks: `components/ui/Kinetic.tsx`, `Atmosphere.tsx`.

## 4. Security (non-negotiable)

- **Never commit secrets.** `.gitignore` covers `.env*` (only `.env.example` is tracked). Keep it that way.
- API routes that touch user data **require auth**: `const session = await auth(); const userId = session?.user?.id` → 401 if missing.
- **Enforce ownership** on every fetch-by-id (`getAnalysisById` checks `userId`). No IDOR.
- Passwords: scrypt, format `scrypt:<salt>:<hash>` (`lib/password.ts`). Never log them.
- **Do not log** raw document text or full model output in production paths (parse-failure logging exists in `lib/ai.ts` — gate/scrub it).
- Stripe webhooks: verify signature, stay **idempotent** per `event.id` (`lib/stripe-events.ts`).
- `proxy.ts` owns CSP + security headers; keep NIM + Stripe origins allow-listed, nothing broader.

## 5. Business-rule invariants (must always hold)

| Invariant | Enforced in |
|-----------|-------------|
| Free tier = **3 saved analyses / UTC day** | `lib/free-quota.ts` (`FREE_DAILY_ANALYSIS_LIMIT`) |
| Pro = `plan==="pro"` **AND** `subscriptionStatus==="active"` | `lib/user-plan.ts` |
| Quota checked **before** the AI call; reserved then **refunded on failure** | `app/api/analyze/route.ts` + `lib/db.ts` |
| Upload ≤ **10MB**; PDF/PNG/JPG/WEBP only | analyze route + `lib/pdf-parser.ts` |
| Stripe price = **$9/mo** (`unit_amount: 900`) | `lib/stripe.ts` |
| No raw document files persisted (only `result` JSON) | data model |

## 6. Database & migrations

- Edit `prisma/schema.prisma`, then create a migration. **Do not** rely on the Vercel build to run migrations (it can't reach Supabase's direct port).
- Local: `npx prisma migrate dev`. Prod: `npx prisma migrate deploy` (out-of-band) — runtime self-heal in `lib/ensure-schema.ts` is a safety net, **not** the migration path. See [[KNOWLEDGE/deployment-and-schema]].
- New-column DDL must be **idempotent** (`ADD COLUMN IF NOT EXISTS`) and **read-first** so it never errors on the non-owner pooler role.

## 7. Commands

```bash
npm install                  # runs prisma generate (postinstall)
npm run dev
npm run build
npm test                     # node --import tsx --test lib/**/*.test.ts
npm run db:migrate           # scripts/prebuild-migrate.mjs (helper)
npx prisma migrate deploy    # production migrations (run out-of-band)
```

## 8. Git & PR hygiene

- Branch off `main`; don't commit/push unless asked.
- Keep the working tree clean — uncommitted experiments (`DESIGN.md`, `marketing-posters/`) should be committed or removed deliberately, not left to rot.
- One package manager: the repo has both `package-lock.json` and `pnpm-lock.yaml` — pick one (see [[TODO]]).

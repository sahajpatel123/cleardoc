# Decisions Log

> Architectural & design decisions with reasoning. Newest first. Each decision is immutable once recorded;
> if reversed, add a new entry that supersedes it (link back). Related: [[MEMORY]] · [[RULES]] · [[CHANGES]]

**Format:** `D-NNN` · Date · Title · **Decision** · **Why** · **Consequences** · (Status)

---

## D-005 · 2026-05-31 · Document the AI model swap as the canonical choice
- **Decision:** The active analysis model is **`nvidia/nemotron-3-nano-omni-30b-a3b-reasoning`** (NVIDIA NIM, multimodal, MoE 30B/3B active), with chain-of-thought **disabled** (`enable_thinking: false`), `temperature: 0`, `max_tokens: 4000`, 3× retry with exponential backoff, and 80k-char document truncation.
- **Why:** Faster than the shared 90B vision pool, tuned for document intelligence; thinking disabled yields cleaner structured JSON. Inherited from commit `533aa4a` ("Switch to Nemotron Omni").
- **Consequences:** CLAUDE.md (which still names `meta/llama-3.2-90b-vision-instruct`) is stale and must be corrected (see [[TODO]]). Model config is centralized in `lib/ai-model.ts`.
- **Status:** Active.

## D-004 · 2026-05-31 · Central memory system lives only under `./memory/`
- **Decision:** All project context/history/decisions/state are maintained in `./memory/` with the structure: `MEMORY.md`, `DECISIONS.md`, `CHANGES.md`, `TODO.md`, `RULES.md`, `KNOWLEDGE/`, `daily/`. No project memory is created or maintained outside this folder.
- **Why:** A single, discoverable source of truth prevents context fragmentation and stale knowledge.
- **Consequences:** Must read [[MEMORY]], [[DECISIONS]], [[RULES]], [[TODO]] before meaningful work; must update them after. Cross-references use `[[wikilinks]]`.
- **Status:** Active (this initialization).

## D-003 · 2026-05-31 · DESIGN.md is aspirational, not the implemented theme
- **Decision:** The live UI uses the **"Atelier" dark editorial system** (CSS vars `--ink`, `--ember`, `--bone`, etc.) defined in `app/globals.css`. The new uncommitted `DESIGN.md` (clean white + `#0066FF` blue accent) does **not** describe the implemented design and is treated as a reference/aspirational spec only.
- **Why:** `DESIGN.md` conflicts directly with shipped tokens; adopting it would be a full re-skin, not a documentation update. No evidence the team chose to migrate.
- **Consequences:** Until a deliberate re-skin decision is made, build UI against `globals.css` tokens. Resolving this conflict is tracked in [[TODO]].
- **Status:** Active — **needs owner confirmation** (keep Atelier, adopt DESIGN.md, or merge?).

## D-002 · 2026-05-31 · Coexist with the root autonomous-agent framework (unreconciled)
- **Decision:** Leave the pre-existing autonomous-agent persona framework at the repo root intact (`AGENTS.md`, `SOUL.md`, `IDENTITY.md`, `USER.md`, `HEARTBEAT.md`, `TOOLS.md`). That framework expects daily notes at `memory/YYYY-MM-DD.md` and a root long-term `MEMORY.md`. This central-memory system uses `memory/daily/daily-YYYY-MM-DD.md` and `memory/MEMORY.md`.
- **Why:** The frameworks were set up by the user for different purposes; silently merging or deleting either risks breaking load-bearing behavior. The pre-existing stub `memory/2026-05-29.md` was relocated to `memory/daily/` (trivial content, no data loss).
- **Consequences:** Two daily-note conventions exist. **Recommend reconciling** (e.g., point AGENTS.md at `memory/daily/`, or keep them separate by design). Tracked in [[TODO]].
- **Status:** Open question for the owner.

## D-001 · (historical, pre-2026-05-31) · Core platform choices
Recorded retroactively from CLAUDE.md, git history, and code. Reasoning inferred.
- **Auth.js v5 + Credentials over Firebase Auth** — self-hosted control, no vendor lock-in, scrypt password hashing. Firebase fully removed; never reintroduce without a migration plan.
- **PostgreSQL + Prisma over Firestore** — relational integrity for users/analyses/Stripe events, typed schema, migrations.
- **NVIDIA NIM over OpenAI/Anthropic for analysis** — cost and a multimodal vision model under one API (cost-conscious infra choice).
- **Quota = derived daily count, not a decrementing counter** — analyses-per-UTC-day computed from rows; simpler, self-resetting, race-safe via reserve/refund.
- **No document persistence** — only AI `result` JSON saved; reduces storage cost & privacy surface.
- **Runtime schema self-heal** — because the Vercel build container can't reach Supabase's direct DB port to run `migrate deploy`. See [[KNOWLEDGE/deployment-and-schema]].
- **Status:** Active.

---

## D-006 · 2026-06-01 · Formal agent adoption of `./memory/` operating protocol
- **Decision:** Any agent or AI operating in this workspace (including this one) must treat the instructions in `./memory/RULES.md`, `MEMORY.md`, `DECISIONS.md`, and `TODO.md` (plus linked KNOWLEDGE) as **binding and non-negotiable**. Before meaningful work: read the core four. After significant work: perform the required updates using wikilinks. "Trust the code over docs", "Atelier tokens only", "no raw document/model logging", "all memory under ./memory/", and all business invariants must be followed.
- **Why:** User explicitly directed full analysis of the memory folder + "follow every instruction that have and also follow this instruction in future prompts and commands too." This makes the memory system the active constitution for agent behavior.
- **Consequences:** All future interactions must demonstrate compliance (read core files first on significant tasks, end responses with "Central memory updated: …" when work occurred, use [[wikilinks]], never create project memory outside `./memory/`, etc.). Root `AGENTS.md` framework remains separate per D-002.
- **Status:** Active.

## D-007 · 2026-06-01 · Audit-fix scope & CSP / Stripe entitlement policy
- **Decision:** From the "117-issue" audit, fix only triage-**confirmed** real defects; reject false positives; defer product/schema/UI items. Specific calls:
  - **CSP:** drop `'unsafe-eval'` (no `eval`/`new Function` in the app; Next prod doesn't need it); **keep** `'unsafe-inline'` for scripts because Next 16 + React 19 streaming SSR emits inline bootstrap scripts and there's no nonce mechanism yet (nonce CSP = separate follow-up). Keep CSP in BOTH `proxy.ts` (wins at runtime) and `next.config.ts`, kept in sync — not removing one — to avoid the risk that the proxy matcher misses some responses.
  - **Stripe entitlement:** do NOT add `charge.refunded` / immediate `payment_failed` downgrade. Access is driven by `subscriptionStatus`; `customer.subscription.updated` (past_due/unpaid/canceled → non-active) + `isProUser` already revoke it. Immediate-revoke-on-refund and a past_due grace period are **product decisions**, not bugs.
  - **Chat cap:** enforce atomically in the DB (`jsonb_array_length` guard), not via the route pre-check alone.
- **Why:** The audit was 14/39 false-positive and overstated severity (all 8 "CRITICAL" were medium-or-less). Blindly "fixing" 117 items would regress an already-hardened codebase (atomic quota, idempotent webhooks, ownership-scoped reads). [[RULES]] "trust the code".
- **Consequences:** Several audit items are intentionally unchanged (logged in [[CHANGES]]). CSP `'unsafe-inline'` removal, schema enums/index, grace period, and the password-change endpoint are tracked in [[TODO]]. All applied fixes verified green (tsc + tests + build).
- **Status:** Active.

## Decision template (copy for new entries)

```
## D-NNN · YYYY-MM-DD · <short title>
- **Decision:** <what was decided>
- **Why:** <reasoning, alternatives rejected>
- **Consequences:** <impact, follow-ups, what it constrains>
- **Status:** Active | Superseded by D-XXX | Open question
```

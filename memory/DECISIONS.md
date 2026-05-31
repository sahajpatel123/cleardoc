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

## Decision template (copy for new entries)

```
## D-NNN · YYYY-MM-DD · <short title>
- **Decision:** <what was decided>
- **Why:** <reasoning, alternatives rejected>
- **Consequences:** <impact, follow-ups, what it constrains>
- **Status:** Active | Superseded by D-XXX | Open question
```

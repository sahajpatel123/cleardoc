# Knowledge Base

Deep-dive reference documentation on specific ClearDoc subsystems.

## Contents

Add files here when a subsystem needs more detailed documentation than what fits in MEMORY.md or DECISIONS.md.

### Suggested Topics

- `ai-pipeline.md` — How document analysis works end-to-end (extract → prompt → parse → validate → save)
- `auth-flow.md` — NextAuth v5 Credentials setup, JWT strategy, token-version invalidation
- `stripe-integration.md` — Checkout flow, webhook handling, subscription lifecycle
- `rate-limiting.md` — Upstash Redis setup, per-IP and per-account limits, fail-closed behavior
- `csp-security.md` — Nonced CSP implementation, proxy.ts architecture
- `prisma-schema.md` — Data model relationships, migrations, advisory locks

## Conventions

- One file per subsystem
- Include file paths and line numbers for key code
- Keep updated when the subsystem changes
- Reference from DECISIONS.md or CHANGES.md when relevant

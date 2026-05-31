# KNOWLEDGE Index

> Deep technical notes, research, and patterns that are too detailed for [[MEMORY]] but worth keeping.
> [[MEMORY]] stays concise; durable detail lives here.

## How to use this folder

- **One topic per file.** Name files in `kebab-case.md`.
- **Link, don't duplicate.** Reference notes from [[MEMORY]], [[DECISIONS]], or [[TODO]] with `[[KNOWLEDGE/<file>]]`.
- **Date significant updates** inside each note so staleness is visible.
- **Trust code over notes** — if a note conflicts with source, fix the note.
- Add new notes here and register them in the index below.

## Index

| File | What it covers |
|------|----------------|
| [[KNOWLEDGE/architecture]] | System overview, end-to-end analysis flow, key modules, data model |
| [[KNOWLEDGE/ai-pipeline]] | Model, system prompt contract, retry/truncation, JSON validation |
| [[KNOWLEDGE/deployment-and-schema]] | Vercel + Supabase, why migrations don't run at build, runtime self-heal |
| [[KNOWLEDGE/security]] | Security posture, status of prior findings, open audits |
| [[KNOWLEDGE/claude-md-drift]] | Where root `CLAUDE.md` is out of date vs the actual code |

## Suggested future notes

- `analysis-chains-and-cases.md` — `parentId` / `caseId` model and the case API.
- `chat-feature.md` — per-analysis Q&A (`/api/chat`, `Analysis.chatMessages`).
- `stripe-lifecycle.md` — checkout → webhook → subscription state transitions.
- `rate-limiting.md` — Upstash config, fallback behavior when unset.

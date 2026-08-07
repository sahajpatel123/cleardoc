# Contributing to ClearDoc

Thanks for your interest in ClearDoc! This document walks through how to set up a local dev environment, run the test suite, and submit changes.

## Prerequisites

- **Node.js 22+** (see `.nvmrc`). Run `nvm use` if you have nvm installed.
- **npm** (ships with Node).
- **git**.
- *(Optional)* [playwright](https://playwright.dev) system deps for the browser smoke tests — `npx playwright install --with-deps chromium` installs Chromium and its deps. Required to run the full test suite locally; not required to read the code.

## Local Setup

```sh
git clone https://github.com/sahajpatel123/cleardoc.git
cd cleardoc
nvm use                     # picks up the Node 22 pin in .nvmrc
npm install --no-save playwright   # only dev dep — serverless code uses built-ins
npx playwright install --with-deps chromium
```

There's no `npm install` step that pulls in a `package-lock.json` (we don't ship one — the serverless code uses Node built-ins only). The `--no-save` flag keeps the playwright install transient and doesn't pollute any lockfile.

## Running Tests

We use Node's built-in [`node:test`](https://nodejs.org/api/test.html) runner — no test framework dependency. All test commands are wrapped in npm scripts (see `package.json`):

| Command | What it runs |
| ------- | ------------ |
| `npm test` | Unit + smoke + integration in sequence (full suite) |
| `npm run test:unit` | The 6 unit test files (`test/*.test.js`, except smoke and integration) |
| `npm run test:smoke` | Playwright browser smoke tests against the static server |
| `npm run test:integration` | End-to-end test against a mock AI server |
| `npm run check` | `validate:json` + `syntax` + `test` (full pre-deploy gate) |
| `npm run syntax` | `node --check` on every JS source file |
| `npm run validate:json` | `JSON.parse` on `vercel.json` and `site.webmanifest` |

The smoke tests require Chromium. If you don't have it installed, the tests are auto-skipped (no failure). The unit + integration tests run on any platform with Node 22.

## Repository Layout

```
api/         — Vercel serverless functions (CommonJS, one file per route + _safety.js helpers)
assets/      — Static assets (app.js, theme.css, sw.js, og-card.svg, pdfjs-bootstrap.js)
test/        — node:test unit + Playwright smoke + node:test integration
vercel.json  — Vercel deploy config (security headers, rewrites, builds)
site.webmanifest — PWA manifest
index.html, analyze.html, pricing.html, 404.html — Static pages
memory/      — Multi-agent logbook + decisions (append-only LOGBOOK.md)
```

## Commit Conventions

We use **conventional commits** with a small twist. Format:

```
<type>(<scope>): <subject>

<optional body explaining what and why>
```

- **Types**: `feat`, `fix`, `refactor`, `docs`, `test`, `chore`, `sec`, `perf`
- **Scope**: file or subsystem — e.g. `analyzer`, `api`, `health`, `smoke`, `health-error`, `nav`
- **Subject**: imperative mood, no period, ≤72 chars

Examples from history:
- `feat(api): tag every console.error with [req=<id>] for log correlation`
- `fix(health): probe cache now bounded at 100 entries with LRU eviction`
- `docs(security): add SECURITY.md with disclosure policy and security posture summary`

## Architecture Notes

ClearDoc is a fully static site served by Vercel's edge network. The only server-side code is three serverless functions in `api/`:

- `/api/analyze` — POST, runs document analysis via Gemini/OpenRouter
- `/api/chat` — POST, per-document Q&A via Gemini
- `/api/health` — GET, public health probe

All three are wrapped in an outer try/catch safety net with `res.headersSent` guard + sanitized 500 body, and all three emit `X-Request-Id` for log correlation. See `SECURITY.md` for the full security posture.

Client-side state lives in `localStorage`:
- `cleardoc:lastAnalysis` — last analyzed document (24h TTL, restored via banner)
- `cleardoc:draftInput` — in-progress textarea draft (cleared on Analyze/Clear)
- `cleardoc:share:*` — shareable analysis URL payload (gzip + base64url)

## Pull Request Checklist

Before requesting review, please confirm:

- [ ] `npm run check` passes locally (JSON valid, syntax clean, all tests green)
- [ ] `scripts/security-hardening.sh` passes locally (no hardcoded secrets, SHA-pinned actions, CSP secure)
- [ ] For API changes: source-pattern test added or updated in `test/*-error.test.js`
- [ ] For schema changes: new test cases in `test/*-schema.test.js`
- [ ] For new helpers: new test cases in `test/safety.test.js`
- [ ] For client-visible changes: smoke test added in `test/smoke.test.js`
- [ ] LOGBOOK.md updated (append a new entry per RULES.md, do not edit existing entries)
- [ ] If you touched the security headers, also re-validate the smoke-test CSP assertions
- [ ] Commit message follows conventional commit format, using `sec()` prefix for security changes

## CI/CD Security

ClearDoc uses GitHub Actions with security best practices:

| Workflow | Purpose | Required Check |
|----------|---------|----------------|
| `test.yml` | Unit, smoke, integration tests | ✅ Required for merge |
| `security.yml` | Dependency review + security lint | ✅ Required for merge |
| `codeql.yml` | CodeQL security analysis | ✅ Required for merge |

### Running Security Checks Locally

```bash
# Quick security validation
bash scripts/security-hardening.sh

# Full pre-deploy check (includes security)
npm run check
```

### Security Best Practices

- All GitHub Actions are SHA-pinned for supply-chain security
- Workflows use minimal permissions
- CodeQL runs on every push/PR
- Dependabot handles dependency updates

## Reporting Security Issues

**Do not file public GitHub issues for security-sensitive bugs.** See [SECURITY.md](./SECURITY.md) for the disclosure policy and contact channels.

## Code of Conduct

This is an independent single-maintainer project. Be kind, write clear commit messages, and link any related issues in your PR description.
# ClearDoc

> Read what you're about to sign.

ClearDoc turns intimidating legal, medical, and financial documents into plain English — flags the traps, gives you a verdict, and tells you exactly what to do next. Built as a static editorial site with four Vercel serverless API endpoints.

## Stack

- **Frontend** — Hand-crafted editorial / brutalist design with GSAP animations, Lenis smooth scroll, PDF.js + Tesseract.js attachment support. Vanilla JS, no framework.
- **API** — Four Vercel serverless functions (`/api/analyze`, `/api/chat`, `/api/health`, `/api/csp-report`) with shared safety helpers (`/api/_safety.js`). OpenRouter (`google/gemma-4-31b-it:free`) with automatic Gemini fallback.
- **Deploy** — Vercel. Static output + serverless functions, edge-cached where possible.
- **PWA** — Service worker (`assets/sw.js`) precaches the shell, network-first for HTML, cache-first for assets.

## Pages

- `/` (`index.html`) — Home with hero clarifier, sample clauses, illustrative cases
- `/analyze` (`analyze.html`) — Full document analyzer (paste, upload, ask)
- `/pricing` (`pricing.html`) — Pricing page
- `/404` (`404.html`) — Custom not-found page

## API endpoints

| Endpoint | Method | Purpose | Rate limit | Body cap |
| -------- | ------ | ------- | ---------- | -------- |
| `/api/analyze` | POST | Document analysis | 10 req/min/IP | 256 KB |
| `/api/chat` | POST | Q&A about an analyzed document | 30 req/min/IP | 128 KB |
| `/api/health` | GET | Public health check (reachable at `/health`) | 60 req/min/IP | — |
| `/api/csp-report` | POST | CSP violation reports (browser → ops) | 60 req/min/IP | 16 KB |

Every JSON response includes:

- `X-Request-Id` — per-request UUID for log correlation
- `X-Request-Latency-Total-Ms` — full server-side time (rate-limit + body read + AI chain + serialize)
- `X-Build-Sha` — deployed commit SHA (local dev: header omitted)
- `X-RateLimit-Limit`, `-Remaining`, `-Reset`, `Retry-After` — sliding-window budget
- `Cache-Control: no-store` — never cached (except `/api/health` 200 + HEAD which are edge-cacheable for 5s)
- Structured JSON 500 (sanitized — no stack frames, no `err.message` leak) on uncaught throws

AI-touched responses (`/api/analyze`, `/api/chat`) additionally include:

- `X-AI-Provider` — `openrouter` | `gemini` | `none`
- `X-AI-Model` — exact model identifier (e.g. `google/gemma-4-31b-it:free`)
- `X-AI-Response-Time-Ms` — total ms across the provider chain
- `X-AI-Fallback` — `true` when the silent fallback provider answered
- `X-AI-OpenRouter-Ms` / `X-AI-Gemini-Ms` — per-provider latency breakdown
- `Retry-After: 60` on degraded 502 paths so monitoring clients back off properly

See [SECURITY.md](./SECURITY.md) for the full security posture and disclosure policy.

## Local development

The frontend is plain HTML/CSS/JS — open `index.html` directly, or:

```bash
# Node version is pinned via .nvmrc (Node 22, matches CI).
nvm use   # or `fnm use` / Volta / asdf — whatever auto-respects .nvmrc

# Install Playwright (only runtime dep for the smoke tests).
npm install --no-save playwright
npx playwright install --with-deps chromium

# Any static server works. Vercel CLI is convenient:
npx vercel dev

# Run the full local CI equivalent:
npm run check
```

API endpoints need Node 22+ and run on Vercel's serverless runtime. For local development, `vercel dev` runs both the static site and the functions.

### Environment variables

| Variable | Required for | Notes |
|----------|-------------|-------|
| `OPENROUTER_API_KEY` | `/api/analyze` | Preferred provider (free `google/gemma-4-31b-it:free` model) |
| `GEMINI_API_KEY` | `/api/analyze` (fallback) + `/api/chat` | Also accepts `GOOGLE_GEMINI_API_KEY` |
| `GEMINI_CHAT_MODEL` | `/api/chat` | Defaults to `gemini-2.5-flash` |

If neither AI key is set, the analyzer falls back to a fully local regex-based scan. The chat endpoint returns 503.

## Project layout

```
.
├── index.html, analyze.html, pricing.html, 404.html
│                                 Static editorial pages (no framework)
├── assets/
│   ├── app.js                    Frontend logic (vanilla JS, IIFE; ~2000 lines)
│   ├── theme.css                 Editorial design system + animations
│   ├── sw.js                     Service worker (network-first HTML, cache-first assets)
│   ├── pdfjs-bootstrap.js        PDF.js worker config (extracted to enable strict CSP)
│   └── og-card.svg               1200×630 social-share preview
├── api/
│   ├── _safety.js                Shared helpers: json, getIp, rateLimit, readCappedBody,
│   │                             applyRateLimitHeaders, attachRequestId, errLog, accessLog,
│   │                             probeProvider(+Cached), safeParseAnalysisResult,
│   │                             safeParseChatResult, sanitizeLogField, applyBuildShaHeader,
│   │                             applyAiResponseHeaders
│   ├── analyze.js                Document analysis (OpenRouter → Gemini)
│   ├── chat.js                   Per-document Q&A (Gemini → OpenRouter)
│   ├── health.js                 Public health check + AI-provider reachability probe
│   └── csp-report.js             CSP violation reports (browser → ops)
├── test/
│   ├── safety.test.js            90+ unit tests for _safety.js helpers
│   ├── analyze-schema.test.js    28 tests for safeParseAnalysisResult
│   ├── chat-schema.test.js       13 tests for safeParseChatResult
│   ├── analyze-error.test.js     source-pattern tests for analyze.js safety net
│   ├── chat-error.test.js        source-pattern tests for chat.js safety net
│   ├── health-error.test.js      source-pattern tests for health.js safety net
│   ├── csp-report-error.test.js  source-pattern tests for csp-report.js safety net
│   ├── smoke.test.js             60+ Playwright browser tests (load + CSP + share + a11y)
│   └── integration.test.js       1 end-to-end test against a mock AI server
├── public/
│   └── .well-known/
│       └── security.txt          RFC 9116 disclosure endpoint
├── SECURITY.md                   Vulnerability disclosure policy + posture summary
├── CONTRIBUTING.md               Dev setup, test commands, commit conventions, PR checklist
├── vercel.json                   Routing, security headers, build config
├── site.webmanifest              PWA manifest
├── package.json                  npm scripts: test, syntax, validate:json, check
├── .nvmrc                        Node 22 pin
└── memory/                       Multi-agent memory system (see memory/MEMORY.md)
```

## Memory system

This project uses an agent memory protocol — see `memory/MEMORY.md`. Every CLI agent must read `MEMORY.md`, `DECISIONS.md`, `RULES.md`, `TODO.md` at the start of a session and append to `memory/LOGBOOK.md` after meaningful work.

## Security & disclosure

See [SECURITY.md](./SECURITY.md) for the full security posture (CSP, SRI, fail-closed validators, safety nets, X-Request-Id, rate-limit headers, etc.) and disclosure policy. The well-known [RFC 9116 `security.txt`](./public/.well-known/security.txt) is served at `/.well-known/security.txt`.

## Contributing

See [CONTRIBUTING.md](./CONTRIBUTING.md) for the full dev workflow (setup, test commands, commit conventions, PR checklist).

## License

Proprietary. All rights reserved.

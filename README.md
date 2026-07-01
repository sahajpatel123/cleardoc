# ClearDoc

> Read what you're about to sign.

ClearDoc turns intimidating legal, medical, and financial documents into plain English — flags the traps, gives you a verdict, and tells you exactly what to do next. Built as a static editorial site with two Vercel serverless API endpoints.

## Stack

- **Frontend** — Hand-crafted editorial / brutalist design with GSAP animations, Lenis smooth scroll, PDF.js attachment support. Vanilla JS, no framework.
- **API** — Two Vercel serverless functions (`/api/analyze`, `/api/chat`) with shared safety helpers (`/api/_safety.js`). OpenRouter (Google Gemma 4) with automatic Gemini fallback.
- **Deploy** — Vercel. Static output + serverless functions.

## Pages

- `/` (`index.html`) — Home with hero clarifier, sample clauses, illustrative cases
- `/analyze` (`analyze.html`) — Full document analyzer (paste, upload, ask)
- `/pricing` (`pricing.html`) — Pricing page
- `/api/health` — Public health check (also reachable at `/health`)
- `/api/analyze` — POST: analyze a document (rate-limited 10 req/min/IP, 256KB cap)
- `/api/chat` — POST: ask a question about an analyzed document (30 req/min/IP, 128KB cap)

## Local development

The frontend is plain HTML/CSS/JS — open `index.html` directly, or:

```bash
# Any static server works. Vercel CLI is convenient:
npx vercel dev
```

API endpoints need Node 18+ and run on Vercel's serverless runtime. For local development, `vercel dev` runs both the static site and the functions.

### Environment variables

| Variable | Required for | Notes |
|----------|-------------|-------|
| `OPENROUTER_API_KEY` | `/api/analyze` | Preferred provider (free Gemma 4 model) |
| `GEMINI_API_KEY` | `/api/analyze` (fallback) + `/api/chat` | Also accepts `GOOGLE_GEMINI_API_KEY` |
| `GEMINI_CHAT_MODEL` | `/api/chat` | Defaults to `gemini-2.5-flash` |

If neither AI key is set, the analyzer falls back to a fully local regex-based scan. The chat endpoint returns 503.

## Project layout

```
.
├── index.html          # Home
├── analyze.html        # Document analyzer
├── pricing.html        # Pricing
├── assets/
│   ├── app.js          # Frontend logic (vanilla JS, IIFE)
│   └── theme.css       # Editorial design system
├── api/
│   ├── _safety.js      # Shared helpers (json, getIp, rateLimit, readCappedBody)
│   ├── analyze.js      # Document analysis (OpenRouter → Gemini)
│   ├── chat.js         # Per-document Q&A (Gemini)
│   └── health.js       # Public health check
├── vercel.json         # Routing, security headers, build config
└── memory/             # Project memory system (see memory/MEMORY.md)
```

## Memory system

This project uses an agent memory protocol — see `memory/MEMORY.md`. Every CLI agent must read MEMORY / DECISIONS / RULES / TODO at the start of a session and append to `memory/LOGBOOK.md` after meaningful work.

## License

Proprietary. All rights reserved.
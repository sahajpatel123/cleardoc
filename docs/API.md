# ClearDoc API Reference

Single-page reference for the four serverless API endpoints. For a high-level intro see [`README.md`](../README.md); for security posture see [`SECURITY.md`](../SECURITY.md).

Base URL: `https://cleardoc.app` (or `http://localhost:3000` for `vercel dev`).

Every response across all endpoints carries the standard observability family:

| Header | Description |
| ------ | ----------- |
| `X-Request-Id` | Per-request UUID v4 (or upstream `X-Request-Id` echoed if valid) — grep server logs by this ID |
| `X-Request-Latency-Total-Ms` | Full server-side time: rate-limit + body read + AI chain + validation + serialize. Rounded to integer. |
| `X-Build-Sha` | Deployed commit SHA from `VERCEL_GIT_COMMIT_SHA`. Omitted in local dev (env var unset). |
| `X-RateLimit-Limit / -Remaining / -Reset` | Sliding-window budget. `Reset` is UNIX seconds when at least one slot becomes available. |
| `Retry-After` | Set on 429 (rate-limit) and degraded 502/503 paths. Tells clients how long to back off. |
| `Cache-Control` | `no-store` on `/api/analyze`, `/api/chat`, `/api/csp-report`. `public, max-age=5, s-maxage=5` on `/api/health` 200 + HEAD. |
| `X-Robots-Tag` (via `vercel.json`) | `none` on all `/api/*` (search engines shouldn't index endpoints) |
| `Content-Security-Policy` (via `vercel.json`) | `default-src 'none'; frame-ancestors 'none'` on all `/api/*` |
| 500 body | `{"error": "An internal error occurred. Please try again."}` — sanitized, never includes `err.message` or stack frames |

AI-touched endpoints (`/api/analyze`, `/api/chat`) additionally carry:

| Header | Description |
| ------ | ----------- |
| `X-AI-Provider` | `openrouter` \| `gemini` \| `none` |
| `X-AI-Model` | Exact model identifier that answered |
| `X-AI-Response-Time-Ms` | Total ms across the provider chain (sum of all attempts) |
| `X-AI-Fallback` | `true` if the fallback provider answered (silent activation of the secondary path) |
| `X-AI-OpenRouter-Ms` | ms the OpenRouter call took, if fired |
| `X-AI-Gemini-Ms` | ms the Gemini call took, if fired |

All endpoints additionally carry `X-Endpoint: <name>` for grouping response-header metrics without parsing URLs.

---

## `/api/health` — Public health check

**Method:** `GET` (or `HEAD` for a cheap reachability probe).

**Rate limit:** 60 req/min/IP.

**Successful response (200):**
```json
{
  "ok": true,
  "status": "ok",
  "version": "1.0.0",          // from package.json
  "gitSha": "abc1234…",         // null in local dev
  "uptimeSec": 3642,
  "summary": {
    "providersConfigured": 1,
    "providersReachable": 1,
    "fastestProviderMs": 145,
    "slowestProviderMs": 145,
    "cacheHits": 128,
    "totalProbes": 130,
    "networkProbes": 2,
    "cspReports": {
      "total": 14,
      "byDirective": { "script-src": 12, "img-src": 2 }
    }
  },
  "providers": {
    "gemini": { "configured": true, "reachable": true, "latencyMs": 145, "cached": true, "cachedAtAgeSec": 32 },
    "openrouter": { "configured": false, "reachable": false, "error": "OPENROUTER_API_KEY not set" }
  },
  "process": {
    "nodeVersion": "v22.11.0",
    "platform": "linux",
    "arch": "x64",
    "pid": 17,
    "processUptimeSec": 3642,
    "region": "iad1",
    "vercelEnv": "production",
    "memory": {
      "rssMb": 92,
      "heapTotalMb": 64,
      "heapUsedMb": 41,
      "externalMb": 1,
      "arrayBuffersMb": 0,
      "limitMb": 256,
      "usedPercent": 16.0,
      "nearLimit": false
    }
  },
  "timestamp": "2026-07-19T05:00:00.000Z"
}
```

**Conditional requests (RFC 7232 dual support):**
- `ETag: "abc12345"` — FNV-1a 32-bit hex, derived from `gitSha + providersConfigured + region`
- `Last-Modified: <RFC 7231 IMF-fixdate>` — module-load timestamp

Clients can use either:
- `If-None-Match: "<etag>"` → 304 Not Modified (no body)
- `If-Modified-Since: <date>` → 304 Not Modified (no body, parsed per RFC 7231)

**Edge caching:** `Cache-Control: public, max-age=5, s-maxage=5` so monitoring polls collapse to ~1 invocation per 5s window per edge node.

**Degraded response (503):** `reason` field explains which providers are unreachable or missing.

---

## `/api/analyze` — Document analysis

**Method:** `POST`. Requires `Content-Type: application/json`.

**Rate limit:** 10 req/min/IP. Body cap: 256 KB (rejected 413 before parsing).

**Request body:**
```json
{
  "document": "Long lease text…",
  "fileName": "lease-2025.pdf"     // optional, surfaces in cite outputs
}
```

**Compact mode:** append `?format=verdict-only` to skip rewrite/deadlines/nextSteps. Returns just `{risks, verdict}` — ~5× smaller, ~75% fewer prompt tokens.

**Successful response (200):**
```json
{
  "analysis": {
    "plainEnglishRewrite": "<b>You owe</b> $500/month…",
    "risks": [
      { "severity": "trap", "clause": "In perpetuity…", "explanation": "Forever.", "impact": "Permanent." }
    ],
    "verdict": { "label": "Suspicious", "summary": "Two clauses deserve attention before signing." },
    "deadlines": [{ "date": "30 days", "description": "…" }],
    "nextSteps": ["Read the indemnity clause carefully…"],
    "readingLevel": { "before": 14, "after": 8 },
    "jargonFound": 7
  },
  "provider": "openrouter",
  "model": "google/gemma-4-31b-it:free"
}
```

**Errors:**
- **400** — missing `document`, document < 10 chars, malformed JSON
- **415** — Content-Type isn't `application/json`
- **429** — rate limit exceeded (includes `Retry-After`)
- **502** — both providers failed; response includes `provider: "none"`, `Retry-After: 60`
- **502** — AI returned invalid shape (fail-closed per RULES.md #3); response includes `reason: "invalid_ai_response"`

---

## `/api/chat` — Per-document Q&A

**Method:** `POST`. Requires `Content-Type: application/json`.

**Rate limit:** 30 req/min/IP. Body cap: 128 KB.

**Request body:**
```json
{
  "question": "What happens if I cancel early?",
  "document": "<original document text>",
  "rewrite": "<plain-English rewrite from /api/analyze>",
  "risks": [{ "label": "…", "reason": "…", "sentence": "…" }],
  "fileName": "lease-2025.pdf",     // optional
  "history": [                     // optional, multi-turn Ask thread
    { "q": "previous question", "a": "previous answer" }
  ]
}
```

`history` is capped at `MAX_HISTORY_TURNS` (10) prior turns, each field capped at `MAX_HISTORY_FIELD_CHARS` (500) — defense-in-depth so a malicious client can't pad megabytes into the prompt.

**Successful response (200):**
```json
{
  "answer": "You'd owe a prorated penalty…",
  "citation": "OpenRouter answer · based on analyzed document",
  "model": "gemini-2.5-flash",
  "provider": "gemini"
}
```

**Errors:** Same shape as `/api/analyze` (400 / 415 / 429 / 502).

---

## `/api/csp-report` — Browser CSP violation reports

**Method:** `POST`. Accepts `Content-Type: application/csp-report` (legacy CSP Level 3), `application/reports+json` (newer Reporting API), or `application/json` (curl/dev-tools).

**Rate limit:** 60 req/min/IP. Body cap: 16 KB (CSP reports are typically <2KB).

**Why this exists:** The `Content-Security-Policy` in `vercel.json` declares `report-uri /api/csp-report`. When a browser blocks a script/style/etc. against our CSP, it POSTs here. We log structured and surface per-directive counts in `/api/health`.

**Successful response:** `204 No Content` (per RFC 7231 §6.3.5 — browsers don't care about the body).

**Log shape (Vercel logs):**
```
[req=<uuid>] [csp-report] POST /api/csp-report -> blocked=https://evil.example/x.js directive=script-src document=https://cleardoc.app/
```

**Counter surface (`/api/health summary.cspReports`):** `{ total, byDirective: { "<directive>": n } }`. Oldest-first evicting at 50 keys.

---

## Rate-limit + body-cap summary

| Endpoint | Rate limit | Body cap | Notes |
| -------- | ---------- | -------- | ----- |
| `/api/health` | 60 req/min/IP | — | Headers-only on HEAD. Edge-cacheable 5s. |
| `/api/analyze` | 10 req/min/IP | 256 KB | Plus 80 KB char cap on `document`. |
| `/api/chat` | 30 req/min/IP | 128 KB | History capped separately. |
| `/api/csp-report` | 60 req/min/IP | 16 KB | CSP reports are tiny. |

All rate limits are sliding-window per-IP in-memory (Vercel Hobby = no shared state across instances — sufficient for abuse prevention; not for cross-region fairness).

---

## Schema validators (`api/_safety.js`)

Strict fail-closed validation (RULES.md #3) — partial data is worse than no data:
- `safeParseAnalysisResult(obj)` — full `/api/analyze` response (rewrite + risks + verdict + deadlines + nextSteps + readingLevel + jargonFound)
- `safeParseCompactAnalysisResult(obj)` — compact mode (`?format=verdict-only`) response (just risks + verdict; no rewrite/deadlines/etc.)
- `safeParseChatResult(obj)` — `/api/chat` response (answer + citation + model)

Any malformed field fails the whole response rather than shipping degraded data.

---

## Versioning

Single source of truth: `package.json` `"version"`. `/api/health` reads it via `require("../package.json").version`. Bumping `package.json` automatically rolls the `version` field on every response — the two can't drift apart.

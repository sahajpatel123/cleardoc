# Changelog

User-facing release notes for ClearDoc. For agent work history see [`memory/LOGBOOK.md`](./memory/LOGBOOK.md); for raw commits see `git log`.

ClearDoc is a continuously-deployed static site — every push to `main` is live. This file tracks notable changes grouped by month.

## 2026-07 — Hardened plateau + doc baseline

### Security hardening
- **Strict Content-Security-Policy** (`script-src` without `'unsafe-inline'`) — moved the lone inline script to `assets/pdfjs-bootstrap.js`; `connect-src` allowlists only `generativelanguage.googleapis.com` and `openrouter.ai`.
- **`Content-Type: application/json` enforcement on `/api/analyze` + `/api/chat`** — the AI-touched endpoints now reject requests with a non-JSON `Content-Type` header (returns 415 `Unsupported Media Type`) before any body parsing or rate-limit consumption. Defends against accidental form-encoded or multipart abuse — the only legitimate client surface is `fetch()` with `Content-Type: application/json`. Skipped on `/api/csp-report` (which has its own allowlist — see Security hardening).
- **`Content-Type` allowlist on `/api/csp-report`** — accepts `application/csp-report` (per RFC 9110 §8.3) and `application/reports+json` (per RFC 9701 reporting API). Browsers in the wild use both, so the allowlist covers modern Chrome / Firefox / Safari without being permissive. Other content types still get 415.
- **`/api/health` honors `If-Modified-Since` → `304`** — alongside the `ETag` / `If-None-Match` flow, the public health endpoint now also accepts the older `If-Modified-Since` HTTP-date header and returns `304 Not Modified` when the body hasn't changed since that timestamp. Wider compatibility with monitoring clients that only support HTTP-date conditional GETs.
- **Subresource Integrity (SRI)** hashes on every CDN script tag (gsap, ScrollTrigger, Lenis, PDF.js, and the lazy Tesseract.js loader).
- **HSTS** upgraded to `max-age=63072000; includeSubDomains; preload` — eligible for browser HSTS preload list.
- **Outer try/catch safety net** on all three API handlers with `res.headersSent` guard + sanitized 500 body (no stack frames, no `err.message` leak).
- **Per-handler `X-Request-Id`** propagation + tagged `errLog()` and `accessLog()` for log correlation.
- **Rate-limit headers** (`X-RateLimit-Limit / -Remaining / -Reset`) on every response.
- **AI provider reachability probe** in `/api/health` with cached HEAD requests (60s TTL, LRU eviction at 100 keys).
- **`Retry-After: 60`** on `/api/health` 503 responses so monitoring clients back off correctly during outages.
- **RFC 9116 `security.txt`** at `/.well-known/security.txt` — auto-discovered by security scanners.
- **`/api/csp-report` endpoint + `report-uri` directive in CSP** — browsers now report CSP violations back to ClearDoc. Structured logs surface real-world bypass attempts and policy bugs (e.g., a future code change that triggers an unexpected block). Closes the observability loop on the strict-CSP work shipped earlier this month.
- **`/api/health` honors `If-None-Match` → `304 Not Modified`** — the public health endpoint now sets `ETag` (computed from version + region + vercelEnv so cache keys vary by deploy context). When a polling client sends `If-None-Match` with the previous ETag, the response is a lightweight `304` with no body, saving Vercel function-invocation costs on aggressive monitoring scrapes. Combined with the 5s `Cache-Control: public, max-age=5, s-maxage=5` on the success path, ops dashboards that poll every 1–5s now collapse into ~1 actual invocation per 5s window per edge node, plus zero-invocation 304 responses on the in-between polls.
- **FAQ search input cap** (`maxlength="64"` on the FAQ keyword filter input across `index.html`, `analyze.html`, `pricing.html`) — caps user input at 64 chars before it hits the page-side filter loop. Defends against pathological inputs that would otherwise loop over megabyte-long substrings and freeze the tab. Pairs with the `clarify()` and OCR input caps shipped earlier.

### Reliability
- **Strict fail-closed schema validators** (`safeParseAnalysisResult`, `safeParseChatResult`) — partial legal data is more dangerous than no data (RULES.md #3).
- **OCR image size cap at 10 MB** — the analyze page's `readImage()` path (lazy-loaded Tesseract.js) now rejects attachments above 10 MB before pulling in the ~1 MB Tesseract runtime + English language pack. A 50 MB phone photo was previously burning browser memory on a doomed-to-fail OCR attempt; now it fails fast with a clear error message and a smaller-files hint. Pairs with the existing PDF (30-page) and text (30 KB) caps.
- **Document + BYOF textarea caps at 40,000 chars** — `maxlength="40000"` on both `docInput` (the main analyzer textarea) and `byofIn` (the BYOF demo input) on `analyze.html`. Caps user input at the same threshold the backend already enforces (`MAX_DOCUMENT_CHARS`), so the browser now blocks pathological pastes before they reach the network.
- **Hero clarifier input cap at 500 chars** — `maxlength="500"` on `heroInput` (the single-line clarifier field on the homepage and `analyze.html` hero section). Closes the same class of defensive input cap as the FAQ/clarify/OCR caps — the single-line field can only ever become a single sentence, but the cap makes that contract explicit at the input layer.
- **Ask input cap at 1,000 chars** — `maxlength="1000"` on `askInput` (the per-analysis Ask question field on `analyze.html`). Matches the backend's `MAX_QUESTION_CHARS` (1000) so the browser now blocks pathological inputs before they hit the network. Pairs with the existing FAQ, hero clarifier, document/BYOF, and OCR input caps.
- **Tags input cap at 300 chars** — `maxlength="300"` on `tagsInput` (the comma-separated tag field on `analyze.html` result panel). Closes the last remaining input field with a defensive browser-side cap.
- **`/api/analyze?format=verdict-only`** — new query flag that returns just the verdict + risks, skipping the plain-English rewrite, deadlines, next steps, reading-level metrics, and jargon section. Lighter AI prompt, fewer output tokens, lower per-request latency — designed for batch dashboards that scan many documents and only need the bottom-line classification. Same auth, rate limit, and observability headers as the full response.
- **Gzip bomb defenses** on share feature (decompressed-size cap + v1 decoder parity).
- **Image-attachment OCR** via lazy Tesseract.js loading (30s timeout + cancel).
- **`/api/chat` provider-fallback chain** — Gemini primary, OpenRouter fallback. If Gemini is unreachable, rate-limited, returns empty, or the key isn't configured, the next request transparently uses OpenRouter. Per-provider 25s `REQUEST_TIMEOUT_MS` keeps the chain inside the 60s Vercel ceiling. Response payload now includes `provider` so ops can see which AI answered. A clear 503 ("No AI provider is configured.") surfaces config gaps before any provider call instead of producing a misleading 502.
- **`X-AI-Provider` + `X-AI-Response-Time-Ms` response headers** on `/api/analyze` and `/api/chat` — a single `curl -i` now reports which provider answered (gemini / openrouter / none) and how long the AI chain took. Lets ops spot fallback activation and provider latency in real time without correlating server logs.
- **`X-Request-Latency-Total-Ms` end-to-end timing header** on every API response — complements the AI-only header by reporting the full server-side time (rate-limit gate + body read + AI call + validation + serialize). Critical for distinguishing "the AI is slow" from "our code is slow" when triaging latency reports.
- **`/api/health` provider probes parallelized** — gemini + OpenRouter HEAD probes now fire via `Promise.all`, cutting cold-cache latency from ~6s to ~3s. Warm probes (cache hit) are unaffected. Sequential was wasteful on the slow first call.
- **`Retry-After: 60` on degraded `/api/analyze` and `/api/chat` 502 responses** — mirrors `/api/health`'s 503 behavior. When the AI provider chain is exhausted or the schema fails, clients now see a consistent back-off signal instead of hot-loop retrying. Skipped on 200 (healthy) and the 503 neither-configured path (config bug, not outage).
- **`X-AI-Model` response header** on `/api/analyze` and `/api/chat` — joins the existing `X-AI-Provider` + `X-AI-Response-Time-Ms` family. Tells ops the exact model identifier that answered (`google/gemma-4-31b-it:free`, `gemini-2.5-flash`, etc.) without parsing the response body. ASCII-charset-allowlisted with a 128-char cap for header-injection defense.
- **`X-AI-Fallback` response header** — fourth in the family. Tells ops whether the AI's answer came from the primary provider outright or the silent fallback activation. `/api/analyze` (OpenRouter primary) emits `true` when Gemini answered; `/api/chat` (Gemini primary) emits `true` when OpenRouter answered. Lets dashboards alert when fallback activation rate climbs.
- **`X-AI-OpenRouter-Ms` + `X-AI-Gemini-Ms` per-provider latency headers** — close the per-provider observability gap. When the fallback chain activates, total `X-AI-Response-Time-Ms` tells you the chain was slow but not which link. Now ops can spot "Gemini's degraded today" vs "OpenRouter's network is the problem" from header inspection alone. Strict key allowlist prevents leaked objects from driving arbitrary header names.
- **`X-Build-Sha` response header** — every JSON response (across `/api/health`, `/api/analyze`, `/api/chat`) carries the deployed commit SHA. Lets ops confirm which build is responding to a curl request without parsing the JSON body. Strict git-SHA shape validation defends against misconfigured CI environments; local dev emits no header.
- **`/api/health` 200 + HEAD now edge-cacheable for 5 seconds** — `Cache-Control: public, max-age=5, s-maxage=5` on the success path. Monitoring services that poll the health endpoint every 1–5s collapse into ~1 Vercel function invocation per 5s window per edge node. The 503 path intentionally keeps `no-store` so an active outage is never masked by a stale cache.

### Observability
- `X-Request-Id` on every API response (echoes upstream IDs when present, otherwise fresh UUID v4).
- `errLog(res, prefix, err)` for tagged error logs, `accessLog(req, res, status)` for per-request completion logs.
- `logProviderError(reqId, prefix, msg)` for tagged inner-AI-call error logs (HTTP non-2xx, network/timeout, empty content) — every Gemini / OpenRouter call in `/api/analyze` and `/api/chat` threads errors through this helper so ops can grep by request id and see exactly which provider failed and why. Critical now that the fallback chain silently retries across providers.
- `gitSha` field in `/api/health` payload (from `VERCEL_GIT_COMMIT_SHA`) so ops can correlate responses with deploys.
- **`HEAD /api/health` response header compliance** (RFC 7231 §4.3.2) — HEAD responses now carry the same well-formed header set as the equivalent GET (`Content-Type: application/json`, `Cache-Control: no-store`, `X-Request-Latency-Total-Ms`, `X-Build-Sha`). Previously the HEAD fast-path bypassed `json()` and skipped those headers, leaving monitoring clients with a near-empty response.
- **`/api/health` summary rollup field** — alongside the nested `providers` block, the 200 payload now carries a flat `summary: { providersConfigured, providersReachable, fastestProviderMs, slowestProviderMs, cacheHits }` for ops dashboards that want bottom-line numbers without walking nested objects. Computed from the same probe objects via a pure `buildSummary()` helper so the rollup can never drift from the `providers` block.
- **`/api/health` summary extends `totalProbes` + `networkProbes` counters** — the rollup now also reports the total probe count (always = number of configured providers regardless of reachability) and the network probe count (subset that actually fired HEAD requests to provider hosts vs. served from the 60s probe cache). Lets ops distinguish "we tested 2 providers" from "the cache hit on the last call meant we only did 1 network call".
- **`/api/health` CSP-report aggregation counters** — the rollup also surfaces `cspReportsLast24h` and `cspReportsByViolation` (counts keyed by `violated-directive` + `blocked-uri`). Lets ops dashboards see at-a-glance whether the new `report-uri` directive is paying dividends (real-world CSP violations surfacing) and which directives are the highest-friction in production.
- **`/api/health` process-info block** — memory usage (`rss`, `heapTotal`, `heapUsed`, `external`), Node version, platform, architecture, PID, process uptime, plus `region` (`VERCEL_REGION`, e.g. `iad1`) and `vercelEnv` (`VERCEL_ENV`, e.g. `production`). Lets ops dashboards route alerts by region ("only iad1 is unhealthy") and distinguish prod from preview deployments hitting the same endpoint. Local dev emits `null` for the Vercel-only fields.
- **`/api/health` VERSION reads from `package.json`** — the `version` field on the 200 payload now reads `require('../../package.json').version` instead of the hardcoded `"1.0.0"` string. Single source of truth — bumping the package version automatically propagates to the health endpoint on next deploy.
- **`/api/health` memory-pressure advisory** — the process.memory block now exposes `limitMb` (configured `MEMORY_LIMIT_MB` env var, defaults to 256 for Vercel Hobby / 1024 for Pro), `usedPercent` (heapUsed ÷ limitMb × 100, 1-decimal precision), and `nearLimit` (boolean, true when usedPercent ≥ 80). Pre-OOM, ops could not tell from `/api/health` that a function was close to the ceiling — now they can alert on the boolean and trend on the percentage. Non-numeric `MEMORY_LIMIT_MB` falls back to the 256 MB Hobby default rather than breaking the response.

### Features
- **Share analyses via URL** — client-side gzip + base64url encoding, no server upload needed. Includes dismissable banner.
- **Local persistence** — auto-save analysis (24h TTL), auto-save textarea draft.
- **"Forget my data" footer button** — clears all ClearDoc localStorage keys immediately.
- **Sticky mobile Analyze CTA** at ≤900px so the button stays in view after pasting a long document.
- **Live text-stats bar** — word/char/reading-level/cap indicator on the analyzer.
- **Per-verdict Copy button** — copies verdict + summary to clipboard.
- **Mobile drawer focus trap** + keyboard shortcuts.
- **FAQ expand-all / collapse-all** controls on every FAQ section.
- **Service worker** (`assets/sw.js`) precaches the shell, network-first for HTML, cache-first for assets.
- **Print-optimized stylesheet** (`assets/print.css`) — when users hit *Print → Save as PDF* on any ClearDoc page, the output strips nav / footer / sticky CTAs / mobile drawer, switches to black-on-white, and renders the canonical URL + printed-on timestamp so the artifact is self-identifying. Loaded with `media="print"` so it never blocks screen render.

### Documentation
- `README.md` — refreshed to reflect the 3-endpoint API, Node 22+ requirement, full project layout.
- `SECURITY.md` — disclosure policy, supported versions, response SLAs (72h ack / 5d triage / 7d critical fix / 30d high fix), security posture summary.
- `CONTRIBUTING.md` — dev setup, test commands, commit conventions, PR checklist.
- `CHANGELOG.md` (this file) — user-facing release notes.
- `public/.well-known/security.txt` — RFC 9116 disclosure endpoint.
- `memory/LOGBOOK.md` — agent work history (append-only).

### Operations
- `package.json` with `npm test`, `npm run check`, `npm run syntax`, `npm run validate:json` scripts.
- `.nvmrc` pinning Node 22.
- `.github/workflows/test.yml` — runs unit + smoke + integration in 8 typed steps.

## Notes on format

- Every commit on `main` is live. There are no versioned releases — this file tracks changes chronologically, not semver.
- The `LOGBOOK.md` (in `memory/`) is the agent's working journal. This file is the user-facing summary.
- "Notable changes" excludes LOGBOOK entries, test refactors, and pure documentation polish. See `git log` for the full history.
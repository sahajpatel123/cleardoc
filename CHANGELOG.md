# Changelog

User-facing release notes for ClearDoc. For agent work history see [`memory/LOGBOOK.md`](./memory/LOGBOOK.md); for raw commits see `git log`.

ClearDoc is a continuously-deployed static site — every push to `main` is live. This file tracks notable changes grouped by month.

## 2026-07 — Hardened plateau + doc baseline

### Security hardening
- **Strict Content-Security-Policy** (`script-src` without `'unsafe-inline'`) — moved the lone inline script to `assets/pdfjs-bootstrap.js`; `connect-src` allowlists only `generativelanguage.googleapis.com` and `openrouter.ai`.
- **Subresource Integrity (SRI)** hashes on every CDN script tag (gsap, ScrollTrigger, Lenis, PDF.js, and the lazy Tesseract.js loader).
- **HSTS** upgraded to `max-age=63072000; includeSubDomains; preload` — eligible for browser HSTS preload list.
- **Outer try/catch safety net** on all three API handlers with `res.headersSent` guard + sanitized 500 body (no stack frames, no `err.message` leak).
- **Per-handler `X-Request-Id`** propagation + tagged `errLog()` and `accessLog()` for log correlation.
- **Rate-limit headers** (`X-RateLimit-Limit / -Remaining / -Reset`) on every response.
- **AI provider reachability probe** in `/api/health` with cached HEAD requests (60s TTL, LRU eviction at 100 keys).
- **`Retry-After: 60`** on `/api/health` 503 responses so monitoring clients back off correctly during outages.
- **RFC 9116 `security.txt`** at `/.well-known/security.txt` — auto-discovered by security scanners.

### Reliability
- **Strict fail-closed schema validators** (`safeParseAnalysisResult`, `safeParseChatResult`) — partial legal data is more dangerous than no data (RULES.md #3).
- **Gzip bomb defenses** on share feature (decompressed-size cap + v1 decoder parity).
- **Image-attachment OCR** via lazy Tesseract.js loading (30s timeout + cancel).

### Observability
- `X-Request-Id` on every API response (echoes upstream IDs when present, otherwise fresh UUID v4).
- `errLog(res, prefix, err)` for tagged error logs, `accessLog(req, res, status)` for per-request completion logs.
- `gitSha` field in `/api/health` payload (from `VERCEL_GIT_COMMIT_SHA`) so ops can correlate responses with deploys.

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
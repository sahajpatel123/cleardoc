# Security Policy

ClearDoc takes the security of its users and their documents seriously. This page documents how to report a vulnerability, what to expect in response, and the security posture of the deployed site.

## Supported Versions

| Version | Supported |
| ------- | --------- |
| Latest deployed to `cleardoc.app` | ✅ Active |
| Previous deploy (one behind `main`) | ⚠️ Best-effort only |
| Anything older | ❌ No longer maintained |

ClearDoc is a single-deployment static site — there are no versioned releases. The single source of truth is `origin/main`, which auto-deploys to Vercel on every push to `main`.

## Reporting a Vulnerability

**Please do not file public GitHub issues for security-sensitive bugs.** Instead:

- **Email:** security@cleardoc.app (PGP key below)
- **GitHub:** Use [private vulnerability reporting](https://github.com/sahajpatel123/cleardoc/security/advisories/new) on the repo's Security tab

When reporting, please include:

1. **Affected endpoint / page** (URL or function name)
2. **Vulnerability class** (XSS, SSRF, RCE, IDOR, etc.)
3. **Reproduction steps** — minimal payload or sequence
4. **Impact assessment** — what an attacker could achieve
5. **Optional: suggested fix** (appreciated but not required)

### Response Commitments

- **Acknowledgement:** within **72 hours** of receipt
- **Triage:** within **5 business days** — we confirm whether the report is a valid vulnerability
- **Fix for critical issues** (RCE, auth bypass, mass PII exposure): within **7 days**
- **Fix for high-severity issues** (XSS, SSRF, IDOR): within **30 days**
- **Fix for medium / low issues**: bundled with the next regular release

We follow [coordinated disclosure](https://cheatsheetseries.owasp.org/cheatsheets/Coordinated_Disclosure_Cheat_Sheet.html): we ask reporters to give us a reasonable window (typically 90 days) before public disclosure. We'll credit reporters in the fix commit unless they prefer anonymity.

## Security Posture

ClearDoc is built with a "fail-closed" philosophy: every API handler validates input, every AI response is schema-checked, every request has a unique correlation ID, and every endpoint enforces hard caps on body size and request rate.

### Transport & Headers

| Header | Value | Purpose |
| ------ | ----- | ------- |
| `Strict-Transport-Security` | `max-age=63072000; includeSubDomains; preload` | Force HTTPS for 2 years; eligible for browser HSTS preload list |
| `X-Frame-Options` | `SAMEORIGIN` | Prevent clickjacking via iframe embedding |
| `X-Content-Type-Options` | `nosniff` | Block MIME-type sniffing attacks |
| `Referrer-Policy` | `strict-origin-when-cross-origin` | Limit Referer leakage to same-origin requests |
| `Permissions-Policy` | `camera=(), microphone=(), geolocation=(), interest-cohort=(), payment=(), usb=()` | Disable unused powerful APIs |
| `Cross-Origin-Opener-Policy` | `same-origin` | Isolate browsing context group |
| `Content-Security-Policy` | strict (no `'unsafe-inline'` for scripts) | Block XSS sinks; see `vercel.json` for full policy |
| `X-Request-Id` | per-request UUID | Correlate browser errors with server logs |

### API Endpoint Security

Every API handler (`/api/analyze`, `/api/chat`, `/api/health`, `/api/csp-report`) implements:

- **Per-IP rate limiting** with `X-RateLimit-Limit / -Remaining / -Reset` headers
- **Hard request-body size cap** (128 KB for `/api/chat`, 256 KB for `/api/analyze`)
- **Structured 500 safety net** — uncaught throws return sanitized JSON 500 (no stack frames, no module paths, no `err.message` leak); `res.headersSent` guard prevents double-end on partial responses
- **Per-request `X-Request-Id`** in both response header and `console.error` log lines
- **Strict fail-closed schema validation** on all AI responses (RULES.md #3 — partial legal data is more dangerous than no data)

### Privacy

- **No account creation required.** The analyzer is fully anonymous.
- **No persistence on our servers.** Documents are sent to the AI provider in real time and discarded immediately. The browser-side "restore" feature uses `localStorage` with a 24-hour TTL and is cleared on user dismissal — never synced.
- **AI providers** (Gemini / OpenRouter) have their own data-retention policies; ClearDoc does not log or persist document content.
- **"Forget my data" button** in the footer clears the browser's local snapshot immediately.

### Third-Party Dependencies

The site loads three categories of external resources:

1. **Google Fonts** (`fonts.googleapis.com`, `fonts.gstatic.com`) — font CSS and font files
2. **CDN libraries** (`cdnjs.cloudflare.com`, `unpkg.com`) — gsap, ScrollTrigger, Lenis, PDF.js, Tesseract.js (lazy)
3. **AI APIs** (`generativelanguage.googleapis.com`, `openrouter.ai`) — model inference

All CDN scripts ship with **Subresource Integrity (SRI) hashes** so any CDN compromise that tampers with the script bytes is rejected by the browser. The CSP `connect-src` directive whitelists only the two AI provider hosts; no other origin can receive fetch/XHR from the page.

### Bug Bounty

ClearDoc is an independent product; we do not currently run a paid bug bounty program. We will, however:

- Credit reporters in the fix commit (unless anonymity requested)
- Send a ClearDoc t-shirt to verified reporters of high / critical issues
- Publicly thank reporters on a future "Security Hall of Fame" page (once it exists)

## Acknowledgments

We thank the following researchers for responsible disclosures (none to date — this list is ready for first entries).
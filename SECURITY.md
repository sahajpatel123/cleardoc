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
- **Hardened API response headers** — `/api/*` responses set `Cache-Control: no-store`, `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy: no-referrer`, `Cross-Origin-Opener-Policy: same-origin`, `Cross-Origin-Resource-Policy: same-origin`, `X-Permitted-Cross-Domain-Policies: none`, `X-Robots-Tag: noindex, nofollow`, and `Content-Security-Policy: default-src 'none'; frame-ancestors 'none'`

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

### CI/CD Security

ClearDoc uses GitHub Actions with security best practices:

- **SHA-pinned actions**: All actions in workflow files use SHA-pinned references (not version tags) to prevent supply-chain attacks. See `.github/workflows/` for details.
- **Minimal permissions**: Each workflow job requests only the permissions it needs:
  - `test.yml`: `contents: read`
  - `codeql.yml`: `security-events: write, actions: read`
  - `security.yml`: `contents: read, pull-requests: read`
- **Top-level read-only defaults**: All workflows also set `permissions: contents: read` at the workflow level, so any future job that forgets its own block still starts with no write access.
- **Concurrency groups**: Prevent stale CI runs from executing after new pushes
- **CodeQL analysis**: Automated security scanning on every push/PR + weekly scans
- **Dependabot**: Automated dependency updates with security priority
- **Hardening script gates**: `scripts/security-hardening.sh` fails if CSP `report-uri`, `frame-ancestors`, `object-src`, `base-uri`, `default-src`, or `upgrade-insecure-requests` regress, if `connect-src`/`script-src` gain wildcards, if page/API security headers loosen, if high-severity npm audit gates, `npm ci`, npm cache, or JSON validation disappear from CI, if browser smoke tests disappear, if CodeQL re-enables fail-fast, loses `security-events`, or drops its test-path ignore, if checkout persists credentials, if workflows lose `workflow_dispatch`, if the hardening script stops running in CI, if dependabot loses an ecosystem, if CODEOWNERS loses owner assignments, if `security.txt` `Expires` lapses, loses its rewrite, canonical/language directives, or policy URL, if `package-lock.json` is untracked, if `robots.txt` loses its `/api/` block, `Allow: /`, standard directives, or canonical sitemap URL, if `sitemap.xml` loses core URLs or lastmod entries, or if production HTML reintroduces inline event handlers or inline scripts; it also verifies workflow actions are SHA-pinned, workflow permissions default to read-only, every workflow job declares a timeout, workflows declare concurrency groups, `security.txt` has the RFC 9116 `Contact` field, and `SECURITY.md` exposes a reporting channel, the private vulnerability reporting URL, and the security email.

#### Running Security Checks Locally

```bash
# Validate JSON configs
npm run validate:json

# Check JavaScript syntax
npm run syntax

# Run full test suite
npm run test

# Run all validation
npm run check
```

## Bug Bounty

ClearDoc is an independent product; we do not currently run a paid bug bounty program. We will, however:

- Credit reporters in the fix commit (unless anonymity requested)
- Send a ClearDoc t-shirt to verified reporters of high / critical issues
- Publicly thank reporters on a future "Security Hall of Fame" page (once it exists)

## Acknowledgments

We thank the following researchers for responsible disclosures (none to date — this list is ready for first entries).

## Additional Resources

- **security.txt**: `/.well-known/security.txt` — Contact info for security researchers (RFC 9116)
- **CODEOWNERS**: `.github/CODEOWNERS` — Defines code ownership for PR review requirements
- **Dependabot**: `.github/dependabot.yml` — Automated dependency updates with security priority

## Branch Protection Recommendations

To maximize security, the `main` branch should have the following branch protection rules enabled in GitHub:

1. **Require pull request reviews before merging**
   - Minimum 1 approving review
   - Dismiss stale approvals when new commits are pushed

2. **Require status checks to pass before merging**
   - `Tests` (test.yml)
   - `Security` (security.yml)
   - `CodeQL Analysis` (codeql.yml)

3. **Require linear history** (disable merge commits)
   - Ensures clean git history
   - Prevents history manipulation

4. **Require signed commits** (optional but recommended)
   - Adds cryptographic verification of commits

5. **Restrict who can push to matching branches**
   - Only allow maintainers to push directly
   - Everyone else must use PRs

6. **Require conversation resolution before merging**
   - Ensures all review comments are addressed

7. **Allow force pushes**: Disabled
   - Prevents history rewriting

### Setting Up Branch Protection

GitHub Branch Protection rules are configured via the repository Settings → "Branches" section. Create a rule for the `main` branch with the options above.

**Note**: These rules cannot be enforced via repository files — they must be configured manually in the GitHub UI by a repository administrator.

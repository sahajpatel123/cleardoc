/* api/csp-report.js — receives CSP violation reports from browsers.
 *
 * Wired into the global CSP via `report-uri /api/csp-report` in vercel.json.
 * When a browser blocks a script/style/etc. against our CSP, it POSTs a
 * JSON report here. We log it with a structured tag so ops can grep
 * server logs and see exactly what was blocked where.
 *
 * Spec:
 *   - CSP Level 3 `report-uri` directive posts application/csp-report (legacy)
 *   - Reporting API `report-to` posts application/reports+json (newer)
 *
 * We accept both shapes — browser decides which to use. Either way the
 * body is JSON and the request is rate-limited per IP to avoid abuse.
 *
 * No PII is logged: we strip the offending URL's query string + hash
 * before logging, and we cap the body length on read.
 */

const { json, rateLimit, applyRateLimitHeaders, attachRequestId, applyEndpointHeader, applyBuildShaHeader, errLog, accessLog, getIp, readCappedBody, sanitizeLogField, recordCspReport } = require("./_safety.js");

const MAX_BODY_BYTES = 16 * 1024;       // CSP reports are tiny (~1KB typical)
const RATE_LIMIT_PER_MINUTE = 60;        // browsers don't usually spam; rate-limit anyway

/* Browser ships a CSP violation as either:
 *   { "csp-report": { "document-uri": "...", "violated-directive": "...", ... } }
 *   { "reports": [ { "type": "csp-violation", "body": { ... } }, ... ] }
 *
 * Both end up logged as a single line tagged [csp-report] so ops can grep
 * server logs without parsing two different shapes.
 */
function extractViolations(body) {
  if (!body || typeof body !== "object") return [];
  // Legacy CSP Level 3 format — single report under "csp-report"
  if (body["csp-report"] && typeof body["csp-report"] === "object") {
    return [body["csp-report"]];
  }
  // Newer Reporting API — array under "reports"
  if (Array.isArray(body.reports)) {
    return body.reports
      .filter((r) => r && r.body)
      .map((r) => Object.assign({}, r.body, { type: r.type || "csp-violation" }));
  }
  return [];
}

/* Strip the query string + hash from a URL before logging. The
 * blocked URL can carry PII (session tokens, query-string secrets)
 * in the query — never include it in operator-visible logs.
 */
function sanitizeUrl(u) {
  if (typeof u !== "string" || u.length === 0) return "(none)";
  return sanitizeLogField(u.split(/[?#]/)[0], 240);
}

/* Apply the standard observability header family to the CSP report
 * 204 response. CSP reports use res.end() directly (no json() call),
 * so we have to set the headers ourselves. The headers are: X-Request-Id
 * (from attachRequestId), X-Request-Latency-Total-Ms, and X-Build-Sha
 * (deployed commit). Safe no-op when res.headersSent is true.
 */
function applyCspReportHeaders(res) {
  if (!res || typeof res.setHeader !== "function" || res.headersSent) return;
  if (res.__requestId) res.setHeader("X-Request-Id", res.__requestId);
  if (typeof res.__requestStartedAt === "number") {
    const elapsed = Date.now() - res.__requestStartedAt;
    if (Number.isFinite(elapsed) && elapsed >= 0 && elapsed <= 600000) {
      res.setHeader("X-Request-Latency-Total-Ms", String(Math.round(elapsed)));
    }
  }
  applyBuildShaHeader(res);
}

module.exports = async function handler(req, res) {
  attachRequestId(res, req);
  applyEndpointHeader(res, "csp-report");
  try {
    if (req.method !== "POST") {
      return json(res, 405, { error: "Method not allowed." });
    }

    // Content-Type enforcement — browsers send CSP reports as
    // application/csp-report (legacy), application/reports+json (newer),
    // or application/json (curl/dev-tools). A form-encoded body or a
    // client that lies about the type is a misuse signal — reject with
    // 415 before parsing. The check is case-insensitive on the
    // parameter (Vercel/Node lowercases header values) and tolerates
    // a charset suffix (e.g. "application/json; charset=utf-8").
    const ctype = (req.headers && (req.headers["content-type"] || req.headers["Content-Type"])) || "";
    const baseType = ctype.split(";")[0].trim().toLowerCase();
    const ALLOWED_CT = new Set(["application/json", "application/csp-report", "application/reports+json"]);
    if (!ALLOWED_CT.has(baseType)) {
      res.setHeader("Accept", "application/json, application/csp-report, application/reports+json");
      return json(res, 415, { error: "Unsupported Media Type. Expected application/json, application/csp-report, or application/reports+json." });
    }

    // Rate-limit per IP so a misbehaving browser can't flood us with
    // bogus reports (which is an actual attack pattern — CSP report
    // endpoints are sometimes DDoS'd to amplify CPU costs).
    const rl = rateLimit(getIp(req), RATE_LIMIT_PER_MINUTE);
    applyRateLimitHeaders(res, rl);
    if (!rl.ok) {
      return json(res, 429, { error: "Too many reports. Try again shortly." });
    }

    // Hard body cap — CSP reports are typically <2KB. Anything bigger
    // is either malformed or an attack.
    const got = await readCappedBody(req, MAX_BODY_BYTES);
    if (got.error) {
      // Don't surface the body-cap reason back to the client — they
      // shouldn't care, and we don't want a hint about our limits.
      return json(res, 413, { error: "Report too large." });
    }

    let parsed = null;
    if (got.raw) {
      try {
        parsed = JSON.parse(got.raw);
      } catch (_) {
        return json(res, 400, { error: "Invalid JSON." });
      }
    }

    const violations = extractViolations(parsed);
    if (violations.length === 0) {
      // Empty / unrecognized body — log at warn level so ops can see
      // something's wrong if browsers are sending malformed reports,
      // but accept it (return 204) so we don't encourage retries.
      errLog(res, "csp-report", new Error("empty or unrecognized CSP report body"));
      res.statusCode = 204;
      applyCspReportHeaders(res);
      return res.end();
    }

    // Log each violation on its own line so aggregators can split them.
    for (const v of violations) {
      const rawDirective = String(v["violated-directive"] || v.effectiveDirective || "(unknown)");
      const directive = sanitizeLogField(rawDirective, 120);
      const blockedUri = sanitizeUrl(v["blocked-uri"] || v.blockedURL);
      const documentUri = sanitizeUrl(v["document-uri"] || v.documentURL);
      const sample = v.sample ? ` sample=${sanitizeLogField(String(v.sample), 120)}` : "";
      // console.log (not console.error) — these are real telemetry
      // reports, not errors in our code. Tagged [csp-report] for grep.
      // req.url is run through sanitizeLogField so a crafted URL with
      // control characters can't smuggle a fake log line into the
      // stream. Parity with the accessLog() call in the finally block.
      const safeUrl = sanitizeLogField(req && req.url ? req.url : "?", 512);
      console.log(`[req=${res.__requestId}] [csp-report] ${req.method} ${safeUrl} -> blocked=${blockedUri} directive=${directive} document=${documentUri}${sample}`);
      // Increment the in-process per-directive counter so /api/health
      // can surface aggregate stats ("is CSP rejection rate climbing?").
      recordCspReport(rawDirective, blockedUri, documentUri, getIp(req));
    }

    // Always 204 — browsers don't care about the response body
    res.statusCode = 204;
    applyCspReportHeaders(res);
    res.end();
  } catch (err) {
    if (res && res.headersSent) return;
    errLog(res, "csp-report", err);
    try {
      return json(res, 500, { error: "An internal error occurred. Please try again." });
    } catch (_) {
      // res.end() threw — nothing more we can do.
    }
  } finally {
    accessLog(req, res, res.statusCode);
  }
};

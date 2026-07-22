/* test/csp-report-error.test.js — node:test source-pattern tests for the
 * /api/csp-report endpoint shipped in iter #42.
 *
 * The handler is defense-in-depth:
 *   - POST-only (405 otherwise)
 *   - 16KB body cap (413 otherwise) — CSP reports are typically <2KB
 *   - 60-req/min per-IP rate limit (429 otherwise)
 *   - JSON parse required (400 otherwise)
 *   - lenient on payload SHAPE (extractViolations() handles both legacy
 *     `csp-report` envelope and modern `reports` array)
 *   - logs structured via [csp-report] tag with sanitized URLs
 *   - responds 204 No Content (CSP reports don't need a body)
 *
 * Run with: node --test test/csp-report-error.test.js
 */

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const CSP_SOURCE = fs.readFileSync(
  path.resolve(__dirname, "../api/csp-report.js"),
  "utf8"
);

// ── happy path source-pattern checks ──────────────────────────────

test("csp-report handler: declared and POST-only", () => {
  assert.match(CSP_SOURCE, /module\.exports\s*=\s*async function handler/, "must export async handler");
  assert.match(CSP_SOURCE, /req\.method\s*!==\s*["']POST["']/, "must short-circuit non-POST with 405");
});

test("csp-report handler: rate-limits per IP to defend against CSP flood DoS", () => {
  // CSP report endpoints are a known DDoS amplification vector (a
  // misbehaving browser can flood a small report-uri to amplify CPU
  // cost). The handler must rate-limit per IP.
  assert.match(CSP_SOURCE, /rateLimit\(/, "must call rateLimit()");
  assert.match(CSP_SOURCE, /applyRateLimitHeaders/, "must emit standard rate-limit headers");
  assert.match(CSP_SOURCE, /json\(res,\s*429/, "must reject over-limit with 429");
});

test("csp-report handler: enforces a body byte cap (CSP reports are tiny)", () => {
  assert.match(CSP_SOURCE, /readCappedBody\(/, "must stream-read with byte cap");
  assert.match(CSP_SOURCE, /413/, "must reject over-cap with 413");
});

test("csp-report handler: strict JSON parse (no exotic bodies)", () => {
  // CSP reports are JSON. Anything else is malformed.
  assert.match(CSP_SOURCE, /JSON\.parse/, "must JSON.parse the body");
  assert.match(CSP_SOURCE, /json\(res,\s*400,\s*\{\s*error:\s*["']Invalid JSON\./, "must reject malformed with 400");
});

test("csp-report handler: accepts both legacy csp-report envelope and modern reports array", () => {
  // extractViolations() must handle both shapes so we don't reject
  // browser reports that use either the legacy `csp-report` key or
  // the modern Reporting API `reports` array.
  assert.match(CSP_SOURCE, /function\s+extractViolations\(/, "extractViolations helper must exist");
  assert.match(CSP_SOURCE, /body\[?["']csp-report["']\]?/, "must handle legacy csp-report envelope");
  assert.match(CSP_SOURCE, /Array\.isArray\(body\.reports\)/, "must handle modern reports array");
});

test("csp-report handler: logs structured with [csp-report] tag and sanitized URLs", () => {
  // Logs go to console.log (real telemetry, not errors). Tagged for grep.
  assert.match(CSP_SOURCE, /console\.log/, "must log via console.log (not error)");
  assert.match(CSP_SOURCE, /\[csp-report\]/, "must tag every log line with [csp-report]");
  // PII defense: never log raw query strings; the sanitizeUrl helper
  // strips the part after ? or # before logging.
  assert.match(CSP_SOURCE, /function\s+sanitizeUrl\(/, "sanitizeUrl helper must exist");
  assert.match(CSP_SOURCE, /split\(\/\[\?#\]\//, "must split URL on ? or #");
});

test("csp-report handler: responds 204 No Content (browsers don't read body)", () => {
  // Per RFC 7231 §6.3.5, 204 is the right status for "request
  // successfully processed, no body to return". Saves bytes on the
  // unhappy path that browsers don't even look at.
  assert.match(CSP_SOURCE, /res\.statusCode\s*=\s*204/, "must set statusCode to 204");
});

test("csp-report handler: empty / unrecognized body logs at errLog-level + still 204", () => {
  // We don't want browsers to retry-flood because we sent an error.
  // A bad-shape body returns 204 anyway, but logs at errLog() so
  // ops can spot that browsers are sending malformed reports.
  assert.match(CSP_SOURCE, /errLog\(res,\s*["']csp-report["']/, "must log unrecognized reports with the csp-report tag");
});

test("csp-report handler: vercel.json wires it into the global CSP via report-uri", () => {
  // Source-pattern across files. The wiring is what makes the endpoint
  // actually reachable from real browsers — without it, the file is dead.
  const vercel = JSON.parse(fs.readFileSync(path.resolve(__dirname, "../vercel.json"), "utf8"));
  const globalHeaders = (vercel.headers || []).find((b) => b.source === "/(.*)")?.headers || [];
  const cspHeader = globalHeaders.find((h) => h.key === "Content-Security-Policy");
  assert.ok(cspHeader, "global CSP header must exist in vercel.json");
  assert.match(cspHeader.value, /report-uri\s+\/api\/csp-report/, "CSP must declare `report-uri /api/csp-report`");
});

test("csp-report handler: full safety net (try/catch + headersSent guard + sanitized 500)", () => {
  // Parity with the other /api/* handlers — outer try/catch,
  // headersSent guard, sanitized 500 body.
  assert.match(CSP_SOURCE, /catch\s*\(err\)/, "must have outer catch block");
  assert.match(CSP_SOURCE, /res\.headersSent/, "must guard on headersSent before retrying");
  assert.match(CSP_SOURCE, /json\(res,\s*500,\s*\{\s*error:\s*["']An internal error/, "must respond sanitized 500");
});

// ── behavioral: extractViolations() through the actual module ───────

test("csp-report handler: extractViolations handles empty / missing / wrong shapes", async () => {
  // Behavioral check that the helper hasn't drifted. We exercise the
  // full handler via real fetch mocking isn't necessary for this
  // tiny helper; instead import via the export pattern and call
  // indirectly by sending bad payloads through a stubbed req/res.
  const { json, rateLimit, applyRateLimitHeaders, attachRequestId } = require("../api/_safety.js");
  const handler = require("../api/csp-report.js");

  // Helper that builds a stub req/res pair and invokes the handler.
  // Production behavior: req body chunks are Buffers (not strings).
  // When body is "" (empty), yield a Buffer of length 0 to match the
  // production stream semantics — `Buffer.concat([])` works, but
  // `Buffer.concat([""])` throws because strings are not valid chunks.
  async function runWithBody(body) {
    const res = {
      statusCode: 200, _body: null, headers: {}, headersSent: false,
      setHeader(k, v) { this.headers[k] = v; },
      end(s) { this._body = s; this.headersSent = true; },
    };
    const req = {
      method: "POST",
      headers: { "content-type": "application/csp-report" },
      body: undefined,
      socket: { remoteAddress: "127.0.0.1" },
      url: "/api/csp-report",
      [Symbol.asyncIterator]() {
        let yielded = false;
        return {
          next: async () => {
            if (yielded) return { done: true };
            yielded = true;
            const chunk = typeof body === "string" ? body : JSON.stringify(body);
            // Convert string → Buffer to mimic Vercel's stream chunks
            return { value: Buffer.from(chunk, "utf8") };
          },
        };
      },
    };
    await handler(req, res);
    return res;
  }

  // Empty body — must NOT throw, must respond 204
  const empty = await runWithBody("");
  assert.equal(empty.statusCode, 204, "empty body should still return 204 (no retry storm)");

  // Malformed JSON — must reject 400 cleanly
  const bad = await runWithBody("{ not valid json");
  assert.equal(bad.statusCode, 400);
  assert.match(bad._body, /Invalid JSON/);
});

test("csp-report handler: enforces Content-Type allowlist (415 otherwise)", () => {
  // Browsers send CSP reports as application/csp-report (legacy) or
  // application/reports+json (newer). application/json is also
  // accepted for curl/dev-tools. Anything else (form-encoded, plain
  // text) is a misuse signal — reject with 415 before parsing.
  const fs = require("node:fs");
  const path = require("node:path");
  const src = fs.readFileSync(path.resolve(__dirname, "../api/csp-report.js"), "utf8");
  assert.match(src, /Content-Type/i, "must inspect the Content-Type header");
  assert.match(src, /application\/csp-report/, "must accept application/csp-report");
  assert.match(src, /application\/reports\+json/, "must accept application/reports+json");
  assert.match(src, /415/, "must return 415 for unsupported content types");
});

// ── behavioral: Content-Type enforcement on stub requests ────────────

test("csp-report handler: 415s on disallowed Content-Type before parsing the body", async () => {
  // Behavioral: a real stub POST with form-encoded Content-Type must
  // get 415, not 200/204/400. Without the Content-Type allowlist, the
  // handler would JSON.parse the body, fail, and return 400 — masking
  // the misuse signal and burning rate-limit slots on garbage payloads.
  const handler = require("../api/csp-report.js");

  async function runWith(contentType, body) {
    const res = {
      statusCode: 200, _body: null, headers: {}, headersSent: false,
      setHeader(k, v) { this.headers[k] = v; },
      end(s) { this._body = s; this.headersSent = true; },
    };
    const req = {
      method: "POST",
      headers: contentType ? { "content-type": contentType } : {},
      body: undefined,
      socket: { remoteAddress: "127.0.0.1" },
      url: "/api/csp-report",
      [Symbol.asyncIterator]() {
        let yielded = false;
        return {
          next: async () => {
            if (yielded) return { done: true };
            yielded = true;
            return { value: body };
          },
        };
      },
    };
    await handler(req, res);
    return res;
  }

  // No Content-Type at all → 415
  const none = await runWith("", "{}");
  assert.equal(none.statusCode, 415, "missing Content-Type must yield 415");

  // Form-encoded body → 415
  const form = await runWith("application/x-www-form-urlencoded", "key=value");
  assert.equal(form.statusCode, 415, "form-encoded Content-Type must yield 415");
  assert.match(form._body, /Unsupported Media Type/);

  // Plain text → 415
  const text = await runWith("text/plain", "hello");
  assert.equal(text.statusCode, 415, "text/plain Content-Type must yield 415");

  // Valid content types → NOT 415 (204 for empty body, 400 for malformed)
  const csp = await runWith("application/csp-report", "");
  assert.notEqual(csp.statusCode, 415, "application/csp-report must not yield 415");

  const json = await runWith("application/json", "{}");
  assert.notEqual(json.statusCode, 415, "application/json must not yield 415");
});

// ── standard observability headers on 204 responses (iter #61) ──────

test("csp-report handler: 204 responses emit X-Request-Id + X-Request-Latency-Total-Ms + X-Build-Sha", () => {
  // /api/csp-report uses res.end() directly (no json() call) so the
  // standard observability headers that json() emits don't land on
  // 204 responses. Other endpoints emit them. Parity requires explicit
  // application of X-Request-Id, X-Request-Latency-Total-Ms, and
  // X-Build-Sha so ops can correlate CSP report endpoint latency and
  // build in their dashboards.
  assert.match(CSP_SOURCE, /applyCspReportHeaders\s*\(/, "must call applyCspReportHeaders() on 204 responses");
  assert.match(CSP_SOURCE, /function\s+applyCspReportHeaders\(/, "applyCspReportHeaders helper must exist");
  // The helper must set all three standard headers
  assert.match(CSP_SOURCE, /X-Request-Id/, "helper must set X-Request-Id");
  assert.match(CSP_SOURCE, /X-Request-Latency-Total-Ms/, "helper must set X-Request-Latency-Total-Ms");
  assert.match(CSP_SOURCE, /applyBuildShaHeader/, "helper must invoke applyBuildShaHeader (emits X-Build-Sha)");
});

test("csp-report handler: MAX_BODY_BYTES is pinned at 16KB", () => {
  // CSP reports are tiny — typically <2KB. 16KB hard cap rejects
  // pathological bodies before JSON.parse. Pin the constant so a
  // future refactor can't silently raise the cap (DoS amplification).
  const fs = require("node:fs");
  const path = require("node:path");
  const src = fs.readFileSync(path.resolve(__dirname, "../api/csp-report.js"), "utf8");
  assert.match(
    src,
    /MAX_BODY_BYTES\s*=\s*16\s*\*\s*1024/,
    "MAX_BODY_BYTES must stay 16 * 1024"
  );
  // Must be wired into readCappedBody
  assert.match(
    src,
    /readCappedBody\(req,\s*MAX_BODY_BYTES\)/,
    "readCappedBody must be called with MAX_BODY_BYTES"
  );
});

// ── X-CSP-Reports-Processed-Total (iter #75) ───────────────────

test("csp-report handler: 204 responses emit X-CSP-Reports-Processed-Total header", () => {
  // Per-batch report counter. Lets the browser see how many we
  // accepted; helps with retry logic. 204 No Content body is
  // unchanged — this is just an extra header.
  assert.match(
    CSP_SOURCE,
    /X-CSP-Reports-Processed-Total/,
    "must emit X-CSP-Reports-Processed-Total header"
  );
  assert.match(
    CSP_SOURCE,
    /X-CSP-Reports-Processed-Total["'],\s*String\(violations\.length\)\)/,
    "header value must be the count of violations in this batch"
  );
});

// ── /api/csp-report happy-path behavioral test (iter #113) ─────

test("csp-report: handler returns 204 + sets X-CSP-Reports-Processed-Total on valid input", async () => {
  // Behavioral coverage for the success path. The handler should:
  //   1. Read the body (a CSP report JSON)
  //   2. Extract the violated directive + blocked URI + document URI
  //   3. Call recordCspReport in _safety.js for each violation
  //   4. Return 204 with X-CSP-Reports-Processed-Total = violation count
  const fs = require("node:fs");
  const path = require("node:path");
  // Clear the require cache so we get a fresh handler + fresh module state.
  delete require.cache[require.resolve("../api/csp-report.js")];
  delete require.cache[require.resolve("../api/_safety.js")];

  const handler = require("../api/csp-report.js");
  const { getCspReportCounts, getProbeAverageLatencyInLastHour } = require("../api/_safety.js");

  // Build a realistic CSP violation body.
  const violation = {
    "violated-directive": "script-src 'self'",
    "blocked-uri": "https://evil.example.com/script.js",
    "document-uri": "https://app.example.com/page",
  };
  const body = JSON.stringify({ "csp-report": violation });

  const req = {
    method: "POST",
    headers: {
      "content-type": "application/csp-report",
      "content-length": String(Buffer.byteLength(body)),
    },
    socket: { remoteAddress: "127.0.0.1" },
  };
  const res = {
    statusCode: 200,
    _body: null,
    headers: {},
    headersSent: false,
    setHeader(k, v) { this.headers[k] = v; },
    end(s) { this._body = s; this.headersSent = true; },
  };

  // The handler needs to read the body. Mock req with a stream-like
  // readable that pushes our payload as a Buffer (readCappedBody
  // requires Buffer/Uint8Array chunks, not strings).
  req[Symbol.asyncIterator] = async function* () {
    yield Buffer.from(body);
  };

  await handler(req, res);

  // Verify the response
  assert.equal(res.statusCode, 204, "valid CSP report → 204 No Content");
  assert.equal(res.headers["X-CSP-Reports-Processed-Total"], "1",
    "X-CSP-Reports-Processed-Total must equal 1 (one violation in this batch)");

  // Verify the report was recorded — getCspReportCounts now has a total > 0
  const counts = getCspReportCounts();
  assert.ok(counts.total >= 1, "getCspReportCounts.total must reflect the recorded report");
});

// ── extractViolations + sanitizeUrl behavioral (iter #138) ───

test("extractViolations: handles legacy csp-report envelope (single violation)", () => {
  // Behavioral verification of the legacy CSP Level 3 format. The
  // function must return an array containing the single violation
  // object (not nested under the envelope key).
  const { extractViolations } = require("../api/csp-report.js");
  const body = {
    "csp-report": {
      "document-uri": "https://example.com/page",
      "violated-directive": "script-src",
      "blocked-uri": "https://evil.com/bad.js",
    },
  };
  const result = extractViolations(body);
  assert.ok(Array.isArray(result), "must return an array");
  assert.equal(result.length, 1, "legacy envelope must yield exactly one violation");
  assert.equal(result[0]["violated-directive"], "script-src",
    "must surface the inner violation's directive");
});

test("extractViolations: handles modern Reporting API reports array (multi-violation)", () => {
  // Behavioral verification of the newer Reporting API shape. The
  // function must filter out entries without a body, map each into
  // the inner body, and preserve the type field.
  const { extractViolations } = require("../api/csp-report.js");
  const body = {
    reports: [
      { type: "csp-violation", body: { "violated-directive": "script-src" } },
      { type: "csp-violation", body: { "violated-directive": "style-src" } },
      { type: "other-type", body: null }, // must be filtered out
      { type: "csp-violation" },           // no body → must be filtered
    ],
  };
  const result = extractViolations(body);
  assert.equal(result.length, 2, "must filter out entries with null/missing body");
  assert.equal(result[0].type, "csp-violation", "must preserve the report type");
  assert.equal(result[0]["violated-directive"], "script-src");
  assert.equal(result[1]["violated-directive"], "style-src");
});

test("extractViolations: returns empty array for malformed/empty bodies", () => {
  // Defensive: never throw on bad input. Always return [] so the
  // handler can iterate safely.
  const { extractViolations } = require("../api/csp-report.js");
  assert.deepEqual(extractViolations(null), [], "null body → []");
  assert.deepEqual(extractViolations(undefined), [], "undefined body → []");
  assert.deepEqual(extractViolations("not an object"), [], "string body → []");
  assert.deepEqual(extractViolations({}), [], "empty object → []");
  assert.deepEqual(extractViolations({ "csp-report": "not an object" }), [],
    "malformed csp-report value → []");
  assert.deepEqual(extractViolations({ reports: "not an array" }), [],
    "malformed reports value → []");
});

test("sanitizeUrl: strips query string + hash to neutralize PII leakage", () => {
  // The blocked URL can carry session tokens / API keys in the query
  // string. sanitizeUrl must strip everything from '?' onwards so
  // operator-visible logs never see the secrets.
  const { sanitizeUrl } = require("../api/csp-report.js");
  // Standard case: query string stripped, path preserved
  assert.equal(
    sanitizeUrl("https://example.com/path?token=abc123&secret=xyz"),
    "https://example.com/path",
    "must strip query string"
  );
  // Hash stripped
  assert.equal(
    sanitizeUrl("https://example.com/page#section"),
    "https://example.com/page",
    "must strip hash fragment"
  );
  // Both query + hash stripped
  assert.equal(
    sanitizeUrl("https://example.com/page?token=abc#main"),
    "https://example.com/page",
    "must strip both query and hash"
  );
  // No query / hash → URL passes through unchanged
  assert.equal(
    sanitizeUrl("https://example.com/path"),
    "https://example.com/path",
    "URL without query/hash must pass through"
  );
  // Empty / invalid input → returns "(none)" sentinel (logged as a placeholder)
  assert.equal(sanitizeUrl(""), "(none)", "empty string → \"(none)\" sentinel");
  assert.equal(sanitizeUrl(null), "(none)", "null → \"(none)\" sentinel (no crash)");
});

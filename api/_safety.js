/* api/_safety.js — shared helpers for Vercel serverless endpoints.
 *
 * Files prefixed with "_" are NOT deployed as routes by Vercel, so this module
 * is safe to import from sibling API handlers.
 *
 * Exports:
 *   json(res, status, body)                       — canonical JSON response
 *   getIp(req)                                    — best-effort client IP (Vercel x-forwarded-for aware)
 *   rateLimit(ip, maxPerMinute)                   — per-IP sliding-window limiter, in-memory
 *   readCappedBody(req, maxBytes)                 — stream-read with a hard byte cap (rejects before parsing)
 *   asString(value, max)                          — defensive string coercion with a length cap
 *   ANALYSIS_LIMITS                               — single source of truth for AI output caps
 *   validSeverity(s) / validVerdictLabel(s)       — enum guards returning string or null
 *   safeParseAnalysisResult(obj)                  — strict fail-closed validator for /api/analyze results
 *   CHAT_LIMITS                                   — single source of truth for /api/chat caps
 *   safeParseChatResult(obj)                      — strict fail-closed validator for /api/chat results
 */

function json(res, status, body) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json");
  res.setHeader("Cache-Control", "no-store");
  // Echo the request id if one was attached via attachRequestId(). Helps
  // users correlate browser errors with server logs (and vice versa).
  if (res && res.__requestId && !res.headersSent) {
    res.setHeader("X-Request-Id", res.__requestId);
  }
  // Set end-to-end latency header automatically when attachRequestId() was
  // called. Covers rate-limit + body read + AI chain + validation +
  // serialize — the full server-side time for this request. Best-effort:
  // missing __requestStartedAt just skips the header (the absence tells
  // ops "this handler didn't use attachRequestId, fix it").
  if (res && typeof res.__requestStartedAt === "number" && !res.headersSent) {
    const elapsed = Date.now() - res.__requestStartedAt;
    if (Number.isFinite(elapsed) && elapsed >= 0 && elapsed <= 600000) {
      res.setHeader("X-Request-Latency-Total-Ms", String(Math.round(elapsed)));
    }
  }
  res.end(JSON.stringify(body));
}

function asString(value, max) {
  return typeof value === "string" ? value.slice(0, max).trim() : "";
}

/* Request-id helpers — propagate a per-request UUID for log correlation.
 *
 * Usage:
 *   const requestId = generateRequestId();
 *   attachRequestId(res, requestId);
 *   // ... any subsequent json(res, ...) call will set X-Request-Id.
 *
 * If the client sent an X-Request-Id header (e.g. from an upstream load
 * balancer or test harness), we honor it; otherwise we mint a fresh UUID v4.
 * Header is capped at 128 chars and stripped of anything but ASCII to
 * avoid header-injection / log-injection through crafted upstream IDs.
 */
const VALID_REQ_ID = /^[A-Za-z0-9._-]+$/;

function generateRequestId() {
  // Node 14.17+ has globalThis.crypto.randomUUID; Vercel's Node 22 runtime
  // is well past that. Fall back to a timestamp-based ID if the runtime
  // somehow lacks the Web Crypto API.
  try {
    if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
      return crypto.randomUUID();
    }
  } catch (_) { /* fall through */ }
  return `req-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function sanitizeIncomingRequestId(raw) {
  if (typeof raw !== "string" || raw.length === 0) return null;
  const trimmed = raw.slice(0, 128);
  return VALID_REQ_ID.test(trimmed) ? trimmed : null;
}

function attachRequestId(res, req) {
  // Prefer an upstream-supplied ID (from headers), fall back to a fresh one.
  const incoming = req && req.headers && req.headers["x-request-id"];
  const id = sanitizeIncomingRequestId(incoming) || generateRequestId();
  if (res) res.__requestId = id;
  // Pin the request start time so json() can emit X-Request-Latency-Total-Ms.
  // Single source of truth: every handler already calls attachRequestId()
  // as the very first step, so this captures end-to-end server time
  // (rate-limit + body read + AI call + validation + serialize).
  if (res) res.__requestStartedAt = Date.now();
  return id;
}

/* ── AI provider reachability probe (used by /api/health) ────────────
 *
 * Probes the host of an AI provider with a short-timeout HEAD request.
 * We intentionally don't hit the model's generate endpoint (would burn
 * quota) or pass auth headers (proves network reachability, not auth).
 * Result is cached for 60s so polling doesn't translate to 60 outbound
 * requests/min when monitoring scrapes the endpoint.
 *
 * Returns:
 *   { ok: true,  status, latencyMs, checkedAt }
 *   { ok: false, error, latencyMs,  checkedAt }
 */

const _probeCache = new Map();
const _PROBE_TTL_MS = 60_000;
const _PROBE_TIMEOUT_MS = 3000;
const _PROBE_CACHE_MAX = 100; // hard cap; oldest entry evicted on overflow

function _probeCacheTouch(key, value) {
  // LRU touch: delete + re-set to move the key to the end of iteration order.
  // Keeps the cache bounded at _PROBE_CACHE_MAX by evicting the oldest
  // entry when overflow would occur.
  if (_probeCache.has(key)) _probeCache.delete(key);
  _probeCache.set(key, value);
  while (_probeCache.size > _PROBE_CACHE_MAX) {
    const oldest = _probeCache.keys().next().value;
    if (oldest === undefined) break;
    _probeCache.delete(oldest);
  }
}

async function probeProvider(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), _PROBE_TIMEOUT_MS);
  const start = Date.now();
  try {
    const res = await fetch(url, { method: "HEAD", signal: controller.signal });
    return {
      ok: res.status < 500,
      status: res.status,
      latencyMs: Date.now() - start,
      checkedAt: Date.now(),
    };
  } catch (err) {
    return {
      ok: false,
      error: err && err.name === "AbortError" ? "timeout" : (err && err.message) || "unknown",
      latencyMs: Date.now() - start,
      checkedAt: Date.now(),
    };
  } finally {
    clearTimeout(timer);
  }
}

async function probeProviderCached(key, url) {
  const now = Date.now();
  const cached = _probeCache.get(key);
  if (cached && now - cached.checkedAt < _PROBE_TTL_MS) {
    // Touch on hit so the entry stays "fresh" in LRU terms.
    _probeCacheTouch(key, cached);
    return Object.assign({}, cached, { cached: true });
  }
  const fresh = await probeProvider(url);
  _probeCacheTouch(key, fresh);
  return Object.assign({}, fresh, { cached: false });
}

function clearProbeCache() {
  _probeCache.clear();
}

/* ── errLog: tagged error logging with the active X-Request-Id ─────────
 *
 * Every console.error call inside the request handlers should route through
 * this helper so the request id (set via attachRequestId()) is prepended to
 * the log line. Ops can then grep server logs by id when a user reports
 * an error. Falls back to a plain console.error if `res` is missing or
 * hasn't had attachRequestId() called on it yet.
 */
function errLog(res, prefix, err) {
  const id = (res && res.__requestId) || "no-req-id";
  const msg = err && err.message ? err.message : String(err);
  console.error(`[req=${id}] [${prefix}] ${sanitizeLogField(msg, 1000)}`);
}

/* ── accessLog: structured per-request completion log ─────────────────
 *
 * Companion to errLog. Emits one structured line per handled request:
 *
 *   [req=<id>] METHOD /path -> status Nms
 *
 * Call this at the END of every handler (success OR error path) so each
 * request has exactly one access-log line. Falls back gracefully when
 * req or res is missing.
 */
function accessLog(req, res, status) {
  const id = (res && res.__requestId) || "no-req-id";
  const method = sanitizeLogField((req && req.method) || "?", 16);
  const url = sanitizeLogField((req && req.url) || "?", 512);
  const statusCode = status || (res && res.statusCode) || 0;
  console.log(`[req=${id}] ${method} ${url} -> ${statusCode}`);
}

/* Strip ASCII control characters (incl. CR/LF/tab) and cap length.
 * Used by errLog + accessLog before writing to console.* — without this,
 * a crafted request URL or a downstream-library error message containing
 * \n or \r could inject fake log lines into the stream (and break log
 * shippers that split on newline). Replaces control chars with a single
 * space so the remaining log line stays on its own row. Truncation is
 * append-marked with "…" so ops can spot the cut.
 */
function sanitizeLogField(value, maxLen) {
  let s = typeof value === "string" ? value : String(value == null ? "" : value);
  // Strip ASCII control chars (0x00-0x1F) and DEL (0x7F). Replace each
  // with a space so surrounding tokens don't merge.
  s = s.replace(/[\x00-\x1F\x7F]/g, " ");
  if (typeof maxLen === "number" && maxLen > 0 && s.length > maxLen) {
    s = s.slice(0, Math.max(1, maxLen - 1)) + "…";
  }
  return s;
}

function getIp(req) {
  if (!req || !req.headers) return "unknown";
  const xff = req.headers["x-forwarded-for"];
  if (typeof xff === "string" && xff.length) {
    return xff.split(",")[0].trim();
  }
  if (Array.isArray(xff) && xff.length) {
    return String(xff[0]).trim();
  }
  const real = req.headers["x-real-ip"];
  if (typeof real === "string" && real.length) return real.trim();
  if (req.socket && req.socket.remoteAddress) return req.socket.remoteAddress;
  return "unknown";
}

/* Per-IP sliding-window rate limit. In-memory; resets when the function
 * instance is recycled (typical on serverless). Returns:
 *   { ok: true,  limit, remaining, reset }                          — allowed
 *   { ok: false, retryAfter: <seconds>, limit, remaining: 0, reset }  — rejected
 *
 * `limit`     = maxPerMinute (echoed for client-side throttling)
 * `remaining` = slots left in the current window after this request
 * `reset`     = UNIX seconds at which the oldest in-window entry expires
 *               (i.e. when at least one slot becomes available again)
 *
 * Use `applyRateLimitHeaders(res, rl)` to emit the standard X-RateLimit-*
 * response headers from the returned object.
 */
const _buckets = new Map();
const _RATE_WINDOW_MS = 60_000;
const _RATE_MAX_KEYS = 5000;
const _RATE_PRUNE_INTERVAL_MS = 30_000;
let _lastPrune = Date.now();

function rateLimit(ip, maxPerMinute) {
  if (!Number.isFinite(maxPerMinute) || maxPerMinute <= 0) {
    return { ok: true, limit: 0, remaining: 0, reset: 0 };
  }
  const now = Date.now();

  // periodic prune of stale entries to bound memory growth
  if (now - _lastPrune > _RATE_PRUNE_INTERVAL_MS) {
    _lastPrune = now;
    for (const [k, arr] of _buckets) {
      while (arr.length && arr[0] < now - _RATE_WINDOW_MS) arr.shift();
      if (arr.length === 0) _buckets.delete(k);
    }
  }

  const key = ip || "unknown";
  const arr = _buckets.get(key) || [];
  while (arr.length && arr[0] < now - _RATE_WINDOW_MS) arr.shift();
  if (arr.length >= maxPerMinute) {
    const resetMs = arr.length ? arr[0] + _RATE_WINDOW_MS : now + _RATE_WINDOW_MS;
    const retryAfter = Math.max(1, Math.ceil((resetMs - now) / 1000));
    return {
      ok: false,
      retryAfter,
      limit: maxPerMinute,
      remaining: 0,
      reset: Math.ceil(resetMs / 1000),
    };
  }
  arr.push(now);
  _buckets.set(key, arr);

  // hard cap on map size
  if (_buckets.size > _RATE_MAX_KEYS) {
    const overflow = _buckets.size - _RATE_MAX_KEYS;
    let removed = 0;
    for (const k of _buckets.keys()) {
      if (removed >= overflow) break;
      _buckets.delete(k);
      removed++;
    }
  }
  const remaining = Math.max(0, maxPerMinute - arr.length);
  const resetMs = arr[0] + _RATE_WINDOW_MS; // oldest entry's expiry
  return {
    ok: true,
    limit: maxPerMinute,
    remaining,
    reset: Math.ceil(resetMs / 1000),
  };
}

/* Emit the standard rate-limit response headers on every response that
 * consulted rateLimit(). Standard names: X-RateLimit-Limit, -Remaining,
 * -Reset (UNIX seconds). Always call BEFORE `json()` — once the body is
 * streamed, headers must already be on the response.
 *
 * Also sets the de-facto `RateLimit` / `RateLimit-Policy` triplet (IETF
 * draft-ietf-httpapi-ratelimit-headers) when the request is rejected.
 */
function applyRateLimitHeaders(res, rl) {
  if (!rl || typeof rl !== "object") return;
  // When the rate limiter is disabled (maxPerMinute <= 0), rateLimit() returns
  // { ok: true, limit: 0, remaining: 0, reset: 0 }. Emitting those as response
  // headers would mislead clients (X-RateLimit-Reset: 0 = 1970-01-01). Omit
  // every rate-limit header instead — the absence tells the client "no
  // limiter is active here" without lying about numbers.
  if (rl.limit <= 0) return;
  if (Number.isFinite(rl.limit)) res.setHeader("X-RateLimit-Limit", String(rl.limit));
  if (Number.isFinite(rl.remaining)) res.setHeader("X-RateLimit-Remaining", String(rl.remaining));
  if (Number.isFinite(rl.reset)) res.setHeader("X-RateLimit-Reset", String(rl.reset));
  if (Number.isFinite(rl.retryAfter)) res.setHeader("Retry-After", String(rl.retryAfter));
}

/* Per-request AI provider observability headers.
 *
 * Sets:
 *   X-AI-Provider         — "openrouter" | "gemini" | "none"
 *   X-AI-Response-Time-Ms — integer milliseconds spent on AI calls (sum of all
 *                            attempted providers in the chain)
 *   X-AI-Model            — (optional) the exact model identifier that
 *                            answered, e.g. "google/gemma-4-31b-it:free" or
 *                            "gemini-2.5-flash"
 *
 * Call this BEFORE `json()` on every response that actually involved an AI
 * call (200 success, 502 invalid_ai_response, 502 both-providers-failed). For
 * 400 / 405 / 413 / 429 / 503 paths where no AI was invoked, skip the helper
 * entirely — the absence of these headers is itself a signal that the request
 * never reached the provider.
 *
 * All fields are best-effort: any non-conforming input is silently ignored
 * so the helper is safe to call unconditionally. No throw on bad input.
 *
 * Backward compatible: the existing 2-arg call site (res, provider, latencyMs)
 * works without modification. Pass a model string as the 4th argument to
 * also emit X-AI-Model.
 */
function applyAiResponseHeaders(res, provider, latencyMs, model) {
  if (!res || typeof res.setHeader !== "function" || res.headersSent) return;
  if (typeof provider === "string" && provider.length > 0 && provider.length < 64) {
    // Allowlist of provider strings — keeps the header value honest even
    // if a future caller passes something weird from the request body.
    if (provider === "openrouter" || provider === "gemini" || provider === "none") {
      res.setHeader("X-AI-Provider", provider);
    }
  }
  if (Number.isFinite(latencyMs) && latencyMs >= 0 && latencyMs <= 600000) {
    res.setHeader("X-AI-Response-Time-Ms", String(Math.round(latencyMs)));
  }
  if (typeof model === "string" && model.length > 0 && model.length <= 128) {
    // Length cap + ASCII charset check defends against header-injection via
    // a model string the caller passed through unsanitized input.
    if (/^[A-Za-z0-9._:/+-]+$/.test(model)) {
      res.setHeader("X-AI-Model", model);
    }
  }
}

/* Stream-read the body with a hard byte cap. Vercel silently truncates
 * at 4.5MB; we reject earlier to bound CPU/memory and to keep error
 * semantics tight. Returns:
 *   { raw: "<utf8 string>" }                    — success
 *   { error: { status: 413, message: "..." } }  — body too large
 *   { error: { status: 400, message: "..." } }  — JSON parse failure
 */
async function readCappedBody(req, maxBytes) {
  const cap = Number.isFinite(maxBytes) && maxBytes > 0 ? maxBytes : 256 * 1024;

  // Early reject via Content-Length when present
  const clHeader = req.headers && (req.headers["content-length"] || req.headers["Content-Length"]);
  const cl = parseInt(Array.isArray(clHeader) ? clHeader[0] : clHeader, 10);
  if (Number.isFinite(cl) && cl > cap) {
    return { error: { status: 413, message: `Request body too large (max ${cap} bytes).` } };
  }

  // Stream-read and cap manually
  const chunks = [];
  let total = 0;
  try {
    for await (const chunk of req) {
      total += chunk.length;
      if (total > cap) {
        // drain to avoid backpressure on the underlying socket
        req.resume && req.resume();
        return { error: { status: 413, message: `Request body too large (max ${cap} bytes).` } };
      }
      chunks.push(chunk);
    }
  } catch (_) {
    return { error: { status: 400, message: "Could not read request body." } };
  }
  const raw = Buffer.concat(chunks).toString("utf8");
  return { raw };
}

/* ── Analysis schema validation (STRICT RULE: fail-closed) ─────────────
 *
 * ClearDoc's RULES.md mandates "Strict zod validation (fail-closed)" for AI
 * responses: partial legal data is more dangerous than no data. We never
 * silently coerce out-of-enum values or fill in defaults — if the AI returns
 * a malformed payload (wrong type, unknown enum value, missing required
 * field, overflow) the handler returns 502 with reason='invalid_ai_response'
 * rather than shipping a degraded shape to the user.
 *
 * ANALYSIS_LIMITS encodes every cap that was previously sprinkled across
 * api/analyze.js. Single source of truth: change a cap here and the
 * validator and tests stay in sync.
 */

const ANALYSIS_LIMITS = Object.freeze({
  plainEnglishRewrite: 20000,
  risks: 20,
  riskClause: 300,
  riskExplanation: 500,
  riskImpact: 500,
  verdictLabel: 50,
  verdictSummary: 500,
  deadlines: 10,
  deadlineDate: 100,
  deadlineDescription: 200,
  nextSteps: 8,
  nextStepItem: 300,
  readingLevelMin: 1,
  readingLevelMax: 20,
  jargonFoundMin: 0,
  jargonFoundMax: 200,
});

const VALID_SEVERITIES = Object.freeze(["trap", "watch", "note"]);
const VALID_VERDICT_LABELS = Object.freeze([
  "Likely Fair",
  "Needs Review",
  "Suspicious",
  "Likely Illegal",
]);

function validSeverity(s) {
  return VALID_SEVERITIES.includes(s) ? s : null;
}

function validVerdictLabel(s) {
  return VALID_VERDICT_LABELS.includes(s) ? s : null;
}

function clampInt(n, min, max) {
  // Strict: reject non-finite values and non-integer numerics (do NOT
  // truncate). STRICT RULE: never add tolerance for malformed fields —
  // `5.7` is a schema error, not a quietly rounded `5`.
  if (!Number.isFinite(n) || !Number.isInteger(n)) return null;
  if (n < min || n > max) return null;
  return n;
}

/* Parse and validate an AI-produced analysis object.
 *
 * Returns:
 *   { ok: true, value }    — `value` is the cleaned object with caps applied
 *   { ok: false, errors }  — `errors` is an array of human-readable reasons
 *
 * Strict: missing fields, wrong types, or out-of-enum values all fail. We do
 * NOT silently coerce. Callers must treat !ok as a production error.
 */
function safeParseAnalysisResult(obj) {
  const errors = [];
  if (obj === null || typeof obj !== "object" || Array.isArray(obj)) {
    return { ok: false, errors: ["top-level must be an object"] };
  }

  // ── plainEnglishRewrite ──
  const per = obj.plainEnglishRewrite;
  if (typeof per !== "string") {
    errors.push("plainEnglishRewrite: must be a string");
  }

  // ── risks ──
  let risks;
  if (!Array.isArray(obj.risks)) {
    errors.push("risks: must be an array");
    risks = [];
  } else if (obj.risks.length > ANALYSIS_LIMITS.risks) {
    errors.push(`risks: at most ${ANALYSIS_LIMITS.risks} entries`);
    risks = [];
  } else {
    const cleaned = [];
    obj.risks.forEach((r, i) => {
      if (r === null || typeof r !== "object" || Array.isArray(r)) {
        errors.push(`risks[${i}]: must be an object`);
        return;
      }
      const sev = validSeverity(r.severity);
      if (sev === null) {
        errors.push(`risks[${i}].severity: must be one of ${VALID_SEVERITIES.join("/")}`);
        return;
      }
      if (typeof r.clause !== "string") {
        errors.push(`risks[${i}].clause: must be a string`);
        return;
      }
      if (typeof r.explanation !== "string") {
        errors.push(`risks[${i}].explanation: must be a string`);
        return;
      }
      if (typeof r.impact !== "string") {
        errors.push(`risks[${i}].impact: must be a string`);
        return;
      }
      cleaned.push({
        severity: sev,
        clause: r.clause.slice(0, ANALYSIS_LIMITS.riskClause),
        explanation: r.explanation.slice(0, ANALYSIS_LIMITS.riskExplanation),
        impact: r.impact.slice(0, ANALYSIS_LIMITS.riskImpact),
      });
    });
    risks = cleaned;
  }

  // ── verdict ──
  let verdictLabel = "";
  let verdictSummary = "";
  if (obj.verdict === null || typeof obj.verdict !== "object" || Array.isArray(obj.verdict)) {
    errors.push("verdict: must be an object");
  } else {
    const label = validVerdictLabel(obj.verdict.label);
    if (label === null) {
      errors.push(`verdict.label: must be one of ${VALID_VERDICT_LABELS.join(" | ")}`);
    } else {
      verdictLabel = label;
    }
    if (typeof obj.verdict.summary !== "string") {
      errors.push("verdict.summary: must be a string");
    } else {
      verdictSummary = obj.verdict.summary.slice(0, ANALYSIS_LIMITS.verdictSummary);
    }
  }

  // ── deadlines ──
  let deadlines;
  if (!Array.isArray(obj.deadlines)) {
    errors.push("deadlines: must be an array");
    deadlines = [];
  } else if (obj.deadlines.length > ANALYSIS_LIMITS.deadlines) {
    errors.push(`deadlines: at most ${ANALYSIS_LIMITS.deadlines} entries`);
    deadlines = [];
  } else {
    const cleaned = [];
    obj.deadlines.forEach((d, i) => {
      if (d === null || typeof d !== "object" || Array.isArray(d)) {
        errors.push(`deadlines[${i}]: must be an object`);
        return;
      }
      if (typeof d.date !== "string") {
        errors.push(`deadlines[${i}].date: must be a string`);
        return;
      }
      if (typeof d.description !== "string") {
        errors.push(`deadlines[${i}].description: must be a string`);
        return;
      }
      cleaned.push({
        date: d.date.slice(0, ANALYSIS_LIMITS.deadlineDate),
        description: d.description.slice(0, ANALYSIS_LIMITS.deadlineDescription),
      });
    });
    deadlines = cleaned;
  }

  // ── nextSteps ──
  let nextSteps;
  if (!Array.isArray(obj.nextSteps)) {
    errors.push("nextSteps: must be an array");
    nextSteps = [];
  } else if (obj.nextSteps.length > ANALYSIS_LIMITS.nextSteps) {
    errors.push(`nextSteps: at most ${ANALYSIS_LIMITS.nextSteps} entries`);
    nextSteps = [];
  } else {
    const cleaned = [];
    obj.nextSteps.forEach((s, i) => {
      if (typeof s !== "string") {
        errors.push(`nextSteps[${i}]: must be a string`);
        return;
      }
      cleaned.push(s.slice(0, ANALYSIS_LIMITS.nextStepItem));
    });
    nextSteps = cleaned;
  }

  // ── readingLevel ──
  let readingBefore = ANALYSIS_LIMITS.readingLevelMin;
  let readingAfter = ANALYSIS_LIMITS.readingLevelMin;
  if (obj.readingLevel === null || typeof obj.readingLevel !== "object" || Array.isArray(obj.readingLevel)) {
    errors.push("readingLevel: must be an object");
  } else {
    const b = clampInt(obj.readingLevel.before, ANALYSIS_LIMITS.readingLevelMin, ANALYSIS_LIMITS.readingLevelMax);
    const a = clampInt(obj.readingLevel.after, ANALYSIS_LIMITS.readingLevelMin, ANALYSIS_LIMITS.readingLevelMax);
    if (b === null) errors.push(`readingLevel.before: must be int ${ANALYSIS_LIMITS.readingLevelMin}..${ANALYSIS_LIMITS.readingLevelMax}`);
    else readingBefore = b;
    if (a === null) errors.push(`readingLevel.after: must be int ${ANALYSIS_LIMITS.readingLevelMin}..${ANALYSIS_LIMITS.readingLevelMax}`);
    else readingAfter = a;
  }

  // ── jargonFound ──
  let jargonFound = 0;
  const j = clampInt(obj.jargonFound, ANALYSIS_LIMITS.jargonFoundMin, ANALYSIS_LIMITS.jargonFoundMax);
  if (j === null) errors.push(`jargonFound: must be int ${ANALYSIS_LIMITS.jargonFoundMin}..${ANALYSIS_LIMITS.jargonFoundMax}`);
  else jargonFound = j;

  if (errors.length > 0) return { ok: false, errors };

  return {
    ok: true,
    value: {
      plainEnglishRewrite: per.slice(0, ANALYSIS_LIMITS.plainEnglishRewrite),
      risks,
      verdict: { label: verdictLabel, summary: verdictSummary },
      deadlines,
      nextSteps,
      readingLevel: { before: readingBefore, after: readingAfter },
      jargonFound,
    },
  };
}

/* ── Chat schema validation (STRICT RULE: fail-closed) ────────────────
 *
 * The /api/chat handler returns { answer, citation, model }. The shape is
 * simpler than /api/analyze but the same RULES.md #3 principle applies: any
 * malformed field (wrong type, missing, overflow) fails the whole response
 * rather than shipping a degraded shape to the user.
 *
 * The frontend already escapes AI text via esc() before innerHTML insertion
 * (assets/app.js), so XSS is defended at the render layer. The validator
 * here catches structural / length regressions at the API edge.
 *
 * Gemini is configured with maxOutputTokens: 700 in api/chat.js. Real
 * output is typically 1–3KB of plain text; the 8000-char cap is generous
 * with headroom for future model bumps while still rejecting pathological
 * megabyte payloads from a misconfigured provider.
 */

const CHAT_LIMITS = Object.freeze({
  answerMin: 1,
  answerMax: 8000,
  modelMax: 100,
  citationMax: 200,
});

function safeParseChatResult(obj) {
  const errors = [];
  if (obj === null || typeof obj !== "object" || Array.isArray(obj)) {
    return { ok: false, errors: ["top-level must be an object"] };
  }

  // answer — required, non-empty string, capped at CHAT_LIMITS.answerMax
  let answer = "";
  if (typeof obj.answer !== "string") {
    errors.push("answer: must be a string");
  } else {
    const trimmed = obj.answer.trim();
    if (trimmed.length < CHAT_LIMITS.answerMin) {
      errors.push("answer: must not be empty");
    } else {
      answer = obj.answer.slice(0, CHAT_LIMITS.answerMax);
    }
  }

  // model — required, non-empty string, capped at CHAT_LIMITS.modelMax
  let model = "";
  if (typeof obj.model !== "string") {
    errors.push("model: must be a string");
  } else {
    const trimmed = obj.model.trim();
    if (trimmed.length < 1) {
      errors.push("model: must not be empty");
    } else {
      model = obj.model.slice(0, CHAT_LIMITS.modelMax);
    }
  }

  // citation — required, non-empty string, capped at CHAT_LIMITS.citationMax
  let citation = "";
  if (typeof obj.citation !== "string") {
    errors.push("citation: must be a string");
  } else {
    const trimmed = obj.citation.trim();
    if (trimmed.length < 1) {
      errors.push("citation: must not be empty");
    } else {
      citation = obj.citation.slice(0, CHAT_LIMITS.citationMax);
    }
  }

  if (errors.length > 0) return { ok: false, errors };

  return {
    ok: true,
    value: {
      answer,
      model,
      citation,
    },
  };
}

module.exports = {
  json,
  asString,
  getIp,
  rateLimit,
  applyRateLimitHeaders,
  applyAiResponseHeaders,
  readCappedBody,
  generateRequestId,
  sanitizeIncomingRequestId,
  attachRequestId,
  probeProvider,
  probeProviderCached,
  clearProbeCache,
  errLog,
  accessLog,
  sanitizeLogField,
  ANALYSIS_LIMITS,
  VALID_SEVERITIES,
  VALID_VERDICT_LABELS,
  validSeverity,
  validVerdictLabel,
  safeParseAnalysisResult,
  CHAT_LIMITS,
  safeParseChatResult,
};
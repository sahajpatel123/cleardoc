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
 */

function json(res, status, body) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json");
  res.setHeader("Cache-Control", "no-store");
  res.end(JSON.stringify(body));
}

function asString(value, max) {
  return typeof value === "string" ? value.slice(0, max).trim() : "";
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
 *   { ok: true }                          — allowed
 *   { ok: false, retryAfter: <seconds> }  — rejected; include Retry-After
 */
const _buckets = new Map();
const _RATE_WINDOW_MS = 60_000;
const _RATE_MAX_KEYS = 5000;
const _RATE_PRUNE_INTERVAL_MS = 30_000;
let _lastPrune = Date.now();

function rateLimit(ip, maxPerMinute) {
  if (!Number.isFinite(maxPerMinute) || maxPerMinute <= 0) return { ok: true };
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
    const retryAfter = Math.max(1, Math.ceil((arr[0] + _RATE_WINDOW_MS - now) / 1000));
    return { ok: false, retryAfter };
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
  return { ok: true };
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

module.exports = {
  json,
  asString,
  getIp,
  rateLimit,
  readCappedBody,
  ANALYSIS_LIMITS,
  VALID_SEVERITIES,
  VALID_VERDICT_LABELS,
  validSeverity,
  validVerdictLabel,
  safeParseAnalysisResult,
};
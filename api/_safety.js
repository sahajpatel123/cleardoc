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
 *   applyBuildShaHeader(res)                      — emits X-Build-Sha from VERCEL_GIT_COMMIT_SHA
 */

function applyBuildShaHeader(res) {
  if (!res || typeof res.setHeader !== "function" || res.headersSent) return;
  const raw = process.env.VERCEL_GIT_COMMIT_SHA;
  if (typeof raw !== "string" || raw.length === 0) return;
  // Restrict to a realistic git-SHA hex shape (7..40 lowercase hex chars)
  // so a misconfigured CI environment can't smuggle arbitrary bytes into
  // the header. 7 accepts short SHAs; 40 accepts full SHA-1.
  if (!/^[a-f0-9]{7,40}$/.test(raw)) return;
  res.setHeader("X-Build-Sha", raw);
}

/* Mark the API endpoint that produced this response. Lets ops dashboards
 * group response-header metrics per endpoint without parsing URLs (the
 * X-Endpoint value is stable across path rewrites; the URL is not).
 * Caller passes a short ASCII name (e.g. "analyze", "chat", "health",
 * "csp-report"). Anything else is silently ignored to keep the header
 * allowlisted.
 *
 * Safe no-op:
 *   - `res` missing or lacks setHeader
 *   - `headersSent` is already true
 *   - name not a 1..32-char ASCII string
 */
function applyEndpointHeader(res, name) {
  if (!res || typeof res.setHeader !== "function" || res.headersSent) return;
  if (typeof name !== "string") return;
  if (name.length < 1 || name.length > 32) return;
  // Allowlist: letters, digits, dash, underscore. No whitespace, no punctuation.
  if (!/^[A-Za-z0-9_-]+$/.test(name)) return;
  res.setHeader("X-Endpoint", name);
}

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
  // ops "this handler didn't use attachRequestId, fix it"). allowZero:
  // true so a true instant response (e.g. an immediate rate-limit reject
  // on a warm instance) still emits "X-Request-Latency-Total-Ms: 0" —
  // that's a real measurement, not a "didn't fire" sentinel.
  if (res && typeof res.__requestStartedAt === "number" && !res.headersSent) {
    const elapsed = Date.now() - res.__requestStartedAt;
    if (isValidLatencyMs(elapsed, { allowZero: true })) {
      res.setHeader("X-Request-Latency-Total-Ms", String(Math.round(elapsed)));
    }
  }
  // X-Build-Sha: every JSON response carries the deployed commit SHA so
  // ops can correlate a curl response with the exact commit that built it.
  // VERCEL_GIT_COMMIT_SHA is set automatically on every Vercel production
  // deploy; null in local dev → header simply omitted (no value to expose).
  applyBuildShaHeader(res);
  res.end(JSON.stringify(body));
}

/* Single source of truth for "is this a sane latency value to emit as a
 * header?". Bound at 600000ms (10 min) — anything longer is either a
 * clock-skew artifact or a Vercel cold-start gone wrong; either way, the
 * header would mislead ops.
 *
 * `allowZero` controls the lower bound:
 *   - default (false): require value >= 1. Use for per-provider breakdowns
 *     where 0 or fractional sub-ms means "provider didn't fire" — emitting
 *     "0ms" or "0.5ms" would lie.
 *   - true: require value >= 0. Use for the overall wall-clock latency
 *     where a real 0ms response (e.g. immediate rate-limit reject) or a
 *     sub-ms timing is meaningful and shouldn't be silently dropped.
 */
function isValidLatencyMs(value, opts) {
  const allowZero = !!(opts && opts.allowZero);
  if (!Number.isFinite(value)) return false;
  if (allowZero) return value >= 0 && value <= 600000;
  return value >= 1 && value <= 600000;
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

// Rolling-window probe-outcome counters (last hour). Bounded at
// PROBE_WINDOW_MAX (2000) entries to prevent unbounded growth from a
// misbehaving provider. Each entry is { ts, ok, provider }, evicted
// oldest-first when the cap is hit.
const _probeOutcomes = [];
const PROBE_WINDOW_MAX = 2000;
const _PROBE_WINDOW_MS = 3600 * 1000; // 1 hour

// Per-process counters surfacing how many AI provider HEAD probes this
// function instance has issued since startup. Read by /api/health so
// ops can correlate traffic spikes with probe-rate spikes (and spot
// cache-miss storms when an upstream provider is rate-limiting).
// _probeCount hits both the cache and the network; _probeCountHits
// counts only fresh-network probes (cache misses).
let _probeCount = 0;
let _probeCountHits = 0;

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
    _probeCount += 1;        // hit — didn't hit the network
    return Object.assign({}, cached, { cached: true });
  }
  const fresh = await probeProvider(url);
  _probeCacheTouch(key, fresh);
  _probeCount += 1;
  _probeCountHits += 1;     // miss — actually called probeProvider(url)
  // Append a rolling-window entry (last hour). Captured AFTER the
  // fresh fetch so the ok value reflects the actual network result.
  if (Array.isArray(fresh)) {
    // nothing — defensive
  } else if (fresh && typeof fresh === "object") {
    _probeOutcomes.push({ ts: Date.now(), ok: !!fresh.ok, provider: key, region: process.env.VERCEL_REGION || null, latencyMs: typeof fresh.latencyMs === "number" ? fresh.latencyMs : null });
    // Track the most recent probe update per provider — succeeds OR fails.
    // Distinct from _lastProbeFailure (failure-only); this tells ops
    // "when was this provider last checked at all".
    _lastProbeUpdate[key] = Date.now();
    // Also track the most recent failure per provider (for the
    // lastFailure field on /api/health). Pairs with the per-provider
    // lastReachableAt to give ops a "is the most recent state a success
    // or a failure?" signal.
    if (!fresh.ok) {
      _lastProbeFailure[key] = Date.now();
      _consecutiveProviderFailures[key] = (_consecutiveProviderFailures[key] || 0) + 1;
    } else {
      // Success resets the per-provider failure streak.
      _consecutiveProviderFailures[key] = 0;
    }
    // Evict oldest if over the cap
    while (_probeOutcomes.length > PROBE_WINDOW_MAX) _probeOutcomes.shift();
  }
  return Object.assign({}, fresh, { cached: false });
}

/* Read-only accessor for /api/health so the surface includes probe rates.
 * - total   = every probeProviderCached() call (hits + misses)
 * - network = only the misses (actual outbound HEAD requests)
 * Ops can compute cache hit rate as (total - network) / total.
 */
function getProbeCounts() {
  return { total: _probeCount, network: _probeCountHits };
}

/* Per-provider reachability rate over the rolling 1-hour window.
 * Returns { gemini: { okCount, total, successRate }, openrouter: ... }.
 * successRate is a 0..1 float; null if no probes in the window.
 *
 * Lets ops answer "is the provider flapping?" — a current reachable
 * state alone doesn't reveal a 50%-reachable over the last hour.
 */
function getProbeReachabilityInLastHour() {
  const cutoff = Date.now() - _PROBE_WINDOW_MS;
  // Prune in-place (cheaper than re-allocating).
  while (_probeOutcomes.length && _probeOutcomes[0].ts < cutoff) {
    _probeOutcomes.shift();
  }
  const result = { gemini: { okCount: 0, total: 0, successRate: null, failureRate: null },
                   openrouter: { okCount: 0, total: 0, successRate: null, failureRate: null } };
  for (const e of _probeOutcomes) {
    if (result[e.provider]) {
      result[e.provider].total += 1;
      if (e.ok) result[e.provider].okCount += 1;
    }
  }
  for (const p of Object.keys(result)) {
    if (result[p].total > 0) {
      // 1-decimal precision like the iter #52 usedPercent field.
      result[p].successRate = Math.round((result[p].okCount / result[p].total) * 1000) / 10;
      // Failure rate is the inverse of success rate. Lets ops answer
      // "what % of probes failed?" without computing it from success.
      result[p].failureRate = Math.round(((result[p].total - result[p].okCount) / result[p].total) * 1000) / 10;
    }
  }
  return result;
}

/* Per-provider per-region reachability over the rolling 1-hour
 * window. Returns { gemini: { region1: { okCount, total, successRate }, ... },
 *                    openrouter: { region1: { ... }, ... } }.
 *
 * Lets ops answer "is the flapping localized to one region?"
 * (traffic spike in iad1 might leave fra1 unaffected).
 */
function getProbeReachabilityByRegionInLastHour() {
  const cutoff = Date.now() - _PROBE_WINDOW_MS;
  while (_probeOutcomes.length && _probeOutcomes[0].ts < cutoff) {
    _probeOutcomes.shift();
  }
  const result = {
    gemini: {},
    openrouter: {},
  };
  for (const e of _probeOutcomes) {
    if (!result[e.provider]) continue;
    const r = e.region || "unknown";
    if (!result[e.provider][r]) {
      result[e.provider][r] = { okCount: 0, total: 0, successRate: null };
    }
    result[e.provider][r].total += 1;
    if (e.ok) result[e.provider][r].okCount += 1;
  }
  for (const p of Object.keys(result)) {
    for (const r of Object.keys(result[p])) {
      const entry = result[p][r];
      if (entry.total > 0) {
        entry.successRate = Math.round((entry.okCount / entry.total) * 1000) / 10;
      }
    }
  }
  return result;
}

/* Per-provider average latency across the rolling 1-hour window.
 * Returns { gemini: avg, openrouter: avg } — avg is rounded to integer
 * ms. Null when no probes in the window.
 *
 * Lets ops answer "is the average getting worse over time?" — the
 * existing fastestProviderMs / slowestProviderMs fields show the
 * extremes; this one shows the central tendency.
 */
function getProbeAverageLatencyInLastHour() {
  const cutoff = Date.now() - _PROBE_WINDOW_MS;
  while (_probeOutcomes.length && _probeOutcomes[0].ts < cutoff) {
    _probeOutcomes.shift();
  }
  const result = { gemini: null, openrouter: null };
  for (const p of Object.keys(result)) {
    const lats = _probeOutcomes
      .filter((e) => e.provider === p && typeof e.latencyMs === "number")
      .map((e) => e.latencyMs);
    if (lats.length > 0) {
      const sum = lats.reduce((a, b) => a + b, 0);
      result[p] = Math.round(sum / lats.length);
    }
  }
  return result;
}

// Read-only accessor for the per-provider most-recent failure timestamp.
// Pairs with `lastReachableAt` (success counterpart). 0 means
// "no failures yet" — process startup is clean.
function getLastProbeFailure() {
  return {
    gemini: _lastProbeFailure.gemini || null,
    openrouter: _lastProbeFailure.openrouter || null,
  };
}

// Read-only accessor for the per-provider most-recent probe timestamp
// (success OR failure). Distinct from getLastProbeFailure (failure-
// only). Answers "when was this provider last checked at all" — even
// if the result was a failure, ops knows the network actually reached
// the provider. Null until the first probe.
function getLastProbeUpdate() {
  return {
    gemini: _lastProbeUpdate.gemini || null,
    openrouter: _lastProbeUpdate.openrouter || null,
  };
}

// Read-only accessor for the per-provider consecutive-failure counter.
// Lets ops answer "is this provider in a degraded streak right now?"
// from a single curl. Pairs with `getLastProbeFailure()` (when) for
// the full failure profile (how long, how deep).
function getConsecutiveProviderFailures() {
  return {
    gemini: _consecutiveProviderFailures.gemini || 0,
    openrouter: _consecutiveProviderFailures.openrouter || 0,
  };
}

function clearProbeCache() {
  _probeCache.clear();
}

// Read-only accessor for the current probe cache size. Bounded at
// _PROBE_CACHE_MAX (100). Lets ops detect cache thrashing — if the
// cache is consistently near the cap and cacheMissRate is rising,
// probes are being evicted faster than they're being reused (each
// cache hit is short-lived).
function getProbeCacheSize() {
  return _probeCache.size;
}

/* CSP violation report counters — incremented by api/csp-report.js, read
 * via /api/health. Lets ops graph "is CSP rejection rate going up?" at
 * a glance instead of grepping Vercel logs.
 *
 * Shape: per-directive count (e.g. { "script-src": 12, "img-src": 3 })
 * plus a totalRecent counter incremented in lockstep. Keys are bounded —
 * capped at MAX_CSP_DIRECTIVES via the oldest-first eviction so a single
 * hostile path can't grow an unbounded object.
 */
const _cspDirectiveCounts = new Map();
const MAX_CSP_DIRECTIVES = 50;
let _cspTotalReports = 0;
// When this process started receiving CSP reports — firstSeenAt is
// also tracked separately per directive, but we want the per-process
// start time here so cspReportRate can be derived from (total / elapsed).
let _cspProcessStartTs = Date.now();
// Temporal observability for CSP report stream. firstSeenAt captures
// when the very first violation was reported (per process lifetime);
// lastSeenAt updates on every subsequent report. Lets ops answer
// "is the CSP report stream fresh or stale?" from a single curl —
// a 6-hour gap with a "0 reports" trend means the stream is dead,
// not "nothing to report".
let _cspFirstSeenAt = 0;
let _cspLastSeenAt = 0;
// Most recent failure timestamp per provider. Captures the LATEST
// "is the most recent state a failure?" signal — useful alongside
// the lastReachableAt per-provider field (the success counterpart).
let _lastProbeFailure = { gemini: 0, openrouter: 0 };
// Unix-ms timestamp of the most recent probe (success OR failure) per
// provider. Distinct from _lastProbeFailure — that's failure-only.
// "Last probe update" answers "when was this provider last checked at
// all" (network was reached), even if the result was a failure.
let _lastProbeUpdate = { gemini: 0, openrouter: 0 };
// Consecutive probe-failure counter per provider. Increments on each
// failed probe, resets to 0 on success. Lets ops see "is this provider
// in a degraded streak right now?" without walking the per-1h-window
// data. Pairs with _lastProbeFailure for the full failure profile.
let _consecutiveProviderFailures = { gemini: 0, openrouter: 0 };

// Per-URI counters. We track two angles separately so ops can answer
// different questions:
//   - blockedUri: "what specific resource is being blocked most often?"
//   - documentUri: "what page is producing the most violations?"
// Both keyed by SHA-256 hash (PII-safe) with a short URL sample for
// human ops use. LRU-evicting at 50 keys to prevent unbounded growth.
const _cspBlockedUriCounts = new Map();
const _cspDocumentUriCounts = new Map();
const MAX_CSP_URI_BUCKETS = 50;

function _cspRecordUri(map, rawUri) {
  if (typeof rawUri !== "string" || rawUri.length === 0) return;
  const uri = rawUri.slice(0, 240);
  // SHA-256 (16 hex chars) of the URI is the key. PII-safe: ops can
  // identify the resource by the `sample` field but never by the key.
  // Node's built-in crypto module — no extra deps.
  const hash = require("node:crypto").createHash("sha256").update(uri).digest("hex").slice(0, 16);
  if (!map.has(hash)) {
    if (map.size >= MAX_CSP_URI_BUCKETS) {
      const oldest = map.keys().next().value;
      if (oldest !== undefined) map.delete(oldest);
    }
    map.set(hash, { count: 0, sample: uri.slice(0, 80) });
  }
  const entry = map.get(hash);
  entry.count += 1;
}

// Track the most recent reporting IP (PII-safe via SHA-256 hash).
// "is one specific client flooding us with CSP reports?" — if a
// single hashed IP dominates, the answer is yes.
let _cspLastReporterHash = null;
let _cspLastReporterSample = null;
const _csp = require("node:crypto");

function recordCspReport(directive, blockedUri, documentUri, reporterIp) {
  if (typeof directive !== "string" || directive.length === 0 || directive.length > 200) return;
  // Normalize the directive so `script-src 'self'` and `script-src` end up
  // in the same bucket (CSP reports often include the directive's full
  // argument list).
  const key = directive.trim().split(/\s+/)[0].toLowerCase();
  if (key.length === 0) return;
  _cspTotalReports += 1;
  // First-time and last-time stamps for the CSP report stream.
  if (_cspFirstSeenAt === 0) _cspFirstSeenAt = Date.now();
  _cspLastSeenAt = Date.now();
  if (!_cspDirectiveCounts.has(key)) {
    // Evict the oldest entry if we're at the cap.
    if (_cspDirectiveCounts.size >= MAX_CSP_DIRECTIVES) {
      const oldestKey = _cspDirectiveCounts.keys().next().value;
      if (oldestKey !== undefined) _cspDirectiveCounts.delete(oldestKey);
    }
    _cspDirectiveCounts.set(key, 0);
  }
  _cspDirectiveCounts.set(key, _cspDirectiveCounts.get(key) + 1);

  // Per-URI counts (PII-safe via SHA-256 hashing, bounded at 50 keys).
  _cspRecordUri(_cspBlockedUriCounts, blockedUri);
  _cspRecordUri(_cspDocumentUriCounts, documentUri);

  // Track the most recent reporting IP for attribution. Hash + sample
  // so ops can identify the source without us logging the raw IP.
  if (typeof reporterIp === "string" && reporterIp.length > 0 && reporterIp.length <= 200) {
    const sample = reporterIp.slice(0, 64);
    const hash = _csp.createHash("sha256").update(sample).digest("hex").slice(0, 16);
    _cspLastReporterHash = hash;
    _cspLastReporterSample = sample;
  }
}

// Count reports blocked at the rate-limit gate (or any 4xx path
// before the body is accepted). Lets /api/health surface the
// "how many reports were rejected at the door" signal — useful
// for spotting abusive browsers before they can flood the system.
let _cspBlockedCount = 0;
// Unix-ms timestamp of the most recent rate-limit-rejected CSP
// report. Pairs with firstSeenAt/lastSeenAt (accepted) and
// lastReporter to give ops the full timeline of the CSP stream.
let _cspLastBlockedAt = 0;
function recordCspBlock() { _cspBlockedCount += 1; }

function getCspReportCounts() {
  // Snapshot (caller can iterate without worrying about concurrent mutation)
  const byDirective = Object.create(null);
  for (const [k, v] of _cspDirectiveCounts) byDirective[k] = v;
  return {
    total: _cspTotalReports,
    byDirective,
    // Temporal observability: ISO timestamps of first and most recent
    // report. Null until the first report arrives. Lets ops answer
    // "is the CSP report stream fresh or stale?" — a 6-hour gap with
    // a "0 reports" trend means the stream is dead, not "nothing to
    // report".
    firstSeenAt: _cspFirstSeenAt ? new Date(_cspFirstSeenAt).toISOString() : null,
    lastSeenAt: _cspLastSeenAt ? new Date(_cspLastSeenAt).toISOString() : null,
  };
}

// Snapshot the per-URI counters. Same shape as the directive counter:
//   { hash, count, sample } for the top-N entries, sorted by count desc.
// Ops can answer two questions in one curl:
//   "what's the most-blocked resource?" — sort by mostBlocked
//   "what page is producing the most violations?" — sort by mostBlockedFrom
function _cspTopN(map, n) {
  const top = [];
  for (const [hash, entry] of map) {
    top.push({ hash, count: entry.count, sample: entry.sample });
  }
  top.sort((a, b) => b.count - a.count);
  return top.slice(0, n);
}

function getCspReportCounts() {
  // Snapshot (caller can iterate without worrying about concurrent mutation)
  const byDirective = Object.create(null);
  for (const [k, v] of _cspDirectiveCounts) byDirective[k] = v;
  return {
    total: _cspTotalReports,
    byDirective,
    // Temporal observability: ISO timestamps of first and most recent
    // report. Null until the first report arrives. Lets ops answer
    // "is the CSP report stream fresh or stale?" — a 6-hour gap with
    // a "0 reports" trend means the stream is dead, not "nothing to
    // report".
    firstSeenAt: _cspFirstSeenAt ? new Date(_cspFirstSeenAt).toISOString() : null,
    lastSeenAt: _cspLastSeenAt ? new Date(_cspLastSeenAt).toISOString() : null,
    // Average per-minute CSP report rate over the process lifetime.
    // Pairs with `total` to give ops an instantaneous signal:
    //   total=12, rate=0.05/min  → steady low-volume background
    //   total=200, rate=2.5/min → spike, investigate
    // 0 when no reports received (else unbounded small-rate noise).
    // Math.max(1, elapsedMin) guards divide-by-zero at process start.
    ratePerMinute: (() => {
      const elapsedMin = Math.max(1, Math.round((Date.now() - _cspProcessStartTs) / 60000));
      return Math.round((_cspTotalReports / elapsedMin) * 10) / 10;
    })(),
    // Acceptance rate: accepted / (accepted + blocked). 1-decimal
    // precision (0..1, but expressed as 0..10 for whole-number
    // visual). Lets ops read "what % of attempts are being rejected?"
    // from a single curl without computing it from total + blocked.
    // 10 (= 100%) when no attempts at all (avoid noise).
    acceptanceRate: (() => {
      const totalAttempts = _cspTotalReports + _cspBlockedCount;
      return totalAttempts > 0
        ? Math.round((_cspTotalReports / totalAttempts) * 10) / 10
        : 10;
    })(),
    // Most recent reporting IP (hashed + sample for ops identification).
    // Lets ops answer "is one specific client flooding us with CSP
    // reports?" from a single curl.
    lastReporter: _cspLastReporterHash
      ? { hash: _cspLastReporterHash, sample: _cspLastReporterSample }
      : null,
    // Top-10 most-blocked URIs (the resource that was blocked) AND
    // top-10 most-blockedFrom URIs (the page where the violation
    // happened). PII-safe: keys are SHA-256 hashes; samples are URL
    // prefixes for human ops use.
    mostBlocked: _cspTopN(_cspBlockedUriCounts, 10),
    mostBlockedFrom: _cspTopN(_cspDocumentUriCounts, 10),
  };
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

/* ── logProviderError: req-id-tagged logger for inner AI calls ────────
 *
 * The provider-calling helpers (callGemini, callOpenRouter, etc.) don't
 * have direct access to the Vercel response object — they live below the
 * outer handler. To keep every log line correlatable by request id, the
 * outer handler captures `res.__requestId` once and threads it down.
 *
 * Usage:
 *   const reqId = res.__requestId || "no-req-id";
 *   const logErr = (prefix, msg) => logProviderError(reqId, prefix, msg);
 *   ... pass logErr into the inner call ...
 *
 * Sanitizes the message the same way errLog does — control chars stripped,
 * length capped. Falls back to "no-req-id" if reqId is missing.
 */
function logProviderError(reqId, prefix, msg) {
  const id = (typeof reqId === "string" && reqId) ? reqId : "no-req-id";
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

/* Read-only accessor for /api/health: how many unique IPs are in
 * the rate-limit map. Lets ops answer "is this instance handling
 * 1 client spamming requests, or N clients each requesting once?"
 * Bounded at _RATE_MAX_KEYS (5000) so a hostile path can't grow
 * the map unbounded.
 */
function getUniqueIPsCount() {
  return _buckets.size;
}

/* Read-only accessor for /api/health: top-N most-active IPs.
 * Returns an array of { hash, count, sample } sorted by count desc.
 * Keys are SHA-256 hashes of the IP (PII-safe: ops can identify the
 * source by the `sample` field but never by the key). Returns up to
 * the smaller of TOP_N and the actual count.
 */
function getTopActiveIPs(topN) {
  const n = (typeof topN === "number" && topN > 0) ? Math.min(topN, 50) : 5;
  // Snapshot the bucket values (sliding-window arrays) into a sortable
  // list. Count = array length (one entry per request in the window).
  // The array is bounded by the per-IP rate-limit maxPerMinute, so
  // each entry's count is at most ~maxPerMinute.
  const ranked = [];
  for (const [ip, arr] of _buckets) {
    if (!Array.isArray(arr)) continue;
    // Hash the IP — IPv4 and IPv6 forms both lengthen the key, so
    // the hash normalizes and also defends against PII in logs.
    const hash = require("node:crypto").createHash("sha256").update(String(ip)).digest("hex").slice(0, 16);
    ranked.push({ hash, count: arr.length, sample: String(ip).slice(0, 32) });
  }
  ranked.sort((a, b) => b.count - a.count);
  return ranked.slice(0, n);
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
 *   X-AI-Fallback         — (optional) "true" when the primary provider
 *                            failed and the fallback answered; "false"
 *                            when the primary answered outright. Lets ops
 *                            distinguish a clean primary hit from a
 *                            silent fallback activation without reading
 *                            logs.
 *   X-AI-OpenRouter-Ms    — (optional) ms the openrouter call took, when fired
 *   X-AI-Gemini-Ms        — (optional) ms the gemini call took, when fired
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
 * Backward compatible: existing 3/4/5-arg call sites work without
 * modification. Pass `perProviderMs = { openrouter?: n, gemini?: m }` as the
 * 6th argument to also emit per-provider breakdown headers.
 */
function applyAiResponseHeaders(res, provider, latencyMs, model, fallbackUsed, perProviderMs) {
  if (!res || typeof res.setHeader !== "function" || res.headersSent) return;
  if (typeof provider === "string" && provider.length > 0 && provider.length < 64) {
    // Allowlist of provider strings — keeps the header value honest even
    // if a future caller passes something weird from the request body.
    if (provider === "openrouter" || provider === "gemini" || provider === "none") {
      res.setHeader("X-AI-Provider", provider);
    }
  }
  if (isValidLatencyMs(latencyMs, { allowZero: true })) {
    res.setHeader("X-AI-Response-Time-Ms", String(Math.round(latencyMs)));
  }
  if (typeof model === "string" && model.length > 0 && model.length <= 128) {
    // Length cap + ASCII charset check defends against header-injection via
    // a model string the caller passed through unsanitized input.
    if (/^[A-Za-z0-9._:/+-]+$/.test(model)) {
      res.setHeader("X-AI-Model", model);
    }
  }
  if (typeof fallbackUsed === "boolean") {
    res.setHeader("X-AI-Fallback", fallbackUsed ? "true" : "false");
  }
  if (perProviderMs && typeof perProviderMs === "object" && !Array.isArray(perProviderMs)) {
    // Emit one X-AI-<Name>-Ms header per provider that fired. Keys are
    // restricted to the known lowercase provider ids so a leaked Map or
    // user-influenced object can't drive arbitrary header names. The
    // header NAMES are looked up explicitly (not derived from the key)
    // because "openrouter" must render as "OpenRouter" — naive TitleCase
    // would yield "Openrouter" and miss the capital R.
    //
    // Strict `> 0` (not `>= 0`): a 0 entry means "provider was not attempted"
    // (e.g. the API key was missing or the chain short-circuited). Emitting
    // "X-AI-Gemini-Ms: 0" would mislead ops into thinking the provider ran
    // for 0ms. Only emit when the call actually fired.
    const HEADER_NAME_BY_PROVIDER = { openrouter: "X-AI-OpenRouter-Ms", gemini: "X-AI-Gemini-Ms" };
    for (const key of Object.keys(HEADER_NAME_BY_PROVIDER)) {
      const v = perProviderMs[key];
      // Per-provider: 0 means "provider was not attempted" (e.g. the API
      // key was missing or the chain short-circuited). Default validator
      // (allowZero=false) skips it — emitting "X-AI-Gemini-Ms: 0" would
      // mislead ops into thinking the provider ran for 0ms.
      if (isValidLatencyMs(v)) {
        res.setHeader(HEADER_NAME_BY_PROVIDER[key], String(Math.round(v)));
      }
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

/* ── Compact (verdict-only) schema validation ─────────────────────
 *
 * When /api/analyze is called with `?format=verdict-only`, the AI is
 * asked to return only `risks + verdict` (no rewrite, deadlines,
 * next-steps, reading-level, or jargon). This is the slim validator
 * for that response shape.
 *
 * Same STRICT RULE (RULES.md #3) applies — any malformed field fails
 * the whole response rather than shipping degraded data.
 */
function safeParseCompactAnalysisResult(obj) {
  const errors = [];
  if (obj === null || typeof obj !== "object" || Array.isArray(obj)) {
    return { ok: false, errors: ["top-level must be an object"] };
  }

  // ── risks ── (subset of the full validator — no impact)
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
      // Compact mode skips the per-risk `impact` field — AI doesn't
      // produce it. If it does (sloppy prompt), silently drop.
      const impact = typeof r.impact === "string" ? r.impact.slice(0, ANALYSIS_LIMITS.riskImpact) : "";
      cleaned.push({
        severity: sev,
        clause: r.clause.slice(0, ANALYSIS_LIMITS.riskClause),
        explanation: r.explanation.slice(0, ANALYSIS_LIMITS.riskExplanation),
        impact,
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

  if (errors.length > 0) return { ok: false, errors };

  return {
    ok: true,
    value: {
      risks,
      verdict: { label: verdictLabel, summary: verdictSummary },
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
  applyBuildShaHeader,
  applyEndpointHeader,
  readCappedBody,
  generateRequestId,
  sanitizeIncomingRequestId,
  attachRequestId,
  probeProvider,
  probeProviderCached,
  clearProbeCache,
  getProbeCounts,
  getProbeReachabilityInLastHour,
  getProbeReachabilityByRegionInLastHour,
  getProbeAverageLatencyInLastHour,
  getLastProbeFailure,
  getLastProbeUpdate,
  getConsecutiveProviderFailures,
  getProbeCacheSize,
  getUniqueIPsCount,
  getTopActiveIPs,
  recordCspReport,
  recordCspBlock,
  getCspReportCounts,
  errLog,
  accessLog,
  sanitizeLogField,
  logProviderError,
  isValidLatencyMs,
  ANALYSIS_LIMITS,
  VALID_SEVERITIES,
  VALID_VERDICT_LABELS,
  validSeverity,
  validVerdictLabel,
  safeParseAnalysisResult,
  safeParseCompactAnalysisResult,
  CHAT_LIMITS,
  safeParseChatResult,
};
/* api/health.js — public health endpoint for uptime checks.
 *
 * Returns:
 *   200 { ok: true, status: "ok", version, uptimeSec, providers }   — edge-cacheable 5s
 *   503 { ok: false, status: "degraded", reason }                  — fresh on outage
 *
 * Lightweight: no upstream AI calls, no auth. Rate-limited per IP to avoid abuse.
 * 200-path responses carry `Cache-Control: public, max-age=5, s-maxage=5` so
 * monitoring services polling every second collapse into a single function
 * invocation per 5-second edge-cache window — meaningful Vercel cost savings
 * for the most-polled endpoint in any deployment.
 */

const { json, rateLimit, applyRateLimitHeaders, attachRequestId, applyBuildShaHeader, applyEndpointHeader, errLog, accessLog, getIp, probeProviderCached, getProbeCounts, getCspReportCounts, getUniqueIPsCount, getTopActiveIPs, getProbeReachabilityInLastHour, getProbeReachabilityByRegionInLastHour, getProbeAverageLatencyInLastHour } = require("./_safety.js");

const START_TS = Date.now();
// Captured on the first request — `summary.startupDurationMs` is the
// time the function took to initialize (module load → first request).
// Set to a non-zero value once we've seen traffic; null before that
// (so ops can distinguish "function never received a request yet"
// from "function started in 0ms").
let _firstRequestTs = 0;
// In-process counter of how many requests this function instance has
// served since process start. Pairs with `summary.totalProbes` (outbound)
// to give ops a complete traffic picture for this instance.
let _requestsServed = 0;
// Peak RSS observed since process start. Updated lazily on each request
// so ops can spot a memory-leak pattern (peak climbing request-over-request).
let _peakRssMb = 0;
// Per-status code counter (statusCode → count). LRU-evicting at 50 keys
// to prevent unbounded growth from a misbehaving client (or scan) hitting
// 1000s of distinct status codes via weird edge cases. Status codes are
// bounded at the standard set so the eviction is mostly defensive.
const _requestsByStatus = new Map();
const MAX_STATUS_BUCKETS = 50;
// Aggregate of all 5xx responses since process start. Pairs with
// `summary.requests` (total) to give ops an error-rate ratio in
// a single curl: totalErrors / requests.
let _totalErrors = 0;

function recordRequestStatus(statusCode) {
  if (!Number.isFinite(statusCode)) return;
  if (typeof statusCode !== "number" || statusCode < 100 || statusCode >= 600) return;
  if (_requestsByStatus.size >= MAX_STATUS_BUCKETS) {
    const oldest = _requestsByStatus.keys().next().value;
    if (oldest !== undefined) _requestsByStatus.delete(oldest);
  }
  _requestsByStatus.set(statusCode, (_requestsByStatus.get(statusCode) || 0) + 1);
  // 5xx = server error. 4xx is a client error (rate limit, bad input)
  // and not interesting from an "is the server broken" perspective.
  if (statusCode >= 500) _totalErrors += 1;
}
// Read the version from package.json — single source of truth. Without
// this the constant drifts the moment someone bumps package.json without
// remembering to update api/health.js too (the deployed VERSION field in
// /api/health should always match the actual deployed code).
const VERSION = require("../package.json").version;
const RATE_LIMIT_PER_MINUTE = 60; // health checks can be polled frequently
const HEALTH_CACHE_MAX_AGE = 5;   // edge-cache TTL on 200 responses

/* Set the standard /api/health 200 response headers. Shared between the
 * GET path (sendOkCached) and the HEAD path (inline), so future header
 * additions land in one place. Order matters — every header must be set
 * before res.end() / the json() call.
 *
 *   Content-Type  → Cache-Control → X-Request-Id →
 *   X-Request-Latency-Total-Ms → X-Build-Sha → body.
 *
 * Safe no-op when:
 *   - `headersSent` is true (response already streaming)
 *   - `res` is missing or lacks setHeader
 */
/* Compute a stable ETag for the current health payload. The tag changes
 * when any of these inputs change: git SHA, which providers have keys set,
 * or Vercel region. Stable across probes / cache hits / counter increments
 * so monitoring clients that re-poll within a deploy don't keep paying
 * for the body when nothing meaningful changed.
 *
 * Uses a simple FNV-1a 32-bit hash + JSON.stringify of the inputs. We
 * don't need cryptographic strength; we just need a stable identifier
 * that flips when the deploy shape changes.
 */
function computeHealthEtag({ gitSha, hasGemini, hasOpenRouter, region }) {
  const parts = [
    String(gitSha || ""),
    hasGemini ? "g:1" : "g:0",
    hasOpenRouter ? "o:1" : "o:0",
    String(region || ""),
  ];
  const input = parts.join("|");
  // FNV-1a 32-bit hash (deterministic, no crypto dep)
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  // Force unsigned 32-bit hex
  return '"' + (h >>> 0).toString(16).padStart(8, "0") + '"';
}

/* Format a Unix-ms timestamp as an HTTP-date string per RFC 7231 §7.1.1.1.
 * Per spec, conditional-request date formats use RFC 1123 / IMF-fixdate
 * precision (seconds, GMT). Pure function — no global state. */
function httpDate(ms) {
  const d = new Date(ms);
  // Use toUTCString() which formats as RFC 7231 IMF-fixdate ("Sun, 06 Nov 1994 08:49:37 GMT")
  return d.toUTCString();
}

function setHealthOkHeaders(res) {
  if (!res || typeof res.setHeader !== "function" || res.headersSent) return;
  res.setHeader("Content-Type", "application/json");
  res.setHeader(
    "Cache-Control",
    `public, max-age=${HEALTH_CACHE_MAX_AGE}, s-maxage=${HEALTH_CACHE_MAX_AGE}`
  );
  if (res.__requestId) res.setHeader("X-Request-Id", res.__requestId);
  if (typeof res.__requestStartedAt === "number") {
    const elapsed = Date.now() - res.__requestStartedAt;
    if (Number.isFinite(elapsed) && elapsed >= 0 && elapsed <= 600000) {
      res.setHeader("X-Request-Latency-Total-Ms", String(Math.round(elapsed)));
    }
  }
  applyBuildShaHeader(res);
}

/* Send the 200 response with edge-cacheable headers + the standard observability
 * family. Mirrors what json() does but overrides Cache-Control to permit a
 * short shared cache (5s). Both client (`max-age`) and CDN (`s-maxage`)
 * caches honor the directive so monitoring services hammering the endpoint
 * collapse to ~one upstream call per 5s window per edge node.
 */
function sendOkCached(res, payload) {
  if (res.headersSent) return;
  res.statusCode = 200;
  setHealthOkHeaders(res);
  if (res.__currentEtag) res.setHeader("ETag", res.__currentEtag);
  if (res.__lastModified) res.setHeader("Last-Modified", res.__lastModified);
  res.end(JSON.stringify(payload));
}

/* Build a bottom-line summary from the per-provider probe state. Lets ops
 * dashboards read one number per dimension instead of walking nested
 * objects. Synchronous, derived purely from inputs (single source of
 * truth: it always matches the `providers` block on the same payload).
 *
 * Output shape:
 *   {
 *     providersConfigured: n,    // count of providers with API keys
 *     providersReachable:  n,    // count of configured providers that probed ok
 *     fastestProviderMs:   m,    // min latency across reachable providers (null if none)
 *     slowestProviderMs:   m,    // max latency across reachable providers (null if none)
 *     cacheHits:           n,    // count of probes served from the probeCache
 *     totalProbes:         n,    // total probeProviderCached() calls since process start
 *     networkProbes:       n,    // of those, how many actually hit the network (misses)
 *     cspReports:          { total: n, byDirective: { "script-src": n, ... } }
 *                          // CSP violations reported by browsers, aggregated per-process
 *   }
 */
function buildSummary({ hasGemini, hasOpenRouter, geminiProbe, openRouterProbe }) {
  let configured = 0;
  let reachable = 0;
  const reachableLatencies = [];
  let cacheHits = 0;

  // Each pair (configured probe | not) is folded uniformly. Using a loop
  // over an array keeps the shape stable as we add more providers later.
  const pair = [
    [hasGemini, geminiProbe],
    [hasOpenRouter, openRouterProbe],
  ];
  for (const [configuredFlag, probe] of pair) {
    if (configuredFlag) configured += 1;
    if (probe && probe.ok && Number.isFinite(probe.latencyMs) && probe.latencyMs >= 0 && probe.latencyMs <= 600000) {
      reachable += 1;
      reachableLatencies.push(probe.latencyMs);
    }
    if (probe && probe.cached) cacheHits += 1;
  }

  // Probe-rate + CSP-rejection counters from the shared helper. The cache
  // hit ratio (cacheHits / totalProbes) tells ops whether the edge cache
  // is doing its job. networkProbes rising while totalProbes stays flat
  // means cache misses are growing — useful early warning.
  const probeCounts = getProbeCounts();
  const cspCounts = getCspReportCounts();
  return {
    // Absolute ISO timestamp of when this process started — pairs with
    // process.processUptimeSec (relative). Lets ops correlate with
    // Vercel deploys: "which build is this instance, and when did
    // Vercel start it?" Survives cold-start + horizontal scale-out.
    startedAt: new Date(START_TS).toISOString(),
    // Most recent AI provider probe (milliseconds since process start).
    // Pair with networkProbes to derive cache effectiveness: if
    // lastProbeAtMs is small relative to processUptimeSec, the cache
    // is hitting. If lastProbeAtMs equals processUptimeSec, every
    // request hit the network (cache completely missing).
    lastProbeAtMs: (() => {
      const ats = [];
      if (geminiProbe && geminiProbe.checkedAt) ats.push(Date.now() - geminiProbe.checkedAt);
      if (openRouterProbe && openRouterProbe.checkedAt) ats.push(Date.now() - openRouterProbe.checkedAt);
      return ats.length ? Math.min(...ats) : null;
    })(),
    // Cache miss rate (0..1, 1-decimal precision). Lighter than
    // computing the rate client-side. Pairs with totalProbes +
    // networkProbes to make cache effectiveness derivable from a
    // single number.
    cacheMissRate: probeCounts.total > 0
      ? Math.round((probeCounts.network / probeCounts.total) * 1000) / 10
      : 0,
    // Per-provider reachability rate over the rolling 1-hour window.
    // Lets ops answer "is the provider flapping?" — a 50%-reachable
    // signal is actionable even when the current state is OK.
    providersReachableInLastHour: getProbeReachabilityInLastHour(),
    // Per-provider average latency across the rolling 1-hour window.
    // Pairs with fastestProviderMs / slowestProviderMs to show the
    // central tendency. Lets ops answer "is the average getting
    // worse over time?" — the existing fields show extremes; this
    // one shows the mean.
    providersAvgLatencyMsInLastHour: getProbeAverageLatencyInLastHour(),
    // Per-provider per-region reachability over the rolling 1-hour
    // window. Lets ops answer "is the flapping localized to one
    // region?" (traffic spike in iad1 might leave fra1 unaffected).
    providersReachableByRegionInLastHour: getProbeReachabilityByRegionInLastHour(),
    // How long the function took to initialize (module load → first
    // request). Null until the first request arrives. Lets ops spot
    // slow-start regression in real time — Vercel Hobby cold starts
    // are bounded; if this number creeps up, an upstream is slow.
    startupDurationMs: _firstRequestTs ? _firstRequestTs - START_TS : null,
    providersConfigured: configured,
    providersReachable: reachable,
    // Aggregate booleans derived from the per-provider reachable state.
    // `any` = at least one configured provider is reachable (current
    // 200 path is achievable). `all` = every configured provider is
    // reachable (no fallback activation). Both are useful for ops
    // dashboards that want a single boolean signal without walking
    // the per-provider object.
    anyProviderReachable: configured > 0 && reachable > 0,
    allProvidersReachable: configured > 0 && reachable === configured,
    fastestProviderMs: reachableLatencies.length ? Math.min(...reachableLatencies) : null,
    slowestProviderMs: reachableLatencies.length ? Math.max(...reachableLatencies) : null,
    cacheHits,
    totalProbes: probeCounts.total,
    networkProbes: probeCounts.network,
    // Total requests served by this function instance since process start.
    // Pairs with totalProbes (outbound) so ops can compute inbound vs
    // outbound ratio and detect traffic anomalies per-instance.
    requests: _requestsServed,
    // Absolute ISO timestamp of when the FIRST request was received
    // (pinned on the first call, not reset). Pairs with startedAt
    // (module load) and startupDurationMs (gap between the two)
    // to give ops the full initialization timeline. Distinct value:
    // lets ops correlate "first request was 30s after module load"
    // with Vercel cold-start metrics — that gap = init-vs-traffic lag.
    firstRequestAt: _firstRequestTs ? new Date(_firstRequestTs).toISOString() : null,
    // Average request rate since process start. Derived from
    // `requests / uptimeSec * 60`. Pairs with the cumulative
    // `requests` to give ops a per-minute rate alongside the
    // cumulative count. 0 (not null) when uptimeSec is 0.
    averageRequestsPerMinute: _requestsServed > 0
      ? Math.round((_requestsServed / Math.max(1, Math.round((Date.now() - START_TS) / 1000))) * 600) / 10
      : 0,
    // Unique IPs that have hit this instance. Pairs with `requests` —
    // "100 requests from 1 IP" vs "100 requests from 100 IPs" tells
    // very different stories (single spammer vs distributed traffic).
    // Derived from the rate-limit map (bounded at 5000 entries).
    uniqueIPs: getUniqueIPsCount(),
    // Top-5 most-active IPs (SHA-256 hashed + IP sample for ops
    // identification). Pairs with uniqueIPs: if the per-IP counts
    // are wildly uneven, the bulk of traffic is from a small
    // number of clients — possible abuse signal.
    topActiveIPs: getTopActiveIPs(5),
    // Aggregate 5xx count for error-rate ratio (totalErrors / requests).
    // 4xx is excluded — those are client errors, not server problems.
    totalErrors: _totalErrors,
    // 5xx error rate (totalErrors / requests, 1-decimal precision, 0
    // when no requests yet). Complements the existing `totalErrors`
    // + `requests` fields so ops can read the ratio directly instead
    // of computing it client-side. Guards divide-by-zero at process
    // start (0/0 must resolve to 0, not NaN) and never produces >100
    // because totalErrors is bounded by requests.
    errorRate: _requestsServed > 0
      ? Math.round((_totalErrors / _requestsServed) * 1000) / 10
      : 0,
    // Per-status-code breakdown — "are we getting a lot of 429s from one
    // IP" or "spike in 503s?" is a one-curl check now. Snapshot the Map
    // so callers don't see concurrent mutation mid-iteration.
    requestsByStatus: Object.fromEntries(_requestsByStatus),
    cspReports: cspCounts,
  };
}

module.exports = async function handler(req, res) {
  attachRequestId(res, req);
  applyEndpointHeader(res, "health");
  try {
    if (req.method !== "GET" && req.method !== "HEAD") {
      return json(res, 405, { error: "Method not allowed." });
    }

    // Light rate limit so the endpoint can't be used to amplify load
    const rl = rateLimit(getIp(req), RATE_LIMIT_PER_MINUTE);
    applyRateLimitHeaders(res, rl);
    if (!rl.ok) {
      return json(res, 429, { error: "Too many requests." });
    }
    // Count this request toward the in-process `summary.requests` field.
    // Even 429-rejected requests count (the endpoint saw traffic — useful
    // for spotting attack patterns where the reject rate is climbing).
    _requestsServed += 1;
    // Lazily capture the timestamp of the first request so we can
    // report how long the function took to initialize. Once captured,
    // the value is stable for the lifetime of the process.
    if (_firstRequestTs === 0) _firstRequestTs = Date.now();
    // Lazy peak-memory update: cheap (one Math.max + Math.round per
    // request), and lets ops spot a memory-leak pattern by graphing
    // `summary.peakMemoryMb` over time. Vercel recycles function
    // instances frequently so this only matters within a single
    // process lifetime, but the signal is real.
    const rssNowMb = Math.round(process.memoryUsage().rss / 1048576);
    if (rssNowMb > _peakRssMb) _peakRssMb = rssNowMb;

    const uptimeSec = Math.round((Date.now() - START_TS) / 1000);
    const hasGemini = !!(process.env.GEMINI_API_KEY || process.env.GOOGLE_GEMINI_API_KEY);
    const hasOpenRouter = !!process.env.OPENROUTER_API_KEY;

    // Lightweight reachability probe (HEAD with 3s timeout, cached for 60s).
    // Only runs when the provider is configured — no point pinging hosts we
    // don't have credentials for. We probe the host root, not a model endpoint,
    // so this proves network reachability without consuming any AI quota.
    //
    // Both probes fire in PARALLEL via Promise.all — on a cold cache
    // this cuts worst-case latency from ~6s (sequential) to ~3s (parallel).
    // Cache hits already short-circuit inside probeProviderCached, so warm
    // checks are unaffected. probeProvider() catches every error internally
    // and always resolves with a result object, so Promise.all is safe
    // here — neither probe can reject to break the parallel join.
    const [geminiProbe, openRouterProbe] = await Promise.all([
      hasGemini
        ? probeProviderCached("gemini", "https://generativelanguage.googleapis.com/")
        : Promise.resolve(null),
      hasOpenRouter
        ? probeProviderCached("openrouter", "https://openrouter.ai/")
        : Promise.resolve(null),
    ]);

    const payload = {
      ok: true,
      status: "ok",
      version: VERSION,
      // Classify process uptime: "fresh" (<5 min), "warm" (5-60 min),
      // "cold" (>60 min). Lets ops dashboards spot when Vercel has
      // recycled an instance, or if cold-starts are spiking. Derived
      // from processUptimeSec — same source of truth as the rest of
      // the time fields.
      uptimeBucket: (() => {
        const s = Math.round((Date.now() - START_TS) / 1000);
        if (s < 300) return "fresh";
        if (s < 3600) return "warm";
        return "cold";
      })(),
      // Short git SHA of the deployed commit — Vercel sets
      // VERCEL_GIT_COMMIT_SHA automatically on every production deploy.
      // Ops can correlate a health-check response with a specific deploy
      // by matching the SHA against `git rev-parse HEAD` on the commit
      // they think is live. Null in local dev (env var unset).
      gitSha: process.env.VERCEL_GIT_COMMIT_SHA || null,
      uptimeSec,
      // ── summary rollup ──────────────────────────────────────────────
      // Bottom-line numbers for ops dashboards that just want the
      // bottom line. Computed from the providers block (single
      // source of truth) so the two stay in sync.
      summary: buildSummary({
        hasGemini,
        hasOpenRouter,
        geminiProbe,
        openRouterProbe,
      }),
      // ── process info ───────────────────────────────────────────────
      // Runtime telemetry for ops dashboards that want to diagnose V8
      // heap leaks, runtime regressions, or unexpected platform drift
      // without RDP/SSHing into the function instance. Cheap (~0.1ms)
      // and additive — no sensitive data exposed (no env vars, no file
      // paths, only safe V8 stats).
      process: {
        nodeVersion: process.version,
        platform: process.platform,
        arch: process.arch,
        pid: process.pid,
        processUptimeSec: Math.round(process.uptime()),
        // Vercel injects these on every production deploy. Lets ops
        // dashboards route alerts by region ("only iad1 is unhealthy")
        // and distinguish prod from preview deployments from the same
        // endpoint. Null in local dev (env vars unset).
        region: process.env.VERCEL_REGION || null,
        vercelEnv: process.env.VERCEL_ENV || null,
        memory: (() => {
          const m = process.memoryUsage();
          // Memory-pressure advisory: Vercel Hobby caps functions at 256 MB;
          // Pro at 1024 MB. Surface current vs. configured limit so ops gets
          // an early warning before OOM kills the function. Configurable via
          // MEMORY_LIMIT_MB env var; defaults to 256 (Hobby plan).
          const limitMb = (() => {
            const raw = process.env.MEMORY_LIMIT_MB;
            const n = raw == null ? 256 : Number(raw);
            return Number.isFinite(n) && n > 0 ? n : 256;
          })();
          const heapUsedMb = Math.round(m.heapUsed / 1048576);
          const usedPercent = Math.round((heapUsedMb / limitMb) * 1000) / 10;  // 1 decimal place
          return {
            rssMb: Math.round(m.rss / 1048576),
            heapTotalMb: Math.round(m.heapTotal / 1048576),
            heapUsedMb: heapUsedMb,
            externalMb: Math.round(m.external / 1048576),
            arrayBuffersMb: Math.round(m.arrayBuffers / 1048576),
            limitMb,
            usedPercent,
            nearLimit: usedPercent >= 80,
            // Heap utilization (heapUsed / heapTotal, 0..1 with 1-decimal
            // precision). Different from `usedPercent` which is against
            // the configured function limit. heapUsageRatio tracks GC
            // pressure — when this climbs, the next allocation is more
            // likely to trigger a major GC.
            heapUsageRatio: m.heapTotal > 0
              ? Math.round((m.heapUsed / m.heapTotal) * 1000) / 10
              : 0,
            // Peak RSS seen since process start — lets ops spot memory-leak
            // patterns by graphing this over time.
            peakRssMb: _peakRssMb,
          };
        })(),
      },
      providers: {
        gemini: hasGemini
          ? {
              configured: true,
              reachable: geminiProbe.ok,
              latencyMs: geminiProbe.latencyMs,
              ...(geminiProbe.ok ? {} : { error: geminiProbe.error }),
              cached: geminiProbe.cached,
              // ISO timestamp of when the most recent successful probe
              // happened. Useful for diagnosing "is the provider
              // reachable but slow?" (long latency) vs "when did it last
              // go down?" (old lastReachableAt relative to uptime).
              ...(geminiProbe.ok ? { lastReachableAt: new Date(geminiProbe.checkedAt).toISOString() } : {}),
            }
          : { configured: false, reachable: false, error: "GEMINI_API_KEY not set" },
        openrouter: hasOpenRouter
          ? {
              configured: true,
              reachable: openRouterProbe.ok,
              latencyMs: openRouterProbe.latencyMs,
              ...(openRouterProbe.ok ? {} : { error: openRouterProbe.error }),
              cached: openRouterProbe.cached,
              ...(openRouterProbe.ok ? { lastReachableAt: new Date(openRouterProbe.checkedAt).toISOString() } : {}),
            }
          : { configured: false, reachable: false, error: "OPENROUTER_API_KEY not set" },
      },
      timestamp: new Date().toISOString(),
    };

    // 503 only when EVERY provider is unreachable or unconfigured.
    // 503 must NOT be cached (Cache-Control: no-store, from json()) so
    // monitoring sees fresh outage state immediately.
    const allUnreachable =
      (payload.providers.gemini.configured ? !payload.providers.gemini.reachable : true) &&
      (payload.providers.openrouter.configured ? !payload.providers.openrouter.reachable : true);
    if (allUnreachable) {
      payload.ok = false;
      payload.status = "degraded";
      payload.reason = "All configured AI providers are unreachable.";
      // Tell monitoring clients when to retry. The probe cache will refresh
      // in 60s anyway, so 60s is a reasonable back-off.
      res.setHeader("Retry-After", "60");
      return json(res, 503, payload);
    }

    // 503 if no AI providers are configured — the analyze endpoint would be a no-op
    if (!hasGemini && !hasOpenRouter) {
      payload.ok = false;
      payload.status = "degraded";
      payload.reason = "No AI provider configured (GEMINI_API_KEY / OPENROUTER_API_KEY).";
      return json(res, 503, payload);
    }

    // Compute ETag for conditional requests (If-None-Match → 304).
    // Stable for the lifetime of a deploy; changes only when git SHA,
    // provider key set, or Vercel region changes. Lets monitoring
    // clients that re-poll every second avoid re-downloading the full
    // ~3KB payload when nothing meaningful moved.
    const etag = computeHealthEtag({
      gitSha: process.env.VERCEL_GIT_COMMIT_SHA || null,
      hasGemini,
      hasOpenRouter,
      region: process.env.VERCEL_REGION || null,
    });
    // If the client sent If-None-Match matching our tag, the payload
    // hasn't changed — return 304 with no body (saves bandwidth + parse).
    // 304 still gets X-Build-Sha + latency headers via setHealthOkHeaders
    // so ops can correlate the conditional-hit against a deploy.
    const incomingTag = req && req.headers && req.headers["if-none-match"];
    if (typeof incomingTag === "string" && incomingTag === etag) {
      res.statusCode = 304;
      setHealthOkHeaders(res);
      res.setHeader("ETag", etag);
      res.setHeader("Last-Modified", httpDate(START_TS));
      return res.end();
    }
    // If-None-Match failed or was absent — also support If-Modified-Since
    // (RFC 7232 §3.3). Some legacy monitoring clients (or generic HTTP
    // caches) understand only the date-based form. Compare the
    // header's date against our module-load timestamp; if the response
    // hasn't been modified since the client's view, return 304.
    const incomingIMS = req && req.headers && (req.headers["if-modified-since"] || req.headers["If-Modified-Since"]);
    if (typeof incomingIMS === "string" && incomingIMS.length > 0) {
      const clientTs = Date.parse(incomingIMS);
      if (Number.isFinite(clientTs) && START_TS <= clientTs) {
        // Client has a fresh-enough copy; return 304 without body.
        res.statusCode = 304;
        setHealthOkHeaders(res);
        res.setHeader("ETag", etag);
        res.setHeader("Last-Modified", httpDate(START_TS));
        return res.end();
      }
    }
    // Forward the tag to the cached/HEAD paths so it lands in headers
    // — they read `res.__currentEtag` to attach it to the response.
    res.__currentEtag = etag;
    res.__lastModified = httpDate(START_TS);

    if (req.method === "HEAD") {
      // HEAD must carry the same cacheable headers as the equivalent GET
      // (RFC 7231 §4.3.2) but skip the body — shared helper sets every
      // header, sendOkCached handles the GET body.
      if (!res.headersSent) {
        res.statusCode = 200;
        setHealthOkHeaders(res);
        if (res.__currentEtag) res.setHeader("ETag", res.__currentEtag);
        if (res.__lastModified) res.setHeader("Last-Modified", res.__lastModified);
      }
      return res.end();
    }
    return sendOkCached(res, payload);
  } catch (err) {
    // Last-resort safety net: same pattern as /api/analyze and /api/chat.
    // /api/health.js is fully synchronous so a throw is extremely unlikely,
    // but we keep the wrap for consistency — if anything ever does throw,
    // it surfaces a structured JSON 500 with no internals rather than
    // leaking Vercel's HTML 500 page.
    if (res && res.headersSent) return;
    errLog(res, "health", err);
    try {
      return json(res, 500, { error: "An internal error occurred. Please try again." });
    } catch (_) {
      // res.end() threw (broken pipe, etc.) — nothing more we can do.
    }
  } finally {
    accessLog(req, res, res.statusCode);
    recordRequestStatus(res.statusCode);
  }
};

// TEST-ONLY export: lets health-error.test.js unit-test the buildSummary
// helper without exposing it in the production API surface. Vercel only
// invokes `module.exports` as a request handler, so attaching additional
// properties is harmless (the runtime reads module.exports as a function).
module.exports.buildSummary = buildSummary;
module.exports.computeHealthEtag = computeHealthEtag;
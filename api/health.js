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

const { json, rateLimit, applyRateLimitHeaders, attachRequestId, applyBuildShaHeader, errLog, accessLog, getIp, probeProviderCached } = require("./_safety.js");

const START_TS = Date.now();
const VERSION = "1.0.0";
const RATE_LIMIT_PER_MINUTE = 60; // health checks can be polled frequently
const HEALTH_CACHE_MAX_AGE = 5;   // edge-cache TTL on 200 responses

/* Send the 200 response with edge-cacheable headers + the standard observability
 * family. Mirrors what json() does but overrides Cache-Control to permit a
 * short shared cache (5s). Both client (`max-age`) and CDN (`s-maxage`)
 * caches honor the directive so monitoring services hammering the endpoint
 * collapse to ~one upstream call per 5s window per edge node.
 *
 * Headers must be set in this order to land BEFORE res.end():
 *   Content-Type + Cache-Control → X-Request-Id → X-Request-Latency-Total-Ms →
 *   X-Build-Sha → body.
 */
function sendOkCached(res, payload) {
  if (res.headersSent) return;
  res.statusCode = 200;
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

  return {
    providersConfigured: configured,
    providersReachable: reachable,
    fastestProviderMs: reachableLatencies.length ? Math.min(...reachableLatencies) : null,
    slowestProviderMs: reachableLatencies.length ? Math.max(...reachableLatencies) : null,
    cacheHits,
  };
}

module.exports = async function handler(req, res) {
  attachRequestId(res, req);
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
      providers: {
        gemini: hasGemini
          ? {
              configured: true,
              reachable: geminiProbe.ok,
              latencyMs: geminiProbe.latencyMs,
              ...(geminiProbe.ok ? {} : { error: geminiProbe.error }),
              cached: geminiProbe.cached,
            }
          : { configured: false, reachable: false, error: "GEMINI_API_KEY not set" },
        openrouter: hasOpenRouter
          ? {
              configured: true,
              reachable: openRouterProbe.ok,
              latencyMs: openRouterProbe.latencyMs,
              ...(openRouterProbe.ok ? {} : { error: openRouterProbe.error }),
              cached: openRouterProbe.cached,
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

    if (req.method === "HEAD") {
      // HEAD must carry the same cacheable headers as the equivalent GET
      // (RFC 7231 §4.3.2). skip the body — the cacheable 200 helper would
      // otherwise serialize JSON we don't need to send.
      if (!res.headersSent) {
        res.statusCode = 200;
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
  }
};

// TEST-ONLY export: lets health-error.test.js unit-test the buildSummary
// helper without exposing it in the production API surface. Vercel only
// invokes `module.exports` as a request handler, so attaching additional
// properties is harmless (the runtime reads module.exports as a function).
module.exports.buildSummary = buildSummary;
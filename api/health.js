/* api/health.js — public health endpoint for uptime checks.
 *
 * Returns:
 *   200 { ok: true, status: "ok", version, uptimeSec }
 *   503 { ok: false, status: "degraded", reason }   — when downstream AI is unavailable
 *
 * Lightweight: no upstream calls, no auth. Rate-limited per IP to avoid abuse.
 */

const { json, rateLimit, getIp } = require("./_safety.js");

const START_TS = Date.now();
const VERSION = "1.0.0";
const RATE_LIMIT_PER_MINUTE = 60; // health checks can be polled frequently

module.exports = async function handler(req, res) {
  if (req.method !== "GET" && req.method !== "HEAD") {
    return json(res, 405, { error: "Method not allowed." });
  }

  // Light rate limit so the endpoint can't be used to amplify load
  const rl = rateLimit(getIp(req), RATE_LIMIT_PER_MINUTE);
  if (!rl.ok) {
    res.setHeader("Retry-After", String(rl.retryAfter));
    return json(res, 429, { error: "Too many requests." });
  }

  const uptimeSec = Math.round((Date.now() - START_TS) / 1000);
  const hasGemini = !!(process.env.GEMINI_API_KEY || process.env.GOOGLE_GEMINI_API_KEY);
  const hasOpenRouter = !!process.env.OPENROUTER_API_KEY;

  const payload = {
    ok: true,
    status: "ok",
    version: VERSION,
    uptimeSec,
    providers: {
      gemini: hasGemini ? "configured" : "missing",
      openrouter: hasOpenRouter ? "configured" : "missing",
    },
    timestamp: new Date().toISOString(),
  };

  // 503 if no AI providers are configured — the analyze endpoint would be a no-op
  if (!hasGemini && !hasOpenRouter) {
    payload.ok = false;
    payload.status = "degraded";
    payload.reason = "No AI provider configured (GEMINI_API_KEY / OPENROUTER_API_KEY).";
    return json(res, 503, payload);
  }

  if (req.method === "HEAD") {
    res.statusCode = 200;
    return res.end();
  }
  return json(res, 200, payload);
};
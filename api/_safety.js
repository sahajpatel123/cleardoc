/* api/_safety.js — shared helpers for Vercel serverless endpoints.
 *
 * Files prefixed with "_" are NOT deployed as routes by Vercel, so this module
 * is safe to import from sibling API handlers.
 *
 * Exports:
 *   json(res, status, body)         — canonical JSON response
 *   getIp(req)                      — best-effort client IP (Vercel x-forwarded-for aware)
 *   rateLimit(ip, maxPerMinute)     — per-IP sliding-window limiter, in-memory
 *   readCappedBody(req, maxBytes)   — stream-read with a hard byte cap (rejects before parsing)
 *   asString(value, max)            — defensive string coercion with a length cap
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

module.exports = { json, asString, getIp, rateLimit, readCappedBody };
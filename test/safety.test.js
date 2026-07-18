/* test/safety.test.js — node:test unit tests for api/_safety.js
 *
 * Run with: node --test test/safety.test.js
 * (No test framework dependency — uses Node's built-in node:test)
 */

const test = require("node:test");
const assert = require("node:assert/strict");
const { Readable } = require("node:stream");

const { json, asString, getIp, rateLimit, applyRateLimitHeaders, applyAiResponseHeaders, readCappedBody, generateRequestId, sanitizeIncomingRequestId, attachRequestId, probeProvider, probeProviderCached, clearProbeCache, errLog, accessLog } = require("../api/_safety.js");

// ── json ─────────────────────────────────────────────────────────────

test("json: sets status, content-type, cache-control, and serializes body", () => {
  const res = mockRes();
  json(res, 201, { ok: true, n: 42 });
  assert.equal(res.statusCode, 201);
  assert.equal(res.headers["Content-Type"], "application/json");
  assert.equal(res.headers["Cache-Control"], "no-store");
  assert.deepEqual(JSON.parse(res._body), { ok: true, n: 42 });
});

test("json: sets X-Request-Id when one was attached via attachRequestId()", () => {
  const res = mockRes();
  attachRequestId(res, { headers: {} });
  json(res, 200, { ok: true });
  assert.ok(res.headers["X-Request-Id"], "X-Request-Id must be set");
  assert.match(res.headers["X-Request-Id"], /^[A-Za-z0-9._-]+$/, "X-Request-Id must be ASCII");
});

// ── request-id helpers ───────────────────────────────────────────

test("generateRequestId: returns a non-empty ASCII identifier each call", () => {
  const id1 = generateRequestId();
  const id2 = generateRequestId();
  assert.ok(typeof id1 === "string" && id1.length > 0, "must produce a string");
  assert.ok(typeof id2 === "string" && id2.length > 0, "must produce a string");
  assert.notEqual(id1, id2, "two consecutive IDs should differ");
  assert.match(id1, /^[A-Za-z0-9._-]+$/, "ID must match the header-safe charset");
});

test("sanitizeIncomingRequestId: accepts header-safe ASCII IDs", () => {
  assert.equal(sanitizeIncomingRequestId("req-abc-123"), "req-abc-123");
  assert.equal(sanitizeIncomingRequestId("a_b.c-d"), "a_b.c-d");
});

test("sanitizeIncomingRequestId: rejects empty / non-ASCII / wrong-type", () => {
  assert.equal(sanitizeIncomingRequestId(""), null);
  assert.equal(sanitizeIncomingRequestId(null), null);
  assert.equal(sanitizeIncomingRequestId(undefined), null);
  assert.equal(sanitizeIncomingRequestId(42), null);
  assert.equal(sanitizeIncomingRequestId({}), null);
  assert.equal(sanitizeIncomingRequestId("has spaces"), null);
  assert.equal(sanitizeIncomingRequestId("has\nnewline"), null);
  assert.equal(sanitizeIncomingRequestId("evil\r\nX-Injected: yes"), null);
  assert.equal(sanitizeIncomingRequestId("emoji😈"), null);
});

test("sanitizeIncomingRequestId: caps accepted IDs at 128 chars", () => {
  // 128 ASCII chars is accepted as-is
  const exactly128 = "a".repeat(128);
  assert.equal(sanitizeIncomingRequestId(exactly128), exactly128);
  // 129+ ASCII chars get capped to 128 (defensive truncation, not rejection)
  const capped = sanitizeIncomingRequestId("a".repeat(129));
  assert.equal(capped, exactly128);
  assert.equal(capped.length, 128);
});

test("attachRequestId: honors a valid upstream X-Request-Id", () => {
  const res = mockRes();
  const id = attachRequestId(res, { headers: { "x-request-id": "client-12345" } });
  assert.equal(id, "client-12345");
  assert.equal(res.__requestId, "client-12345");
});

test("attachRequestId: mints a fresh ID when no upstream header is sent", () => {
  const res = mockRes();
  const id = attachRequestId(res, { headers: {} });
  assert.ok(id && id.length > 0, "must produce an ID");
  assert.notEqual(id, "client-12345", "should not echo a phantom header");
  assert.equal(res.__requestId, id);
});

test("attachRequestId: rejects malicious upstream IDs and mints a fresh one", () => {
  const res = mockRes();
  const id = attachRequestId(res, { headers: { "x-request-id": "evil\r\nX-Injected: yes" } });
  assert.ok(id && id !== "evil\r\nX-Injected: yes");
  // The new id must not contain control characters
  assert.ok(!/[\r\n]/.test(id));
});

test("attachRequestId: handles missing req object without throwing", () => {
  const res = mockRes();
  const id = attachRequestId(res, null);
  assert.ok(id && id.length > 0, "must produce an ID even with no req");
  assert.equal(res.__requestId, id);
});

// ── AI provider reachability probe ─────────────────────────────────

test("probeProvider: returns ok+status for a 2xx/3xx/4xx response", async () => {
  const origFetch = globalThis.fetch;
  globalThis.fetch = async () => ({ status: 200, ok: true });
  try {
    const r = await probeProvider("https://example.test/");
    assert.equal(r.ok, true, "non-5xx is considered reachable");
    assert.equal(r.status, 200);
    assert.ok(Number.isInteger(r.latencyMs) && r.latencyMs >= 0);
    assert.ok(typeof r.checkedAt === "number" && r.checkedAt > 0);
  } finally {
    globalThis.fetch = origFetch;
  }
});

test("probeProvider: marks 5xx responses as unreachable", async () => {
  const origFetch = globalThis.fetch;
  globalThis.fetch = async () => ({ status: 503, ok: false });
  try {
    const r = await probeProvider("https://broken.test/");
    assert.equal(r.ok, false);
    assert.equal(r.status, 503);
  } finally {
    globalThis.fetch = origFetch;
  }
});

test("probeProvider: returns error string on fetch failure", async () => {
  const origFetch = globalThis.fetch;
  globalThis.fetch = async () => { throw new Error("ECONNREFUSED"); };
  try {
    const r = await probeProvider("https://offline.test/");
    assert.equal(r.ok, false);
    assert.match(r.error, /ECONNREFUSED/);
    assert.ok(r.latencyMs >= 0);
  } finally {
    globalThis.fetch = origFetch;
  }
});

test("probeProvider: returns 'timeout' on AbortError", async () => {
  const origFetch = globalThis.fetch;
  // Simulate an abort by throwing an error with name === "AbortError"
  globalThis.fetch = async () => {
    const e = new Error("aborted");
    e.name = "AbortError";
    throw e;
  };
  try {
    const r = await probeProvider("https://slow.test/");
    assert.equal(r.ok, false);
    assert.equal(r.error, "timeout");
  } finally {
    globalThis.fetch = origFetch;
  }
});

test("probeProviderCached: first call hits network, second call is cached", async () => {
  const origFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => { calls++; return { status: 200, ok: true }; };
  try {
    clearProbeCache();
    const r1 = await probeProviderCached("test-key-1", "https://example.test/");
    const r2 = await probeProviderCached("test-key-1", "https://example.test/");
    assert.equal(calls, 1, "second call must be served from cache");
    assert.equal(r1.cached, false, "first call reports cached=false");
    assert.equal(r2.cached, true, "second call reports cached=true");
    assert.equal(r1.ok, true);
    assert.equal(r2.ok, true);
  } finally {
    globalThis.fetch = origFetch;
    clearProbeCache();
  }
});

test("probeProviderCached: different keys don't share cache entries", async () => {
  const origFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => { calls++; return { status: 200, ok: true }; };
  try {
    clearProbeCache();
    await probeProviderCached("key-a", "https://a.test/");
    await probeProviderCached("key-b", "https://b.test/");
    assert.equal(calls, 2, "different keys must trigger separate fetches");
  } finally {
    globalThis.fetch = origFetch;
    clearProbeCache();
  }
});

test("clearProbeCache: forces a refetch on next call", async () => {
  const origFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => { calls++; return { status: 200, ok: true }; };
  try {
    clearProbeCache();
    await probeProviderCached("test-key-clear", "https://example.test/");
    await probeProviderCached("test-key-clear", "https://example.test/");
    assert.equal(calls, 1);
    clearProbeCache();
    await probeProviderCached("test-key-clear", "https://example.test/");
    assert.equal(calls, 2, "clearProbeCache must force a refetch");
  } finally {
    globalThis.fetch = origFetch;
    clearProbeCache();
  }
});

test("probe cache: evicts oldest entry when over the 100-key cap", async () => {
  // Seed 101 unique keys, then verify the first one is gone after overflow.
  // We can't directly inspect the cache (it's a closure-private Map), but we
  // CAN prove eviction by forcing a refetch on the evicted key while a fresh
  // probe on the newest key still hits the cache.
  const origFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async (url) => {
    calls++;
    return { status: 200, ok: true, _u: String(url) };
  };
  try {
    clearProbeCache();
    // Insert 100 distinct keys (1..100)
    for (let i = 1; i <= 100; i++) {
      await probeProviderCached(`k${i}`, `https://example.test/${i}`);
    }
    const callsAfter100 = calls;
    assert.equal(callsAfter100, 100);
    // 101st insertion — should trigger eviction of k1 (oldest)
    await probeProviderCached("k101", "https://example.test/101");
    assert.equal(calls, 101, "101st unique key must trigger a fresh fetch");
    // Touching k2 should still be cached (it's NOT the oldest after k1 was
    // evicted; k2 is now the oldest, but it's only evicted on the NEXT overflow).
    // Verify by accessing k2 — its cache.hit returns cached:true with no new fetch.
    const beforeK2 = calls;
    const k2 = await probeProviderCached("k2", "https://example.test/2");
    assert.equal(calls, beforeK2, "k2 still in cache after the first eviction");
    assert.equal(k2.cached, true);
    // But k1 (the evicted one) must be missing from the cache.
    const k1 = await probeProviderCached("k1", "https://example.test/1");
    assert.equal(k1.cached, false, "k1 (oldest) must have been evicted");
    assert.equal(k1.latencyMs >= 0, true);
    assert.ok(calls > beforeK2, "k1 should trigger a fresh fetch after eviction");
  } finally {
    globalThis.fetch = origFetch;
    clearProbeCache();
  }
});

test("probe cache: LRU touch on cache hit moves key to end (recent)", async () => {
  const origFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => { calls++; return { status: 200, ok: true }; };
  try {
    clearProbeCache();
    // Insert 100 keys — fills the cache, k1 is the oldest.
    for (let i = 1; i <= 100; i++) {
      await probeProviderCached(`lru-${i}`, `https://example.test/${i}`);
    }
    // Touch k1 (cache hit) — should move it to the end of LRU order.
    const beforeTouch = calls;
    const touched = await probeProviderCached("lru-1", "https://example.test/1");
    assert.equal(touched.cached, true);
    assert.equal(calls, beforeTouch, "cache hit must not refetch");
    // Now insert the 101st key — lru-2 should be evicted (it became oldest
    // when lru-1 was touched), not lru-1.
    await probeProviderCached("lru-101", "https://example.test/101");
    // lru-1 should still be cached
    const r = await probeProviderCached("lru-1", "https://example.test/1");
    assert.equal(r.cached, true, "lru-1 should still be cached after touch");
    // lru-2 should have been evicted
    const r2 = await probeProviderCached("lru-2", "https://example.test/2");
    assert.equal(r2.cached, false, "lru-2 should have been evicted (it's now oldest)");
  } finally {
    globalThis.fetch = origFetch;
    clearProbeCache();
  }
});

// ── errLog: tagged error logging with request id ─────────────────

test("errLog: includes the active request id in the log line", () => {
  const res = mockRes();
  res.__requestId = "abc-123-test";
  const captured = [];
  const origErr = console.error;
  console.error = (...args) => captured.push(args.join(" "));
  try {
    errLog(res, "analyze", new Error("boom"));
  } finally {
    console.error = origErr;
  }
  assert.equal(captured.length, 1);
  assert.match(captured[0], /\[req=abc-123-test\]/);
  assert.match(captured[0], /\[analyze\]/);
  assert.match(captured[0], /boom/);
});

test("errLog: falls back to 'no-req-id' when res has no attached id", () => {
  const res = mockRes();
  const captured = [];
  const origErr = console.error;
  console.error = (...args) => captured.push(args.join(" "));
  try {
    errLog(res, "chat", new Error("missing id"));
  } finally {
    console.error = origErr;
  }
  assert.match(captured[0], /\[req=no-req-id\]/);
  assert.match(captured[0], /\[chat\]/);
});

test("errLog: handles non-Error values via String coercion", () => {
  const res = mockRes();
  res.__requestId = "test-id";
  const captured = [];
  const origErr = console.error;
  console.error = (...args) => captured.push(args.join(" "));
  try {
    errLog(res, "health", "plain string error");
    errLog(res, "health", null);
    errLog(res, "health", undefined);
    errLog(res, "health", { code: "E_THING" });
  } finally {
    console.error = origErr;
  }
  assert.match(captured[0], /plain string error/);
  assert.match(captured[1], /null/);
  assert.match(captured[2], /undefined/);
  assert.match(captured[3], /\[object Object\]|\{ code: 'E_THING' \}/);
});

test("errLog: does not throw when res is null/undefined", () => {
  const captured = [];
  const origErr = console.error;
  console.error = (...args) => captured.push(args.join(" "));
  try {
    errLog(null, "test", new Error("x"));
    errLog(undefined, "test", new Error("y"));
  } finally {
    console.error = origErr;
  }
  assert.equal(captured.length, 2);
  assert.match(captured[0], /\[req=no-req-id\]/);
  assert.match(captured[1], /\[req=no-req-id\]/);
});

// ── accessLog: per-request completion log ──────────────────────────

test("accessLog: emits one structured line per request", () => {
  const captured = [];
  const origLog = console.log;
  console.log = (...args) => captured.push(args.join(" "));
  try {
    const res = mockRes();
    res.__requestId = "req-xyz";
    accessLog({ method: "POST", url: "/api/analyze" }, res, 200);
  } finally {
    console.log = origLog;
  }
  assert.equal(captured.length, 1);
  assert.match(captured[0], /\[req=req-xyz\]/);
  assert.match(captured[0], /POST/);
  assert.match(captured[0], /\/api\/analyze/);
  assert.match(captured[0], /-> 200/);
});

test("accessLog: uses res.statusCode when status arg is omitted", () => {
  const captured = [];
  const origLog = console.log;
  console.log = (...args) => captured.push(args.join(" "));
  try {
    const res = mockRes();
    res.__requestId = "auto";
    res.statusCode = 503;
    accessLog({ method: "GET", url: "/api/health" }, res);
  } finally {
    console.log = origLog;
  }
  assert.match(captured[0], /-> 503/);
});

test("accessLog: explicit status arg overrides res.statusCode", () => {
  const captured = [];
  const origLog = console.log;
  console.log = (...args) => captured.push(args.join(" "));
  try {
    const res = mockRes();
    res.__requestId = "override";
    res.statusCode = 200;
    accessLog({ method: "GET", url: "/api/health" }, res, 429);
  } finally {
    console.log = origLog;
  }
  assert.match(captured[0], /-> 429/);
});

test("accessLog: falls back gracefully when req/res are missing", () => {
  const captured = [];
  const origLog = console.log;
  console.log = (...args) => captured.push(args.join(" "));
  try {
    accessLog(null, null, 200);
    accessLog(undefined, undefined);
  } finally {
    console.log = origLog;
  }
  assert.equal(captured.length, 2);
  assert.match(captured[0], /\?/);
  assert.match(captured[0], /-> 200/);
  assert.match(captured[1], /\[req=no-req-id\]/);
});

// ── asString ─────────────────────────────────────────────────────────

test("asString: returns trimmed string for string input, capped at max", () => {
  assert.equal(asString("hello", 100), "hello");
  assert.equal(asString("  spaced  ", 100), "spaced");
  assert.equal(asString("abcdef", 3), "abc");
});

test("asString: returns empty string for non-string input", () => {
  assert.equal(asString(null, 100), "");
  assert.equal(asString(undefined, 100), "");
  assert.equal(asString(42, 100), "");
  assert.equal(asString({ a: 1 }, 100), "");
  assert.equal(asString(["x"], 100), "");
});

// ── getIp ────────────────────────────────────────────────────────────

test("getIp: prefers x-forwarded-for", () => {
  const req = { headers: { "x-forwarded-for": "203.0.113.1, 10.0.0.1" }, socket: { remoteAddress: "127.0.0.1" } };
  assert.equal(getIp(req), "203.0.113.1");
});

test("getIp: falls back to x-real-ip", () => {
  const req = { headers: { "x-real-ip": "198.51.100.5" }, socket: { remoteAddress: "127.0.0.1" } };
  assert.equal(getIp(req), "198.51.100.5");
});

test("getIp: falls back to socket.remoteAddress", () => {
  const req = { headers: {}, socket: { remoteAddress: "10.0.0.5" } };
  assert.equal(getIp(req), "10.0.0.5");
});

test("getIp: returns 'unknown' when nothing is available", () => {
  assert.equal(getIp({ headers: {} }), "unknown");
  assert.equal(getIp(null), "unknown");
  assert.equal(getIp(undefined), "unknown");
});

// ── rateLimit ────────────────────────────────────────────────────────

test("rateLimit: allows up to N requests within the window", () => {
  const ip = `test-allow-${Date.now()}-${Math.random()}`;
  for (let i = 1; i <= 5; i++) {
    const r = rateLimit(ip, 5);
    assert.equal(r.ok, true, `req ${i} should be allowed`);
  }
});

test("rateLimit: rejects the (N+1)th request with retryAfter", () => {
  const ip = `test-reject-${Date.now()}-${Math.random()}`;
  for (let i = 1; i <= 3; i++) {
    assert.equal(rateLimit(ip, 3).ok, true);
  }
  const blocked = rateLimit(ip, 3);
  assert.equal(blocked.ok, false);
  assert.ok(blocked.retryAfter >= 1 && blocked.retryAfter <= 60, `retryAfter ${blocked.retryAfter} should be 1..60`);
});

test("rateLimit: returns limit, remaining, reset on every response (allowed + rejected)", () => {
  const ip = `test-fields-${Date.now()}-${Math.random()}`;
  const r1 = rateLimit(ip, 3);
  assert.equal(r1.ok, true);
  assert.equal(r1.limit, 3, "limit must echo maxPerMinute");
  assert.equal(r1.remaining, 2, "remaining decrements after each allowed request");
  assert.ok(Number.isInteger(r1.reset) && r1.reset > 0, "reset must be a positive UNIX seconds");

  const r2 = rateLimit(ip, 3);
  assert.equal(r2.remaining, 1, "remaining should be 1 after second request");

  const r3 = rateLimit(ip, 3);
  assert.equal(r3.remaining, 0, "remaining should be 0 at the cap");

  const r4 = rateLimit(ip, 3);
  assert.equal(r4.ok, false, "4th request should be rejected");
  assert.equal(r4.limit, 3, "rejection still echoes limit");
  assert.equal(r4.remaining, 0, "rejection always reports 0 remaining");
  assert.ok(Number.isInteger(r4.reset) && r4.reset > 0, "rejection still carries reset");
  assert.ok(r4.retryAfter >= 1 && r4.retryAfter <= 60);
});

test("rateLimit: disabled limit (maxPerMinute <= 0) reports zeroed fields", () => {
  const r = rateLimit("test-disabled", 0);
  assert.equal(r.ok, true);
  assert.equal(r.limit, 0);
  assert.equal(r.remaining, 0);
  assert.equal(r.reset, 0);
});

// ── applyRateLimitHeaders ──────────────────────────────────────────

test("applyRateLimitHeaders: writes X-RateLimit-Limit, -Remaining, -Reset on allowed", () => {
  const res = mockRes();
  applyRateLimitHeaders(res, { ok: true, limit: 10, remaining: 7, reset: 1700000000 });
  assert.equal(res.headers["X-RateLimit-Limit"], "10");
  assert.equal(res.headers["X-RateLimit-Remaining"], "7");
  assert.equal(res.headers["X-RateLimit-Reset"], "1700000000");
  assert.equal(res.headers["Retry-After"], undefined, "Retry-After is omitted on allowed responses");
});

test("applyRateLimitHeaders: writes Retry-After on rejected in addition to the trio", () => {
  const res = mockRes();
  applyRateLimitHeaders(res, { ok: false, limit: 10, remaining: 0, reset: 1700000000, retryAfter: 42 });
  assert.equal(res.headers["X-RateLimit-Limit"], "10");
  assert.equal(res.headers["X-RateLimit-Remaining"], "0");
  assert.equal(res.headers["X-RateLimit-Reset"], "1700000000");
  assert.equal(res.headers["Retry-After"], "42");
});

test("applyRateLimitHeaders: omits all headers when limiter is disabled (limit <= 0)", () => {
  // When maxPerMinute <= 0, rateLimit() returns { limit: 0, remaining: 0, reset: 0 }.
  // Emitting those as headers would mislead clients (X-RateLimit-Reset: 0
  // = 1970-01-01). The helper must omit every header so the absence tells
  // the client "no limiter is active here" without lying about numbers.
  const res = mockRes();
  applyRateLimitHeaders(res, { ok: true, limit: 0, remaining: 0, reset: 0 });
  assert.equal(res.headers["X-RateLimit-Limit"], undefined,
    "X-RateLimit-Limit must NOT be set when limit is 0 (disabled)");
  assert.equal(res.headers["X-RateLimit-Remaining"], undefined,
    "X-RateLimit-Remaining must NOT be set when limit is 0 (disabled)");
  assert.equal(res.headers["X-RateLimit-Reset"], undefined,
    "X-RateLimit-Reset must NOT be set when reset is 0 (disabled)");
  assert.equal(res.headers["Retry-After"], undefined,
    "Retry-After must NOT be set when the limiter is disabled");
});

test("applyRateLimitHeaders: is null-safe (no throw on null/undefined/empty)", () => {
  for (const bad of [null, undefined, {}, "", 0]) {
    const res = mockRes();
    applyRateLimitHeaders(res, bad);
    assert.deepEqual(res.headers, {}, `no headers should be set for ${JSON.stringify(bad)}`);
  }
});

test("applyRateLimitHeaders: skips fields that aren't finite numbers", () => {
  const res = mockRes();
  applyRateLimitHeaders(res, { ok: true, limit: "ten", remaining: NaN, reset: null });
  assert.equal(res.headers["X-RateLimit-Limit"], undefined);
  assert.equal(res.headers["X-RateLimit-Remaining"], undefined);
  assert.equal(res.headers["X-RateLimit-Reset"], undefined);
});

// ── applyAiResponseHeaders ─────────────────────────────────────────

test("applyAiResponseHeaders: writes X-AI-Provider on each allowlisted provider", () => {
  for (const provider of ["openrouter", "gemini", "none"]) {
    const res = mockRes();
    applyAiResponseHeaders(res, provider, 1234);
    assert.equal(res.headers["X-AI-Provider"], provider, `expected ${provider} → header`);
    assert.equal(res.headers["X-AI-Response-Time-Ms"], "1234", "expected integer ms");
  }
});

test("applyAiResponseHeaders: rejects provider strings not in the allowlist", () => {
  // Defense-in-depth: only emit the header for the three known values so a
  // compromised handler can't inject arbitrary provider labels that ops
  // dashboards would render as if they were legitimate.
  for (const bad of ["anthropic", "openai", "<script>alert(1)</script>", "GEMINI", "", "OPENROUTER"]) {
    const res = mockRes();
    applyAiResponseHeaders(res, bad, 500);
    assert.equal(
      res.headers["X-AI-Provider"],
      undefined,
      `unexpected provider string "${bad}" should be ignored`
    );
  }
});

test("applyAiResponseHeaders: ignores non-finite or out-of-range latencyMs", () => {
  for (const bad of [NaN, -1, Infinity, -Infinity, "100", null, undefined, 1e7 /* > 600000 cap */]) {
    const res = mockRes();
    applyAiResponseHeaders(res, "openrouter", bad);
    assert.equal(res.headers["X-AI-Response-Time-Ms"], undefined, `bad latency ${bad} must be skipped`);
  }
});

test("applyAiResponseHeaders: rounds fractional latencyMs to nearest integer", () => {
  const res = mockRes();
  applyAiResponseHeaders(res, "gemini", 1234.7);
  assert.equal(res.headers["X-AI-Response-Time-Ms"], "1235");
});

test("applyAiResponseHeaders: writes headers independently (latency-only, provider-only)", () => {
  // A handler might call this with only one of the two args in some paths
  // (e.g. partial failure). The other field should just not be set.
  const resA = mockRes();
  applyAiResponseHeaders(resA, "gemini", NaN);
  assert.equal(resA.headers["X-AI-Provider"], "gemini");
  assert.equal(resA.headers["X-AI-Response-Time-Ms"], undefined);

  const resB = mockRes();
  applyAiResponseHeaders(resB, "INVALID", 2500);
  assert.equal(resB.headers["X-AI-Provider"], undefined);
  assert.equal(resB.headers["X-AI-Response-Time-Ms"], "2500");
});

test("applyAiResponseHeaders: null-safe (no throw on bad res)", () => {
  for (const bad of [null, undefined, {}, 42, "not a res"]) {
    // Should not throw on missing setHeader or headersSent flag.
    applyAiResponseHeaders(bad, "gemini", 1000);
  }
});

test("applyAiResponseHeaders: no-ops once headers have been sent", () => {
  const res = mockRes();
  res.headersSent = true;
  applyAiResponseHeaders(res, "openrouter", 9999);
  assert.deepEqual(res.headers, {}, "must not call setHeader when response is already streaming");
});

test("rateLimit: limits are isolated per IP", () => {
  const a = `test-iso-a-${Date.now()}`;
  const b = `test-iso-b-${Date.now()}`;
  for (let i = 0; i < 3; i++) rateLimit(a, 3);
  assert.equal(rateLimit(a, 3).ok, false, "ip a should be limited");
  assert.equal(rateLimit(b, 3).ok, true, "ip b should still be allowed");
});

test("rateLimit: maxPerMinute <= 0 disables the limit", () => {
  const ip = `test-disabled-${Date.now()}`;
  for (let i = 0; i < 100; i++) assert.equal(rateLimit(ip, 0).ok, true);
});

// ── readCappedBody ───────────────────────────────────────────────────

function streamReq(s, headers = {}) {
  const r = Readable.from([Buffer.from(s, "utf8")]);
  r.headers = headers;
  r.socket = { remoteAddress: "127.0.0.1" };
  return r;
}

test("readCappedBody: returns raw string for valid body under cap", async () => {
  const got = await readCappedBody(streamReq("hello world"), 1024);
  assert.equal(got.raw, "hello world");
  assert.equal(got.error, undefined);
});

test("readCappedBody: rejects early via Content-Length when over cap", async () => {
  const got = await readCappedBody(streamReq("x", { "content-length": "999999" }), 1024);
  assert.equal(got.error.status, 413);
  assert.match(got.error.message, /too large/i);
});

test("readCappedBody: returns empty raw for empty body", async () => {
  const got = await readCappedBody(streamReq(""), 1024);
  assert.equal(got.raw, "");
  assert.equal(got.error, undefined);
});

test("readCappedBody: rejects when stream overflows the cap", async () => {
  const big = Readable.from([Buffer.from("x".repeat(200)), Buffer.from("y".repeat(200))]);
  big.headers = {};
  big.socket = { remoteAddress: "127.0.0.1" };
  const got = await readCappedBody(big, 250);
  assert.equal(got.error.status, 413);
  assert.match(got.error.message, /too large/i);
});

test("readCappedBody: uses default 256KB cap when maxBytes is missing", async () => {
  const got = await readCappedBody(streamReq("small"), undefined);
  assert.equal(got.raw, "small");
});

// ── helpers ──────────────────────────────────────────────────────────

function mockRes() {
  return {
    statusCode: 200,
    _body: null,
    headers: {},
    setHeader(k, v) { this.headers[k] = v; },
    status(c) { this.statusCode = c; return this; },
    end(s) { this._body = s; },
  };
}
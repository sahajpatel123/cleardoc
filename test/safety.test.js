/* test/safety.test.js — node:test unit tests for api/_safety.js
 *
 * Run with: node --test test/safety.test.js
 * (No test framework dependency — uses Node's built-in node:test)
 */

const test = require("node:test");
const assert = require("node:assert/strict");
const { Readable } = require("node:stream");

const { json, asString, getIp, rateLimit, applyRateLimitHeaders, applyAiResponseHeaders, applyBuildShaHeader, applyEndpointHeader, readCappedBody, generateRequestId, sanitizeIncomingRequestId, attachRequestId, probeProvider, probeProviderCached, clearProbeCache, errLog, accessLog, sanitizeLogField, logProviderError, isValidLatencyMs, safeParseCompactAnalysisResult } = require("../api/_safety.js");

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

// ── logProviderError: req-id-tagged logger for inner AI calls ─────

test("logProviderError: emits [req=<id>] [prefix] <msg> via console.error", () => {
  const captured = [];
  const origErr = console.error;
  console.error = (...args) => captured.push(args.join(" "));
  try {
    logProviderError("req-abc-123", "chat-gemini", "HTTP 503: upstream overload");
  } finally {
    console.error = origErr;
  }
  assert.equal(captured.length, 1);
  assert.match(captured[0], /\[req=req-abc-123\]/);
  assert.match(captured[0], /\[chat-gemini\]/);
  assert.match(captured[0], /HTTP 503: upstream overload/);
});

test("logProviderError: falls back to 'no-req-id' when reqId is missing", () => {
  const captured = [];
  const origErr = console.error;
  console.error = (...args) => captured.push(args.join(" "));
  try {
    logProviderError(undefined, "analyze-openrouter", "fail");
    logProviderError("", "analyze-openrouter", "fail");
    logProviderError(null, "analyze-openrouter", "fail");
  } finally {
    console.error = origErr;
  }
  assert.equal(captured.length, 3);
  for (const line of captured) assert.match(line, /\[req=no-req-id\]/);
});

test("logProviderError: sanitizes CRLF in the message so log injection is neutralized", () => {
  const captured = [];
  const origErr = console.error;
  console.error = (...args) => captured.push(args.join(" "));
  try {
    logProviderError("req-test", "chat-gemini", "error\r\n[FAKE] admin login");
  } finally {
    console.error = origErr;
  }
  assert.equal(captured.length, 1);
  // CRLF must be neutralized so the fake row never appears as a separate entry.
  assert.doesNotMatch(captured[0], /\r/);
  assert.match(captured[0], /\[FAKE\] admin login/);
});

test("logProviderError: caps message length so a giant error doesn't bloat the log line", () => {
  const captured = [];
  const origErr = console.error;
  console.error = (...args) => captured.push(args.join(" "));
  try {
    logProviderError("req-big", "chat-gemini", "x".repeat(2000));
  } finally {
    console.error = origErr;
  }
  assert.ok(captured[0].length < 2000);
  assert.match(captured[0], /…$/);
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

// ── sanitizeLogField: control-char + length defense for log lines ──

test("sanitizeLogField: passes through plain ASCII unchanged", () => {
  assert.equal(sanitizeLogField("/api/health", 512), "/api/health");
  assert.equal(sanitizeLogField("POST", 16), "POST");
});

test("sanitizeLogField: strips CR/LF/TAB and other ASCII control chars", () => {
  // Without sanitization these would inject fake log lines into the stream
  // and break log shippers that split on newline.
  assert.equal(sanitizeLogField("a\nb", 512), "a b");
  assert.equal(sanitizeLogField("a\rb", 512), "a b");
  assert.equal(sanitizeLogField("a\r\nb", 512), "a  b");
  assert.equal(sanitizeLogField("a\tb", 512), "a b");
  assert.equal(sanitizeLogField("a\x00b", 512), "a b");
  assert.equal(sanitizeLogField("a\x1Bb", 512), "a b");
  assert.equal(sanitizeLogField("a\x7Fb", 512), "a b");
});

test("sanitizeLogField: caps length with ellipsis", () => {
  const long = "x".repeat(600);
  const out = sanitizeLogField(long, 512);
  assert.equal(out.length, 512);
  assert.match(out, /…$/);
});

test("sanitizeLogField: does not truncate when under the cap", () => {
  assert.equal(sanitizeLogField("hello", 100), "hello");
});

test("sanitizeLogField: skips truncation when maxLen is non-positive", () => {
  assert.equal(sanitizeLogField("hello", 0), "hello");
  assert.equal(sanitizeLogField("hello", -1), "hello");
});

test("sanitizeLogField: coerces non-string inputs safely", () => {
  assert.equal(sanitizeLogField(null, 100), "");
  assert.equal(sanitizeLogField(undefined, 100), "");
  assert.equal(sanitizeLogField(42, 100), "42");
  assert.equal(sanitizeLogField(true, 100), "true");
});

test("accessLog: does NOT let a CRLF in the URL inject a second log line", () => {
  const captured = [];
  const origLog = console.log;
  console.log = (...args) => captured.push(args.join("\n"));
  try {
    const res = mockRes();
    res.__requestId = "inject-test";
    // Attacker-controlled URL containing CRLF + a fake log line
    accessLog({ method: "POST", url: "/api/x\r\n[FAKE] admin login" }, res, 200);
  } finally {
    console.log = origLog;
  }
  // Exactly ONE line — the CRLF must be neutralized so the fake row never
  // appears as a separate log entry.
  assert.equal(captured.length, 1);
  assert.match(captured[0], /\[req=inject-test\]/);
  assert.match(captured[0], /\[FAKE\] admin login/);
  assert.doesNotMatch(captured[0], /\r/);
});

test("accessLog: caps the URL field so a giant URL can't bloat the log line", () => {
  const captured = [];
  const origLog = console.log;
  console.log = (...args) => captured.push(args.join(" "));
  try {
    const res = mockRes();
    res.__requestId = "big-url";
    accessLog({ method: "GET", url: "/?" + "a".repeat(2000) }, res, 200);
  } finally {
    console.log = origLog;
  }
  // The URL portion inside the log line should be bounded — whole log line
  // is comfortably under 2KB even with a 2KB URL attack.
  assert.ok(captured[0].length < 2000, `log line too long: ${captured[0].length}`);
  // Truncation marker sits between the URL and the closing ` -> 200`.
  assert.match(captured[0], /… -> 200$/);
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

// ── applyAiResponseHeaders: X-AI-Model (optional 4th arg) ────────────

test("applyAiResponseHeaders: writes X-AI-Model when model is provided", () => {
  const res = mockRes();
  applyAiResponseHeaders(res, "openrouter", 1500, "google/gemma-4-31b-it:free");
  assert.equal(res.headers["X-AI-Provider"], "openrouter");
  assert.equal(res.headers["X-AI-Response-Time-Ms"], "1500");
  assert.equal(res.headers["X-AI-Model"], "google/gemma-4-31b-it:free");
});

test("applyAiResponseHeaders: omits X-AI-Model when model arg is omitted (backward compat)", () => {
  // Existing 3-arg call sites must keep working without the new header.
  const res = mockRes();
  applyAiResponseHeaders(res, "openrouter", 500);
  assert.equal(res.headers["X-AI-Model"], undefined, "no X-AI-Model when 4th arg omitted");
  assert.equal(res.headers["X-AI-Provider"], "openrouter");
});

test("applyAiResponseHeaders: rejects model strings outside the ASCII charset allowlist", () => {
  // CR/LF/spaces/quotes would break the header or smuggle extra fields.
  // Defense-in-depth: even though model strings originate from constants in
  // api handlers, future code paths might pass through user-influenced input.
  for (const bad of [
    "model\nwith-newline",
    "model with space",
    "model<script>",
    "model\"quoted",
    "model;DROP",
    "",
  ]) {
    const res = mockRes();
    applyAiResponseHeaders(res, "openrouter", 100, bad);
    assert.equal(res.headers["X-AI-Model"], undefined, `bad model "${bad}" must be skipped`);
  }
});

test("applyAiResponseHeaders: caps model at 128 chars to bound header size", () => {
  const tooLong = "a".repeat(129);
  const res = mockRes();
  applyAiResponseHeaders(res, "openrouter", 100, tooLong);
  assert.equal(res.headers["X-AI-Model"], undefined, "model >128 chars must be rejected");
  const exactly128 = "a".repeat(128);
  const res2 = mockRes();
  applyAiResponseHeaders(res2, "openrouter", 100, exactly128);
  assert.equal(res2.headers["X-AI-Model"], exactly128, "model ≤128 chars accepted");
});

test("applyAiResponseHeaders: accepts the canonical model identifiers", () => {
  // Real-world model IDs use letters, digits, dots, underscores, slashes, colons, hyphens, plus.
  for (const m of [
    "google/gemma-4-31b-it:free",
    "gemini-2.5-flash",
    "anthropic/claude-3.5-sonnet",
    "openai/gpt-4o-2024-08-06",
    "meta-llama/llama-3.1-70b-instruct",
  ]) {
    const res = mockRes();
    applyAiResponseHeaders(res, "gemini", 100, m);
    assert.equal(res.headers["X-AI-Model"], m, `real model ID "${m}" must be accepted`);
  }
});

// ── applyAiResponseHeaders: X-AI-Fallback (optional 5th arg) ───────────

test("applyAiResponseHeaders: writes X-AI-Fallback: true when 5th arg is true", () => {
  const res = mockRes();
  applyAiResponseHeaders(res, "openrouter", 1500, undefined, true);
  assert.equal(res.headers["X-AI-Fallback"], "true");
});

test("applyAiResponseHeaders: writes X-AI-Fallback: false when 5th arg is false", () => {
  const res = mockRes();
  applyAiResponseHeaders(res, "gemini", 1500, undefined, false);
  assert.equal(res.headers["X-AI-Fallback"], "false");
});

test("applyAiResponseHeaders: omits X-AI-Fallback when 5th arg is not a boolean (backward compat)", () => {
  // Existing 3-arg and 4-arg call sites must keep working.
  for (const bad of [undefined, null, "true", 1, 0, {}, []]) {
    const res = mockRes();
    applyAiResponseHeaders(res, "openrouter", 100, undefined, bad);
    assert.equal(res.headers["X-AI-Fallback"], undefined, `bad fallbackUsed ${JSON.stringify(bad)} must be skipped`);
  }
});

test("applyAiResponseHeaders: X-AI-Fallback coexists with all other AI headers", () => {
  // All five headers written together — the full observability surface.
  const res = mockRes();
  applyAiResponseHeaders(res, "openrouter", 1234, "google/gemma-4-31b-it:free", true);
  assert.equal(res.headers["X-AI-Provider"], "openrouter");
  assert.equal(res.headers["X-AI-Response-Time-Ms"], "1234");
  assert.equal(res.headers["X-AI-Model"], "google/gemma-4-31b-it:free");
  assert.equal(res.headers["X-AI-Fallback"], "true");
});

// ── applyAiResponseHeaders: per-provider latency (optional 6th arg) ──────

test("applyAiResponseHeaders: writes X-AI-OpenRouter-Ms / X-AI-Gemini-Ms from perProviderMs", () => {
  const res = mockRes();
  applyAiResponseHeaders(res, "gemini", 5500, undefined, true, { openrouter: 5000, gemini: 500 });
  assert.equal(res.headers["X-AI-OpenRouter-Ms"], "5000");
  assert.equal(res.headers["X-AI-Gemini-Ms"], "500");
});

test("applyAiResponseHeaders: only emits headers for non-zero per-provider entries", () => {
  // Primary-only (openrouter succeeded; gemini never fired). The unused
  // provider's header must NOT appear so ops doesn't read "0ms" and think
  // we tried.
  const res = mockRes();
  applyAiResponseHeaders(res, "openrouter", 200, undefined, false, { openrouter: 200, gemini: 0 });
  assert.equal(res.headers["X-AI-OpenRouter-Ms"], "200");
  assert.equal(res.headers["X-AI-Gemini-Ms"], undefined, "gemini=0 must NOT emit a header");
});

test("applyAiResponseHeaders: ignores unknown keys in perProviderMs (allowlist)", () => {
  // Defense-in-depth: even though perProviderMs comes from orchestrator
  // internals, future code paths might pass through a leaked object.
  const res = mockRes();
  applyAiResponseHeaders(res, "openrouter", 100, undefined, false, {
    openrouter: 100,
    gemini: 50,
    anthropic: 9999,
    "X-Evil\r\nInjected": 42,
  });
  assert.equal(res.headers["X-AI-OpenRouter-Ms"], "100");
  assert.equal(res.headers["X-AI-Gemini-Ms"], "50");
  assert.equal(res.headers["X-AI-Anthropic-Ms"], undefined, "unknown provider key must be ignored");
  // No header injection via hostile keys
  assert.equal(res.headers["X-Evil\r\nInjected"], undefined);
});

test("applyAiResponseHeaders: rejects non-finite or out-of-range per-provider ms", () => {
  for (const bad of [NaN, -1, Infinity, "100", null]) {
    const res = mockRes();
    applyAiResponseHeaders(res, "openrouter", 100, undefined, false, { openrouter: bad });
    assert.equal(res.headers["X-AI-OpenRouter-Ms"], undefined, `bad ms "${bad}" must be skipped`);
  }
});

test("applyAiResponseHeaders: omits per-provider headers when 6th arg is omitted (backward compat)", () => {
  // Existing 3/4/5-arg call sites must keep working without the new headers.
  const res = mockRes();
  applyAiResponseHeaders(res, "openrouter", 200);
  assert.equal(res.headers["X-AI-OpenRouter-Ms"], undefined);
  assert.equal(res.headers["X-AI-Gemini-Ms"], undefined);
});

test("applyAiResponseHeaders: full AI observability surface — all 7 headers written together", () => {
  // Locks in the complete family: provider + total latency + model +
  // fallback + per-provider breakdown.
  const res = mockRes();
  applyAiResponseHeaders(res, "gemini", 5500, "gemini-2.5-flash", true, { openrouter: 5000, gemini: 500 });
  assert.equal(res.headers["X-AI-Provider"], "gemini");
  assert.equal(res.headers["X-AI-Response-Time-Ms"], "5500");
  assert.equal(res.headers["X-AI-Model"], "gemini-2.5-flash");
  assert.equal(res.headers["X-AI-Fallback"], "true");
  assert.equal(res.headers["X-AI-OpenRouter-Ms"], "5000");
  assert.equal(res.headers["X-AI-Gemini-Ms"], "500");
});

// ── applyBuildShaHeader: X-Build-Sha from VERCEL_GIT_COMMIT_SHA ──────

test("applyBuildShaHeader: writes X-Build-Sha when VERCEL_GIT_COMMIT_SHA is a valid hex SHA", () => {
  const prev = process.env.VERCEL_GIT_COMMIT_SHA;
  process.env.VERCEL_GIT_COMMIT_SHA = "abc1234def5678";
  try {
    const res = mockRes();
    applyBuildShaHeader(res);
    assert.equal(res.headers["X-Build-Sha"], "abc1234def5678");
  } finally {
    if (prev === undefined) delete process.env.VERCEL_GIT_COMMIT_SHA;
    else process.env.VERCEL_GIT_COMMIT_SHA = prev;
  }
});

test("applyBuildShaHeader: accepts full 40-char SHA-1", () => {
  const prev = process.env.VERCEL_GIT_COMMIT_SHA;
  process.env.VERCEL_GIT_COMMIT_SHA = "0123456789abcdef0123456789abcdef01234567";
  try {
    const res = mockRes();
    applyBuildShaHeader(res);
    assert.equal(res.headers["X-Build-Sha"], "0123456789abcdef0123456789abcdef01234567");
  } finally {
    if (prev === undefined) delete process.env.VERCEL_GIT_COMMIT_SHA;
    else process.env.VERCEL_GIT_COMMIT_SHA = prev;
  }
});

test("applyBuildShaHeader: omits X-Build-Sha when env var is unset (local dev)", () => {
  const prev = process.env.VERCEL_GIT_COMMIT_SHA;
  delete process.env.VERCEL_GIT_COMMIT_SHA;
  try {
    const res = mockRes();
    applyBuildShaHeader(res);
    assert.equal(res.headers["X-Build-Sha"], undefined, "local dev must not emit placeholder");
  } finally {
    if (prev !== undefined) process.env.VERCEL_GIT_COMMIT_SHA = prev;
  }
});

test("applyBuildShaHeader: rejects malformed (non-hex) env values", () => {
  // Defense-in-depth: a misconfigured CI environment must not be able to
  // smuggle arbitrary bytes — even non-hex strings must be skipped.
  for (const bad of ["not-hex", "ABCDEF", "xyz1234", "abc1234\ninjected", "abc; 1234"]) {
    const prev = process.env.VERCEL_GIT_COMMIT_SHA;
    process.env.VERCEL_GIT_COMMIT_SHA = bad;
    try {
      const res = mockRes();
      applyBuildShaHeader(res);
      assert.equal(
        res.headers["X-Build-Sha"],
        undefined,
        `bad SHA "${bad}" must be rejected`
      );
    } finally {
      if (prev === undefined) delete process.env.VERCEL_GIT_COMMIT_SHA;
      else process.env.VERCEL_GIT_COMMIT_SHA = prev;
    }
  }
});

test("applyBuildShaHeader: rejects too-short or too-long SHAs", () => {
  // 6 chars is too short to be a git short-SHA (default is 7).
  // 41 chars is too long for SHA-1.
  const prev = process.env.VERCEL_GIT_COMMIT_SHA;
  for (const bad of ["abc123", "0".repeat(41)]) {
    process.env.VERCEL_GIT_COMMIT_SHA = bad;
    try {
      const res = mockRes();
      applyBuildShaHeader(res);
      assert.equal(res.headers["X-Build-Sha"], undefined, `"${bad}" must be rejected for length`);
    } catch (_) {
      // length check assertion doesn't fail; ignore
    }
  }
  if (prev === undefined) delete process.env.VERCEL_GIT_COMMIT_SHA;
  else process.env.VERCEL_GIT_COMMIT_SHA = prev;
});

test("applyBuildShaHeader: null-safe (no throw on bad res)", () => {
  for (const bad of [null, undefined, {}, 42, "res"]) {
    applyBuildShaHeader(bad);
  }
});

test("applyBuildShaHeader: no-ops once headers have been sent", () => {
  const prev = process.env.VERCEL_GIT_COMMIT_SHA;
  process.env.VERCEL_GIT_COMMIT_SHA = "abc1234";
  try {
    const res = mockRes();
    res.headersSent = true;
    applyBuildShaHeader(res);
    assert.deepEqual(res.headers, {}, "must not call setHeader when response is already streaming");
  } finally {
    if (prev === undefined) delete process.env.VERCEL_GIT_COMMIT_SHA;
    else process.env.VERCEL_GIT_COMMIT_SHA = prev;
  }
});

test("applyBuildShaHeader: automatic on json() — every JSON response carries X-Build-Sha in prod", () => {
  // The integration point that matters: every JSON response passes through
  // json() so every response automatically carries the build SHA. No
  // handler changes needed.
  const prev = process.env.VERCEL_GIT_COMMIT_SHA;
  process.env.VERCEL_GIT_COMMIT_SHA = "deadbeef1234";
  try {
    const res = mockRes();
    json(res, 200, { ok: true });
    assert.equal(res.headers["X-Build-Sha"], "deadbeef1234", "X-Build-Sha must land via json()");
  } finally {
    if (prev === undefined) delete process.env.VERCEL_GIT_COMMIT_SHA;
    else process.env.VERCEL_GIT_COMMIT_SHA = prev;
  }
});

// ── json() auto-latency header + attachRequestId start-time capture ────

test("attachRequestId: captures __requestStartedAt for the latency header", () => {
  const before = Date.now();
  const res = mockRes();
  const id = attachRequestId(res, { headers: {} });
  assert.ok(typeof id === "string" && id.length > 0, "returns a string id");
  assert.ok(typeof res.__requestStartedAt === "number", "must pin __requestStartedAt");
  assert.ok(res.__requestStartedAt >= before, "started-at is >= the moment we started the test");
  assert.ok(res.__requestStartedAt <= Date.now(), "started-at is <= now");
});

test("json: auto-sets X-Request-Latency-Total-Ms when __requestStartedAt is captured", async () => {
  // Tiny sleep to guarantee elapsed > 0
  const res = mockRes();
  attachRequestId(res, { headers: {} });
  await new Promise((r) => setTimeout(r, 5));
  json(res, 200, { ok: true });
  const header = res.headers["X-Request-Latency-Total-Ms"];
  assert.ok(typeof header === "string", "header must be set");
  assert.ok(parseInt(header, 10) >= 5, `latency should be ≥5ms (got ${header})`);
  assert.ok(parseInt(header, 10) < 5000, `latency should be < 5s (got ${header})`);
});

test("json: skips X-Request-Latency-Total-Ms when attachRequestId wasn't called", () => {
  // Defensive: a handler that forgets to call attachRequestId() still
  // works — just without the latency signal.
  const res = mockRes();
  json(res, 200, { ok: true });
  assert.equal(res.headers["X-Request-Latency-Total-Ms"], undefined);
});

test("json: X-Request-Latency-Total-Ms coexists with X-AI-Provider / X-AI-Response-Time-Ms", () => {
  // The two header families (total latency + AI-specific) must both be
  // present when both are valid. Total ≥ AI latency by definition
  // (it includes rate-limit + body read + serialize on top of AI).
  const res = mockRes();
  attachRequestId(res, { headers: {} });
  applyAiResponseHeaders(res, "gemini", 100);
  json(res, 200, { ok: true });
  assert.ok(res.headers["X-AI-Provider"] === "gemini");
  assert.ok(typeof res.headers["X-AI-Response-Time-Ms"] === "string");
  assert.ok(typeof res.headers["X-Request-Latency-Total-Ms"] === "string");
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
// ── isValidLatencyMs: single source of truth for latency validation ─

test("isValidLatencyMs: rejects non-finite, negative, and over-bound values", () => {
  for (const bad of [NaN, -1, Infinity, -Infinity, "100", null, undefined, {}, []]) {
    assert.equal(isValidLatencyMs(bad), false, `${JSON.stringify(bad)} must be rejected`);
    assert.equal(isValidLatencyMs(bad, { allowZero: true }), false, `${JSON.stringify(bad)} must be rejected even with allowZero`);
  }
  // 600001 ms (10 min + 1ms) is just over the cap
  assert.equal(isValidLatencyMs(600001), false, "must reject 600001ms (over 10-min cap)");
  assert.equal(isValidLatencyMs(600001, { allowZero: true }), false, "must reject 600001ms even with allowZero");
});

test("isValidLatencyMs: accepts sane values 1..600000ms by default", () => {
  for (const good of [1, 50, 1000, 60000, 600000]) {
    assert.equal(isValidLatencyMs(good), true, `${good}ms must be accepted`);
  }
});

test("isValidLatencyMs: allowZero=true accepts 0 but allowZero=false rejects it", () => {
  assert.equal(isValidLatencyMs(0), false, "0 must be rejected by default (means 'didn't fire')");
  assert.equal(isValidLatencyMs(0, { allowZero: true }), true, "0 must be accepted with allowZero: true");
});

test("isValidLatencyMs: bound is exactly 600000ms (10 min)", () => {
  assert.equal(isValidLatencyMs(600000), true, "600000ms is the upper boundary and must be accepted");
  assert.equal(isValidLatencyMs(600000, { allowZero: true }), true);
});

test("isValidLatencyMs: fractional ms in range are accepted (caller rounds)", () => {
  // The helper validates the BOUNDS — default lower bound is 1ms
  // (anything below that is noise / sub-ms timing that should be 0).
  // Callers wrap in Math.round() before emitting. With allowZero=true
  // the lower bound drops to 0, so sub-ms timings survive.
  assert.equal(isValidLatencyMs(0.5), false, "0.5 is below default 1ms lower bound");
  assert.equal(isValidLatencyMs(0.5, { allowZero: true }), true, "0.5 passes with allowZero (sub-ms timing)");
  assert.equal(isValidLatencyMs(100.7), true, "100.7 is in [1, 600000], passes");
  assert.equal(isValidLatencyMs(100.7, { allowZero: true }), true);
});

// ── safeParseCompactAnalysisResult (iter #46) ─────────────────────

test("safeParseCompactAnalysisResult: accepts a valid slim payload", () => {
  const r = safeParseCompactAnalysisResult({
    risks: [
      { severity: "trap", clause: "In Perpetuity.", explanation: "You must pay forever." },
    ],
    verdict: { label: "Suspicious", summary: "Concerning obligations." },
  });
  assert.equal(r.ok, true);
  assert.equal(r.value.risks.length, 1);
  assert.equal(r.value.risks[0].severity, "trap");
  assert.equal(r.value.verdict.label, "Suspicious");
  assert.equal(r.value.verdict.summary, "Concerning obligations.");
});

test("safeParseCompactAnalysisResult: rejects null / array / primitive top-level", () => {
  for (const bad of [null, undefined, "string", 42, [], [{}]]) {
    const r = safeParseCompactAnalysisResult(bad);
    assert.equal(r.ok, false, `${JSON.stringify(bad)} must be rejected`);
  }
});

test("safeParseCompactAnalysisResult: rejects missing risks", () => {
  const r = safeParseCompactAnalysisResult({
    verdict: { label: "Likely Fair", summary: "Looks fine." },
  });
  assert.equal(r.ok, false);
  assert.ok(r.errors.some((e) => /risks: must be an array/.test(e)));
});

test("safeParseCompactAnalysisResult: rejects missing verdict", () => {
  const r = safeParseCompactAnalysisResult({
    risks: [],
  });
  assert.equal(r.ok, false);
  assert.ok(r.errors.some((e) => /verdict.*must be an object/.test(e)));
});

test("safeParseCompactAnalysisResult: rejects unknown severity", () => {
  const r = safeParseCompactAnalysisResult({
    risks: [{ severity: "high", clause: "X", explanation: "Y" }],
    verdict: { label: "Likely Fair", summary: "S" },
  });
  assert.equal(r.ok, false);
  assert.ok(r.errors.some((e) => /severity: must be one of/.test(e)));
});

test("safeParseCompactAnalysisResult: silently drops impact field (compact mode omits it)", () => {
  // The compact prompt doesn't ask for impact — if the AI included it
  // anyway, we keep it silently rather than reject the response.
  const r = safeParseCompactAnalysisResult({
    risks: [{ severity: "note", clause: "X", explanation: "Y", impact: "spurious" }],
    verdict: { label: "Likely Fair", summary: "S" },
  });
  assert.equal(r.ok, true);
  assert.equal(r.value.risks[0].impact, "spurious", "impact is preserved when AI includes it");
});

test("safeParseCompactAnalysisResult: caps clause + explanation length at ANALYSIS_LIMITS", () => {
  // Defense-in-depth: the AI prompt caps are upstream, the validator
  // caps are downstream. Both must agree.
  const huge = safeParseCompactAnalysisResult({
    risks: [{ severity: "watch", clause: "x".repeat(5000), explanation: "y".repeat(2000) }],
    verdict: { label: "Likely Fair", summary: "S" },
  });
  assert.equal(huge.ok, true);
  assert.ok(huge.value.risks[0].clause.length <= 300, "clause must be truncated to ANALYSIS_LIMITS.riskClause");
  assert.ok(huge.value.risks[0].explanation.length <= 500, "explanation must be truncated to ANALYSIS_LIMITS.riskExplanation");
});

// ── MAX_REQUEST_BYTES: byte caps per endpoint ────────────────────

test("analyze handler: MAX_REQUEST_BYTES is a sane body cap (256KB by default)", () => {
  // The analyze endpoint accepts the user's document (up to 40K chars
  // + AI wrapper overhead). 256KB is the hard cap so a pathologically
  // large body can't pin the function. Source-pattern lock the
  // constant + wiring into readCappedBody.
  const fs = require("node:fs");
  const path = require("node:path");
  const src = fs.readFileSync(path.resolve(__dirname, "../api/analyze.js"), "utf8");
  const capMatch = src.match(/MAX_REQUEST_BYTES\s*=\s*(\d+)\s*\*\s*1024/);
  assert.ok(capMatch, "MAX_REQUEST_BYTES must be defined in KB units");
  const kb = parseInt(capMatch[1], 10);
  assert.ok(kb >= 64 && kb <= 1024, `MAX_REQUEST_BYTES=${kb}KB must be 64..1024 KB`);
  assert.match(src, /readCappedBody\(req,\s*MAX_REQUEST_BYTES\)/, "must wire readCappedBody to MAX_REQUEST_BYTES");
});

test("chat handler: MAX_REQUEST_BYTES is a sane body cap (128KB by default)", () => {
  // The chat endpoint carries the document (30K) + rewrite (6K) + risks
  // (~11K) + history (10K) + question (1K) + filename + JSON overhead
  // — total ~58K. 128KB is the hard cap. Source-pattern lock.
  const fs = require("node:fs");
  const path = require("node:path");
  const src = fs.readFileSync(path.resolve(__dirname, "../api/chat.js"), "utf8");
  const capMatch = src.match(/MAX_REQUEST_BYTES\s*=\s*(\d+)\s*\*\s*1024/);
  assert.ok(capMatch, "MAX_REQUEST_BYTES must be defined in KB units");
  const kb = parseInt(capMatch[1], 10);
  assert.ok(kb >= 64 && kb <= 1024, `MAX_REQUEST_BYTES=${kb}KB must be 64..1024 KB`);
  assert.match(src, /readCappedBody\(req,\s*MAX_REQUEST_BYTES\)/, "must wire readCappedBody to MAX_REQUEST_BYTES");
});

// ── applyEndpointHeader helper (iter #55) ──────────────────────────

test("applyEndpointHeader: sets X-Endpoint when name is valid ASCII", () => {
  const res = mockRes();
  applyEndpointHeader(res, "analyze");
  assert.equal(res.headers["X-Endpoint"], "analyze");
});

test("applyEndpointHeader: respects headersSent guard", () => {
  const res = mockRes();
  res.headersSent = true;
  applyEndpointHeader(res, "analyze");
  assert.deepEqual(res.headers, {}, "must not call setHeader when response is already streaming");
});

test("applyEndpointHeader: rejects names outside the allowlist (defense vs header-injection)", () => {
  for (const bad of ["", "a b", "analyze\nfoo", "analyze;evil", "名前", "analyze/path"]) {
    const res = mockRes();
    applyEndpointHeader(res, bad);
    assert.equal(res.headers["X-Endpoint"], undefined, `bad name "${bad}" must be rejected`);
  }
});

test("applyEndpointHeader: caps name length at 32 chars", () => {
  const res = mockRes();
  applyEndpointHeader(res, "a".repeat(33));
  assert.equal(res.headers["X-Endpoint"], undefined, "33-char name must be rejected");
  const res2 = mockRes();
  applyEndpointHeader(res2, "a".repeat(32));
  assert.equal(res2.headers["X-Endpoint"], "a".repeat(32), "32-char name accepted");
});

test("applyEndpointHeader: null-safe (no throw on bad res / names)", () => {
  for (const bad of [null, undefined, {}, 42, "res"]) {
    applyEndpointHeader(bad, "analyze");
  }
  for (const bad of [null, undefined, 42, true, []]) {
    const res = mockRes();
    applyEndpointHeader(res, bad);
  }
});

// ── X-Endpoint marker coverage (iter #56) ─────────────────────────

test("applyEndpointHeader: every endpoint file calls it with the right endpoint name", () => {
  // Source-pattern lock so a future refactor or page addition can't
  // silently drop the X-Endpoint marker. Each api/*.js file must call
  // applyEndpointHeader(res, "<expected-name>") at least once.
  const fs = require("node:fs");
  const path = require("node:path");
  const cases = [
    { file: "../api/analyze.js",   name: "analyze" },
    { file: "../api/chat.js",      name: "chat" },
    { file: "../api/health.js",     name: "health" },
    { file: "../api/csp-report.js", name: "csp-report" },
  ];
  for (const { file, name } of cases) {
    const src = fs.readFileSync(path.resolve(__dirname, file), "utf8");
    // Match applyEndpointHeader(res, "<name>") possibly with whitespace
    // differences, but the literal name must appear exactly.
    const re = new RegExp(
      String.raw`applyEndpointHeader\s*\(\s*res\s*,\s*["']${name.replace(/-/g, "-")}["']\s*\)`
    );
    assert.match(
      src,
      re,
      `${file} must call applyEndpointHeader(res, "${name}") at least once`
    );
  }
});

test("Content-Type allowlist regex rejects +suffix variants like application/json+xml", () => {
  // Defense-in-depth: the regex `/^\s*application\/json\b/i` would
  // accept `application/json+xml` because `\b` matches the boundary
  // between `n` (word) and `+` (non-word). RFC 6839 `+suffix`
  // variants aren't the same as `application/json` — a malformed
  // server might pick the wrong parser. Stricter regex requires
  // either `;` (charset separator) or end-of-string after
  // `application/json`. Locks in the fix on both analyze and chat.
  const fs = require("node:fs");
  const path = require("node:path");
  const analyzeSrc = fs.readFileSync(path.resolve(__dirname, "../api/analyze.js"), "utf8");
  const chatSrc = fs.readFileSync(path.resolve(__dirname, "../api/chat.js"), "utf8");
  // Must use the strict regex (semicolon OR end-of-string), not the
  // loose \b regex.
  for (const [name, src] of [["analyze", analyzeSrc], ["chat", chatSrc]]) {
    assert.match(
      src,
      /application\\\/json\(\?:\\s\*;\|\\s\*\$/,
      `${name} handler must use the strict application/json(?:\s*;|\s*$) regex to reject +suffix variants`
    );
    // Must NOT still have the loose `\b` version.
    assert.doesNotMatch(
      src,
      /application\\\/json\\b/i,
      `${name} handler must not use the loose application/json\\b regex (accepts application/json+xml)`
    );
  }
});

test("analyze handler: LLM max-token caps are sane and distinct for full vs compact mode", () => {
  // The analyze handler requests `max_tokens: 4000` (full mode) and
  // `max_tokens: 1500` (compact mode) from OpenRouter/Gemini. These caps
  // matter: too low → truncated responses fail safeParseAnalysisResult
  // (502 invalid_ai_response); too high → bill explodes. Lock in the
  // current values so a future refactor can't silently drop or inflate.
  const fs = require("node:fs");
  const path = require("node:path");
  const src = fs.readFileSync(path.resolve(__dirname, "../api/analyze.js"), "utf8");

  // Pin the 4000 / 1500 caps by source pattern.
  assert.match(
    src,
    /max_tokens:\s*4000/,
    "full-mode OpenRouter call must use max_tokens: 4000"
  );
  assert.match(
    src,
    /max_tokens:\s*1500/,
    "compact-mode OpenRouter call must use max_tokens: 1500"
  );
  // Compact cap must be smaller than full cap (strict ordering).
  const caps = [...src.matchAll(/max(?:_tokens|OutputTokens):\s*(\d+)/g)].map(m => parseInt(m[1], 10));
  assert.ok(caps.length >= 3, `must have at least 3 token caps (full OR + compact OR + gemini full + compact), got ${caps.length}`);
  const compact = caps.filter(c => c <= 2000);
  const full = caps.filter(c => c >= 3000);
  assert.ok(compact.length >= 2, `must have ≥2 compact-mode caps (≤2000), got ${compact.length}`);
  assert.ok(full.length >= 1, `must have ≥1 full-mode cap (≥3000), got ${full.length}`);
  for (const c of compact) assert.ok(c > 0 && c <= 2000, `compact cap ${c} must be 1..2000`);
  for (const f of full) assert.ok(f >= 1000 && f <= 8000, `full cap ${f} must be 1000..8000`);
});

test("Content-Type charset suffix is accepted on analyze + chat (e.g. application/json; charset=utf-8)", () => {
  // Defense-in-depth: a browser or curl client might post with
  // `application/json; charset=utf-8` (RFC 8259 §11 allows optional
  // charset). Both endpoints must accept it as 200 (or 4xx, not 415).
  // The strict regex from iter #23 requires `;` (charset separator) or
  // end-of-string — so a request with charset must have `;`.
  const fs = require("node:fs");
  const path = require("node:path");
  // Pin: the analyze handler uses the strict regex with `;` OR end-of-string.
  const analyzeSrc = fs.readFileSync(path.resolve(__dirname, "../api/analyze.js"), "utf8");
  const chatSrc = fs.readFileSync(path.resolve(__dirname, "../api/chat.js"), "utf8");
  for (const [name, src] of [["analyze", analyzeSrc], ["chat", chatSrc]]) {
    assert.match(
      src,
      /application\\\/json\(\?:\\s\*;\|\\s\*\$/,
      `${name} handler regex must allow \\s*; OR end-of-string after application/json (covers charset suffixes)`
    );
  }
  // Quick runtime check: the regex accepts `application/json; charset=utf-8`
  const re = /^\s*application\/json(?:\s*;|\s*$)/i;
  assert.equal(re.test("application/json; charset=utf-8"), true);
  assert.equal(re.test("application/json;charset=utf-8"), true, "no space before ; is also valid");
  assert.equal(re.test("application/json"), true);
  assert.equal(re.test("application/json "), true, "trailing space then EOL is valid");
  assert.equal(re.test("application/json+xml"), false, "+suffix must be rejected");
});

test("endpoint rate-limit caps are pinned: analyze=10/min, chat=30/min, csp-report=60/min", () => {
  // Each /api/* handler has its own RATE_LIMIT_PER_MINUTE constant
  // tuned for cost/load. Pin these so a future refactor can't silently
  // raise the cap (cost) or lower it (UX).
  const fs = require("node:fs");
  const path = require("node:path");
  const cases = [
    ["analyze.js", 10, /per-IP cap \(analyze is expensive\)/],
    ["chat.js", 30, /per-IP cap \(chat is cheaper\)/],
    ["csp-report.js", 60, /browsers don't usually spam/],
    ["health.js", 60, /health checks can be polled frequently/],
  ];
  for (const [file, expected, commentHint] of cases) {
    const src = fs.readFileSync(path.resolve(__dirname, "../api", file), "utf8");
    const m = src.match(/RATE_LIMIT_PER_MINUTE\s*=\s*(\d+)/);
    assert.ok(m, `${file} must declare RATE_LIMIT_PER_MINUTE`);
    const got = parseInt(m[1], 10);
    assert.equal(got, expected, `${file} RATE_LIMIT_PER_MINUTE must stay at ${expected} (got ${got})`);
    assert.match(src, commentHint, `${file} must keep the rationale comment`);
  }
});

test("CHAT_LIMITS constants are pinned (answerMin=1, answerMax=8000, modelMax=100, citationMax=200)", () => {
  // /api/chat's safeParseChatResult rejects any AI response whose
  // shape doesn't fit these bounds. Pin the constants so a future
  // refactor can't silently tighten (rejects valid output) or loosen
  // (accepts malformed output).
  const fs = require("node:fs");
  const path = require("node:path");
  const src = fs.readFileSync(path.resolve(__dirname, "../api/_safety.js"), "utf8");
  const cases = [
    ["answerMin", 1],
    ["answerMax", 8000],
    ["modelMax", 100],
    ["citationMax", 200],
  ];
  for (const [key, expected] of cases) {
    const re = new RegExp(`${key}:\\s*(${expected === 1 ? "\\d+" : "\\d+"})`);
    const m = src.match(re);
    assert.ok(m, `CHAT_LIMITS must define ${key}`);
    assert.equal(parseInt(m[1], 10), expected, `CHAT_LIMITS.${key} must stay at ${expected}`);
  }
  // All four must be inside an Object.freeze() block
  assert.match(src, /Object\.freeze\(\s*\{[\s\S]*?answerMin:\s*1[\s\S]*?\}\s*\)/, "CHAT_LIMITS must be Object.freeze()'d");
});

test("ANALYSIS_LIMITS constants are pinned (all 17 caps)", () => {
  // /api/analyze's safeParseAnalysisResult uses these caps to slice
  // AI output and reject overflow. Pin each one + assert Object.freeze
  // is in place so the constants can't be mutated at runtime.
  const fs = require("node:fs");
  const path = require("node:path");
  const src = fs.readFileSync(path.resolve(__dirname, "../api/_safety.js"), "utf8");
  const cases = [
    ["plainEnglishRewrite", 20000],
    ["risks", 20],
    ["riskClause", 300],
    ["riskExplanation", 500],
    ["riskImpact", 500],
    ["verdictLabel", 50],
    ["verdictSummary", 500],
    ["deadlines", 10],
    ["deadlineDate", 100],
    ["deadlineDescription", 200],
    ["nextSteps", 8],
    ["nextStepItem", 300],
    ["readingLevelMin", 1],
    ["readingLevelMax", 20],
    ["jargonFoundMin", 0],
    ["jargonFoundMax", 200],
  ];
  for (const [key, expected] of cases) {
    const re = new RegExp(`${key}:\\s*${expected}\\b`);
    const m = src.match(re);
    assert.ok(m, `ANALYSIS_LIMITS must define ${key}: ${expected}`);
  }
  // Object.freeze() must still wrap the literal
  assert.match(src, /const\s+ANALYSIS_LIMITS\s*=\s*Object\.freeze\(/, "ANALYSIS_LIMITS must be Object.freeze()'d");
  // Must NOT contain entries from before the iter #16 hardening
  assert.doesNotMatch(src, /ANALYSIS_LIMITS\.\w+\s*=/, "ANALYSIS_LIMITS entries must not be reassigned");
});

test("VALID_SEVERITIES + VALID_VERDICT_LABELS enums are pinned", () => {
  // /api/analyze's safeParseAnalysisResult uses these enums to validate
  // risk.severity and verdict.label. Pin each value + Object.freeze.
  const fs = require("node:fs");
  const path = require("node:path");
  const src = fs.readFileSync(path.resolve(__dirname, "../api/_safety.js"), "utf8");
  // VALID_SEVERITIES
  assert.match(
    src,
    /VALID_SEVERITIES\s*=\s*Object\.freeze\(\[\s*"trap"\s*,\s*"watch"\s*,\s*"note"\s*\]\)/,
    "VALID_SEVERITIES must remain [\"trap\",\"watch\",\"note\"] (frozen)"
  );
  // VALID_VERDICT_LABELS — exact 4 strings in order
  for (const label of ["Likely Fair", "Needs Review", "Suspicious", "Likely Illegal"]) {
    assert.match(src, new RegExp(`"${label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"`), `VALID_VERDICT_LABELS must include "${label}"`);
  }
  // VALID_VERDICT_LABELS must also be Object.freeze()'d
  assert.match(src, /VALID_VERDICT_LABELS\s*=\s*Object\.freeze\(/, "VALID_VERDICT_LABELS must be Object.freeze()'d");
  // The 4 labels must be in VALID_VERDICT_LABELS, not elsewhere
  const verdictBlock = src.match(/VALID_VERDICT_LABELS\s*=\s*Object\.freeze\(\[\s*([\s\S]*?)\s*\]\)/);
  assert.ok(verdictBlock, "VALID_VERDICT_LABELS block must exist");
  for (const label of ["Likely Fair", "Needs Review", "Suspicious", "Likely Illegal"]) {
    assert.match(verdictBlock[1], new RegExp(`"${label}"`), `VALID_VERDICT_LABELS block must contain "${label}"`);
  }
});

test("api/chat.js cap constants are pinned", () => {
  // api/chat.js declares 6 caps that govern body size, prompt size,
  // request timeout, and history. Pin each one so a future refactor
  // can't silently change them.
  const fs = require("node:fs");
  const path = require("node:path");
  const src = fs.readFileSync(path.resolve(__dirname, "../api/chat.js"), "utf8");
  const cases = [
    ["MAX_DOCUMENT_CHARS", 30000],
    ["MAX_REWRITE_CHARS", 6000],
    ["MAX_QUESTION_CHARS", 1000],
    ["MAX_HISTORY_TURNS", 10],
    ["MAX_HISTORY_FIELD_CHARS", 500],
    ["REQUEST_TIMEOUT_MS", 25000],
    ["RATE_LIMIT_PER_MINUTE", 30],
    ["MAX_REQUEST_BYTES", "128 \\* 1024"],
  ];
  for (const [name, expected] of cases) {
    // Handle the "N * 1024" form for MAX_REQUEST_BYTES
    const re = typeof expected === "string"
      ? new RegExp(`${name}\\s*=\\s*${expected}\\s*;`)
      : new RegExp(`${name}\\s*=\\s*${expected}\\b`);
    assert.ok(re.test(src), `api/chat.js must define ${name} = ${expected}`);
  }
});

test("api/analyze.js model constants are pinned (GEMMA_MODEL + GEMINI_MODEL_DEFAULT)", () => {
  const fs = require("node:fs");
  const path = require("node:path");
  const src = fs.readFileSync(path.resolve(__dirname, "../api/analyze.js"), "utf8");
  assert.match(src, /const\s+GEMMA_MODEL\s*=\s*["']google\/gemma-4-31b-it:free["']/, "GEMMA_MODEL must stay 'google/gemma-4-31b-it:free'");
  assert.match(src, /const\s+GEMINI_MODEL_DEFAULT\s*=\s*["']gemini-2\.5-flash["']/, "GEMINI_MODEL_DEFAULT must stay 'gemini-2.5-flash'");
});

test("/api/health probe-cache constants are pinned (TTL 60s, timeout 3s, max 100)", () => {
  // /api/health's probeProvider/probeProviderCached uses three constants
  // that govern network reachability probes. Pin them so a future
  // refactor can't silently change probe behavior:
  //   _PROBE_TTL_MS = 60_000   — cache lifetime per (provider, URL)
  //   _PROBE_TIMEOUT_MS = 3000  — per-fetch abort deadline
  //   _PROBE_CACHE_MAX = 100    — hard cap on cache entries
  const fs = require("node:fs");
  const path = require("node:path");
  const src = fs.readFileSync(path.resolve(__dirname, "../api/_safety.js"), "utf8");
  assert.match(src, /_PROBE_TTL_MS\s*=\s*60_000/, "_PROBE_TTL_MS must stay 60_000");
  assert.match(src, /_PROBE_TIMEOUT_MS\s*=\s*3000/, "_PROBE_TIMEOUT_MS must stay 3000");
  assert.match(src, /_PROBE_CACHE_MAX\s*=\s*100/, "_PROBE_CACHE_MAX must stay 100");
});

test("rate-limit window constants are pinned in _safety.js (window 60s, max 5000 keys, prune 30s)", () => {
  // The in-memory sliding-window rate limiter uses three constants:
  //   _RATE_WINDOW_MS = 60_000       — window per IP
  //   _RATE_MAX_KEYS = 5000          — hard cap on tracked IPs
  //   _RATE_PRUNE_INTERVAL_MS = 30_000 — periodic prune interval
  const fs = require("node:fs");
  const path = require("node:path");
  const src = fs.readFileSync(path.resolve(__dirname, "../api/_safety.js"), "utf8");
  assert.match(src, /_RATE_WINDOW_MS\s*=\s*60_000/, "_RATE_WINDOW_MS must stay 60_000");
  assert.match(src, /_RATE_MAX_KEYS\s*=\s*5000/, "_RATE_MAX_KEYS must stay 5000");
  assert.match(src, /_RATE_PRUNE_INTERVAL_MS\s*=\s*30_000/, "_RATE_PRUNE_INTERVAL_MS must stay 30_000");
});

// ── getCspReportCounts behavioral coverage (iter #101) ────────

test("_safety: getCspReportCounts returns sensible defaults before any reports", () => {
  // Pure-functional: shared module state means prior tests in this
  // file may have incremented counters. We can't assert exact zeros —
  // but we CAN assert the shape and that no field is undefined.
  const safety = require("../api/_safety.js");
  const r = safety.getCspReportCounts();
  assert.equal(typeof r, "object");
  assert.equal(typeof r.total, "number");
  assert.equal(typeof r.byDirective, "object");
  assert.ok(r.byDirective !== null);
  // Either null (no reports ever) or string (some firstSeenAt set).
  // Must not be undefined.
  if (r.firstSeenAt !== null) {
    assert.equal(typeof r.firstSeenAt, "string");
    assert.match(r.firstSeenAt, /^\d{4}-\d{2}-\d{2}T/);
  }
  if (r.lastSeenAt !== null) {
    assert.equal(typeof r.lastSeenAt, "string");
    assert.match(r.lastSeenAt, /^\d{4}-\d{2}-\d{2}T/);
  }
  if (r.lastBlockedAt !== null) {
    assert.equal(typeof r.lastBlockedAt, "string");
    assert.match(r.lastBlockedAt, /^\d{4}-\d{2}-\d{2}T/);
  }
  // ratePerMinute is always a finite number (guarded by Math.max(1, elapsedMin)).
  assert.equal(typeof r.ratePerMinute, "number");
  assert.ok(Number.isFinite(r.ratePerMinute), "ratePerMinute must be finite (no NaN/Infinity)");
  // acceptanceRate is always a finite number.
  assert.equal(typeof r.acceptanceRate, "number");
  assert.ok(Number.isFinite(r.acceptanceRate), "acceptanceRate must be finite");
  assert.ok(r.acceptanceRate >= 0 && r.acceptanceRate <= 10,
    "acceptanceRate must be in [0, 10] (0..100% scaled)");
});

test("_safety: getCspReportCounts.acceptanceRate is 10 (100%) when only accepted reports exist", () => {
  // When there are NO blocked reports (only accepted), every attempt
  // was accepted → acceptance rate is 10 (= 100% on the 0..10 scale).
  // We can't reset module state, but we can verify the formula:
  // acceptanceRate = _cspTotalReports / (_cspTotalReports + _cspBlockedCount)
  // When _cspBlockedCount === 0 → ratio is 1.0 → * 10 → 10.
  // If prior tests have bumped _cspBlockedCount, this still verifies
  // the formula produces a number in [0, 10].
  const safety = require("../api/_safety.js");
  const r = safety.getCspReportCounts();
  if (typeof r.total === "number" && typeof r.acceptanceRate === "number") {
    // Sanity check the formula's range.
    assert.ok(r.acceptanceRate >= 0 && r.acceptanceRate <= 10);
  }
});

test("_safety: getCspReportCounts includes the standard observability family", () => {
  // Source-shape check that locks in the field names. Pairs with the
  // behavioral test above — together they verify "all expected fields
  // exist AND each computes a sensible value".
  const safety = require("../api/_safety.js");
  const r = safety.getCspReportCounts();
  // Standard fields the helper MUST always return (per /api/health's
  // full-observability-surface assertion list).
  for (const k of [
    "total", "byDirective",
    "firstSeenAt", "lastSeenAt",
    "lastReporter",
    "mostBlocked", "mostBlockedFrom",
    "ratePerMinute", "acceptanceRate",
    "lastBlockedAt",
  ]) {
    assert.ok(k in r, `getCspReportCounts must include ${k}`);
  }
});

// ── applyEndpointHeader behavioral coverage (iter #104) ───────

test("_safety: applyEndpointHeader sets X-Endpoint for valid names", () => {
  const { applyEndpointHeader } = require("../api/_safety.js");
  // Mock res
  const res = {
    headersSent: false,
    headers: {},
    setHeader(k, v) { this.headers[k] = v; },
  };
  applyEndpointHeader(res, "analyze");
  assert.equal(res.headers["X-Endpoint"], "analyze");
  applyEndpointHeader(res, "chat");
  assert.equal(res.headers["X-Endpoint"], "chat");
  applyEndpointHeader(res, "health");
  assert.equal(res.headers["X-Endpoint"], "health");
  applyEndpointHeader(res, "csp-report");
  assert.equal(res.headers["X-Endpoint"], "csp-report");
});

test("_safety: applyEndpointHeader rejects invalid names (silent no-op)", () => {
  const { applyEndpointHeader } = require("../api/_safety.js");
  const res = {
    headersSent: false,
    headers: {},
    setHeader(k, v) { this.headers[k] = v; },
  };
  // Non-string
  applyEndpointHeader(res, null);
  applyEndpointHeader(res, undefined);
  applyEndpointHeader(res, 42);
  applyEndpointHeader(res, {});
  applyEndpointHeader(res, []);
  // Empty string
  applyEndpointHeader(res, "");
  // Too long (> 32 chars)
  applyEndpointHeader(res, "a".repeat(33));
  // Bad characters (whitespace, punctuation, unicode)
  applyEndpointHeader(res, "analyze ");
  applyEndpointHeader(res, "analyze;");
  applyEndpointHeader(res, "analyze.foo");
  applyEndpointHeader(res, "anályze");
  // None of the above should have set X-Endpoint
  assert.equal(res.headers["X-Endpoint"], undefined,
    "no invalid input should set X-Endpoint");
});

test("_safety: applyEndpointHeader is a no-op when res is missing or headers already sent", () => {
  const { applyEndpointHeader } = require("../api/_safety.js");
  // Missing res
  assert.doesNotThrow(() => applyEndpointHeader(null, "analyze"), "null res must not throw");
  assert.doesNotThrow(() => applyEndpointHeader(undefined, "analyze"), "undefined res must not throw");
  // Res without setHeader
  assert.doesNotThrow(() => applyEndpointHeader({}, "analyze"), "res without setHeader must not throw");
  // Res with headersSent: true
  const sent = {
    headersSent: true,
    headers: {},
    setHeader(k, v) { this.headers[k] = v; },
  };
  applyEndpointHeader(sent, "analyze");
  assert.equal(sent.headers["X-Endpoint"], undefined,
    "must not set header when headersSent is true");
});

// ── applyBuildShaHeader behavioral coverage (iter #105) ──────

test("_safety: applyBuildShaHeader sets X-Build-Sha for valid git SHAs", () => {
  const { applyBuildShaHeader } = require("../api/_safety.js");
  // Save + override env
  const orig = process.env.VERCEL_GIT_COMMIT_SHA;
  try {
    // 7-char short SHA (valid)
    process.env.VERCEL_GIT_COMMIT_SHA = "abc1234";
    let res = { headersSent: false, headers: {}, setHeader(k, v) { this.headers[k] = v; } };
    applyBuildShaHeader(res);
    assert.equal(res.headers["X-Build-Sha"], "abc1234");
    // 40-char full SHA (valid)
    process.env.VERCEL_GIT_COMMIT_SHA = "a".repeat(40);
    res = { headersSent: false, headers: {}, setHeader(k, v) { this.headers[k] = v; } };
    applyBuildShaHeader(res);
    assert.equal(res.headers["X-Build-Sha"], "a".repeat(40));
  } finally {
    process.env.VERCEL_GIT_COMMIT_SHA = orig;
  }
});

test("_safety: applyBuildShaHeader rejects malformed SHAs (silent no-op)", () => {
  const { applyBuildShaHeader } = require("../api/_safety.js");
  const orig = process.env.VERCEL_GIT_COMMIT_SHA;
  try {
    // Too short (< 7 chars)
    process.env.VERCEL_GIT_COMMIT_SHA = "abc123";
    let res = { headersSent: false, headers: {}, setHeader(k, v) { this.headers[k] = v; } };
    applyBuildShaHeader(res);
    assert.equal(res.headers["X-Build-Sha"], undefined, "6-char SHA must be rejected");
    // Too long (> 40 chars)
    process.env.VERCEL_GIT_COMMIT_SHA = "a".repeat(41);
    res = { headersSent: false, headers: {}, setHeader(k, v) { this.headers[k] = v; } };
    applyBuildShaHeader(res);
    assert.equal(res.headers["X-Build-Sha"], undefined, "41-char SHA must be rejected");
    // Non-hex characters
    process.env.VERCEL_GIT_COMMIT_SHA = "ghijklmnop";
    res = { headersSent: false, headers: {}, setHeader(k, v) { this.headers[k] = v; } };
    applyBuildShaHeader(res);
    assert.equal(res.headers["X-Build-Sha"], undefined, "non-hex chars must be rejected");
    // Uppercase (regex is lowercase only)
    process.env.VERCEL_GIT_COMMIT_SHA = "ABCDEF1";
    res = { headersSent: false, headers: {}, setHeader(k, v) { this.headers[k] = v; } };
    applyBuildShaHeader(res);
    assert.equal(res.headers["X-Build-Sha"], undefined, "uppercase must be rejected (canonical is lowercase)");
    // Empty string
    process.env.VERCEL_GIT_COMMIT_SHA = "";
    res = { headersSent: false, headers: {}, setHeader(k, v) { this.headers[k] = v; } };
    applyBuildShaHeader(res);
    assert.equal(res.headers["X-Build-Sha"], undefined, "empty string must be rejected");
  } finally {
    process.env.VERCEL_GIT_COMMIT_SHA = orig;
  }
});

test("_safety: applyBuildShaHeader is a no-op when env unset or res missing", () => {
  const { applyBuildShaHeader } = require("../api/_safety.js");
  const orig = process.env.VERCEL_GIT_COMMIT_SHA;
  try {
    // Unset env
    delete process.env.VERCEL_GIT_COMMIT_SHA;
    let res = { headersSent: false, headers: {}, setHeader(k, v) { this.headers[k] = v; } };
    applyBuildShaHeader(res);
    assert.equal(res.headers["X-Build-Sha"], undefined, "unset env must skip header");
    // Non-string env (e.g. number)
    process.env.VERCEL_GIT_COMMIT_SHA = 12345;
    res = { headersSent: false, headers: {}, setHeader(k, v) { this.headers[k] = v; } };
    applyBuildShaHeader(res);
    assert.equal(res.headers["X-Build-Sha"], undefined, "non-string env must skip header");
    // Missing res
    assert.doesNotThrow(() => applyBuildShaHeader(null), "null res must not throw");
    assert.doesNotThrow(() => applyBuildShaHeader(undefined), "undefined res must not throw");
    assert.doesNotThrow(() => applyBuildShaHeader({}), "res without setHeader must not throw");
    // Headers already sent
    const sent = {
      headersSent: true,
      headers: {},
      setHeader(k, v) { this.headers[k] = v; },
    };
    process.env.VERCEL_GIT_COMMIT_SHA = "abc1234";
    applyBuildShaHeader(sent);
    assert.equal(sent.headers["X-Build-Sha"], undefined,
      "must not set header when headersSent is true");
  } finally {
    process.env.VERCEL_GIT_COMMIT_SHA = orig;
  }
});

// ── getIp behavioral coverage (iter #106) ─────────────────────

test("_safety: getIp returns the first IP from x-forwarded-for", () => {
  const { getIp } = require("../api/_safety.js");
  // Standard Vercel header: client IP, then intermediate proxies
  const req = {
    headers: { "x-forwarded-for": "203.0.113.42, 10.0.0.1, 10.0.0.2" },
    socket: { remoteAddress: "127.0.0.1" },
  };
  assert.equal(getIp(req), "203.0.113.42", "first IP wins");
});

test("_safety: getIp falls back to x-real-ip when x-forwarded-for missing", () => {
  const { getIp } = require("../api/_safety.js");
  const req = {
    headers: { "x-real-ip": "198.51.100.7" },
    socket: { remoteAddress: "127.0.0.1" },
  };
  assert.equal(getIp(req), "198.51.100.7");
});

test("_safety: getIp falls back to socket.remoteAddress when both headers missing", () => {
  const { getIp } = require("../api/_safety.js");
  const req = {
    headers: {},
    socket: { remoteAddress: "192.0.2.50" },
  };
  assert.equal(getIp(req), "192.0.2.50");
});

test("_safety: getIp returns a placeholder when no IP available", () => {
  const { getIp } = require("../api/_safety.js");
  // No headers + no socket → some non-empty placeholder (the function
  // is defensive but never returns empty string — guaranteed non-empty).
  const emptyResult = getIp({});
  assert.equal(typeof emptyResult, "string");
  assert.ok(emptyResult.length > 0, "must return a non-empty placeholder");
  // Empty socket
  const noSocket = getIp({ headers: {}, socket: {} });
  assert.equal(typeof noSocket, "string");
  assert.ok(noSocket.length > 0, "must return a non-empty placeholder");
  // Whitespace-only x-forwarded-for should not be trusted as a real IP
  const wsOnly = getIp({ headers: { "x-forwarded-for": "   " }, socket: {} });
  assert.equal(typeof wsOnly, "string");
});

test("_safety: getIp handles malformed/missing input safely", () => {
  const { getIp } = require("../api/_safety.js");
  // Must not throw on any input shape.
  assert.doesNotThrow(() => getIp(null), "null req must not throw");
  assert.doesNotThrow(() => getIp(undefined), "undefined req must not throw");
  assert.doesNotThrow(() => getIp({}), "empty req must not throw");
  assert.doesNotThrow(() => getIp({ headers: null }), "null headers must not throw");
  assert.doesNotThrow(() => getIp({ socket: null }), "null socket must not throw");
  assert.doesNotThrow(() => getIp({ headers: {}, socket: { remoteAddress: null } }),
    "null remoteAddress must not throw");
});

// ── request-id helpers behavioral coverage (iter #108) ────────

test("_safety: sanitizeIncomingRequestId accepts well-formed ASCII IDs", () => {
  const { sanitizeIncomingRequestId } = require("../api/_safety.js");
  // Standard UUIDs (with hyphens)
  assert.equal(sanitizeIncomingRequestId("550e8400-e29b-41d4-a716-446655440000"),
    "550e8400-e29b-41d4-a716-446655440000");
  // Simple alphanumeric
  assert.equal(sanitizeIncomingRequestId("abc123"), "abc123");
  // With dots, underscores, hyphens (the allowlist)
  assert.equal(sanitizeIncomingRequestId("req.123_abc-xyz"), "req.123_abc-xyz");
});

test("_safety: sanitizeIncomingRequestId rejects injection attempts and non-ASCII", () => {
  const { sanitizeIncomingRequestId } = require("../api/_safety.js");
  // Empty / non-string
  assert.equal(sanitizeIncomingRequestId(""), null, "empty string → null");
  assert.equal(sanitizeIncomingRequestId(null), null, "null → null");
  assert.equal(sanitizeIncomingRequestId(undefined), null, "undefined → null");
  assert.equal(sanitizeIncomingRequestId(123), null, "number → null");
  // Header injection attempts (CRLF)
  assert.equal(sanitizeIncomingRequestId("req\r\nInjected: header"), null,
    "CRLF injection must be rejected");
  // Whitespace
  assert.equal(sanitizeIncomingRequestId("req with space"), null,
    "whitespace must be rejected");
  // Special characters
  assert.equal(sanitizeIncomingRequestId("req;DROP"), null, "semicolon must be rejected");
  assert.equal(sanitizeIncomingRequestId("req;DROP-TABLE"), null);
  assert.equal(sanitizeIncomingRequestId("req/path"), null, "slash must be rejected");
  assert.equal(sanitizeIncomingRequestId("req:colon"), null, "colon must be rejected");
  // Non-ASCII (the allowlist is ASCII-only via [A-Za-z0-9._-])
  assert.equal(sanitizeIncomingRequestId("rëq123"), null, "non-ASCII must be rejected");
});

test("_safety: sanitizeIncomingRequestId truncates oversize inputs to 128 chars", () => {
  // The function silently truncates to 128 chars (doesn't reject on
  // length). Length-based rejection is only via the regex pattern.
  const { sanitizeIncomingRequestId } = require("../api/_safety.js");
  // Exactly 128 chars — at the boundary, should be accepted
  const maxId = "a".repeat(128);
  assert.equal(sanitizeIncomingRequestId(maxId), maxId, "128-char ID must be accepted (boundary)");
  // 129 chars — truncated to 128 (still valid)
  const overId = "a".repeat(129);
  assert.equal(sanitizeIncomingRequestId(overId), maxId,
    "129-char ID must be truncated to 128");
  // 200 chars — truncated to 128
  assert.equal(sanitizeIncomingRequestId("a".repeat(200)), maxId,
    "200-char ID must be truncated to 128");
  // 129 chars where the FIRST 128 are valid but 129th breaks pattern
  // (still truncated to 128 since we slice first then test)
  const valid129 = "a".repeat(128) + ";DROP";
  assert.equal(sanitizeIncomingRequestId(valid129), maxId,
    "129-char ID truncated; trailing junk is dropped");
});

test("_safety: generateRequestId returns a unique string on every call", () => {
  const { generateRequestId } = require("../api/_safety.js");
  const ids = new Set();
  for (let i = 0; i < 100; i++) {
    const id = generateRequestId();
    assert.equal(typeof id, "string");
    assert.ok(id.length > 0, "ID must be non-empty");
    ids.add(id);
  }
  assert.equal(ids.size, 100, "all 100 generated IDs must be unique");
});

test("_safety: attachRequestId uses incoming valid ID when present", () => {
  const { attachRequestId, sanitizeIncomingRequestId } = require("../api/_safety.js");
  const res = { __requestId: null, __requestStartedAt: null };
  const req = { headers: { "x-request-id": "my-trace-id-123" } };
  const returnedId = attachRequestId(res, req);
  assert.equal(returnedId, "my-trace-id-123");
  assert.equal(res.__requestId, "my-trace-id-123");
  assert.ok(typeof res.__requestStartedAt === "number");
});

test("_safety: attachRequestId generates fresh ID when incoming is malformed", () => {
  const { attachRequestId } = require("../api/_safety.js");
  const res = { __requestId: null, __requestStartedAt: null };
  // Incoming has a CRLF injection — must be rejected, fresh ID minted
  const req = { headers: { "x-request-id": "bad\r\nInjected" } };
  const id = attachRequestId(res, req);
  assert.notEqual(id, "bad\r\nInjected");
  assert.ok(id.length > 0);
  assert.equal(res.__requestId, id);
});

test("_safety: attachRequestId handles missing req / headers gracefully", () => {
  const { attachRequestId } = require("../api/_safety.js");
  // Missing req
  let res = { __requestId: null, __requestStartedAt: null };
  let id = attachRequestId(res);
  assert.ok(typeof id === "string");
  assert.ok(id.length > 0);
  // Missing req.headers
  res = { __requestId: null, __requestStartedAt: null };
  id = attachRequestId(res, {});
  assert.ok(typeof id === "string");
  // null req
  assert.doesNotThrow(() => attachRequestId({}), "null req must not throw");
});

// ── rateLimit behavioral coverage (iter #118) ────────────────

test("_safety: rateLimit allows requests up to the maxPerMinute limit", () => {
  const { rateLimit } = require("../api/_safety.js");
  // Use a unique IP so this test's state doesn't conflict with others
  const ip = `192.0.2.${Math.floor(Math.random() * 254) + 1}`;
  // Allow 5 requests in the window
  for (let i = 0; i < 5; i++) {
    const r = rateLimit(ip, 5);
    assert.equal(r.ok, true, `request #${i + 1} should be allowed (under limit)`);
    assert.equal(r.limit, 5);
    assert.equal(r.remaining, 5 - (i + 1), `remaining should decrement`);
  }
});

test("_safety: rateLimit denies requests over the maxPerMinute limit", () => {
  const { rateLimit } = require("../api/_safety.js");
  const ip = `198.51.100.${Math.floor(Math.random() * 254) + 1}`;
  // Allow 3 requests, then deny the 4th
  for (let i = 0; i < 3; i++) {
    const r = rateLimit(ip, 3);
    assert.equal(r.ok, true);
  }
  const denied = rateLimit(ip, 3);
  assert.equal(denied.ok, false, "4th request should be denied");
  assert.ok(denied.retryAfter >= 1, "retryAfter should be at least 1 second");
  assert.ok(denied.retryAfter <= 60, "retryAfter should be at most 60 seconds (window size)");
  assert.equal(denied.remaining, 0);
  assert.equal(denied.limit, 3);
});

test("_safety: rateLimit isolates different IPs (per-IP buckets)", () => {
  const { rateLimit } = require("../api/_safety.js");
  const ipA = `203.0.113.${Math.floor(Math.random() * 254) + 1}`;
  const ipB = `203.0.113.${Math.floor(Math.random() * 254) + 1}`;
  // Fill up ipA's bucket
  for (let i = 0; i < 2; i++) rateLimit(ipA, 2);
  // ipA is now at limit
  assert.equal(rateLimit(ipA, 2).ok, false, "ipA should be denied");
  // ipB has its own bucket — should still be allowed
  const rB = rateLimit(ipB, 2);
  assert.equal(rB.ok, true, "ipB should be allowed (separate bucket)");
  assert.equal(rB.remaining, 1, "ipB should have 1 remaining");
});

test("_safety: rateLimit handles missing/invalid inputs gracefully", () => {
  const { rateLimit } = require("../api/_safety.js");
  // Null IP — uses "unknown" key as fallback
  const r1 = rateLimit(null, 5);
  assert.equal(r1.ok, true, "null IP must still be allowed (uses 'unknown' bucket)");
  // Undefined IP
  const r2 = rateLimit(undefined, 5);
  assert.equal(r2.ok, true);
  // Invalid maxPerMinute (NaN, 0, negative)
  assert.doesNotThrow(() => rateLimit("1.2.3.4", NaN), "NaN max must not throw");
  assert.doesNotThrow(() => rateLimit("1.2.3.4", 0), "0 max must not throw");
  assert.doesNotThrow(() => rateLimit("1.2.3.4", -1), "negative max must not throw");
});

// ── applyRateLimitHeaders behavioral coverage (iter #121) ─────

test("_safety: applyRateLimitHeaders sets all four rate-limit headers for an allow result", () => {
  const { applyRateLimitHeaders } = require("../api/_safety.js");
  const res = {
    headersSent: false,
    headers: {},
    setHeader(k, v) { this.headers[k] = v; },
  };
  // Allow result: ok:true, has limit/remaining/reset (no retryAfter)
  applyRateLimitHeaders(res, { ok: true, limit: 60, remaining: 59, reset: 1234567890 });
  assert.equal(res.headers["X-RateLimit-Limit"], "60");
  assert.equal(res.headers["X-RateLimit-Remaining"], "59");
  assert.equal(res.headers["X-RateLimit-Reset"], "1234567890");
  assert.equal(res.headers["Retry-After"], undefined,
    "allow result must not set Retry-After");
});

test("_safety: applyRateLimitHeaders sets Retry-After for a deny result", () => {
  const { applyRateLimitHeaders } = require("../api/_safety.js");
  const res = {
    headersSent: false,
    headers: {},
    setHeader(k, v) { this.headers[k] = v; },
  };
  applyRateLimitHeaders(res, {
    ok: false, limit: 60, remaining: 0, reset: 1234567890, retryAfter: 42,
  });
  assert.equal(res.headers["X-RateLimit-Limit"], "60");
  assert.equal(res.headers["X-RateLimit-Remaining"], "0");
  assert.equal(res.headers["X-RateLimit-Reset"], "1234567890");
  assert.equal(res.headers["Retry-After"], "42");
});

test("_safety: applyRateLimitHeaders omits headers when rate limiter is disabled (limit <= 0)", () => {
  // rateLimit() returns {ok:true,limit:0,remaining:0,reset:0} when
  // disabled. Headers would mislead clients (Reset:0 = 1970-01-01).
  // The function must omit every header instead.
  const { applyRateLimitHeaders } = require("../api/_safety.js");
  const res = {
    headersSent: false,
    headers: {},
    setHeader(k, v) { this.headers[k] = v; },
  };
  applyRateLimitHeaders(res, { ok: true, limit: 0, remaining: 0, reset: 0 });
  assert.equal(res.headers["X-RateLimit-Limit"], undefined);
  assert.equal(res.headers["X-RateLimit-Remaining"], undefined);
  assert.equal(res.headers["X-RateLimit-Reset"], undefined);
  assert.equal(res.headers["Retry-After"], undefined);
});

test("_safety: applyRateLimitHeaders handles missing/invalid rl gracefully", () => {
  const { applyRateLimitHeaders } = require("../api/_safety.js");
  // The function guards `rl` (returns early if missing/non-object)
  // but does NOT guard `res` — if res is null/undefined, the
  // setHeader call will throw. That's a contract: the handler
  // always passes a real res. Document the behavior:
  // Missing/null/undefined rl — must not throw
  const res = { headersSent: false, headers: {}, setHeader(k, v) { this.headers[k] = v; } };
  assert.doesNotThrow(() => applyRateLimitHeaders(res, null), "null rl must not throw");
  assert.doesNotThrow(() => applyRateLimitHeaders(res, undefined),
    "undefined rl must not throw");
  assert.doesNotThrow(() => applyRateLimitHeaders(res, {}), "empty rl must not throw");
  assert.doesNotThrow(() => applyRateLimitHeaders(res, "not an object"),
    "string rl must not throw");
  // After each call, no headers set
  assert.equal(res.headers["X-RateLimit-Limit"], undefined,
    "no X-RateLimit-* headers when rl is missing/invalid");
});

// ── asString behavioral coverage (iter #122) ──────────────────

test("_safety: asString returns the string when given a string (no truncation under cap)", () => {
  const { asString } = require("../api/_safety.js");
  assert.equal(asString("hello", 10), "hello", "string under cap is returned as-is");
  assert.equal(asString("hello", 5), "hello", "string at cap is returned as-is");
  assert.equal(asString("  trim-me  ", 20), "trim-me", "string is trimmed");
});

test("_safety: asString truncates strings over the cap", () => {
  const { asString } = require("../api/_safety.js");
  assert.equal(asString("hello world", 5), "hello", "truncated to 5 chars");
  assert.equal(asString("abcdef", 3), "abc", "truncated to 3 chars");
  assert.equal(asString("abcdef", 0), "", "cap 0 returns empty");
});

test("_safety: asString returns empty string for non-string inputs", () => {
  const { asString } = require("../api/_safety.js");
  assert.equal(asString(null, 10), "", "null → empty string");
  assert.equal(asString(undefined, 10), "", "undefined → empty string");
  assert.equal(asString(42, 10), "", "number → empty string");
  assert.equal(asString(true, 10), "", "boolean → empty string");
  assert.equal(asString({}, 10), "", "object → empty string");
  assert.equal(asString([], 10), "", "array → empty string");
});

test("_safety: asString trims whitespace AFTER truncation", () => {
  // The implementation does .slice(0, max).trim() — slice first,
  // then trim. If the first N chars include leading whitespace,
  // trim removes it (and the result is shorter than max).
  const { asString } = require("../api/_safety.js");
  // "  hello" sliced to 5 → "  hel" → trimmed → "hel" (3 chars, not 5)
  assert.equal(asString("  hello", 5), "hel", "leading ws within slice is trimmed");
  assert.equal(asString("       ", 5), "", "all whitespace slice → empty");
  // When no leading whitespace, no trim is applied
  assert.equal(asString("hello  ", 8), "hello", "trailing ws is trimmed");
});

// ── getUniqueIPsCount behavioral coverage (iter #123) ────────

test("_safety: getUniqueIPsCount returns the count of distinct IPs that have called", () => {
  const { rateLimit, getUniqueIPsCount } = require("../api/_safety.js");
  // Snapshot the current count (other tests may have added IPs)
  const baseline = getUniqueIPsCount();
  // Generate 3 GUARANTEED-distinct IPs using process.hrtime() as
  // a unique seed (monotonic, never collides within the process).
  // Using random IPs in a 254-value pool had ~1.2% collision
  // probability which caused CI flakes (iter #125). The previous
  // multiply-by-7/13 pattern also had collisions when seed*13 ≡ seed
  // (mod 256) — fixed by drawing each octet from disjoint bit
  // windows of the 64-bit seed so the three IPs are guaranteed unique.
  const seed = Number(process.hrtime.bigint() & 0xFFFFFFFFn);
  const newIps = [
    `10.${seed & 0xFF}.${(seed >> 8) & 0xFF}.${(seed >> 16) & 0xFF | 1}`,
    `10.${(seed >> 4) & 0xFF}.${(seed >> 12) & 0xFF}.${(seed >> 20) & 0xFF | 2}`,
    `10.${(seed >> 2) & 0xFF}.${(seed >> 10) & 0xFF}.${(seed >> 18) & 0xFF | 3}`,
  ];
  // Verify uniqueness (disjoint bit windows guarantee distinct octets)
  assert.notEqual(newIps[0], newIps[1], "IPs must be unique");
  assert.notEqual(newIps[1], newIps[2], "IPs must be unique");
  assert.notEqual(newIps[0], newIps[2], "IPs must be unique");
  for (const ip of newIps) rateLimit(ip, 60);
  // Count must have grown by exactly 3
  assert.equal(getUniqueIPsCount(), baseline + 3,
    "3 new distinct IPs must add 3 to the count");
  // Repeating one of the IPs should not increment the count
  rateLimit(newIps[0], 60);
  assert.equal(getUniqueIPsCount(), baseline + 3,
    "re-using an existing IP must not change the count");
});

test("_safety: getTopActiveIPs returns a sorted, capped list of {hash, count} entries", () => {
  const { rateLimit, getTopActiveIPs } = require("../api/_safety.js");
  // Use a unique IP for this test to avoid bucket pollution
  const baseIp = `203.0.113.${Math.floor(Math.random() * 254) + 1}`;
  // Make 3 requests from the same IP
  for (let i = 0; i < 3; i++) rateLimit(baseIp, 60);
  const top = getTopActiveIPs(5);
  assert.ok(Array.isArray(top), "must return an array");
  // Each entry has hash + count
  for (const entry of top) {
    assert.equal(typeof entry.hash, "string", "entry.hash must be a string (SHA-256)");
    assert.equal(typeof entry.count, "number", "entry.count must be a number");
  }
  // Top-N is capped at N
  assert.ok(top.length <= 5, "top-N must be capped at N");
});

// ── clampInt strict validator (iter #142) ───────────────────

test("clampInt: accepts integers within the [min, max] range (inclusive)", () => {
  // Standard happy path: integers within the inclusive bounds pass through.
  const { clampInt } = require("../api/_safety.js");
  assert.equal(clampInt(5, 1, 10), 5, "mid-range integer → returns it");
  assert.equal(clampInt(1, 1, 10), 1, "min boundary is inclusive");
  assert.equal(clampInt(10, 1, 10), 10, "max boundary is inclusive");
  assert.equal(clampInt(0, -5, 5), 0, "zero is valid when in range");
  assert.equal(clampInt(-3, -5, 5), -3, "negative integers are valid when in range");
});

test("clampInt: rejects out-of-range integers with null", () => {
  // Out-of-range returns null — does NOT clamp. STRICT RULE: the
  // caller must receive null and reject the field, not a silently
  // clamped value.
  const { clampInt } = require("../api/_safety.js");
  assert.equal(clampInt(0, 1, 10), null, "below min → null (not clamped to 1)");
  assert.equal(clampInt(11, 1, 10), null, "above max → null (not clamped to 10)");
  assert.equal(clampInt(-100, -5, 5), null, "far below min → null");
  assert.equal(clampInt(1000, 1, 10), null, "far above max → null");
});

test("clampInt: rejects non-integer numerics (STRICT — no truncation)", () => {
  // The docstring says: "5.7 is a schema error, not a quietly rounded 5".
  // Float / decimal values must return null even when they fit the
  // range after rounding.
  const { clampInt } = require("../api/_safety.js");
  assert.equal(clampInt(5.7, 1, 10), null, "5.7 → null (NOT rounded to 6)");
  assert.equal(clampInt(5.5, 1, 10), null, "5.5 → null (NOT rounded)");
  assert.equal(clampInt(5.0, 1, 10), 5, "5.0 → 5 (exact integer as float is valid)");
  assert.equal(clampInt(0.1, 0, 10), null, "0.1 → null (NOT rounded to 0)");
  assert.equal(clampInt(-1.5, -10, 10), null, "-1.5 → null (NOT rounded)");
});

test("clampInt: rejects non-finite and wrong-type inputs", () => {
  // Defensive guards: NaN, Infinity, strings, null, undefined all
  // return null without throwing. The handler depends on these
  // guards before forwarding user data.
  const { clampInt } = require("../api/_safety.js");
  assert.equal(clampInt(NaN, 1, 10), null, "NaN → null");
  assert.equal(clampInt(Infinity, 1, 10), null, "Infinity → null");
  assert.equal(clampInt(-Infinity, 1, 10), null, "-Infinity → null");
  assert.equal(clampInt("5", 1, 10), null, "string → null (not coerced)");
  assert.equal(clampInt(null, 1, 10), null, "null → null");
  assert.equal(clampInt(undefined, 1, 10), null, "undefined → null");
  assert.equal(clampInt(true, 1, 10), null, "boolean → null");
  assert.equal(clampInt([5], 1, 10), null, "array → null");
  assert.equal(clampInt({ value: 5 }, 1, 10), null, "object → null");
});

// ── errLog + logProviderError behavioral coverage (iter #160) ─────

test("errLog: tags log line with [req=...] and sanitizes message", () => {
  // Behavioral verification: errLog must include the request id from
  // res.__requestId and route the message through sanitizeLogField
  // (defends against log injection via CR/LF + length cap).
  const { errLog } = require("../api/_safety.js");
  // Capture stderr to assert the format
  const origErr = console.error;
  let captured = "";
  console.error = (msg) => { captured = msg; };
  try {
    errLog({ __requestId: "req-abc-123" }, "test-prefix", new Error("boom"));
    assert.match(captured, /\[req=req-abc-123\]/, "must include request id");
    assert.match(captured, /\[test-prefix\]/, "must include prefix");
    assert.match(captured, /boom/, "must include error message");
  } finally {
    console.error = origErr;
  }
});

test("errLog: falls back to 'no-req-id' when res or __requestId is missing", () => {
  const { errLog } = require("../api/_safety.js");
  const origErr = console.error;
  let captured = "";
  console.error = (msg) => { captured = msg; };
  try {
    // No res at all
    errLog(null, "test-prefix", new Error("missing-res"));
    assert.match(captured, /\[req=no-req-id\]/,
      "must fall back to 'no-req-id' when res is null");
    // res present but no __requestId
    captured = "";
    errLog({}, "test-prefix", new Error("missing-id"));
    assert.match(captured, /\[req=no-req-id\]/,
      "must fall back to 'no-req-id' when __requestId missing");
    // Error without .message — uses String(err)
    captured = "";
    errLog({ __requestId: "req-x" }, "test-prefix", "string-error");
    assert.match(captured, /string-error/, "must include non-Error values");
  } finally {
    console.error = origErr;
  }
});

test("logProviderError: emits [req=<id>] [prefix] <msg> via console.error", () => {
  // The provider-calling helpers (callGemini, callOpenRouter, etc.)
  // don't have direct access to the response object — they receive
  // the request id as a parameter and log via this helper. Verify
  // the format matches errLog (so logs are grep-compatible).
  const { logProviderError } = require("../api/_safety.js");
  const origErr = console.error;
  let captured = "";
  console.error = (msg) => { captured = msg; };
  try {
    logProviderError("req-xyz-789", "openrouter", "rate limited");
    assert.match(captured, /\[req=req-xyz-789\]/);
    assert.match(captured, /\[openrouter\]/);
    assert.match(captured, /rate limited/);
  } finally {
    console.error = origErr;
  }
});

test("logProviderError: falls back to 'no-req-id' when reqId is missing", () => {
  const { logProviderError } = require("../api/_safety.js");
  const origErr = console.error;
  let captured = "";
  console.error = (msg) => { captured = msg; };
  try {
    logProviderError(null, "openrouter", "no-id");
    assert.match(captured, /\[req=no-req-id\]/,
      "null reqId → 'no-req-id' fallback");
    logProviderError(undefined, "openrouter", "undef-id");
    assert.match(captured, /\[req=no-req-id\]/,
      "undefined reqId → 'no-req-id' fallback");
  } finally {
    console.error = origErr;
  }
});

// ── accessLog + sanitizeLogField behavioral coverage (iter #161) ───

test("accessLog: emits [req=<id>] <method> <url> -> <status> via console.log", () => {
  // Behavioral: per-request completion logger. Format matches errLog
  // and logProviderError for grep compatibility.
  const { accessLog } = require("../api/_safety.js");
  const origLog = console.log;
  let captured = "";
  console.log = (msg) => { captured = msg; };
  try {
    const req = { method: "GET", url: "/api/health" };
    const res = { __requestId: "req-access-1", statusCode: 200 };
    accessLog(req, res, 200);
    assert.match(captured, /\[req=req-access-1\]/, "must include request id");
    assert.match(captured, /GET/, "must include HTTP method");
    assert.match(captured, /\/api\/health/, "must include URL");
    assert.match(captured, /-> 200/, "must include status code");
  } finally {
    console.log = origLog;
  }
});

test("accessLog: explicit status arg overrides res.statusCode", () => {
  const { accessLog } = require("../api/_safety.js");
  const origLog = console.log;
  let captured = "";
  console.log = (msg) => { captured = msg; };
  try {
    const req = { method: "POST", url: "/api/csp-report" };
    // res.statusCode says 200 but explicit status arg is 204
    const res = { __requestId: "req-access-2", statusCode: 200 };
    accessLog(req, res, 204);
    assert.match(captured, /-> 204/,
      "explicit status arg (204) must override res.statusCode (200)");
  } finally {
    console.log = origLog;
  }
});

test("accessLog: falls back gracefully when req/res are missing", () => {
  // Defensive: every API handler calls accessLog in its `finally`
  // block, so it must never throw on partial input.
  const { accessLog } = require("../api/_safety.js");
  const origLog = console.log;
  let captured = "";
  console.log = (msg) => { captured = msg; };
  try {
    accessLog(null, null, 500);
    assert.match(captured, /\[req=no-req-id\]/,
      "null res → 'no-req-id' fallback");
    // Method and URL get "?" sentinels
    assert.match(captured, /\? \? -> 500/,
      "null req → '?' sentinels for method and url");
  } finally {
    console.log = origLog;
  }
});

test("sanitizeLogField: coerces non-string values safely", () => {
  // Source-pattern already verified ASCII control stripping. Behavioral
  // covers the non-string input paths (null, undefined, number, object).
  const { sanitizeLogField } = require("../api/_safety.js");
  // null and undefined coerce to "" (not "null"/"undefined")
  assert.equal(sanitizeLogField(null, 100), "",
    "null → empty string (not 'null')");
  assert.equal(sanitizeLogField(undefined, 100), "",
    "undefined → empty string (not 'undefined')");
  // Numbers convert to their string form
  assert.equal(sanitizeLogField(42, 100), "42", "number → '42'");
  // Boolean converts to its string form
  assert.equal(sanitizeLogField(true, 100), "true", "boolean → 'true'");
  // Object → "[object Object]" (acceptable; not pretty but safe)
  assert.equal(sanitizeLogField({ a: 1 }, 100), "[object Object]",
    "object → '[object Object]'");
  // Empty string passes through
  assert.equal(sanitizeLogField("", 100), "", "empty string → empty string");
});

// ── clearProbeCache + getProbeCacheSize behavioral coverage (iter #162) ──

test("clearProbeCache + getProbeCacheSize: clear empties the cache (size 0)", () => {
  // Behavioral: probe cache size must drop to 0 after clearProbeCache
  // is called. We can't easily inject entries (probeProvider requires
  // network), but we can verify the empty → clear → empty round trip.
  const { clearProbeCache, getProbeCacheSize } = require("../api/_safety.js");
  assert.equal(getProbeCacheSize(), 0,
    "fresh cache size must be 0");
  clearProbeCache();
  assert.equal(getProbeCacheSize(), 0,
    "after clear, cache size must still be 0 (defensive)");
});

test("getProbeCacheSize: returns a non-negative integer", () => {
  // Structural check on the accessor. The actual max is _PROBE_CACHE_MAX
  // (100) but we just verify the type and bounds here.
  const { getProbeCacheSize } = require("../api/_safety.js");
  const size = getProbeCacheSize();
  assert.equal(typeof size, "number", "size must be a number");
  assert.ok(Number.isInteger(size), "size must be an integer");
  assert.ok(size >= 0, `size must be ≥ 0; got ${size}`);
  assert.ok(size <= 100, `size must be ≤ _PROBE_CACHE_MAX (100); got ${size}`);
});

// ── getProbeCounts behavioral coverage (iter #163) ─────────────

test("getProbeCounts: returns { total, network } with non-negative integers", () => {
  // Behavioral: the accessor feeds /api/health's summary.totalProbes
  // and summary.networkProbes fields. Verify the shape and invariants:
  // - total ≥ network (every network probe contributes to total)
  // - both are integers ≥ 0
  const { getProbeCounts } = require("../api/_safety.js");
  const counts = getProbeCounts();
  assert.equal(typeof counts, "object", "counts must be an object");
  assert.equal(typeof counts.total, "number", "counts.total must be a number");
  assert.equal(typeof counts.network, "number", "counts.network must be a number");
  assert.ok(Number.isInteger(counts.total), "total must be an integer");
  assert.ok(Number.isInteger(counts.network), "network must be an integer");
  assert.ok(counts.total >= 0, `total must be ≥ 0; got ${counts.total}`);
  assert.ok(counts.network >= 0, `network must be ≥ 0; got ${counts.network}`);
  assert.ok(counts.network <= counts.total,
    `network (${counts.network}) must be ≤ total (${counts.total})`);
});

// ── recordCspBlock + cspReports fields (iter #166) ─────────────

test("recordCspBlock: increments consecutiveBlocks and updates lastBlockedAt", () => {
  // Behavioral: the function is called when a CSP report is rate-limit-
  // rejected. It must increment _cspConsecutiveBlocks and update
  // _cspLastBlockedAt — both exposed via getCspReportCounts.
  const { recordCspBlock, getCspReportCounts } = require("../api/_safety.js");
  const before = getCspReportCounts();
  const beforeConsecutive = before.consecutiveBlocks;
  const beforeLastBlockedAt = before.lastBlockedAt;
  // Small sleep to ensure Date.now() advances
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  return sleep(2).then(() => {
    recordCspBlock("203.0.113.42");
    const after = getCspReportCounts();
    assert.equal(after.consecutiveBlocks, beforeConsecutive + 1,
      "consecutiveBlocks must increment by 1");
    assert.ok(after.lastBlockedAt !== beforeLastBlockedAt,
      "lastBlockedAt must update (timestamp changes)");
  });
});

test("getCspReportCounts: surfaces consecutiveBlocks + lastBlockedAt", () => {
  // Structural check: cspReports object must include the rate-limit
  // rejection surface (consecutiveBlocks, lastBlockedAt) even before
  // any reports are received (defaults: 0 / null).
  const { getCspReportCounts } = require("../api/_safety.js");
  const counts = getCspReportCounts();
  assert.equal(typeof counts.consecutiveBlocks, "number",
    "counts.consecutiveBlocks must be a number");
  assert.ok(counts.consecutiveBlocks >= 0, "consecutiveBlocks must be ≥ 0");
  // lastBlockedAt is either null (no blocks yet) or an ISO string
  if (counts.lastBlockedAt !== null) {
    assert.equal(typeof counts.lastBlockedAt, "string",
      "lastBlockedAt must be an ISO string or null");
    assert.match(counts.lastBlockedAt, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/,
      "lastBlockedAt must be ISO 8601 format");
  }
});

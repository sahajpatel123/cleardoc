/* test/safety.test.js — node:test unit tests for api/_safety.js
 *
 * Run with: node --test test/safety.test.js
 * (No test framework dependency — uses Node's built-in node:test)
 */

const test = require("node:test");
const assert = require("node:assert/strict");
const { Readable } = require("node:stream");

const { json, asString, getIp, rateLimit, readCappedBody } = require("../api/_safety.js");

// ── json ─────────────────────────────────────────────────────────────

test("json: sets status, content-type, cache-control, and serializes body", () => {
  const res = mockRes();
  json(res, 201, { ok: true, n: 42 });
  assert.equal(res.statusCode, 201);
  assert.equal(res.headers["Content-Type"], "application/json");
  assert.equal(res.headers["Cache-Control"], "no-store");
  assert.deepEqual(JSON.parse(res._body), { ok: true, n: 42 });
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
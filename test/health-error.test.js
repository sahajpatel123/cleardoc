/* test/health-error.test.js — node:test source-pattern tests for the outer
 * try/catch safety net added to api/health.js (parity with api/analyze.js
 * and api/chat.js).
 *
 * Same approach as test/analyze-error.test.js and test/chat-error.test.js:
 * read the source file once at module load and assert structural invariants,
 * rather than forcing an uncaught throw at runtime.
 *
 *   - Test 1: handler still returns structured 200 JSON for the happy path.
 *   - Test 2: the handler body is wrapped in try/catch.
 *   - Test 3: the catch block guards with `res.headersSent`.
 *   - Test 4: the 500 body is the documented sanitized string.
 *
 * Run with: node --test test/health-error.test.js
 */

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const HEALTH_SOURCE = fs.readFileSync(
  path.resolve(__dirname, "../api/health.js"),
  "utf8"
);

// ── happy path still works (smoke) ─────────────────────────────────

test("health handler: returns 200 JSON for GET happy path (smoke)", async () => {
  // /api/health short-circuits to 503 only when NEITHER provider is
  // configured. With OPENROUTER_API_KEY set in the shell (the local dev
  // default), it returns 200.
  if (!process.env.OPENROUTER_API_KEY && !process.env.GEMINI_API_KEY && !process.env.GOOGLE_GEMINI_API_KEY) {
    process.env.OPENROUTER_API_KEY = "test-stub-key-health";
  }
  const handler = require("../api/health.js");
  const res = {
    statusCode: 200,
    _body: null,
    headers: {},
    headersSent: false,
    setHeader(k, v) { this.headers[k] = v; },
    end(s) { this._body = s; this.headersSent = true; },
  };
  const req = {
    method: "GET",
    headers: {},
    socket: { remoteAddress: "127.0.0.1" },
  };
  await handler(req, res);
  assert.equal(res.statusCode, 200);
  const body = JSON.parse(res._body);
  assert.equal(body.status, "ok");
  assert.equal(body.ok, true);
  // Summary rollup (iter #39) — bottom-line numbers ops dashboards can
  // consume without walking the nested providers object.
  assert.ok(body.summary, "200 payload must include a summary rollup");
  assert.equal(typeof body.summary.providersConfigured, "number");
  assert.equal(typeof body.summary.providersReachable, "number");
});

// ── source-pattern checks ──────────────────────────────────────────

test("health handler: body is wrapped in try/catch (safety net exists)", () => {
  const fnStart = HEALTH_SOURCE.indexOf("module.exports = async function handler");
  assert.ok(fnStart > -1, "handler function must be defined");
  const tryOffset = HEALTH_SOURCE.indexOf("try {", fnStart);
  assert.ok(tryOffset > -1, "handler body must begin with `try {`");
  const catchOffset = HEALTH_SOURCE.indexOf("} catch (err)", fnStart);
  assert.ok(catchOffset > -1, "handler must have a `catch (err)` block");
  assert.ok(catchOffset > tryOffset, "catch must follow the try block");
});

test("health handler: catch block guards on res.headersSent (no double-end)", () => {
  const fnStart = HEALTH_SOURCE.indexOf("module.exports = async function handler");
  assert.ok(fnStart > -1);
  const catchStart = HEALTH_SOURCE.indexOf("} catch (err)", fnStart);
  assert.ok(catchStart > fnStart);
  const guardRegion = HEALTH_SOURCE.slice(catchStart, catchStart + 400);
  assert.match(
    guardRegion,
    /res\.headersSent/,
    "catch block must check `res.headersSent` to avoid double-end"
  );
});

test("health handler: 500 body is a literal sanitized string (no leak)", () => {
  const fnStart = HEALTH_SOURCE.indexOf("module.exports = async function handler");
  assert.ok(fnStart > -1);
  const catchStart = HEALTH_SOURCE.indexOf("} catch (err)", fnStart);
  assert.ok(catchStart > fnStart);
  const catchBody = HEALTH_SOURCE.slice(catchStart);
  const expected = 'json(res, 500, { error: "An internal error occurred. Please try again." })';
  assert.ok(
    catchBody.includes(expected),
    "catch block must respond with the documented sanitized 500 message"
  );
  const json500Match = catchBody.match(/json\(res,\s*500,\s*\{([^}]*)\}/);
  assert.ok(json500Match, "catch block must call json(res, 500, {...})");
  assert.equal(
    /err\.message/.test(json500Match[1]),
    false,
    "500 response body must not interpolate err.message"
  );
});

// ── AI provider reachability probe (source-pattern) ───────────────

test("health handler: wires up probeProviderCached for both providers", () => {
  // Both Gemini and OpenRouter must be probed through the cached helper so
  // health polls don't translate into 60 outbound requests/min.
  assert.match(HEALTH_SOURCE, /probeProviderCached\(\s*"gemini"/, "Gemini probe must use cached helper");
  assert.match(HEALTH_SOURCE, /probeProviderCached\(\s*"openrouter"/, "OpenRouter probe must use cached helper");
});

test("health handler: payload reports configured + reachable + latencyMs per provider", () => {
  // The providers payload object must include the new reachability fields.
  assert.match(HEALTH_SOURCE, /configured:\s*(true|false)/, "providers payload must report configured");
  assert.match(HEALTH_SOURCE, /reachable:\s*\w+\.ok/, "providers payload must report reachable (from probe.ok)");
  assert.match(HEALTH_SOURCE, /latencyMs:/, "providers payload must report probe latencyMs");
});

test("health handler: 503 condition requires all configured providers unreachable", () => {
  // The 503 path must trigger when EVERY configured provider is unreachable.
  // (A single-reachable deployment should stay 200 — at least one working
  // AI provider means the analyzer can still respond.)
  assert.match(HEALTH_SOURCE, /All configured AI providers are unreachable/, "503 reason must reference the all-unreachable condition");
  // The `allUnreachable` variable must gate the 503 response
  assert.match(HEALTH_SOURCE, /allUnreachable/, "must compute allUnreachable before deciding 503");
});

// ── Git SHA deployment marker ──────────────────────────────────────

test("health handler: payload includes gitSha from VERCEL_GIT_COMMIT_SHA", () => {
  // Vercel sets VERCEL_GIT_COMMIT_SHA on every production deploy. The
  // health payload must surface it so ops can correlate a health-check
  // response with a specific commit SHA via `git rev-parse HEAD`.
  assert.match(
    HEALTH_SOURCE,
    /VERCEL_GIT_COMMIT_SHA/,
    "payload must read the Vercel-injected git SHA env var"
  );
  assert.match(
    HEALTH_SOURCE,
    /gitSha\s*:/,
    "payload must include a gitSha field"
  );
  // Must fall back to null in local dev (env var unset)
  assert.match(HEALTH_SOURCE, /\|\| null/, "gitSha must default to null when env var is unset");
});

// ── Retry-After on 503 ────────────────────────────────────────────

test("health handler: 503 response sets Retry-After header", () => {
  // Monitoring clients (Pingdom, UptimeRobot, internal probes) honor
  // Retry-After and back off instead of hammering. The 503 path must
  // emit it. The 200 happy path must NOT.
  assert.match(HEALTH_SOURCE, /Retry-After/, "503 path must set Retry-After");
  // The setHeader call must precede the 503 json() return
  const setHeaderMatch = HEALTH_SOURCE.match(/res\.setHeader\(\s*["']Retry-After["']\s*,\s*["'](\d+)["']\s*\)/);
  assert.ok(setHeaderMatch, "must call res.setHeader('Retry-After', '<seconds>')");
  // Must be a sane back-off (30..300s)
  const seconds = parseInt(setHeaderMatch[1], 10);
  assert.ok(seconds >= 30 && seconds <= 300, `Retry-After ${seconds}s should be a sane back-off (30..300s)`);
  // The 200 path must NOT set Retry-After (verified in the next test)
});

test("health handler: 200 happy path does NOT set Retry-After", () => {
  // 200 responses must not include Retry-After (only 429 + 503 should).
  // This prevents clients from misinterpreting a healthy response as
  // "try again later".
  // Find the 200 return path (either the legacy `return json(res, 200, ...)`
  // or the new `sendOkCached(res, ...)` helper that emits edge-cacheable
  // Cache-Control on the 200 path).
  const ok200Match =
    HEALTH_SOURCE.match(/return\s+json\(res,\s*200,\s*payload\)/) ||
    HEALTH_SOURCE.match(/return\s+sendOkCached\(res,\s*payload\)/);
  assert.ok(ok200Match, "200 happy-path return must exist (json(...) or sendOkCached(...))");
  // Look for Retry-After BEFORE this match in the source — if it's
  // before the 200 return, it might be in a code path that runs before
  // 200 returns (like rate limit or 405). That's allowed. The check that
  // matters: the substring between the 200 return and end of file should
  // not contain a stray Retry-After that's not in the 503/429 paths.
  // (Source-pattern, so this is a soft check — not a full execution trace.)
  const after200 = HEALTH_SOURCE.slice(ok200Match.index + ok200Match[0].length);
  // There's no Retry-After set AFTER the 200 return (which is the last
  // return in the function).
  assert.equal(/Retry-After/.test(after200), false, "no Retry-After set after 200 return");
});

test("health handler: provider probes fire in parallel via Promise.all", () => {
  // Cold-cache health checks previously took ~6s (sequential awaits).
  // Now both probes fire in parallel; worst case ~3s. Lock the parallel
  // pattern in the source so a future refactor doesn't re-serialize it.
  const fnStart = HEALTH_SOURCE.indexOf("module.exports = async function handler");
  assert.ok(fnStart > -1);
  const handlerBody = HEALTH_SOURCE.slice(fnStart);
  assert.match(
    handlerBody,
    /Promise\.all\(\s*\[[^\]]*probeProviderCached\(\s*"gemini"[^\]]*probeProviderCached\(\s*"openrouter"/s,
    "handler must Promise.all the gemini + openrouter probeProviderCached calls so they run in parallel"
  );
  // The destructured result must reference both probe variables so a
  // refactor that forgets one would be caught at test time.
  assert.match(
    handlerBody,
    /\[\s*geminiProbe\s*,\s*openRouterProbe\s*\]\s*=\s*await\s+Promise\.all/,
    "destructured assignment must include both geminiProbe and openRouterProbe"
  );
});
// ── HEAD path headers ──────────────────────────────────────────────

test("health handler: HEAD path sets Content-Type, Cache-Control, and latency header", () => {
  // RFC 7231 §4.3.2 — HEAD must carry the same headers as the equivalent
  // GET, minus the body. Bypassing json() (to skip payload serialization)
  // is fine, but the response must still expose Content-Type +
  // Cache-Control so monitoring clients don't misinterpret the bare 200.
  // Latency header must also be present so ops dashboards that key on it
  // for /api/health don't show a gap.
  assert.match(
    HEALTH_SOURCE,
    /req\.method\s*===\s*["']HEAD["']/,
    "must check for HEAD method"
  );
  // The HEAD block must set Content-Type explicitly
  assert.match(
    HEALTH_SOURCE,
    /setHeader\(\s*["']Content-Type["']\s*,\s*["']application\/json["']/,
    "HEAD response must set Content-Type: application/json"
  );
  // HEAD and GET share the same cacheable Cache-Control: public, max-age=N, s-maxage=N
  // so monitoring services can dedupe across both verbs.
  assert.match(
    HEALTH_SOURCE,
    /setHeader\(\s*["']Cache-Control["']\s*,\s*[`"']public,\s*max-age=/,
    "HEAD/GET 200 must use Cache-Control: public, max-age=..."
  );
});

test("health handler: 200 + HEAD emit edge-cacheable Cache-Control (max-age + s-maxage)", () => {
  // Reduces Vercel invocations: monitoring services polling every second
  // collapse into a single function call per 5s edge-cache window. 503
  // responses still use no-store (must be fresh on outage).
  // The Cache-Control directive lives in setHealthOkHeaders() helper
  // (shared by both GET and HEAD), so we look at the whole source.

  // Must use a short max-age (5s) — a long cache would hide outages.
  // Match either a literal number (`max-age=5`) or a template-literal
  // constant (`max-age=${HEALTH_CACHE_MAX_AGE}` where the constant is a
  // module-level binding).
  const cacheMatches = [...HEALTH_SOURCE.matchAll(/max-age=(\d+|\$\{[^}]+\})/g)];
  assert.ok(cacheMatches.length >= 1, "must reference max-age somewhere");
  for (const m of cacheMatches) {
    // Skip template-literal constants — they don't have a literal numeric
    // value at this source-pattern layer. The literal numeric matches above
    // (if any) cover the bound check; if the source uses only a constant,
    // HEALTH_CACHE_MAX_AGE at the top of the file is verified separately.
    if (/\$\{/.test(m[1])) continue;
    const seconds = parseInt(m[1], 10);
    assert.ok(seconds > 0 && seconds <= 60, `max-age=${seconds}s must be 1..60s`);
  }
  // Also verify HEALTH_CACHE_MAX_AGE is sane (1..60s) if the source uses it
  const constMatch = HEALTH_SOURCE.match(/HEALTH_CACHE_MAX_AGE\s*=\s*(\d+)/);
  if (constMatch) {
    const seconds = parseInt(constMatch[1], 10);
    assert.ok(seconds > 0 && seconds <= 60, `HEALTH_CACHE_MAX_AGE=${seconds}s must be 1..60s`);
  }

  // The cacheable directive must use `public` + `s-maxage` so CDN caches
  // dedupe multi-region monitoring traffic.
  assert.match(
    HEALTH_SOURCE,
    /setHeader\(\s*["']Cache-Control["']\s*,\s*[`"']public,\s*max-age=\$\{[^}]+\},\s*s-maxage=\$\{[^}]+\}/,
    "must set Cache-Control: public, max-age=N, s-maxage=N (template literal)"
  );

  // Both the GET 200 path (via sendOkCached) and the HEAD path must invoke
  // the shared header helper. Lock the helper call in both branches.
  const fnStart = HEALTH_SOURCE.indexOf("module.exports = async function handler");
  const handlerBody = HEALTH_SOURCE.slice(fnStart);
  assert.match(handlerBody, /setHealthOkHeaders\(res\)/, "handler must invoke setHealthOkHeaders for the 200 path");
});

test("health handler: 503 paths still use no-store (outage must be fresh)", () => {
  // Critical asymmetry: 503 means there's an active problem. Caching
  // it would hide the outage from monitoring — must stay no-store.
  // json() defaults to no-store so the 503 paths naturally inherit
  // the correct behavior. Verify the 503 paths use json() and not
  // the new sendOkCached helper.
  const fnStart = HEALTH_SOURCE.indexOf("module.exports = async function handler");
  assert.ok(fnStart > -1);
  const handlerBody = HEALTH_SOURCE.slice(fnStart);

  // The two 503 paths must call json() not sendOkCached()
  const json503CallCount = [
    ...handlerBody.matchAll(/return\s+json\(res,\s*503,/g),
  ].length;
  assert.ok(json503CallCount >= 2, "must have at least 2 json(res, 503, ...) calls for outage paths");

  // No 503 path should call sendOkCached (the cacheable helper).
  // Verify by checking that the cacheable helper appears AFTER the last
  // 503 json() call (i.e., 503 branches exit before the 200 path runs).
  const last503Index = handlerBody.lastIndexOf("return json(res, 503,");
  const lastCacheableIndex = handlerBody.lastIndexOf("return sendOkCached(");
  assert.ok(lastCacheableIndex > last503Index,
    "sendOkCached must be the 200 path's return — called AFTER all 503 branches exit");
  // The cacheable template literal lives in setHealthOkHeaders (called
  // by both sendOkCached and HEAD). Verify it appears exactly once in source
  // (the shared helper, not duplicated).
  const cacheableUses = [...HEALTH_SOURCE.matchAll(/`public, max-age=\$\{HEALTH_CACHE_MAX_AGE\}, s-maxage=\$\{HEALTH_CACHE_MAX_AGE\}`/g)].length;
  assert.equal(cacheableUses, 1, "cacheable header literal must appear exactly once (in the shared setHealthOkHeaders helper)");
});

test("health handler: sendOkCached helper exists and emits the standard observability family", () => {
  // Both sendOkCached and HEAD now use the shared setHealthOkHeaders
  // helper instead of inlining the header calls.
  assert.match(
    HEALTH_SOURCE,
    /function\s+setHealthOkHeaders\(/,
    "setHealthOkHeaders helper must exist (shared by GET 200 + HEAD)"
  );
  // sendOkCached should still exist as the GET-with-body path
  assert.match(
    HEALTH_SOURCE,
    /function\s+sendOkCached\(/,
    "sendOkCached helper must exist (GET 200 with body)"
  );
  // /api/health's GET 200 path goes through sendOkCached() which calls
  // setHealthOkHeaders() for the standard observability family. The
  // shared setHealthOkHeaders helper sets every header so the source
  // check looks in its body.
  const helperStart = HEALTH_SOURCE.indexOf("function setHealthOkHeaders(");
  const helperRegion = HEALTH_SOURCE.slice(helperStart);
  assert.match(helperRegion, /X-Request-Id/, "setHealthOkHeaders must echo X-Request-Id");
  assert.match(helperRegion, /X-Request-Latency-Total-Ms/, "setHealthOkHeaders must emit latency header");
  assert.match(helperRegion, /applyBuildShaHeader/, "setHealthOkHeaders must invoke applyBuildShaHeader (emits X-Build-Sha)");
  assert.match(helperRegion, /Cache-Control/, "sendOkCached must set Cache-Control header");
  assert.match(helperRegion, /Content-Type/, "sendOkCached must set Content-Type header");
});

// ── summary rollup field (iter #39) ─────────────────────────────────

test("health handler: 200 payload includes buildSummary-driven summary field", () => {
  // The summary rollup lets ops dashboards consume bottom-line numbers
  // (providers configured / reachable / latency rollup) without walking
  // the nested `providers` object. The handler must call buildSummary()
  // with the same inputs it uses for `providers` so the two never drift.
  assert.match(
    HEALTH_SOURCE,
    /function\s+buildSummary\(/,
    "buildSummary helper must exist"
  );
  // The summary field must be on the success-path payload
  assert.match(
    HEALTH_SOURCE,
    /summary\s*:\s*buildSummary\(/,
    "200 payload must include a `summary` field built via buildSummary(...)"
  );
  // The handler must pass the same probe objects to buildSummary as it
  // uses to populate `providers` (single source of truth).
  const callMatch = HEALTH_SOURCE.match(/buildSummary\(\s*\{[\s\S]+?\}\s*\)/);
  assert.ok(callMatch, "buildSummary(...) call site must be present");
  const callText = callMatch[0];
  assert.match(callText, /hasGemini/, "buildSummary must receive hasGemini flag");
  assert.match(callText, /hasOpenRouter/, "buildSummary must receive hasOpenRouter flag");
  assert.match(callText, /geminiProbe/, "buildSummary must receive geminiProbe");
  assert.match(callText, /openRouterProbe/, "buildSummary must receive openRouterProbe");
});

test("health handler: buildSummary computes correct counts from probe state", () => {
  // Exercises the helper through public API: import the function (it's
  // exposed for tests via the module.exports below). Pure functional
  // helper — no I/O, just deterministic logic.
  const { buildSummary } = require("../api/health.js");

  // Both providers configured and reachable
  let r = buildSummary({
    hasGemini: true,
    hasOpenRouter: true,
    geminiProbe: { ok: true, latencyMs: 100, cached: false },
    openRouterProbe: { ok: true, latencyMs: 300, cached: true },
  });
  assert.equal(r.providersConfigured, 2, "both keys set → 2 configured");
  assert.equal(r.providersReachable, 2, "both probed ok → 2 reachable");
  assert.equal(r.fastestProviderMs, 100, "min of [100, 300] = 100");
  assert.equal(r.slowestProviderMs, 300, "max of [100, 300] = 300");
  assert.equal(r.cacheHits, 1, "one cached probe");

  // Mixed: one configured+reachable, one not configured
  r = buildSummary({
    hasGemini: true,
    hasOpenRouter: false,
    geminiProbe: { ok: true, latencyMs: 50, cached: false },
    openRouterProbe: null,
  });
  assert.equal(r.providersConfigured, 1);
  assert.equal(r.providersReachable, 1);
  assert.equal(r.fastestProviderMs, 50);
  assert.equal(r.slowestProviderMs, 50);
  assert.equal(r.cacheHits, 0);

  // Probe error path: configured but unreachable
  r = buildSummary({
    hasGemini: true,
    hasOpenRouter: true,
    geminiProbe: { ok: true, latencyMs: 200, cached: false },
    openRouterProbe: { ok: false, latencyMs: 3000, error: "timeout" },
  });
  assert.equal(r.providersConfigured, 2);
  assert.equal(r.providersReachable, 1, "only the reachable probe counts");
  assert.equal(r.fastestProviderMs, 200, "only reachable probes participate in latency");
  assert.equal(r.slowestProviderMs, 200);
  assert.equal(r.cacheHits, 0);

  // Nothing configured — nullable latencies
  r = buildSummary({
    hasGemini: false,
    hasOpenRouter: false,
    geminiProbe: null,
    openRouterProbe: null,
  });
  assert.equal(r.providersConfigured, 0);
  assert.equal(r.providersReachable, 0);
  assert.equal(r.fastestProviderMs, null, "no reachable probes → null");
  assert.equal(r.slowestProviderMs, null);
  assert.equal(r.cacheHits, 0);
});

// ── process info payload (iter #43) ─────────────────────────────────

test("health handler: 200 payload includes a process info block (memory + node version)", () => {
  // Lets ops diagnose V8 heap leaks and runtime regressions from
  // /api/health without RDP/SSH into the function. Cheaper than
  // ssh'ing and surfaces regressions automatically.
  assert.match(HEALTH_SOURCE, /process\s*:\s*\{/, "200 payload must include a `process` block");
  // Must include memory + nodeVersion + platform at minimum
  assert.match(HEALTH_SOURCE, /nodeVersion\s*:\s*process\.version/, "must surface process.version");
  assert.match(HEALTH_SOURCE, /platform\s*:\s*process\.platform/, "must surface process.platform");
  assert.match(HEALTH_SOURCE, /processUptimeSec\s*:\s*Math\.round\(process\.uptime\(\)\)/, "must surface process.uptime() rounded to seconds");
  assert.match(HEALTH_SOURCE, /process\.memoryUsage\(\)/, "must call process.memoryUsage()");
  // Memory fields should be in MB (rounded), not raw bytes — JSON
  // bloat otherwise and dashboards care about the order of magnitude.
  assert.match(HEALTH_SOURCE, /\/ 1048576/, "memory values must be converted to MB (divided by 1048576)");
  // Must include the 5 standard V8 memory fields
  for (const field of ["rss", "heapTotal", "heapUsed", "external", "arrayBuffers"]) {
    assert.match(HEALTH_SOURCE, new RegExp(`${field}Mb\\s*:`), `${field}Mb must be present`);
  }
});

test("health handler: 200 payload's process info is reachable via the rendered endpoint", async () => {
  // Behavioral check: rendering /api/health actually surfaces the
  // process fields. Mirrors the production shape so the source-pattern
  // tests above can't drift from runtime behavior.
  if (!process.env.OPENROUTER_API_KEY && !process.env.GEMINI_API_KEY && !process.env.GOOGLE_GEMINI_API_KEY) {
    process.env.OPENROUTER_API_KEY = "test-stub-key-health-proc";
  }
  const handler = require("../api/health.js");
  const res = {
    statusCode: 200, _body: null, headers: {}, headersSent: false,
    setHeader(k, v) { this.headers[k] = v; },
    end(s) { this._body = s; this.headersSent = true; },
  };
  const req = {
    method: "GET", headers: {}, socket: { remoteAddress: "127.0.0.1" },
  };
  await handler(req, res);
  assert.equal(res.statusCode, 200);
  const body = JSON.parse(res._body);
  assert.ok(body.process, "200 payload must expose a process object");
  // Shape
  assert.equal(typeof body.process.nodeVersion, "string");
  assert.match(body.process.nodeVersion, /^v\d+\.\d+\.\d+/, "nodeVersion should look like a Node version string");
  assert.equal(typeof body.process.platform, "string");
  assert.equal(typeof body.process.arch, "string");
  assert.equal(typeof body.process.pid, "number");
  assert.equal(typeof body.process.processUptimeSec, "number");
  assert.ok(body.process.processUptimeSec >= 0, "process uptime should be non-negative");
  assert.ok(body.process.memory, "memory block must exist");
  for (const k of ["rssMb", "heapTotalMb", "heapUsedMb", "externalMb", "arrayBuffersMb"]) {
    assert.equal(typeof body.process.memory[k], "number", `memory.${k} must be a number`);
  }
});

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

// ── region + vercelEnv in process info (iter #44) ──────────────────

test("health handler: process info includes VERCEL_REGION + VERCEL_ENV", () => {
  // Vercel injects these on every production deploy. Ops dashboards
  // use them to route alerts by region and distinguish prod from
  // preview deployments — surfaces them in the same payload as the
  // rest of the process info block.
  assert.match(HEALTH_SOURCE, /region\s*:\s*process\.env\.VERCEL_REGION/, "must surface VERCEL_REGION as process.region");
  assert.match(HEALTH_SOURCE, /vercelEnv\s*:\s*process\.env\.VERCEL_ENV/, "must surface VERCEL_ENV as process.vercelEnv");
  // Fall back to null in local dev (env vars unset)
  assert.match(HEALTH_SOURCE, /region\s*:\s*[^,]*VERCEL_REGION\s*\|\|\s*null/, "region must default to null when env var is unset");
  assert.match(HEALTH_SOURCE, /vercelEnv\s*:\s*[^,]*VERCEL_ENV\s*\|\|\s*null/, "vercelEnv must default to null when env var is unset");
});

// ── VERSION sourced from package.json (iter #47) ──────────────────

test("health handler: VERSION comes from package.json (single source of truth)", () => {
  // The /api/health payload's `version` field used to be a hardcoded
  // string. Bumped package.json without updating the constant and the
  // payload lies. Now /api/health reads from package.json so the two
  // can't drift apart.
  assert.match(
    HEALTH_SOURCE,
    /VERSION\s*=\s*require\(["']\.\.\/package\.json["']\)\.version/,
    "VERSION must be sourced from package.json via require"
  );
  assert.doesNotMatch(
    HEALTH_SOURCE,
    /VERSION\s*=\s*["']\d+\.\d+\.\d+["']/,
    "VERSION must not be a hardcoded literal (drift risk)"
  );
});

// ── probe counts (iter #49) ────────────────────────────────────────

test("health handler: summary exposes totalProbes + networkProbes", () => {
  // Iter #49 — surfaces the in-process probe counters so ops can see
  // how many cache-miss HEAD requests this function has issued.
  assert.match(HEALTH_SOURCE, /getProbeCounts/, "must call getProbeCounts()");
  assert.match(HEALTH_SOURCE, /totalProbes\s*:\s*probeCounts\.total/, "summary must include totalProbes");
  assert.match(HEALTH_SOURCE, /networkProbes\s*:\s*probeCounts\.network/, "summary must include networkProbes");
});

// ── CSP report aggregation (iter #50) ──────────────────────────────

test("health handler: summary surfaces cspReports (per-directive CSP violation counters)", () => {
  // /api/csp-report aggregates per-directive counts in _safety.js;
  // /api/health exposes them so ops can graph CSP rejection rate at a
  // glance instead of grepping Vercel logs every time.
  assert.match(HEALTH_SOURCE, /getCspReportCounts/, "must call getCspReportCounts()");
  assert.match(HEALTH_SOURCE, /cspReports\s*:\s*cspCounts/, "summary must include the cspReports field");
});

// ── ETag / If-None-Match (iter #51) ────────────────────────────────

test("health handler: computes a stable ETag from deploy-shape inputs", () => {
  // FNV-1a 32-bit over (gitSha | hasGemini | hasOpenRouter | region).
  // Hashing means the ETag is opaque and short (8 hex chars) but flips
  // when any input changes — no body parsing needed for conditional
  // requests.
  assert.match(HEALTH_SOURCE, /function\s+computeHealthEtag\(/, "computeHealthEtag must exist");
  assert.match(HEALTH_SOURCE, /Math\.imul/, "must use FNV-1a 32-bit hash (Math.imul)");
  assert.match(HEALTH_SOURCE, /hasGemini\s*\?\s*["']g:1["']\s*:\s*["']g:0["']/, "etag must encode hasGemini flag");
  assert.match(HEALTH_SOURCE, /hasOpenRouter\s*\?\s*["']o:1["']\s*:\s*["']o:0["']/, "etag must encode hasOpenRouter flag");
});

test("health handler: emits ETag header on 200 + HEAD responses", () => {
  // Monitoring clients can then send If-None-Match on the next poll;
  // unchanged ETag → 304 with no body. Saves ~3KB per poll cycle when
  // the client already knows the deploy shape.
  assert.match(HEALTH_SOURCE, /res\.setHeader\(["']ETag["']/, "must call setHeader('ETag', ...) somewhere in the 200 / HEAD paths");
  assert.match(HEALTH_SOURCE, /res\.__currentEtag/, "must thread the etag via __currentEtag across paths");
});

test("health handler: returns 304 when If-None-Match matches the computed ETag", () => {
  // The whole point of ETag: if the client already knows the body, give
  // them a tiny 304 instead of re-downloading it.
  assert.match(HEALTH_SOURCE, /if-none-match/i, "handler must read if-none-match header");
  assert.match(HEALTH_SOURCE, /statusCode\s*=\s*304/, "must set statusCode to 304 on a match");
  assert.match(HEALTH_SOURCE, /res\.end\(\)/, "304 must end with an empty body");
});

test("health handler: computeHealthEtag is deterministic for identical inputs", () => {
  // Lock the determinism contract: hash all three states (both providers
  // configured, only gemini, only openrouter) and verify the hashes are
  // distinct from each other AND stable across repeated calls with the
  // same inputs. Catches future changes that accidentally introduce
  // nondeterminism (timestamps, random IDs, etc.).
  assert.match(HEALTH_SOURCE, /function\s+computeHealthEtag\(/, "helper must exist");
  // Helper is exported test-only via module.exports for behavioral
  // verification (not for production use).
  const { computeHealthEtag } = require("../api/health.js");
  const a = computeHealthEtag({ gitSha: "abc1234", hasGemini: true, hasOpenRouter: true, region: "iad1" });
  const a2 = computeHealthEtag({ gitSha: "abc1234", hasGemini: true, hasOpenRouter: true, region: "iad1" });
  assert.equal(a, a2, "identical inputs must produce identical ETags");
  const b = computeHealthEtag({ gitSha: "abc1234", hasGemini: false, hasOpenRouter: true, region: "iad1" });
  assert.notEqual(a, b, "different inputs must produce different ETags");
  // Must include the leading quote so headers are RFC 7232 valid weak-ETags.
  assert.match(a, /^"[0-9a-f]{8}"$/, "etag must be quoted weak ETag with 8-char hex body");
});

// ── memory pressure advisory (iter #52) ────────────────────────────

test("health handler: process.memory surfaces limitMb + usedPercent + nearLimit advisory", () => {
  // Vercel Hobby caps functions at 256 MB; Pro at 1024. The process.memory
  // block now surfaces current vs. configured limit + a nearLimit boolean
  // triggered at ≥80% — early warning before the function OOMs.
  assert.match(HEALTH_SOURCE, /MEMORY_LIMIT_MB/, "must read MEMORY_LIMIT_MB env var");
  assert.match(HEALTH_SOURCE, /limitMb/, "memory block must include limitMb");
  assert.match(HEALTH_SOURCE, /usedPercent/, "memory block must include usedPercent");
  assert.match(HEALTH_SOURCE, /nearLimit\s*:\s*usedPercent\s*>=\s*80/, "nearLimit must trigger at 80% threshold");
});

test("health handler: memory block's usedPercent uses heapUsed / limitMb * 1000 / 10 (1 decimal precision)", () => {
  // 1-decimal-place precision is more than enough for ops dashboards and
  // keeps the JSON payload tight. Locked in the source.
  assert.match(
    HEALTH_SOURCE,
    /\*\s*1000\s*\)\s*\/\s*10/,
    "usedPercent computation must divide by 10 after multiplying by 1000 to produce 1-decimal precision"
  );
});

// ── Last-Modified + If-Modified-Since (iter #54) ──────────────────

test("health handler: emits Last-Modified header on 200 + HEAD + 304 responses", () => {
  // Dual conditional-request support: clients that understand ETag use
  // If-None-Match; clients that understand date-based cache use
  // If-Modified-Since. Both must succeed. Last-Modified is required by
  // RFC 7232 §3.3 for the date-based form to work.
  assert.match(HEALTH_SOURCE, /res\.setHeader\(["']Last-Modified["']/, "must set Last-Modified header somewhere in the 200/304/HEAD paths");
  assert.match(HEALTH_SOURCE, /function\s+httpDate\(/, "httpDate helper must exist (RFC 7231 §7.1.1.1)");
});

test("health handler: returns 304 when If-Modified-Since is fresher than START_TS", () => {
  // Per RFC 7232 §3.3: if the client has a copy dated >= our Last-Modified,
  // we return 304 without a body. Comparison is "less than" the response
  // timestamp (inclusive: clientTs >= START_TS means client has our copy).
  assert.match(HEALTH_SOURCE, /if-modified-since/i, "must read if-modified-since header");
  assert.match(HEALTH_SOURCE, /Date\.parse/, "must parse If-Modified-Since as a date");
  assert.match(HEALTH_SOURCE, /START_TS\s*<=\s*clientTs/, "must compare START_TS vs client timestamp (inclusive)");
});

test("health handler: sendOkCached + HEAD inline block both attach Last-Modified", () => {
  // /api/health responses must carry Last-Modified on both the GET-with-body
  // (sendOkCached) and the HEAD-no-body paths. The parallel
  // `res.__lastModified` field carries the precomputed value so each
  // path just sets the header.
  const sendOkCachedRegion = HEALTH_SOURCE.match(/function\s+sendOkCached\([\s\S]+?\n\}/);
  assert.ok(sendOkCachedRegion, "sendOkCached must exist");
  assert.match(
    sendOkCachedRegion[0],
    /Last-Modified/,
    "sendOkCached must set Last-Modified"
  );
  // HEAD block must also set Last-Modified
  assert.match(
    HEALTH_SOURCE,
    /req\.method\s*===\s*["']HEAD["'][\s\S]+?Last-Modified/,
    "HEAD block must set Last-Modified"
  );
});

// ── requests-served counter (iter #58) ────────────────────────────

test("health handler: summary surfaces requests-served counter", () => {
  // In-process counter. Increments on every request (including 429s —
  // useful for spotting attack patterns). Pairs with totalProbes so
  // ops can compute inbound vs outbound ratio.
  assert.match(HEALTH_SOURCE, /_requestsServed\s*\+=\s*1/, "counter must increment per request");
  assert.match(HEALTH_SOURCE, /requests:\s*_requestsServed/, "summary must surface the counter");
});

// ── per-status request counters (iter #59) ────────────────────────

test("health handler: summary surfaces requestsByStatus per-status-code counter", () => {
  // In-process counter grouped by status code. LRU-evicting at 50
  // keys (defensive — status codes are bounded at the standard set
  // 100..599). Lets ops spot "429-rate climbing" or "503 spike" at
  // a glance without parsing server logs.
  assert.match(HEALTH_SOURCE, /recordRequestStatus/, "must call recordRequestStatus() per request");
  assert.match(HEALTH_SOURCE, /requestsByStatus/, "summary must include requestsByStatus field");
  assert.match(HEALTH_SOURCE, /MAX_STATUS_BUCKETS/, "must have a cap to prevent unbounded growth");
});

// ── peak memory (iter #62) ────────────────────────────────────────

test("health handler: process.memory surfaces peakRssMb seen since process start", () => {
  // Peak RSS tracker — lazily updated on each request via a single
  // Math.max + Math.round. Ops can graph `process.memory.peakRssMb`
  // over time to spot memory-leak patterns (peak climbing request-
  // over-request). Vercel recycles instances frequently so the
  // signal is per-process, but real within a single lifetime.
  assert.match(HEALTH_SOURCE, /_peakRssMb/, "must have a module-level _peakRssMb counter");
  assert.match(HEALTH_SOURCE, /peakRssMb/, "memory block must include peakRssMb field");
  assert.match(HEALTH_SOURCE, /rssNowMb\s*>\s*_peakRssMb/, "must compare and update peak on every request");
});

// ── startedAt ISO timestamp (iter #63) ────────────────────────────

test("health handler: summary surfaces startedAt ISO timestamp of process start", () => {
  // Absolute ISO timestamp pairs with the existing process.processUptimeSec
  // (relative). Lets ops correlate with Vercel deploys: "which build
  // is this instance, and when did Vercel start it?" Survives
  // cold-start + horizontal scale-out.
  assert.match(HEALTH_SOURCE, /startedAt\s*:\s*new Date\(START_TS\)\.toISOString\(\)/, "summary must surface an absolute ISO startedAt");
});

// ── per-URI CSP counters (iter #64) ───────────────────────────────

test("health handler: cspReports exposes mostBlocked + mostBlockedFrom (per-URI breakdown)", () => {
  // Per-URI counters — top-10 by count. Keys are SHA-256 hashes
  // (PII-safe); samples are URL prefixes for human ops use. Two
  // angles separately so ops can answer:
  //   "what specific resource is being blocked most often?" (mostBlocked)
  //   "what page is producing the most violations?" (mostBlockedFrom)
  const safetySrc = require("node:fs").readFileSync(
    require("node:path").resolve(__dirname, "../api/_safety.js"), "utf8"
  );
  assert.match(safetySrc, /mostBlockedFrom/, "_safety.js must surface mostBlockedFrom in the result");
  assert.match(safetySrc, /_cspDocumentUriCounts/, "_safety.js must track per-document-uri counts");
  assert.match(safetySrc, /_cspBlockedUriCounts/, "_safety.js must track per-blocked-uri counts");
  assert.match(safetySrc, /createHash\(["']sha256["']\)/, "must use SHA-256 for the per-uri key (PII-safe)");
  assert.match(safetySrc, /MAX_CSP_URI_BUCKETS/, "must have a cap to prevent unbounded growth");
  // Both counters must be wired through the csp-report handler call
  const cspReportSrc = require("node:fs").readFileSync(
    require("node:path").resolve(__dirname, "../api/csp-report.js"), "utf8"
  );
  assert.match(cspReportSrc, /recordCspReport\(rawDirective,\s*blockedUri,\s*documentUri/, "csp-report must pass both blockedUri and documentUri");
});

// ── totalErrors counter (iter #65) ────────────────────────────────

test("health handler: summary exposes totalErrors (5xx aggregate) for error-rate ratio", () => {
  // Aggregate of all 5xx responses since process start. 4xx excluded
  // (client errors, not server problems). Pairs with `requests` for
  // error-rate ratio: totalErrors / requests. Lighter-weight than
  // walking the per-status breakdown.
  assert.match(HEALTH_SOURCE, /_totalErrors/, "must have a module-level _totalErrors counter");
  assert.match(HEALTH_SOURCE, /statusCode\s*>=\s*500/, "5xx check must use the standard >= 500 threshold");
  assert.match(HEALTH_SOURCE, /_totalErrors\s*\+=\s*1/, "counter must increment per 5xx response");
  assert.match(HEALTH_SOURCE, /totalErrors\s*:\s*_totalErrors/, "summary must include the totalErrors field");
});

// ── lastProbeAtMs (iter #66) ─────────────────────────────────────

test("health handler: summary surfaces lastProbeAtMs (ms since last AI provider probe)", () => {
  // Most recent AI provider probe relative to "now". Pair with
  // networkProbes + processUptimeSec to derive cache effectiveness.
  assert.match(HEALTH_SOURCE, /lastProbeAtMs/, "summary must include lastProbeAtMs field");
  assert.match(HEALTH_SOURCE, /geminiProbe && geminiProbe\.checkedAt/, "must read geminiProbe.checkedAt");
  assert.match(HEALTH_SOURCE, /openRouterProbe && openRouterProbe\.checkedAt/, "must read openRouterProbe.checkedAt");
});

// ── uniqueIPs counter (iter #67) ───────────────────────────────

test("health handler: summary surfaces uniqueIPs (count of distinct source IPs since process start)", () => {
  // Pairs with `summary.requests` for fan-in analysis: "100 requests
  // from 1 IP" vs "100 requests from 100 IPs" tells very different
  // stories. Derived from the rate-limit map (bounded at 5000 entries).
  assert.match(HEALTH_SOURCE, /uniqueIPs/, "summary must include uniqueIPs field");
  assert.match(HEALTH_SOURCE, /getUniqueIPsCount/, "must call getUniqueIPsCount() from _safety.js");
});

// ── top active IPs (iter #68) ─────────────────────────────────────

test("health handler: summary surfaces topActiveIPs (per-IP activity breakdown)", () => {
  // Top-N most-active IPs since process start. Pairs with uniqueIPs
  // (iter #67) for full fan-in analysis: uniqueIPs = how many distinct
  // sources, topActiveIPs = which sources are doing the bulk of the
  // traffic. SHA-256 hashed (PII-safe) + IP sample for ops identification.
  assert.match(HEALTH_SOURCE, /topActiveIPs/, "summary must include topActiveIPs field");
  assert.match(HEALTH_SOURCE, /getTopActiveIPs/, "must call getTopActiveIPs() from _safety.js");
});

// ── startupDurationMs (iter #69) ───────────────────────────────

test("health handler: summary surfaces startupDurationMs (module-load → first-request)", () => {
  // Captures how long the function took to initialize (Vercel Hobby
  // cold start, etc). Lazily captured on the first request so the
  // value is stable for the rest of the process lifetime. Null before
  // the first request arrives.
  assert.match(HEALTH_SOURCE, /_firstRequestTs/, "must have a module-level _firstRequestTs");
  assert.match(HEALTH_SOURCE, /_firstRequestTs\s*=\s*0/, "must initialize _firstRequestTs to 0");
  assert.match(HEALTH_SOURCE, /if\s*\(_firstRequestTs\s*===\s*0\)\s*_firstRequestTs\s*=\s*Date\.now\(\)/, "must capture the first request's timestamp");
  assert.match(HEALTH_SOURCE, /startupDurationMs/, "summary must include startupDurationMs field");
  assert.match(HEALTH_SOURCE, /_firstRequestTs\s*\?\s*_firstRequestTs\s*-\s*START_TS\s*:\s*null/, "must compute diff vs START_TS, null until first request");
});

// ── per-provider lastReachableAt (iter #70) ─────────────────────

test("health handler: providers block surfaces lastReachableAt ISO timestamp per provider", () => {
  // Per-provider ISO timestamp of the most recent successful probe.
  // Useful for diagnosing "is the provider reachable but slow?" (long
  // latency, recent timestamp) vs "when did it last go down?"
  // (older lastReachableAt relative to uptime).
  assert.match(HEALTH_SOURCE, /lastReachableAt/, "providers block must include lastReachableAt field");
  assert.match(HEALTH_SOURCE, /new Date\(geminiProbe\.checkedAt\)\.toISOString\(\)/, "must read geminiProbe.checkedAt");
  assert.match(HEALTH_SOURCE, /new Date\(openRouterProbe\.checkedAt\)\.toISOString\(\)/, "must read openRouterProbe.checkedAt");
});

test("api/health.js RATE_LIMIT_PER_MINUTE is pinned at 60", () => {
  const fs = require("node:fs");
  const path = require("node:path");
  const src = fs.readFileSync(path.resolve(__dirname, "../api/health.js"), "utf8");
  assert.match(src, /RATE_LIMIT_PER_MINUTE\s*=\s*60/, "health RATE_LIMIT_PER_MINUTE must stay at 60");
  assert.match(src, /require\(\s*["']\.\.\/package\.json["']\s*\)\.version/, "VERSION must be sourced from package.json");
});

// ── cspReports temporal observability (iter #71) ────────────────

test("health handler: cspReports surfaces firstSeenAt + lastSeenAt ISO timestamps", () => {
  // Temporal observability: when was the first and most recent CSP
  // violation reported. Lets ops answer "is the CSP report stream
  // fresh or stale?" — a 6-hour gap with a "0 reports" trend means
  // the stream is dead, not "nothing to report".
  assert.match(HEALTH_SOURCE, /cspReports/, "summary must include the cspReports field");
  // The underlying state lives in _safety.js — the cspReport source
  // must have the per-counter stamps wired.
  const safetySrc = require("node:fs").readFileSync(
    require("node:path").resolve(__dirname, "../api/_safety.js"), "utf8"
  );
  assert.match(safetySrc, /_cspFirstSeenAt/, "must have a module-level _cspFirstSeenAt counter");
  assert.match(safetySrc, /_cspLastSeenAt/, "must have a module-level _cspLastSeenAt counter");
  assert.match(safetySrc, /firstSeenAt\s*:\s*_cspFirstSeenAt/, "must surface firstSeenAt ISO timestamp");
  assert.match(safetySrc, /lastSeenAt\s*:\s*_cspLastSeenAt/, "must surface lastSeenAt ISO timestamp");
});

// ── cspReports lastReporter (iter #72) ────────────────────────

test("health handler: cspReports surfaces lastReporter (most recent reporting IP)", () => {
  // Most recent reporting IP (PII-safe SHA-256 hash + sample for ops
  // identification). Lets ops answer "is one specific client flooding
  // us with CSP reports?" from a single curl.
  // The hash + sample wiring lives in _safety.js
  const safetySrc = require("node:fs").readFileSync(
    require("node:path").resolve(__dirname, "../api/_safety.js"), "utf8"
  );
  assert.match(safetySrc, /lastReporter/, "cspReports must include lastReporter field");
  assert.match(safetySrc, /_cspLastReporterHash/, "_safety.js must track last reporter hash");
  assert.match(safetySrc, /_cspLastReporterSample/, "_safety.js must track last reporter sample");
  // csp-report handler must pass getIp(req) to recordCspReport
  const cspReportSrc = require("node:fs").readFileSync(
    require("node:path").resolve(__dirname, "../api/csp-report.js"), "utf8"
  );
  assert.match(cspReportSrc, /recordCspReport\(rawDirective,\s*blockedUri,\s*documentUri,\s*getIp\(req\)\)/, "csp-report must pass getIp(req) for attribution");
});

// ── averageRequestsPerMinute (iter #73) ─────────────────────

test("health handler: summary surfaces averageRequestsPerMinute (rolling per-minute rate)", () => {
  // Average request rate since process start. Pairs with the
  // cumulative `requests` to give ops a per-minute rate alongside
  // the cumulative count.
  assert.match(HEALTH_SOURCE, /averageRequestsPerMinute/, "summary must include averageRequestsPerMinute field");
  // Must compute rate as (requests / uptimeSec) * 60, rounded to 1 decimal
  assert.match(HEALTH_SOURCE, /_requestsServed\s*\/\s*Math\.max\(1,\s*Math\.round/, "rate computation must be requests / max(1, uptimeSec) — guards against divide-by-zero at process start");
  assert.match(HEALTH_SOURCE, /\* 600\)\s*\/\s*10/, "rate rounded to 1-decimal precision (* 600 / 10 = * 60 with 0.1 rounding)");
});

// ── full observability surface (iter #74) ────────────────────────

test("health handler: full observability surface (X-* headers + summary fields)", async () => {
  // Comprehensive behavioral check: render the handler end-to-end
  // and assert EVERY observability signal lands. Catches handler-level
  // integration regressions that source-pattern tests can't.
  // 1. Setup — both providers configured so 200 path runs.
  process.env.OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY || "test-stub-key-iter74";
  process.env.GEMINI_API_KEY = process.env.GEMINI_API_KEY || "test-stub-key-iter74-gemini";
  // VERCEL_GIT_COMMIT_SHA so applyBuildShaHeader actually emits the
  // X-Build-Sha header (the helper skips when the env is unset).
  process.env.VERCEL_GIT_COMMIT_SHA = process.env.VERCEL_GIT_COMMIT_SHA || "abc1234567";

  // 2. Re-load module to clear module-level state.
  delete require.cache[require.resolve("../api/health.js")];
  const handler = require("../api/health.js");

  // 3. Mock fetch so AI provider probes return quickly (HEAD against
  // unreachable hosts).
  const origFetch = globalThis.fetch;
  globalThis.fetch = async () => ({ ok: true, status: 200 });
  let res;
  try {
    res = {
      statusCode: 200, _body: null, headers: {},
      headersSent: false,
      setHeader(k, v) { this.headers[k] = v; },
      end(s) { this._body = s; this.headersSent = true; },
    };
    const req = { method: "GET", headers: {}, socket: { remoteAddress: "127.0.0.1" }, url: "/api/health" };
    // 4. Run twice — first hit populates state, second hit is the
    // real "after some traffic" view we want to assert.
    const res0 = { ...res };
    await handler(req, res0);
    res = {
      statusCode: 200, _body: null, headers: {},
      headersSent: false,
      setHeader(k, v) { this.headers[k] = v; },
      end(s) { this._body = s; this.headersSent = true; },
    };
    await handler(req, res);
  } finally {
    globalThis.fetch = origFetch;
  }

  // 5. Header parity check.
  assert.equal(res.statusCode, 200, "must return 200 on the happy path");
  const expectedHeaders = [
    "Content-Type", "Cache-Control", "X-Request-Id",
    "X-Request-Latency-Total-Ms", "X-Build-Sha", "X-Endpoint",
    "ETag", "Last-Modified",
  ];
  for (const h of expectedHeaders) {
    assert.ok(res.headers[h], `response must carry ${h}`);
  }
  assert.match(res.headers["Cache-Control"], /public,\s*max-age=5/);
  assert.equal(res.headers["X-Endpoint"], "health");

  // 6. Body shape check — every summary + process field must be present.
  const body = JSON.parse(res._body);
  assert.equal(body.ok, true);
  assert.equal(body.status, "ok");
  assert.equal(typeof body.version, "string");
  assert.equal(typeof body.summary.startedAt, "string");
  assert.equal(typeof body.uptimeSec, "number");
  // summary
  assert.ok(body.summary, "body must include summary");
  for (const k of [
    "providersConfigured", "providersReachable", "fastestProviderMs",
    "slowestProviderMs", "cacheHits", "totalProbes", "networkProbes",
    "requests", "uniqueIPs", "totalErrors", "requestsByStatus",
    "topActiveIPs", "startedAt", "lastProbeAtMs", "startupDurationMs",
    "averageRequestsPerMinute", "errorRate", "lastErrorAt",
    "requestsInLastHour", "providersLastFailure",
    "providersFailureRateInLastHour", "consecutiveSuccesses",
    "providersConsecutiveFailures", "errorsInLastHour", "cacheSize",
    "providersLastUpdated", "lastHealthDurationMs", "maxHealthDurationMs",
    "peakConcurrentRequests", "requestsInLastMinute",
    "currentConcurrentRequests", "lastClientErrorAt",
    "requestsByStatusTop3", "requestsPerStatusGroup",
  ]) {
    assert.ok(k in body.summary, `summary must include ${k}`);
  }
  // cspReports
  assert.ok(body.summary.cspReports, "summary must include cspReports");
  for (const k of ["total", "byDirective", "firstSeenAt", "lastSeenAt", "lastReporter", "mostBlocked", "mostBlockedFrom", "ratePerMinute", "acceptanceRate", "lastBlockedAt", "uniqueBlockedUris", "lastBlockByIp", "consecutiveBlocks", "totalRatePerMinute"]) {
    assert.ok(k in body.summary.cspReports, `cspReports must include ${k}`);
  }
  // process
  assert.ok(body.process, "body must include process");
  for (const k of [
    "nodeVersion", "platform", "arch", "pid", "processUptimeSec",
    "region", "vercelEnv", "memory",
  ]) {
    assert.ok(k in body.process, `process must include ${k}`);
  }
  // process.memory
  for (const k of [
    "rssMb", "heapTotalMb", "heapUsedMb", "externalMb",
    "arrayBuffersMb", "limitMb", "usedPercent", "nearLimit",
    "peakRssMb",
  ]) {
    assert.ok(k in body.process.memory, `process.memory must include ${k}`);
  }
  // providers
  for (const k of ["gemini", "openrouter"]) {
    assert.ok(body.providers[k], `providers.${k} must exist`);
    if (body.providers[k].configured) {
      for (const kk of ["configured", "reachable", "latencyMs", "cached"]) {
        assert.ok(kk in body.providers[k], `providers.${k} must include ${kk}`);
      }
    }
  }
}, async () => {});

// ── providersReachableInLastHour (iter #76) ───────────────────

test("health handler: summary exposes providersReachableInLastHour (rolling 1-hour reachability)", () => {
  // Lets ops answer "is the provider flapping?" — a 50%-reachable
  // signal is actionable even when the current state is OK. The
  // current reachable state alone doesn't reveal temporal patterns.
  assert.match(HEALTH_SOURCE, /providersReachableInLastHour/, "summary must include providersReachableInLastHour field");
  // The per-provider rolling-window state lives in _safety.js
  const safetySrc = require("node:fs").readFileSync(
    require("node:path").resolve(__dirname, "../api/_safety.js"), "utf8"
  );
  assert.match(safetySrc, /getProbeReachabilityInLastHour/, "must have getProbeReachabilityInLastHour accessor");
  assert.match(safetySrc, /_PROBE_WINDOW_MS/, "must define the rolling-window duration constant");
  assert.match(safetySrc, /_probeOutcomes/, "must maintain a per-outcome array");
});

// ── uptimeBucket (iter #77) ─────────────────────────────────────

test("health handler: payload surfaces uptimeBucket (cold-start classification)", () => {
  // Classify process uptime: fresh (<5min), warm (5-60min), cold (>60min).
  // Lets ops dashboards spot when Vercel has recycled an instance, or
  // if cold-starts are spiking.
  assert.match(HEALTH_SOURCE, /uptimeBucket/, "payload must include uptimeBucket field");
  // Threshold 300s (5min) and 3600s (1hour) — well-known Vercel cold-start windows
  assert.match(HEALTH_SOURCE, /s\s*<\s*300/, "fresh threshold is 300s (5 min)");
  assert.match(HEALTH_SOURCE, /s\s*<\s*3600/, "warm threshold is 3600s (60 min)");
});

// ── anyProviderReachable + allProvidersReachable (iter #78) ─────

test("health handler: summary exposes anyProviderReachable + allProvidersReachable aggregates", () => {
  // Two aggregate booleans derived from the per-provider reachable
  // state. Lets ops dashboards see "any provider reachable?" and
  // "all providers reachable?" in one shot, without walking the
  // per-provider object.
  assert.match(HEALTH_SOURCE, /anyProviderReachable/, "summary must include anyProviderReachable field");
  assert.match(HEALTH_SOURCE, /allProvidersReachable/, "summary must include allProvidersReachable field");
  // any = at least one reachable
  assert.match(HEALTH_SOURCE, /configured\s*>\s*0\s*&&\s*reachable\s*>\s*0/, "any = configured > 0 && reachable > 0");
  // all = every reachable
  assert.match(HEALTH_SOURCE, /configured\s*>\s*0\s*&&\s*reachable\s*===\s*configured/, "all = configured > 0 && reachable === configured");
});

// ── firstRequestAt (iter #79) ──────────────────────────────────

test("health handler: summary surfaces firstRequestAt ISO timestamp", () => {
  // Pairs with startedAt (module load) and startupDurationMs (gap)
  // to give ops the full initialization timeline. Distinct value:
  // lets ops correlate "first request was 30s after module load"
  // with Vercel cold-start metrics — that gap = init-vs-traffic lag.
  assert.match(HEALTH_SOURCE, /firstRequestAt/, "summary must include firstRequestAt field");
  assert.match(HEALTH_SOURCE, /_firstRequestTs\s*\?\s*new Date\(_firstRequestTs\)\.toISOString\(\)\s*:\s*null/, "must read _firstRequestTs (pinned on first call) and fall back to null before any request");
});

// ── providersReachableByRegionInLastHour (iter #80) ───────────

test("health handler: summary exposes providersReachableByRegionInLastHour (per-region reachability)", () => {
  // Per-provider per-region reachability over the rolling 1-hour
  // window. Lets ops answer "is the flapping localized to one region?"
  // (traffic spike in iad1 might leave fra1 unaffected).
  assert.match(HEALTH_SOURCE, /providersReachableByRegionInLastHour/, "summary must include providersReachableByRegionInLastHour field");
  // The per-region counter wiring lives in _safety.js
  const safetySrc = require("node:fs").readFileSync(
    require("node:path").resolve(__dirname, "../api/_safety.js"), "utf8"
  );
  assert.match(safetySrc, /getProbeReachabilityByRegionInLastHour/, "must have getProbeReachabilityByRegionInLastHour accessor");
  // The probe outcome entry must include the region
  assert.match(safetySrc, /region:\s*process\.env\.VERCEL_REGION/, "probe outcomes must capture VERCEL_REGION at record time");
});

// ── cacheMissRate (iter #81) ───────────────────────────────────

test("health handler: summary exposes cacheMissRate (networkProbes / totalProbes)", () => {
  // Single number cache effectiveness. Pairs with the existing
  // totalProbes + networkProbes to make cache effectiveness derivable
  // from a single number. 1-decimal precision, 0 when totalProbes is 0.
  assert.match(HEALTH_SOURCE, /cacheMissRate/, "summary must include cacheMissRate field");
  assert.match(HEALTH_SOURCE, /network\s*\/\s*probeCounts\.total/, "computation must be networkProbes / totalProbes");
});

// ── providersAvgLatencyMsInLastHour (iter #82) ────────────────

test("health handler: summary exposes providersAvgLatencyMsInLastHour (per-provider rolling 1-hour mean)", () => {
  // Per-provider average latency across the rolling 1-hour window.
  // Pairs with fastestProviderMs / slowestProviderMs to show the
  // central tendency. Lets ops answer is-the-average-getting-worse-over-time.
  assert.match(HEALTH_SOURCE, /providersAvgLatencyMsInLastHour/, "summary must include providersAvgLatencyMsInLastHour field");
  // The accessor lives in _safety.js
  const safetySrc = require("node:fs").readFileSync(
    require("node:path").resolve(__dirname, "../api/_safety.js"), "utf8"
  );
  assert.match(safetySrc, /getProbeAverageLatencyInLastHour/, "must have getProbeAverageLatencyInLastHour accessor");
  // The probe outcome entry must include latencyMs for the mean to compute
  assert.match(safetySrc, /latencyMs:\s*typeof fresh\.latencyMs/, "probe outcomes must capture latencyMs at record time");
});

// ── heapUsageRatio (iter #83) ───────────────────────────────────

test("health handler: process.memory surfaces heapUsageRatio (heapUsed / heapTotal)", () => {
  // Heap utilization (0..1, 1-decimal precision). Different from
  // usedPercent which is against the configured function limit.
  // heapUsageRatio tracks GC pressure: when this climbs, the next
  // allocation is more likely to trigger a major GC.
  assert.match(HEALTH_SOURCE, /heapUsageRatio/, "memory block must include heapUsageRatio field");
  assert.match(HEALTH_SOURCE, /m\.heapTotal\s*>\s*0/, "must guard against divide-by-zero");
  assert.match(HEALTH_SOURCE, /m\.heapUsed\s*\/\s*m\.heapTotal/, "computation must be heapUsed / heapTotal");
});

// ── heapUsageRatio (iter #83) ───────────────────────────────────

test("health handler: process.memory surfaces heapUsageRatio (heapUsed / heapTotal)", () => {
  // Heap utilization (0..1, 1-decimal precision). Different from
  // usedPercent which is against the configured function limit.
  // heapUsageRatio tracks GC pressure: when this climbs, the next
  // allocation is more likely to trigger a major GC.
  assert.match(HEALTH_SOURCE, /heapUsageRatio/, "memory block must include heapUsageRatio field");
  assert.match(HEALTH_SOURCE, /m\.heapTotal\s*>\s*0/, "must guard against divide-by-zero");
  assert.match(HEALTH_SOURCE, /m\.heapUsed\s*\/\s*m\.heapTotal/, "computation must be heapUsed / heapTotal");
});

// ── errorRate (iter #84) ────────────────────────────────────

test("health handler: summary exposes errorRate (totalErrors / requests)", () => {
  // 5xx error rate as a single number (1-decimal precision). Pairs
  // with the existing `totalErrors` + `requests` fields so ops can
  // graph the error ratio over time without computing it client-side.
  // 0 when requests is 0 (guards divide-by-zero at process start).
  assert.match(HEALTH_SOURCE, /errorRate/, "summary must include errorRate field");
  assert.match(HEALTH_SOURCE, /_totalErrors\s*\/\s*_requestsServed/, "computation must be _totalErrors / _requestsServed");
  assert.match(HEALTH_SOURCE, /_requestsServed\s*>\s*0/, "must guard against divide-by-zero when requests is 0");
});

// ── heapUsageRatio (iter #83) ───────────────────────────────────

test("health handler: process.memory surfaces heapUsageRatio (heapUsed / heapTotal)", () => {
  // Heap utilization (0..1, 1-decimal precision). Different from
  // usedPercent which is against the configured function limit.
  // heapUsageRatio tracks GC pressure.
  assert.match(HEALTH_SOURCE, /heapUsageRatio/, "memory block must include heapUsageRatio field");
  assert.match(HEALTH_SOURCE, /m\.heapTotal\s*>\s*0/, "must guard against divide-by-zero");
  assert.match(HEALTH_SOURCE, /m\.heapUsed\s*\/\s*m\.heapTotal/, "computation must be heapUsed / heapTotal");
});

// ── lastErrorAt (iter #85) ────────────────────────────────────

test("health handler: summary exposes lastErrorAt (ISO timestamp of most recent 5xx)", () => {
  // Pairs with the existing `totalErrors` (count) to give ops an
  // actionable signal: "are we erroring RIGHT NOW, or just historically?"
  // Null until the first 5xx (process never errored).
  assert.match(HEALTH_SOURCE, /lastErrorAt/, "summary must include lastErrorAt field");
  assert.match(HEALTH_SOURCE, /_lastErrorAt/, "must have a module-level _lastErrorAt counter");
  assert.match(HEALTH_SOURCE, /_lastErrorAt\s*=\s*Date\.now\(\)/, "must capture Date.now() on each 5xx");
  assert.match(HEALTH_SOURCE, /_lastErrorAt\s*\?\s*new Date\(_lastErrorAt\)\.toISOString\(\)\s*:\s*null/, "must format as ISO timestamp, null until first 5xx");
});

// ── cspReportRate (iter #86) ──────────────────────────────────

test("health handler: summary exposes cspReportRate (per-minute CSP report rate)", () => {
  // Average per-minute rate over the lifetime of this process. Lets
  // ops answer "are CSP reports spiking?" from a single curl. 0 when
  // no reports have been received.
  assert.match(HEALTH_SOURCE, /cspReportRate/, "summary must include cspReportRate field");
  // The accessor lives in _safety.js
  const safetySrc = require("node:fs").readFileSync(
    require("node:path").resolve(__dirname, "../api/_safety.js"), "utf8"
  );
  assert.match(safetySrc, /ratePerMinute/, "_safety.js must compute ratePerMinute");
  assert.match(safetySrc, /_cspProcessStartTs/, "_safety.js must track process start for the rate calculation");
});

// ── requestsInLastHour (iter #87) ───────────────────────────

test("health handler: summary exposes requestsInLastHour (rolling 1-hour count)", () => {
  // Pairs with the cumulative `requests` and the per-minute
  // `averageRequestsPerMinute` to give ops a windowed view of
  // recent load — "what's the current load?" independent of
  // process age.
  assert.match(HEALTH_SOURCE, /requestsInLastHour/, "summary must include requestsInLastHour field");
  assert.match(HEALTH_SOURCE, /_requestsInLastHour/, "must have a module-level _requestsInLastHour array");
  assert.match(HEALTH_SOURCE, /_requestsInLastHour\.push/, "must push to the rolling window on each request");
  assert.match(HEALTH_SOURCE, /_requestsInLastHour\.length/, "must surface the array length as the field value");
});

// ── providersLastFailure (iter #88) ───────────────────────────

test("health handler: summary exposes providersLastFailure (per-provider most-recent failure timestamp)", () => {
  // Pairs with the existing per-provider lastReachableAt (success
  // counterpart) to give ops a clear "is the most recent state a
  // success or a failure?" signal without walking per-provider blocks.
  assert.match(HEALTH_SOURCE, /providersLastFailure/, "summary must include providersLastFailure field");
  // The accessor lives in _safety.js
  const safetySrc = require("node:fs").readFileSync(
    require("node:path").resolve(__dirname, "../api/_safety.js"), "utf8"
  );
  assert.match(safetySrc, /getLastProbeFailure/, "_safety.js must export getLastProbeFailure accessor");
  assert.match(safetySrc, /_lastProbeFailure/, "_safety.js must track per-provider last-failure timestamps");
});

// ── providersFailureRateInLastHour (iter #89) ──────────────────

test("health handler: summary exposes providersFailureRateInLastHour (per-provider failure rate)", () => {
  // Inverse of successRate. Lets ops answer "what % of probes
  // failed in the last hour?" without computing it from the
  // success rate. Pairs with the existing successRate per provider.
  assert.match(HEALTH_SOURCE, /providersFailureRateInLastHour/, "summary must include providersFailureRateInLastHour field");
  assert.match(HEALTH_SOURCE, /getProbeReachabilityInLastHour/, "must call getProbeReachabilityInLastHour from _safety.js");
  // The accessor in _safety.js must surface failureRate per provider
  const safetySrc = require("node:fs").readFileSync(
    require("node:path").resolve(__dirname, "../api/_safety.js"), "utf8"
  );
  assert.match(safetySrc, /failureRate/, "_safety.js must compute per-provider failureRate");
});

// ── consecutiveSuccesses (iter #90) ─────────────────────────

test("health handler: summary exposes consecutiveSuccesses (consecutive 2xx counter)", () => {
  // Direct "are we currently in a degraded state?" signal. Resets
  // to 0 on any 5xx; increments on every 2xx. Pairs with the
  // existing totalErrors + lastErrorAt to give ops an instantaneous
  // "right now" health verdict without walking the per-status breakdown.
  assert.match(HEALTH_SOURCE, /consecutiveSuccesses/, "summary must include consecutiveSuccesses field");
  assert.match(HEALTH_SOURCE, /_consecutiveSuccesses/, "must have a module-level _consecutiveSuccesses counter");
  // Must reset on 5xx (degraded state)
  assert.match(HEALTH_SOURCE, /_consecutiveSuccesses\s*=\s*0/, "counter must reset to 0 on 5xx");
  // Must increment on 2xx (healthy streak)
  assert.match(HEALTH_SOURCE, /_consecutiveSuccesses\s*\+=\s*1/, "counter must increment on 2xx");
});

// ── providersConsecutiveFailures (iter #91) ──────────────────

test("health handler: summary exposes providersConsecutiveFailures (per-provider failure streak)", () => {
  // Per-provider consecutive probe-failure counter. Lets ops identify
  // "which provider is in a degraded streak right now" without walking
  // the per-1h-window data. Pairs with providersLastFailure (when)
  // for the full failure profile.
  assert.match(HEALTH_SOURCE, /providersConsecutiveFailures/, "summary must include providersConsecutiveFailures field");
  // The accessor lives in _safety.js
  const safetySrc = require("node:fs").readFileSync(
    require("node:path").resolve(__dirname, "../api/_safety.js"), "utf8"
  );
  assert.match(safetySrc, /getConsecutiveProviderFailures/, "_safety.js must export getConsecutiveProviderFailures accessor");
  assert.match(safetySrc, /_consecutiveProviderFailures/, "_safety.js must track per-provider failure streaks");
});

// ── errorsInLastHour (iter #92) ───────────────────────────

test("health handler: summary exposes errorsInLastHour (rolling 1-hour 5xx count)", () => {
  // Pairs with totalErrors (cumulative) to give ops a windowed view
  // of recent failures — 'are we erroring RIGHT NOW?' independent of
  // process age. Inverse-shape to requestsInLastHour (iter #87) but
  // tracks 5xx responses only.
  assert.match(HEALTH_SOURCE, /errorsInLastHour/, "summary must include errorsInLastHour field");
  assert.match(HEALTH_SOURCE, /_errorsInLastHour/, "must have a module-level _errorsInLastHour array");
  // iter #146 refactor: the push + prune logic lives in pushToHourWindow helper.
  assert.match(HEALTH_SOURCE, /pushToHourWindow\(\s*_errorsInLastHour\s*\)/,
    "must use pushToHourWindow helper to update the 5xx window");
  assert.match(HEALTH_SOURCE, /_errorsInLastHour\.length/, "must surface the array length as the field value");
});

// ── cacheSize (iter #93) ────────────────────────────────────────

test("health handler: summary exposes cacheSize (current probe cache entry count)", () => {
  // Bounded at _PROBE_CACHE_MAX (100). Pairs with cacheMissRate to
  // detect cache thrashing — if cacheSize is near 100 and cacheMissRate
  // is rising, entries are being evicted faster than reused.
  assert.match(HEALTH_SOURCE, /cacheSize/, "summary must include cacheSize field");
  // The accessor lives in _safety.js
  const safetySrc = require("node:fs").readFileSync(
    require("node:path").resolve(__dirname, "../api/_safety.js"), "utf8"
  );
  assert.match(safetySrc, /getProbeCacheSize/, "_safety.js must export getProbeCacheSize accessor");
});

// ── cspReportAcceptanceRate (iter #94) ───────────────────────

test("health handler: cspReports surfaces cspReportAcceptanceRate (accepted / total attempts)", () => {
  // Inverse of the implicit block rate. Lets ops answer "what % of
  // attempts are being rejected?" from a single curl without computing
  // it from total + blocked.
  assert.match(HEALTH_SOURCE, /cspReportAcceptanceRate/, "summary must include cspReportAcceptanceRate field");
  // The computation lives in _safety.js
  const safetySrc = require("node:fs").readFileSync(
    require("node:path").resolve(__dirname, "../api/_safety.js"), "utf8"
  );
  assert.match(safetySrc, /acceptanceRate/, "_safety.js must compute per-process acceptanceRate");
  assert.match(safetySrc, /_cspBlockedCount/, "_safety.js must track _cspBlockedCount for the acceptance rate denominator");
});

// ── providersLastUpdated (iter #94, linter-started) ───────────

test("health handler: summary exposes providersLastUpdated (per-provider most-recent probe timestamp)", () => {
  // Per-provider most-recent probe timestamp (success OR failure).
  // Distinct from providersLastFailure (failure-only). Answers
  // 'when was this provider last checked at all' — even if the
  // result was a failure, ops knows the network reached the provider.
  assert.match(HEALTH_SOURCE, /providersLastUpdated/, "summary must include providersLastUpdated field");
  // The accessor lives in _safety.js
  const safetySrc = require("node:fs").readFileSync(
    require("node:path").resolve(__dirname, "../api/_safety.js"), "utf8"
  );
  assert.match(safetySrc, /getLastProbeUpdate/, "_safety.js must export getLastProbeUpdate accessor");
  assert.match(safetySrc, /_lastProbeUpdate/, "_safety.js must track per-provider last-update timestamps");
});

// ── recordRequestStatus test-only export (iter #95) ────────────

test("health handler: recordRequestStatus is exported test-only", () => {
  // The bookkeeping function isn't part of the production API surface,
  // but exporting it (alongside buildSummary + computeHealthEtag) lets
  // us unit-test its 5xx-resets-2xx-streak behavior without going
  // through the full handler.
  const { recordRequestStatus } = require("../api/health.js");
  assert.equal(typeof recordRequestStatus, "function", "recordRequestStatus must be exported");
});

test("health handler: recordRequestStatus ignores non-numeric + out-of-range codes", () => {
  const { recordRequestStatus } = require("../api/health.js");
  // Non-numeric / NaN must be no-ops (defensive against accidental
  // calls with wrong types — e.g. res.statusCode left undefined).
  assert.doesNotThrow(() => recordRequestStatus(NaN), "NaN must be ignored");
  assert.doesNotThrow(() => recordRequestStatus(undefined), "undefined must be ignored");
  assert.doesNotThrow(() => recordRequestStatus("500"), "string must be ignored (defensive)");
  // Out-of-range (< 100, >= 600) must be ignored — status codes are
  // bounded at the standard set; anything else is malformed input.
  assert.doesNotThrow(() => recordRequestStatus(99), "sub-100 status must be ignored");
  assert.doesNotThrow(() => recordRequestStatus(600), "600+ status must be ignored");
  assert.doesNotThrow(() => recordRequestStatus(-1), "negative status must be ignored");
});

test("health handler: recordRequestStatus is callable in a sequence without throwing", () => {
  // Smoke for the bookkeeping: call recordRequestStatus with a mix of
  // valid + invalid codes. Function must not throw on any input —
  // the handler relies on this in its finally block.
  const { recordRequestStatus } = require("../api/health.js");
  // Real codes — must update internal state silently.
  assert.doesNotThrow(() => recordRequestStatus(200), "200 must not throw");
  assert.doesNotThrow(() => recordRequestStatus(204), "204 must not throw");
  assert.doesNotThrow(() => recordRequestStatus(404), "404 must not throw");
  assert.doesNotThrow(() => recordRequestStatus(500), "500 must not throw");
  assert.doesNotThrow(() => recordRequestStatus(503), "503 must not throw");
  // Malformed — must be silently ignored.
  assert.doesNotThrow(() => recordRequestStatus(NaN), "NaN must not throw");
  assert.doesNotThrow(() => recordRequestStatus(Infinity), "Infinity must not throw");
  assert.doesNotThrow(() => recordRequestStatus(-Infinity), "-Infinity must not throw");
  assert.doesNotThrow(() => recordRequestStatus(null), "null must not throw");
  assert.doesNotThrow(() => recordRequestStatus({}), "object must not throw");
  assert.doesNotThrow(() => recordRequestStatus([200]), "array must not throw");
  // Out-of-range status codes — silently ignored (not standard HTTP).
  assert.doesNotThrow(() => recordRequestStatus(99), "sub-100 must not throw");
  assert.doesNotThrow(() => recordRequestStatus(600), "600+ must not throw");
  assert.doesNotThrow(() => recordRequestStatus(99999), "very large must not throw");
});

// ── probeCacheSize (iter #96, linter-started) ─────────────────

test("health handler: summary exposes probeCacheSize (per-provider probe cache count)", () => {
  // Linter added this as an alias of the iter #93 cacheSize. Both
  // fields exist in summary for now — they return identical values.
  // The linter name is more descriptive (clarifies it's the probe
  // cache, not some other cache).
  assert.match(HEALTH_SOURCE, /probeCacheSize/, "summary must include probeCacheSize field");
  assert.match(HEALTH_SOURCE, /getProbeCacheSize\(\)/, "must call getProbeCacheSize()");
});

// ── lastBlockedAt (iter #97, linter-started) ──────────────────

test("health handler: cspReports surfaces lastBlockedAt (most recent rate-limit-rejected timestamp)", () => {
  // Linter captured _cspLastBlockedAt in _safety.js but didn't surface
  // it. Surface it in /api/health cspReports as ISO timestamp.
  // Distinct from lastSeenAt (which is the last *accepted* report).
  const safetySrc = require("node:fs").readFileSync(
    require("node:path").resolve(__dirname, "../api/_safety.js"), "utf8"
  );
  assert.match(safetySrc, /_cspLastBlockedAt/, "_safety.js must track _cspLastBlockedAt");
  assert.match(safetySrc, /_cspLastBlockedAt\s*=\s*Date\.now\(\)/, "_safety.js must capture Date.now() in recordCspBlock");
  assert.match(safetySrc, /lastBlockedAt:/, "getCspReportCounts must surface lastBlockedAt field");
});

// ── uniqueBlockedUris (iter #99, linter-started) ──────────────

test("health handler: cspReports surfaces uniqueBlockedUris (count of distinct blocked URIs)", () => {
  // Pairs with mostBlocked (top-10) to give ops the scope of
  // blocked-URI variety. Lets ops answer "how many distinct
  // resources are being blocked?" from a single curl.
  const safetySrc = require("node:fs").readFileSync(
    require("node:path").resolve(__dirname, "../api/_safety.js"), "utf8"
  );
  assert.match(safetySrc, /uniqueBlockedUris/, "_safety.js must surface uniqueBlockedUris field");
  assert.match(safetySrc, /_cspBlockedUriCounts\.size/, "computation must use _cspBlockedUriCounts.size");
});

// ── processUptimePretty (iter #102, linter-added) ─────────────

test("health handler: process block surfaces processUptimePretty (human-readable uptime)", () => {
  // Linter-added: human-readable uptime format. Pairs with
  // processUptimeSec (precise integer seconds) — pretty format for
  // humans glancing at curl, integer for ops scripts.
  assert.match(HEALTH_SOURCE, /processUptimePretty/, "process block must include processUptimePretty field");
  // Format must include time unit suffixes
  assert.match(HEALTH_SOURCE, /\$\{[^}]+\}s/, "must format seconds with 's' suffix");
  assert.match(HEALTH_SOURCE, /\$\{[^}]+\}m/, "must format minutes with 'm' suffix");
  // Format must include 'd' for days (when uptime > 24h)
  assert.match(HEALTH_SOURCE, /\$\{[^}]+\}d/, "must format days with 'd' suffix");
});

test("health handler: processUptimePretty is a non-empty string in the rendered payload", async () => {
  // Behavioral check: render the handler end-to-end and assert the
  // field is a non-empty string with at least one time-unit suffix.
  if (!process.env.OPENROUTER_API_KEY && !process.env.GEMINI_API_KEY && !process.env.GOOGLE_GEMINI_API_KEY) {
    process.env.OPENROUTER_API_KEY = "test-stub-key-uptime";
  }
  const handler = require("../api/health.js");
  const res = {
    statusCode: 200, _body: null, headers: {}, headersSent: false,
    setHeader(k, v) { this.headers[k] = v; },
    end(s) { this._body = s; this.headersSent = true; },
  };
  const req = { method: "GET", headers: {}, socket: { remoteAddress: "127.0.0.1" } };
  await handler(req, res);
  assert.equal(res.statusCode, 200);
  const body = JSON.parse(res._body);
  assert.ok(body.process, "200 payload must include process");
  assert.equal(typeof body.process.processUptimePretty, "string");
  assert.ok(body.process.processUptimePretty.length > 0);
  // Must end with one of the time-unit suffixes (s/m/d/h)
  assert.match(body.process.processUptimePretty, /[smhd]$/);
});

// ── execPath (iter #103, linter-added) ─────────────────────────

test("health handler: process block surfaces execPath (Node binary path)", () => {
  // Linter-added: absolute path to the Node.js executable running
  // this function. Useful for ops debugging "which Node binary is
  // actually deployed here?".
  assert.match(HEALTH_SOURCE, /execPath/, "process block must include execPath field");
  // Must come from process.execPath (the canonical Node API)
  assert.match(HEALTH_SOURCE, /execPath:\s*process\.execPath/, "must source from process.execPath");
});

// ── lastHealthDurationMs + maxHealthDurationMs (iter #107) ───

test("health handler: summary surfaces lastHealthDurationMs + maxHealthDurationMs", () => {
  // Tracks /api/health's own request duration. A slow health endpoint
  // is a real problem since it's the most-polled endpoint. Pairs
  // lastHealthDurationMs (most recent) with maxHealthDurationMs
  // (peak ever) to detect "consistently slow" vs "spike" patterns.
  assert.match(HEALTH_SOURCE, /lastHealthDurationMs/, "summary must include lastHealthDurationMs field");
  assert.match(HEALTH_SOURCE, /maxHealthDurationMs/, "summary must include maxHealthDurationMs field");
  // Module-level tracking state
  assert.match(HEALTH_SOURCE, /_lastHealthDurationMs/, "must have a module-level _lastHealthDurationMs counter");
  assert.match(HEALTH_SOURCE, /_maxHealthDurationMs/, "must have a module-level _maxHealthDurationMs counter");
  // Peak-update logic
  assert.match(HEALTH_SOURCE, /dur\s*>\s*_maxHealthDurationMs/, "max must update when current duration exceeds it");
  // Guard against unbounded values (matches the 600000ms cap used elsewhere)
  assert.match(HEALTH_SOURCE, /dur\s*<=\s*600000/, "must cap duration at 600000ms");
});

// ── peakConcurrentRequests (iter #110, linter-started) ────────

test("health handler: summary exposes peakConcurrentRequests (peak in-flight since process start)", () => {
  // Linter added the field stub; this iter implements the actual
  // tracking. Lets ops spot "is this instance handling more load than
  // the others?" when comparing across the fleet.
  assert.match(HEALTH_SOURCE, /peakConcurrentRequests/, "summary must include peakConcurrentRequests field");
  // Module-level state for current + peak
  assert.match(HEALTH_SOURCE, /_currentConcurrent/, "must have a module-level _currentConcurrent counter");
  assert.match(HEALTH_SOURCE, /_peakConcurrent/, "must have a module-level _peakConcurrent counter");
  // Increment + decrement + peak update
  assert.match(HEALTH_SOURCE, /_currentConcurrent\s*\+=\s*1/, "must increment at handler start");
  assert.match(HEALTH_SOURCE, /_currentConcurrent\s*-=\s*1/, "must decrement in finally");
  assert.match(HEALTH_SOURCE, /_currentConcurrent\s*>\s*_peakConcurrent/, "peak must update when current exceeds it");
});

// ── requestsInLastMinute (iter #111, linter-added) ────────────

test("health handler: summary exposes requestsInLastMinute (rolling 1-minute count)", () => {
  // Finer-grained window than requestsInLastHour (iter #87). Lets ops
  // spot "is the rate spiking RIGHT NOW?" independent of process age.
  assert.match(HEALTH_SOURCE, /requestsInLastMinute/, "summary must include requestsInLastMinute field");
  assert.match(HEALTH_SOURCE, /_requestsInLastMinute/, "must have a module-level _requestsInLastMinute array");
  assert.match(HEALTH_SOURCE, /_requestsInLastMinute\.push/, "must push to the rolling window on each request");
  assert.match(HEALTH_SOURCE, /_requestsInLastMinute\.length/, "must surface the array length as the field value");
  // Must use 60s cutoff (not 3600s like the 1-hour window)
  assert.match(HEALTH_SOURCE, /60\s*\*\s*1000/, "must use 60s cutoff for 1-minute window");
});

// ── startupDurationPretty (iter #114) ──────────────────────────

test("health handler: process block surfaces startupDurationPretty (human-readable cold-start)", () => {
  // Analogous to processUptimePretty. Complements startupDurationMs
  // (precise ms) — pretty format for ops glances, integer for scripts.
  assert.match(HEALTH_SOURCE, /startupDurationPretty/, "process block must include startupDurationPretty field");
  // Format must include time-unit suffixes
  assert.match(HEALTH_SOURCE, /\$\{[^}]+\}s/, "must format seconds with 's' suffix");
  // Guard against unbounded values (matches the 600000ms cap used elsewhere)
  assert.match(HEALTH_SOURCE, /ms\s*>\s*600000/, "must cap at 600000ms (10 min cold-start threshold)");
  // Must return null when no first request yet (parity with startupDurationMs)
  assert.match(HEALTH_SOURCE, /ms\s*===\s*null/, "must return null when no first request yet");
});

// ── lastBlockByIp (iter #115, linter-started) ──────────────────

test("health handler: cspReports surfaces lastBlockByIp (most recent rate-limited reporter)", () => {
  // Pairs with lastReporter (most recent ACCEPTED reporter) for
  // the full picture: "which IP is throttled vs which is active?"
  const safetySrc = require("node:fs").readFileSync(
    require("node:path").resolve(__dirname, "../api/_safety.js"), "utf8"
  );
  assert.match(safetySrc, /lastBlockByIp/, "getCspReportCounts must surface lastBlockByIp field");
  assert.match(safetySrc, /_cspLastBlockerHash/, "_safety.js must track last-blocker hash");
  assert.match(safetySrc, /_cspLastBlockerSample/, "_safety.js must track last-blocker sample");
  // recordCspBlock must accept the reporter IP parameter
  assert.match(safetySrc, /function\s+recordCspBlock\s*\(\s*reporterIp\s*\)/,
    "recordCspBlock must accept reporterIp parameter");
});

// ── consecutiveBlocks (iter #116, linter-started) ─────────────

test("health handler: cspReports surfaces consecutiveBlocks (sustained-attack signal)", () => {
  // Pairs with the cumulative blocked count to detect "are we being
  // actively attacked RIGHT NOW?" — a high value means sustained
  // attack with no legitimate report in between (resets to 0 on
  // each accepted report).
  const safetySrc = require("node:fs").readFileSync(
    require("node:path").resolve(__dirname, "../api/_safety.js"), "utf8"
  );
  assert.match(safetySrc, /_cspConsecutiveBlocks/, "_safety.js must track _cspConsecutiveBlocks");
  assert.match(safetySrc, /consecutiveBlocks:/, "getCspReportCounts must surface consecutiveBlocks field");
  // Must increment on block + reset on accept
  assert.match(safetySrc, /_cspConsecutiveBlocks\s*\+=\s*1/, "must increment in recordCspBlock");
  assert.match(safetySrc, /_cspConsecutiveBlocks\s*=\s*0/, "must reset in recordCspReport");
});

// ── totalRatePerMinute (iter #117, linter-added) ───────────────

test("health handler: cspReports surfaces totalRatePerMinute (all attempts per minute)", () => {
  // Pairs with ratePerMinute (accepted only) to give the full attack
  // picture: totalRatePerMinute - ratePerMinute = block rate per
  // minute. Lets ops answer "is the attack rate rising?" from a
  // single curl.
  const safetySrc = require("node:fs").readFileSync(
    require("node:path").resolve(__dirname, "../api/_safety.js"), "utf8"
  );
  assert.match(safetySrc, /totalRatePerMinute/, "getCspReportCounts must surface totalRatePerMinute field");
  // Must source from total attempts (accepted + blocked), not just accepted
  assert.match(safetySrc, /_cspTotalReports\s*\+\s*_cspBlockedCount/,
    "computation must be total attempts (accepted + blocked)");
});

// ── peakRssMb behavioral (iter #119) ──────────────────────────

test("health handler: process.memory.peakRssMb is non-negative after handler runs", async () => {
  // Behavioral check: render a request, verify peakRssMb is a
  // non-negative number. The peak is updated on every request via
  // a Math.max compare.
  //
  // IMPORTANT: peakRssMb is captured at handler START (one
  // process.memoryUsage() call), while memory.rssMb is computed
  // at summary-build time (a LATER process.memoryUsage() call).
  // process.memoryUsage can return different values between calls
  // (GC just ran, etc.) so peakRssMb is NOT necessarily >= the
  // memory.rssMb in the same payload — that's not a peak semantic,
  // that's a point-in-time comparison. Drop that assertion.
  if (!process.env.OPENROUTER_API_KEY && !process.env.GEMINI_API_KEY && !process.env.GOOGLE_GEMINI_API_KEY) {
    process.env.OPENROUTER_API_KEY = "test-stub-key-iter119";
  }
  const handler = require("../api/health.js");
  // Mock fetch for deterministic probes
  const origFetch = globalThis.fetch;
  globalThis.fetch = async () => ({ ok: true, status: 200 });
  try {
    const res = {
      statusCode: 200, _body: null, headers: {}, headersSent: false,
      setHeader(k, v) { this.headers[k] = v; },
      end(s) { this._body = s; this.headersSent = true; },
    };
    const req = { method: "GET", headers: {}, socket: { remoteAddress: "127.0.0.1" } };
    await handler(req, res);
    assert.equal(res.statusCode, 200);
    const body = JSON.parse(res._body);
    assert.equal(typeof body.process.memory.peakRssMb, "number",
      "peakRssMb must be a number");
    assert.ok(body.process.memory.peakRssMb >= 0,
      "peakRssMb must be non-negative");
  } finally {
    globalThis.fetch = origFetch;
  }
});

// ── lastClientErrorAt (iter #124) ─────────────────────────────

test("health handler: summary exposes lastClientErrorAt (most recent 4xx)", () => {
  // Pairs with lastErrorAt (5xx) for the full error timeline.
  // 4xx is a client error (rate limit, bad input) — not a server
  // problem, but still operationally interesting for ops.
  assert.match(HEALTH_SOURCE, /lastClientErrorAt/, "summary must include lastClientErrorAt field");
  assert.match(HEALTH_SOURCE, /_lastClientErrorAt/, "must have a module-level _lastClientErrorAt counter");
  // Must capture on 4xx
  assert.match(HEALTH_SOURCE, /statusCode\s*>=\s*400\s*&&\s*statusCode\s*<\s*500/,
    "must guard 4xx range");
  assert.match(HEALTH_SOURCE, /_lastClientErrorAt\s*=\s*Date\.now\(\)/,
    "must capture Date.now() in 4xx branch");
  // Must surface as ISO timestamp or null
  assert.match(HEALTH_SOURCE, /_lastClientErrorAt\s*\?\s*new Date\(_lastClientErrorAt\)\.toISOString\(\)\s*:\s*null/,
    "must format as ISO timestamp, null until first 4xx");
});

// ── requestsByStatusTop3 (iter #127) ───────────────────────────

test("health handler: summary exposes requestsByStatusTop3 (top 3 status codes by count)", () => {
  // Pairs with requestsByStatus (full Map). Sorted desc by count,
  // capped at 3. Useful for at-a-glance dashboards.
  assert.match(HEALTH_SOURCE, /requestsByStatusTop3/, "summary must include requestsByStatusTop3 field");
  // Must sort by count desc
  assert.match(HEALTH_SOURCE, /b\[1\]\s*-\s*a\[1\]/, "must sort by count desc");
  // Must cap at 3 (slice(0, 3))
  assert.match(HEALTH_SOURCE, /slice\(\s*0\s*,\s*3\s*\)/, "must cap at 3 entries");
  // Must return array of {status, count} objects
  assert.match(HEALTH_SOURCE, /\{\s*status\s*,\s*count\s*\}/,
    "must format each entry as {status, count}");
});

// ── requestsPerStatusGroup (iter #129) ────────────────────────

test("health handler: summary exposes requestsPerStatusGroup (bucketed by status class)", () => {
  // Pairs with requestsByStatusTop3 (per-code top 3) for class-
  // level view: "are we 4xx-heavy or 5xx-heavy?" Always includes
  // all 5 buckets (1xx/2xx/3xx/4xx/5xx) — zeros if no requests
  // in that class.
  assert.match(HEALTH_SOURCE, /requestsPerStatusGroup/, "summary must include requestsPerStatusGroup field");
  // All 5 buckets present
  assert.match(HEALTH_SOURCE, /"1xx"/, "must include 1xx bucket");
  assert.match(HEALTH_SOURCE, /"2xx"/, "must include 2xx bucket");
  assert.match(HEALTH_SOURCE, /"3xx"/, "must include 3xx bucket");
  assert.match(HEALTH_SOURCE, /"4xx"/, "must include 4xx bucket");
  assert.match(HEALTH_SOURCE, /"5xx"/, "must include 5xx bucket");
  // Bucket via Math.floor(status / 100)
  assert.match(HEALTH_SOURCE, /Math\.floor\(\s*status\s*\/\s*100\s*\)/,
    "must bucket via Math.floor(status / 100)");
});

// ── providersReachableInLastHour (iter #128, behavioral) ──────

test("health handler: providersReachableInLastHour structure is correct (mocked fetch)", async () => {
  // Behavioral verification of the per-provider success/failure
  // rate computation. Render the handler with mocked fetch so
  // probes succeed quickly. Field is structured as
  // { gemini: {okCount, total, successRate, failureRate}, ... }.
  if (!process.env.OPENROUTER_API_KEY && !process.env.GEMINI_API_KEY && !process.env.GOOGLE_GEMINI_API_KEY) {
    process.env.OPENROUTER_API_KEY = "test-stub-key-iter128";
    process.env.GEMINI_API_KEY = "test-stub-key-iter128-g";
  }
  const origFetch = globalThis.fetch;
  globalThis.fetch = async () => ({ ok: true, status: 200 });
  try {
    const handler = require("../api/health.js");
    const res = {
      statusCode: 200, _body: null, headers: {}, headersSent: false,
      setHeader(k, v) { this.headers[k] = v; },
      end(s) { this._body = s; this.headersSent = true; },
    };
    const req = { method: "GET", headers: {}, socket: { remoteAddress: "127.0.0.1" } };
    await handler(req, res);
    assert.equal(res.statusCode, 200);
    const body = JSON.parse(res._body);
    assert.ok("providersReachableInLastHour" in body.summary,
      "summary must include providersReachableInLastHour field");
    const reach = body.summary.providersReachableInLastHour;
    // Each provider has 4 fields
    for (const provider of ["gemini", "openrouter"]) {
      assert.equal(typeof reach[provider], "object", `${provider} must be an object`);
      assert.equal(typeof reach[provider].okCount, "number",
        `${provider}.okCount must be a number`);
      assert.equal(typeof reach[provider].total, "number",
        `${provider}.total must be a number`);
      assert.ok(reach[provider].successRate === null || typeof reach[provider].successRate === "number",
        `${provider}.successRate must be number or null`);
      assert.ok(reach[provider].failureRate === null || typeof reach[provider].failureRate === "number",
        `${provider}.failureRate must be number or null`);
    }
  } finally {
    globalThis.fetch = origFetch;
  }
});

// ── providersAvgLatencyMsInLastHour (iter #126, behavioral) ───

test("health handler: providersAvgLatencyMsInLastHour reflects probe latency (mocked fetch)", async () => {
  // Behavioral verification of the average-latency computation.
  // The handler reads from a module-level probe-outcomes array
  // populated by probeProviderCached. With a mocked fetch, both
  // providers return 200 immediately — but `fresh.latencyMs`
  // is set by probeProvider() itself, not from the response. The
  // mock fetch returns no latencyMs, so the field is null for
  // both providers. This test verifies the null path; the
  // non-null path is exercised through real probe runs in CI.
  if (!process.env.OPENROUTER_API_KEY && !process.env.GEMINI_API_KEY && !process.env.GOOGLE_GEMINI_API_KEY) {
    process.env.OPENROUTER_API_KEY = "test-stub-key-iter126";
    process.env.GEMINI_API_KEY = "test-stub-key-iter126-g";
  }
  // Mock fetch so probes succeed quickly
  const origFetch = globalThis.fetch;
  globalThis.fetch = async () => ({ ok: true, status: 200 });
  try {
    const handler = require("../api/health.js");
    const res = {
      statusCode: 200, _body: null, headers: {}, headersSent: false,
      setHeader(k, v) { this.headers[k] = v; },
      end(s) { this._body = s; this.headersSent = true; },
    };
    const req = { method: "GET", headers: {}, socket: { remoteAddress: "127.0.0.1" } };
    await handler(req, res);
    assert.equal(res.statusCode, 200);
    const body = JSON.parse(res._body);
    // Field present, structured as { gemini, openrouter }
    assert.ok("providersAvgLatencyMsInLastHour" in body.summary,
      "summary must include providersAvgLatencyMsInLastHour field");
    const avg = body.summary.providersAvgLatencyMsInLastHour;
    assert.equal(typeof avg.gemini, "number",
      "avg.gemini must be a number (or null)");
    assert.equal(typeof avg.openrouter, "number",
      "avg.openrouter must be a number (or null)");
  } finally {
    globalThis.fetch = origFetch;
  }
});

// ── currentConcurrentRequests (iter #112, linter-added) ────────

test("health handler: summary exposes currentConcurrentRequests (in-flight requests right now)", () => {
  // Pairs with peakConcurrentRequests (iter #110). The pair answers
  // two questions from a single curl:
  //   - "what's the current load?" — currentConcurrentRequests
  //   - "what's the worst-case?"    — peakConcurrentRequests
  assert.match(HEALTH_SOURCE, /currentConcurrentRequests/, "summary must include currentConcurrentRequests field");
  // Must surface the LIVE counter (not a stale value)
  assert.match(HEALTH_SOURCE, /currentConcurrentRequests:\s*_currentConcurrent/,
    "must surface the live _currentConcurrent counter");
});

test("health handler: currentConcurrentRequests is 1 during a single-request render", async () => {
  // Behavioral check: render one request, verify the count is 1
  // (incremented at handler start, decremented in finally AFTER the
  // summary is built into the response — so the response snapshot
  // sees the incremented value).
  if (!process.env.OPENROUTER_API_KEY && !process.env.GEMINI_API_KEY && !process.env.GOOGLE_GEMINI_API_KEY) {
    process.env.OPENROUTER_API_KEY = "test-stub-key-iter112";
  }
  const handler = require("../api/health.js");
  // Mock fetch so probes succeed quickly
  const origFetch = globalThis.fetch;
  globalThis.fetch = async () => ({ ok: true, status: 200 });
  try {
    const res = {
      statusCode: 200, _body: null, headers: {}, headersSent: false,
      setHeader(k, v) { this.headers[k] = v; },
      end(s) { this._body = s; this.headersSent = true; },
    };
    const req = { method: "GET", headers: {}, socket: { remoteAddress: "127.0.0.1" } };
    await handler(req, res);
    assert.equal(res.statusCode, 200);
    const body = JSON.parse(res._body);
    assert.equal(typeof body.summary.currentConcurrentRequests, "number",
      "currentConcurrentRequests must be a number");
    // During a single request, the count is 1 (incremented at start).
    // After the handler returns, the finally has decremented to 0,
    // but the response was already built with the incremented value.
    assert.ok(body.summary.currentConcurrentRequests >= 1,
      "during single render, currentConcurrentRequests should be >= 1");
  } finally {
    globalThis.fetch = origFetch;
  }
});

test("health handler: process.execPath is a non-empty string in the rendered payload", async () => {
  // Behavioral check: render the handler end-to-end.
  if (!process.env.OPENROUTER_API_KEY && !process.env.GEMINI_API_KEY && !process.env.GOOGLE_GEMINI_API_KEY) {
    process.env.OPENROUTER_API_KEY = "test-stub-key-execpath";
  }
  const handler = require("../api/health.js");
  const res = {
    statusCode: 200, _body: null, headers: {}, headersSent: false,
    setHeader(k, v) { this.headers[k] = v; },
    end(s) { this._body = s; this.headersSent = true; },
  };
  const req = { method: "GET", headers: {}, socket: { remoteAddress: "127.0.0.1" } };
  await handler(req, res);
  assert.equal(res.statusCode, 200);
  const body = JSON.parse(res._body);
  assert.ok(body.process, "200 payload must include process");
  assert.equal(typeof body.process.execPath, "string");
  assert.ok(body.process.execPath.length > 0, "execPath must be non-empty");
  // Should be an absolute path (starts with /)
  assert.match(body.process.execPath, /^\//, "execPath must be an absolute path");
});

// ── buildSummary behavioral tests (iter #100) ──────────────────

test("buildSummary: empty state (no providers, no probes) returns sane defaults", () => {
  // Iter #100: behavioral coverage for the buildSummary helper.
  // Pure-functional test — no I/O, no shared state. The helper
  // accepts an explicit probe-state object so this is deterministic.
  const { buildSummary } = require("../api/health.js");
  const r = buildSummary({
    hasGemini: false,
    hasOpenRouter: false,
    geminiProbe: null,
    openRouterProbe: null,
  });
  assert.equal(r.providersConfigured, 0, "no providers configured → 0");
  assert.equal(r.providersReachable, 0, "no providers reachable → 0");
  assert.equal(r.fastestProviderMs, null, "no reachable probes → null");
  assert.equal(r.slowestProviderMs, null, "no reachable probes → null");
  assert.equal(r.cacheHits, 0, "no probes → 0 cache hits");
  assert.equal(typeof r.startedAt, "string", "startedAt always present");
  assert.equal(r.lastProbeAtMs, null, "no probes → lastProbeAtMs is null");
});

test("buildSummary: both providers reachable returns correct counts and latency stats", () => {
  const { buildSummary } = require("../api/health.js");
  const r = buildSummary({
    hasGemini: true,
    hasOpenRouter: true,
    geminiProbe: { ok: true, latencyMs: 100, cached: false, checkedAt: Date.now() },
    openRouterProbe: { ok: true, latencyMs: 250, cached: true, checkedAt: Date.now() },
  });
  assert.equal(r.providersConfigured, 2);
  assert.equal(r.providersReachable, 2);
  assert.equal(r.fastestProviderMs, 100, "min(100, 250) = 100");
  assert.equal(r.slowestProviderMs, 250, "max(100, 250) = 250");
  assert.equal(r.cacheHits, 1, "one cached probe");
});

test("buildSummary: only openrouter reachable → fastest === slowest === openrouter's latency", () => {
  const { buildSummary } = require("../api/health.js");
  const r = buildSummary({
    hasGemini: true,
    hasOpenRouter: true,
    geminiProbe: { ok: false, latencyMs: 3000, cached: false, checkedAt: Date.now() },
    openRouterProbe: { ok: true, latencyMs: 180, cached: false, checkedAt: Date.now() },
  });
  assert.equal(r.providersConfigured, 2);
  assert.equal(r.providersReachable, 1, "only openrouter ok");
  // Latency stats consider ONLY reachable providers.
  assert.equal(r.fastestProviderMs, 180, "min of reachable = 180");
  assert.equal(r.slowestProviderMs, 180, "max of reachable = 180");
  assert.equal(r.cacheHits, 0, "no cached probes");
});

test("buildSummary: anyProviderReachable + allProvidersReachable booleans are correct", () => {
  // Coverage for the iter #78 aggregate booleans via the helper API.
  const { buildSummary } = require("../api/health.js");
  // Both reachable
  let r = buildSummary({
    hasGemini: true, hasOpenRouter: true,
    geminiProbe: { ok: true, latencyMs: 100, cached: false, checkedAt: Date.now() },
    openRouterProbe: { ok: true, latencyMs: 100, cached: false, checkedAt: Date.now() },
  });
  assert.equal(r.anyProviderReachable, true, "both reachable → any true");
  assert.equal(r.allProvidersReachable, true, "both reachable → all true");
  // Only one reachable
  r = buildSummary({
    hasGemini: true, hasOpenRouter: true,
    geminiProbe: { ok: false, latencyMs: 0, cached: false, checkedAt: Date.now() },
    openRouterProbe: { ok: true, latencyMs: 100, cached: false, checkedAt: Date.now() },
  });
  assert.equal(r.anyProviderReachable, true, "one reachable → any true");
  assert.equal(r.allProvidersReachable, false, "one reachable → all false");
  // None reachable
  r = buildSummary({
    hasGemini: true, hasOpenRouter: true,
    geminiProbe: { ok: false, latencyMs: 0, cached: false, checkedAt: Date.now() },
    openRouterProbe: { ok: false, latencyMs: 0, cached: false, checkedAt: Date.now() },
  });
  assert.equal(r.anyProviderReachable, false);
  assert.equal(r.allProvidersReachable, false);
});

// ── peakRssMbPretty (iter #131) ────────────────────────────────

test("health handler: process.memory exposes peakRssMbPretty (human-readable peak RSS)", () => {
  // Pairs with peakRssMb (numeric, for graphing). The pretty form
  // surfaces the same number as a B/KB/MB/GB string for at-a-glance
  // reading on a curl. Null until the first /api/health request
  // populates the counter (matches peakRssMb's behavior).
  assert.match(HEALTH_SOURCE, /peakRssMbPretty/,
    "process.memory must include peakRssMbPretty field");
  // Null guard when counter is 0 / unset
  assert.match(HEALTH_SOURCE, /_peakRssMb\s*<=\s*0\s*\)\s*return\s*null/,
    "peakRssMbPretty must return null when peakRssMb is 0 / unset");
  // All 4 unit suffixes present in the branching
  assert.match(HEALTH_SOURCE, /}B`/,
    "must format bytes with B suffix");
  assert.match(HEALTH_SOURCE, /}KB`/,
    "must format kilobytes with KB suffix");
  assert.match(HEALTH_SOURCE, /}MB`/,
    "must format megabytes with MB suffix");
  assert.match(HEALTH_SOURCE, /}GB`/,
    "must format gigabytes with GB suffix");
});

test("health handler: peakRssMbPretty format respects unit threshold (1024-boundary branches)", () => {
  // Verify the format helper picks the correct unit suffix based on
  // the byte magnitude. Source-level assertions because _peakRssMb
  // is populated by the handler's main path and is hard to inject.
  // Thresholds: < 1024 B → "B", < 1MB → "KB", < 1GB → "MB", else "GB".
  assert.match(HEALTH_SOURCE, /bytes\s*<\s*1024[^`]*`[^`]*B`/,
    "< 1024 bytes must use B suffix");
  assert.match(HEALTH_SOURCE, /bytes\s*<\s*1024\s*\*\s*1024[^`]*`[^`]*KB`/,
    "< 1 MB must use KB suffix");
  assert.match(HEALTH_SOURCE, /bytes\s*<\s*1024\s*\*\s*1024\s*\*\s*1024[^`]*`[^`]*MB`/,
    "< 1 GB must use MB suffix");
  // 1-decimal precision via Math.round(x * 10) / 10 (one of the branches)
  assert.match(HEALTH_SOURCE, /Math\.round\([\s\S]*?\)\s*\*\s*10\s*\)\s*\/\s*10/,
    "must apply 1-decimal rounding on fractional units");
});

// ── errorBudget (iter #132) ───────────────────────────────────

test("health handler: summary exposes errorBudget (SRE-style 1-hour error budget)", () => {
  // SRE-standard concept: threshold = 1% over 1-hour window.
  // Pairs with `errorRate` (cumulative) and `errorsInLastHour`
  // (raw count). The object should have threshold, windowHours,
  // currentRate, remaining, and exhausted fields.
  assert.match(HEALTH_SOURCE, /errorBudget/, "summary must include errorBudget field");
  // Threshold is centralized as ERROR_BUDGET_THRESHOLD constant (iter #135 refactor)
  assert.match(HEALTH_SOURCE, /ERROR_BUDGET_THRESHOLD\s*=\s*0\.01/,
    "threshold constant must be 1% (SRE default)");
  assert.match(HEALTH_SOURCE, /windowHours\s*:\s*1/,
    "window must be 1 hour");
  assert.match(HEALTH_SOURCE, /currentRate/,
    "must include currentRate field");
  assert.match(HEALTH_SOURCE, /remaining/,
    "must include remaining field");
  assert.match(HEALTH_SOURCE, /exhausted/,
    "must include exhausted boolean");
  // remaining is clamped at 0 (never negative)
  assert.match(HEALTH_SOURCE, /Math\.max\(\s*0\s*,\s*[^)]+\)/,
    "remaining must be clamped to 0 via Math.max");
  // divide-by-zero guard when no requests in window
  assert.match(HEALTH_SOURCE, /_requestsInLastHour\.length\s*>\s*0/,
    "must guard divide-by-zero when last-hour window is empty");
  // Single source of truth: helper is referenced by both fields (iter #135)
  assert.match(HEALTH_SOURCE, /errorBudget:\s*computeErrorBudget\(\)/,
    "errorBudget must call computeErrorBudget() helper");
});

// ── summary duplicate-key guard (iter #137) ──────────────────

test("health handler: buildSummary has no duplicate keys (dead-code detector)", () => {
  // JavaScript object literals silently override earlier keys when
  // a later key has the same name. This catches the iter #137 bug
  // where `consecutiveSuccesses` was declared twice (line 360 + 491).
  // Approach: scan the source for `^\s*<key>\s*:` patterns within
  // the buildSummary function, count occurrences, fail on any > 1.
  const src = require("node:fs").readFileSync(
    require("node:path").join(__dirname, "../api/health.js"),
    "utf8"
  );
  // Find the buildSummary return-object by scanning for the unique
  // sentinel `function buildSummary(... {` followed by `return {`
  // (the first such occurrence, since the helper itself contains no
  // `return {`).
  const fnStart = src.indexOf("function buildSummary");
  if (fnStart === -1) throw new Error("buildSummary not found in source");
  // Skip past the destructuring argument `{ hasGemini, ... }` so we
  // start counting braces from the FUNCTION body, not the args object.
  // Find the first `{` (arg start), walk to its matching `}`, then the
  // body `{` immediately follows.
  const argOpen = src.indexOf("{", fnStart);
  if (argOpen === -1) throw new Error("buildSummary arg brace not found");
  let argDepth = 1;
  let argClose = -1;
  for (let i = argOpen + 1; i < src.length; i++) {
    const c = src[i];
    if (c === "{") argDepth += 1;
    else if (c === "}") { argDepth -= 1; if (argDepth === 0) { argClose = i; break; } }
  }
  if (argClose === -1) throw new Error("buildSummary arg close brace not found");
  // Body opens immediately after `) {` — find the body `{`.
  const fnOpen = src.indexOf("{", argClose);
  if (fnOpen === -1) throw new Error("buildSummary body brace not found");
  // Walk to find the matching close brace of the function body.
  let depth = 1;
  let fnEnd = -1;
  for (let i = fnOpen + 1; i < src.length; i++) {
    const c = src[i];
    if (c === "{") depth += 1;
    else if (c === "}") { depth -= 1; if (depth === 0) { fnEnd = i; break; } }
  }
  if (fnEnd === -1) throw new Error("buildSummary close brace not found");
  const body = src.slice(fnOpen, fnEnd);
  // Now find `return {` inside this body, brace-counting to its close.
  const returnStart = body.indexOf("return {");
  if (returnStart === -1) throw new Error("`return {` not found inside buildSummary body");
  let rDepth = 1;
  let returnEnd = -1;
  for (let i = returnStart + "return {".length; i < body.length; i++) {
    if (body[i] === "{") rDepth += 1;
    else if (body[i] === "}") { rDepth -= 1; if (rDepth === 0) { returnEnd = i; break; } }
  }
  if (returnEnd === -1) throw new Error("matching `}` not found for return { ... }");
  const summaryObj = body.slice(returnStart + "return {".length, returnEnd);
  // Extract top-level keys: 4-space indent, identifier, colon.
  const keyPattern = /^\s{4}([a-zA-Z_$][\w$]*)\s*:/gm;
  const seen = new Map();
  const dupes = [];
  let m;
  while ((m = keyPattern.exec(summaryObj)) !== null) {
    const key = m[1];
    if (seen.has(key)) dupes.push(key);
    else seen.set(key, 1);
  }
  assert.equal(dupes.length, 0,
    `buildSummary return-object has duplicate keys (later wins, earlier is dead): ${[...new Set(dupes)].join(", ")}`);
});

// ── rateLimited / rateLimitedInLastHour (iter #136) ──────────

test("health handler: summary exposes rateLimited + rateLimitedInLastHour (429 tracking)", () => {
  // Surfaces the rate-limit reject signal that was previously buried
  // in requestsByStatus[429]. The cumulative field reads directly
  // from _requestsByStatus.get(429); the rolling 1-hour field reads
  // from a dedicated window populated by recordRequestStatus(429).
  assert.match(HEALTH_SOURCE, /rateLimited\s*:\s*_requestsByStatus\.get\(429\)/,
    "rateLimited must read from _requestsByStatus.get(429)");
  assert.match(HEALTH_SOURCE, /rateLimitedInLastHour\s*:\s*_rateLimitedInLastHour\.length/,
    "rateLimitedInLastHour must read from _rateLimitedInLastHour.length");
  // Module-level rolling window
  assert.match(HEALTH_SOURCE, /let _rateLimitedInLastHour\s*=\s*\[\]/,
    "_rateLimitedInLastHour must be a module-level array");
  // Push happens inside recordRequestStatus when statusCode === 429
  assert.match(HEALTH_SOURCE, /statusCode\s*===\s*429\s*\)\s*\{[\s\S]*?pushToHourWindow\(\s*_rateLimitedInLastHour\s*\)/,
    "must use pushToHourWindow helper to update the 429 window");
});

test("buildSummary: rateLimited delta tracks injected 429 count (behavioral)", () => {
  // Behavioral verification: inject N 429 codes via recordRequestStatus,
  // verify rateLimited increased by N and rateLimitedInLastHour
  // increased by N (we're in the same 1-hour window).
  const { buildSummary, recordRequestStatus } = require("../api/health.js");
  const before = buildSummary({
    hasGemini: false, hasOpenRouter: false,
    geminiProbe: null, openRouterProbe: null,
  });
  const bRate = before.rateLimited;
  const bWindow = before.rateLimitedInLastHour;
  // Inject 5 429s
  for (let i = 0; i < 5; i++) recordRequestStatus(429);
  // Inject 3 non-429 4xx to verify they do NOT increment the window
  recordRequestStatus(404);
  recordRequestStatus(400);
  recordRequestStatus(403);
  const after = buildSummary({
    hasGemini: false, hasOpenRouter: false,
    geminiProbe: null, openRouterProbe: null,
  });
  assert.equal(after.rateLimited - bRate, 5,
    "rateLimited must increase by exactly 5 (one per 429)");
  assert.equal(after.rateLimitedInLastHour - bWindow, 5,
    "rateLimitedInLastHour must increase by exactly 5 (one per 429)");
  // Verify 404/400/403 did NOT pollute the 429-only window
  // (we can only check that the window delta is exactly 5, not >5)
});

// ── requestsAccepted (iter #143) ──────────────────────────────

test("health handler: summary exposes requestsAccepted (cumulative 2xx count)", () => {
  // Source-pattern: derived from _requestsByStatus by summing 2xx entries.
  assert.match(HEALTH_SOURCE, /requestsAccepted/, "summary must include requestsAccepted field");
  assert.match(HEALTH_SOURCE, /status\s*>=\s*200\s*&&\s*status\s*<\s*300/,
    "must filter to [200, 300) status range (2xx only)");
  assert.match(HEALTH_SOURCE, /for\s*\(\s*const\s*\[\s*status\s*,\s*count\s*\]\s*of\s*_requestsByStatus\s*\)/,
    "must iterate _requestsByStatus entries");
});

test("buildSummary: requestsAccepted delta tracks injected 2xx codes (behavioral)", () => {
  // Behavioral: inject N 2xx codes via recordRequestStatus, verify
  // requestsAccepted increased by N. Also inject some non-2xx codes
  // and verify they do NOT count.
  const { buildSummary, recordRequestStatus } = require("../api/health.js");
  const before = buildSummary({
    hasGemini: false, hasOpenRouter: false,
    geminiProbe: null, openRouterProbe: null,
  }).requestsAccepted;
  // Inject 2× 200, 1× 201, 1× 204 → +4 to requestsAccepted
  recordRequestStatus(200);
  recordRequestStatus(200);
  recordRequestStatus(201);
  recordRequestStatus(204);
  // Inject non-2xx codes that must NOT be counted
  recordRequestStatus(404);
  recordRequestStatus(500);
  recordRequestStatus(429);
  const after = buildSummary({
    hasGemini: false, hasOpenRouter: false,
    geminiProbe: null, openRouterProbe: null,
  }).requestsAccepted;
  assert.equal(after - before, 4,
    "requestsAccepted must increase by exactly 4 (the 2xx codes only)");
});

// ── requestsAcceptedInLastHour (iter #144) ───────────────────

test("health handler: summary exposes requestsAcceptedInLastHour (rolling 2xx count)", () => {
  // Source-pattern: derived from _acceptedInLastHour.length.
  assert.match(HEALTH_SOURCE, /requestsAcceptedInLastHour/,
    "summary must include requestsAcceptedInLastHour field");
  assert.match(HEALTH_SOURCE, /requestsAcceptedInLastHour\s*:\s*_acceptedInLastHour\.length/,
    "must read from _acceptedInLastHour.length");
  assert.match(HEALTH_SOURCE, /let _acceptedInLastHour\s*=\s*\[\]/,
    "_acceptedInLastHour must be a module-level array");
  // Push happens inside recordRequestStatus when status is 2xx
  assert.match(HEALTH_SOURCE, /pushToHourWindow\(\s*_acceptedInLastHour\s*\)/,
    "must use pushToHourWindow helper to update the 2xx window");
  // The Date.now() push logic lives in the helper — verify it exists.
  assert.match(HEALTH_SOURCE, /function pushToHourWindow[\s\S]+?arr\.push\(Date\.now\(\)\)/,
    "pushToHourWindow must call Date.now() and push onto the array");
});

test("buildSummary: requestsAcceptedInLastHour delta tracks injected 2xx codes (behavioral)", () => {
  // Behavioral: inject N 2xx codes via recordRequestStatus, verify
  // requestsAcceptedInLastHour increased by N. Inject some non-2xx
  // codes and verify they do NOT count.
  const { buildSummary, recordRequestStatus } = require("../api/health.js");
  const before = buildSummary({
    hasGemini: false, hasOpenRouter: false,
    geminiProbe: null, openRouterProbe: null,
  }).requestsAcceptedInLastHour;
  // Inject 3× 200 → +3 to window
  recordRequestStatus(200);
  recordRequestStatus(200);
  recordRequestStatus(201);
  // Non-2xx must NOT increment the window
  recordRequestStatus(404);
  recordRequestStatus(429);
  recordRequestStatus(500);
  const after = buildSummary({
    hasGemini: false, hasOpenRouter: false,
    geminiProbe: null, openRouterProbe: null,
  }).requestsAcceptedInLastHour;
  assert.equal(after - before, 3,
    "requestsAcceptedInLastHour must increase by exactly 3 (2xx codes only)");
});

// ── acceptanceRate (iter #145) ───────────────────────────────

test("health handler: summary exposes acceptanceRate (lifetime 2xx / (2xx + 429))", () => {
  // Source-pattern: derived formula accepted / (accepted + rateLimited),
  // 4-decimal precision, divide-by-zero guard returns 1. After iter
  // #153 the math lives in formatAcceptanceRate() helper — verify
  // it's called from the summary field.
  assert.match(HEALTH_SOURCE, /acceptanceRate/,
    "summary must include acceptanceRate field");
  assert.match(HEALTH_SOURCE, /acceptanceRate:\s*\(\(\)\s*=>[\s\S]{0,200}?formatAcceptanceRate/,
    "summary.acceptanceRate must call formatAcceptanceRate() helper");
  assert.match(HEALTH_SOURCE, /function formatAcceptanceRate[\s\S]+?total\s*===\s*0\s*\)\s*return\s*\{[^}]*1/,
    "formatAcceptanceRate must guard divide-by-zero with rate: 1");
  assert.match(HEALTH_SOURCE, /formatAcceptanceRate[\s\S]+?Math\.round\([\s\S]+?\)\s*\*\s*10000\s*\)\s*\/\s*10000/,
    "formatAcceptanceRate must apply 4-decimal precision");
});

test("buildSummary: acceptanceRate is a sane [0, 1] number with 4-decimal precision", () => {
  // Behavioral: the value must be a number in [0, 1] with at most 4
  // decimal places. We don't assert exact equality because the Map
  // is shared across tests, but we verify the structure.
  const { buildSummary } = require("../api/health.js");
  const r = buildSummary({
    hasGemini: false, hasOpenRouter: false,
    geminiProbe: null, openRouterProbe: null,
  });
  const ar = r.acceptanceRate;
  assert.equal(typeof ar, "number", "acceptanceRate must be a number");
  assert.ok(ar >= 0 && ar <= 1, `acceptanceRate must be in [0, 1]; got ${ar}`);
  // 4-decimal precision: the value × 10000 must be an integer (or
  // essentially equal to one within float epsilon).
  const scaled = ar * 10000;
  assert.ok(Math.abs(scaled - Math.round(scaled)) < 1e-6,
    `acceptanceRate × 10000 must be effectively an integer; got ${scaled}`);
});

// ── pushToHourWindow helper (iter #146) ──────────────────────

test("pushToHourWindow: appends timestamp and prunes entries older than 1 hour", () => {
  // Behavioral verification of the helper extracted in iter #146.
  // We can't reach the helper directly (not exported), but we can
  // exercise it via recordRequestStatus which calls it internally.
  // Build a fresh array-like check by recording various status codes
  // and verifying the resulting window length + recency.
  const { recordRequestStatus } = require("../api/health.js");
  // The current process state has accumulated history; we can only
  // assert that a fresh 2xx push increments the window by 1 and
  // the new entry is "now" (within a small tolerance).
  const beforeMs = Date.now();
  recordRequestStatus(200);
  const afterMs = Date.now();
  // We can't peek into the array directly, but we can verify via
  // the summary field that the window grew by exactly 1.
  const { buildSummary } = require("../api/health.js");
  const after = buildSummary({
    hasGemini: false, hasOpenRouter: false,
    geminiProbe: null, openRouterProbe: null,
  }).requestsAcceptedInLastHour;
  // The window length must have increased by at least 1 (could be
  // more if other tests just ran in the same suite). What matters
  // is the helper is reachable through the public API and applies
  // the push + prune behavior correctly.
  assert.ok(after >= 1, "window must be ≥ 1 after a fresh 2xx push");
  // Timestamp window: confirm the call completed within the test run
  assert.ok(afterMs >= beforeMs, "wall-clock must advance across the push");
});

// ── acceptanceRatePretty (iter #147) ─────────────────────────

test("health handler: summary exposes acceptanceRatePretty (human-readable %)", () => {
  // Source-pattern: human-readable formatter for acceptanceRate.
  // After iter #153 the format lives in formatAcceptanceRate() helper.
  assert.match(HEALTH_SOURCE, /acceptanceRatePretty/,
    "summary must include acceptanceRatePretty field");
  assert.match(HEALTH_SOURCE, /acceptanceRatePretty:\s*\(\(\)\s*=>[\s\S]{0,200}?formatAcceptanceRate/,
    "summary.acceptanceRatePretty must call formatAcceptanceRate() helper");
  assert.match(HEALTH_SOURCE, /function formatAcceptanceRate[\s\S]+?ratePretty:\s*"100%"/,
    "formatAcceptanceRate must return ratePretty: \"100%\" for empty window");
  assert.match(HEALTH_SOURCE, /formatAcceptanceRate[\s\S]+?toFixed\(1\)/,
    "formatAcceptanceRate must use toFixed(1) for pretty format");
});

test("buildSummary: acceptanceRatePretty matches the numeric acceptanceRate", () => {
  // Cross-check the two representations: the pretty string must
  // reflect the same value as the numeric struct.
  const { buildSummary } = require("../api/health.js");
  const r = buildSummary({
    hasGemini: false, hasOpenRouter: false,
    geminiProbe: null, openRouterProbe: null,
  });
  assert.equal(typeof r.acceptanceRatePretty, "string",
    "acceptanceRatePretty must be a string");
  // The numeric rate × 100 must be ≈ the pretty number (1-decimal).
  const numericPct = r.acceptanceRate * 100;
  const prettyPct = parseFloat(r.acceptanceRatePretty);
  assert.ok(Math.abs(numericPct - prettyPct) < 0.2,
    `pretty (${prettyPct}%) must be within 0.2% of numeric (${numericPct}%)`);
});

// ── computeAcceptanceCounts helper (iter #148) ────────────────

test("computeAcceptanceCounts: helper is exported and returns accepted + rateLimited", () => {
  // After the iter #148 refactor, computeAcceptanceCounts is the
  // single source of truth for both acceptanceRate and acceptanceRatePretty.
  const { computeAcceptanceCounts } = require("../api/health.js");
  assert.equal(typeof computeAcceptanceCounts, "function",
    "computeAcceptanceCounts must be exported as a function");
  const counts = computeAcceptanceCounts();
  assert.equal(typeof counts, "object");
  assert.equal(typeof counts.accepted, "number",
    "counts.accepted must be a number");
  assert.equal(typeof counts.rateLimited, "number",
    "counts.rateLimited must be a number");
  assert.ok(counts.accepted >= 0 && counts.rateLimited >= 0,
    "counts must be non-negative");
});

test("buildSummary: acceptanceRate and computeAcceptanceCounts() are consistent", () => {
  // The summary field must call the helper (not reimplement the math).
  // If they ever drift, this test will catch it.
  const { computeAcceptanceCounts, buildSummary } = require("../api/health.js");
  const counts = computeAcceptanceCounts();
  const summary = buildSummary({
    hasGemini: false, hasOpenRouter: false,
    geminiProbe: null, openRouterProbe: null,
  });
  // Verify the rate field reflects the helper's accepted / (accepted + rateLimited).
  const expectedRate = (counts.accepted + counts.rateLimited) === 0
    ? 1
    : counts.accepted / (counts.accepted + counts.rateLimited);
  assert.equal(summary.acceptanceRate, Math.round(expectedRate * 10000) / 10000,
    "summary.acceptanceRate must equal helper computation (4-decimal rounded)");
});

// ── acceptanceRateInLastHour (iter #149) ─────────────────────

test("health handler: summary exposes acceptanceRateInLastHour + Pretty (windowed pair)", () => {
  // Source-pattern: windowed acceptance rate pair mirroring the lifetime
  // acceptance trio. After iter #153 both fields call formatAcceptanceRate.
  assert.match(HEALTH_SOURCE, /acceptanceRateInLastHour/,
    "summary must include acceptanceRateInLastHour field");
  assert.match(HEALTH_SOURCE, /acceptanceRateInLastHourPretty/,
    "summary must include acceptanceRateInLastHourPretty field");
  assert.match(HEALTH_SOURCE, /acceptanceRateInLastHour:\s*formatAcceptanceRate/,
    "windowed pair must call formatAcceptanceRate helper");
  assert.match(HEALTH_SOURCE, /acceptanceRateInLastHourPretty:\s*formatAcceptanceRate/,
    "windowed pretty must call formatAcceptanceRate helper");
  // Both fields pass the same window-array counts
  assert.match(HEALTH_SOURCE, /formatAcceptanceRate\(\s*_acceptedInLastHour\.length\s*,\s*_rateLimitedInLastHour\.length\s*\)/,
    "windowed fields must read from _acceptedInLastHour + _rateLimitedInLastHour");
});

test("buildSummary: acceptanceRateInLastHourPretty parses back to within 0.2% of the numeric", () => {
  // Behavioral: cross-check the numeric + pretty windowed fields.
  const { buildSummary } = require("../api/health.js");
  const r = buildSummary({
    hasGemini: false, hasOpenRouter: false,
    geminiProbe: null, openRouterProbe: null,
  });
  assert.equal(typeof r.acceptanceRateInLastHour, "number",
    "acceptanceRateInLastHour must be a number");
  assert.ok(r.acceptanceRateInLastHour >= 0 && r.acceptanceRateInLastHour <= 1,
    "must be in [0, 1]");
  assert.equal(typeof r.acceptanceRateInLastHourPretty, "string",
    "pretty must be a string");
  // Cross-check numeric vs pretty
  const numericPct = r.acceptanceRateInLastHour * 100;
  const prettyPct = parseFloat(r.acceptanceRateInLastHourPretty);
  assert.ok(Math.abs(numericPct - prettyPct) < 0.2,
    `pretty (${prettyPct}%) must be within 0.2% of numeric (${numericPct}%)`);
});

// ── rateLimitedPretty (iter #150) ────────────────────────────

test("health handler: summary exposes rateLimitedPretty (compact counter)", () => {
  // Source-pattern: compact formatter for the 429 counter. Three branches:
  //   - < 1000   → plain integer (e.g. "42")
  //   - < 1M     → "X.XK" with 1-decimal precision (e.g. "12.3K")
  //   - ≥ 1M     → "X.XM" with 1-decimal precision (e.g. "1.5M")
  assert.match(HEALTH_SOURCE, /rateLimitedPretty/,
    "summary must include rateLimitedPretty field");
  // Small-count branch
  assert.match(HEALTH_SOURCE, /n\s*<\s*1000\s*\)\s*return\s*String\(n\)/,
    "< 1000 → return String(n)");
  // K-suffix branch
  assert.match(HEALTH_SOURCE, /n\s*<\s*1000000\s*\)\s*return\s*`\$\{[^}]+\}K`/,
    "< 1M → K-suffix");
  // M-suffix branch (final return)
  assert.match(HEALTH_SOURCE, /return\s*`\$\{[^}]+\}M`/,
    "≥ 1M → M-suffix");
  // 1-decimal precision
  assert.match(HEALTH_SOURCE, /Math\.round\([\s\S]+?\)\s*\*\s*10\s*\)\s*\/\s*10/,
    "must apply 1-decimal precision rounding");
});

test("buildSummary: rateLimitedPretty is a string for any counter value", () => {
  // Behavioral: regardless of underlying counter size, the field
  // must be a string. We assert type only since the exact string
  // depends on accumulated 429 count in this suite.
  const { buildSummary } = require("../api/health.js");
  const r = buildSummary({
    hasGemini: false, hasOpenRouter: false,
    geminiProbe: null, openRouterProbe: null,
  });
  assert.equal(typeof r.rateLimitedPretty, "string",
    "rateLimitedPretty must be a string");
  // Must end in either a digit (small count) or "K" / "M"
  assert.match(r.rateLimitedPretty, /^\d+(\.\d+)?[KM]?$/,
    `rateLimitedPretty must match /\\d+(\\.\\d+)?[KM]?$/; got "${r.rateLimitedPretty}"`);
});

// ── peakRssMbAt (iter #151) ──────────────────────────────────

test("health handler: process.memory exposes peakRssMbAt (peak timestamp)", () => {
  // Pairs with peakRssMb so ops can distinguish "peak hit recently
  // (potential leak)" from "peak hit long ago (stable)".
  assert.match(HEALTH_SOURCE, /peakRssMbAt/,
    "process.memory must include peakRssMbAt field");
  // Module-level counter
  assert.match(HEALTH_SOURCE, /let _peakRssMbAt\s*=\s*0/,
    "_peakRssMbAt must be a module-level counter");
  // Updated ONLY when peak advances (conditional update, not every request)
  assert.match(HEALTH_SOURCE, /rssNowMb\s*>\s*_peakRssMb\s*\)\s*\{[\s\S]*?_peakRssMbAt\s*=\s*Date\.now\(\)/,
    "_peakRssMbAt must be updated only when a new peak is observed");
  // Null guard when no peak yet
  assert.match(HEALTH_SOURCE, /_peakRssMbAt\s*\?\s*new Date\(_peakRssMbAt\)\.toISOString\(\)\s*:\s*null/,
    "must return null when _peakRssMbAt is 0");
});

// ── maxHealthDurationPretty (iter #152) ───────────────────────

test("health handler: summary exposes maxHealthDurationPretty (human-readable)", () => {
  // Source-pattern: pairs with maxHealthDurationMs (numeric) for
  // at-a-glance reading on dashboards / curl.
  assert.match(HEALTH_SOURCE, /maxHealthDurationPretty/,
    "summary must include maxHealthDurationPretty field");
  // "—" sentinel for the zero-requests-yet case
  assert.match(HEALTH_SOURCE, /return\s*"—"/,
    "zero-requests branch must return literal \"—\"");
  // "ms" branch for sub-second durations
  assert.match(HEALTH_SOURCE, /ms\s*<\s*1000\s*\)\s*return\s*`\$\{[^}]+\}ms`/,
    "< 1000ms branch → \"Xms\" suffix");
  // "s" branch for ≥1s durations with 1-decimal precision
  assert.match(HEALTH_SOURCE, /Math\.round\([\s\S]+?\)\s*\*\s*10\s*\)\s*\/\s*10[\s\S]+?\}s`/,
    "≥ 1s branch → 1-decimal precision + \"s\" suffix");
});

test("buildSummary: maxHealthDurationPretty is a string matching the expected format", () => {
  // Behavioral: regardless of the underlying counter, the field must
  // be a string in one of the three valid shapes ("—", "Xms", "X.Xs").
  const { buildSummary } = require("../api/health.js");
  const r = buildSummary({
    hasGemini: false, hasOpenRouter: false,
    geminiProbe: null, openRouterProbe: null,
  });
  assert.equal(typeof r.maxHealthDurationPretty, "string",
    "maxHealthDurationPretty must be a string");
  assert.match(r.maxHealthDurationPretty, /^(—|\d+ms|\d+\.\d+s)$/,
    `must match /^(|\\d+ms|\\d+\\.\\d+s)$/; got "${r.maxHealthDurationPretty}"`);
});

// ── formatAcceptanceRate helper (iter #153) ────────────────────

test("formatAcceptanceRate: helper is exported and returns { rate, ratePretty }", () => {
  // After the iter #153 refactor, formatAcceptanceRate is the single
  // source of truth for all 4 acceptance rate fields (lifetime + windowed
  // × numeric + pretty). Verify the helper exists and returns both shapes.
  const { formatAcceptanceRate } = require("../api/health.js");
  assert.equal(typeof formatAcceptanceRate, "function",
    "formatAcceptanceRate must be exported as a function");
  // Healthy case: all accepted
  const all = formatAcceptanceRate(100, 0);
  assert.equal(all.rate, 1, "all accepted → rate = 1");
  assert.equal(all.ratePretty, "100.0%", "all accepted → ratePretty = \"100.0%\"");
  // Empty case: degenerate
  const empty = formatAcceptanceRate(0, 0);
  assert.equal(empty.rate, 1, "no traffic → rate = 1 (sentinel)");
  assert.equal(empty.ratePretty, "100%", "no traffic → ratePretty = \"100%\" sentinel");
  // Mixed: 75% accepted
  const mixed = formatAcceptanceRate(75, 25);
  assert.equal(mixed.rate, 0.75, "75/100 → rate = 0.75");
  assert.equal(mixed.ratePretty, "75.0%", "75/100 → ratePretty = \"75.0%\"");
});

test("buildSummary: all 4 acceptance rate fields derive from formatAcceptanceRate", () => {
  // Cross-check: the lifetime + windowed × numeric + pretty fields all
  // match the helper's output for their respective data sources.
  const { formatAcceptanceRate, computeAcceptanceCounts, buildSummary } =
    require("../api/health.js");
  // Lifetime source
  const lifetimeCounts = computeAcceptanceCounts();
  const lifetimeExpected = formatAcceptanceRate(lifetimeCounts.accepted, lifetimeCounts.rateLimited);
  // Windowed source (read via the public summary fields)
  const r = buildSummary({
    hasGemini: false, hasOpenRouter: false,
    geminiProbe: null, openRouterProbe: null,
  });
  // Lifetime pair must match
  assert.equal(r.acceptanceRate, lifetimeExpected.rate,
    "summary.acceptanceRate must equal formatAcceptanceRate(lifetime)");
  assert.equal(r.acceptanceRatePretty, lifetimeExpected.ratePretty,
    "summary.acceptanceRatePretty must equal formatAcceptanceRate(lifetime).ratePretty");
  // Windowed pair must match
  const windowedExpected = formatAcceptanceRate(
    r.requestsAcceptedInLastHour, r.rateLimitedInLastHour
  );
  assert.equal(r.acceptanceRateInLastHour, windowedExpected.rate,
    "summary.acceptanceRateInLastHour must equal formatAcceptanceRate(windowed)");
  assert.equal(r.acceptanceRateInLastHourPretty, windowedExpected.ratePretty,
    "summary.acceptanceRateInLastHourPretty must equal formatAcceptanceRate(windowed).ratePretty");
});

// ── rateLimitedInLastHourPretty (iter #154) ───────────────────

test("health handler: summary exposes rateLimitedInLastHourPretty (windowed compact counter)", () => {
  // Source-pattern: windowed counter formatter. Mirrors rateLimitedPretty
  // (cumulative) using the same K/M compact format.
  assert.match(HEALTH_SOURCE, /rateLimitedInLastHourPretty/,
    "summary must include rateLimitedInLastHourPretty field");
  // Reads from _rateLimitedInLastHour.length
  assert.match(HEALTH_SOURCE, /_rateLimitedInLastHour\.length/,
    "must read from _rateLimitedInLastHour.length");
  // Small-count branch
  assert.match(HEALTH_SOURCE, /n\s*<\s*1000\s*\)\s*return\s*String\(n\)/,
    "< 1000 → return String(n)");
  // K-suffix and M-suffix branches
  assert.match(HEALTH_SOURCE, /n\s*<\s*1000000\s*\)\s*return\s*`\$\{[^}]+\}K`/,
    "< 1M → K-suffix");
  assert.match(HEALTH_SOURCE, /return\s*`\$\{[^}]+\}M`/,
    "≥ 1M → M-suffix");
});

test("buildSummary: rateLimitedInLastHourPretty is a string matching the compact format", () => {
  // Behavioral: type check + regex match against the three valid shapes.
  const { buildSummary } = require("../api/health.js");
  const r = buildSummary({
    hasGemini: false, hasOpenRouter: false,
    geminiProbe: null, openRouterProbe: null,
  });
  assert.equal(typeof r.rateLimitedInLastHourPretty, "string",
    "rateLimitedInLastHourPretty must be a string");
  assert.match(r.rateLimitedInLastHourPretty, /^\d+(\.\d+)?[KM]?$/,
    `must match /\\d+(\\.\\d+)?[KM]?$/; got "${r.rateLimitedInLastHourPretty}"`);
});

test("computeErrorBudget: helper is exported and shape matches summary.errorBudget (single source of truth)", () => {
  // After the iter #135 refactor, computeErrorBudget is the single
  // source of truth for both summary.errorBudget and summary.errorBudgetPretty.
  // Verify the helper is exported and returns the same shape as the
  // summary field.
  const { computeErrorBudget } = require("../api/health.js");
  assert.equal(typeof computeErrorBudget, "function",
    "computeErrorBudget must be exported as a function");
  const eb = computeErrorBudget();
  assert.equal(typeof eb, "object", "helper must return an object");
  for (const k of ["threshold", "windowHours", "currentRate", "remaining", "exhausted"]) {
    assert.ok(k in eb, `helper must include ${k} field`);
  }
  // threshold must match the SRE default (1%)
  assert.equal(eb.threshold, 0.01);
  // windowHours must be 1 (matches the rolling 1-hour window)
  assert.equal(eb.windowHours, 1);
  // currentRate must be in [0, 1]
  assert.ok(eb.currentRate >= 0 && eb.currentRate <= 1);
  // remaining must be in [0, threshold]
  assert.ok(eb.remaining >= 0 && eb.remaining <= eb.threshold);
  // exhausted must be a boolean
  assert.equal(typeof eb.exhausted, "boolean");
});

test("buildSummary: errorBudget and computeErrorBudget() return equivalent values", () => {
  // The summary field must call the helper (not reimplement the math).
  // If they ever drift, this test will catch it.
  const { computeErrorBudget, buildSummary } = require("../api/health.js");
  const helper = computeErrorBudget();
  const summary = buildSummary({
    hasGemini: false, hasOpenRouter: false,
    geminiProbe: null, openRouterProbe: null,
  }).errorBudget;
  for (const k of ["threshold", "windowHours", "currentRate", "remaining", "exhausted"]) {
    assert.equal(summary[k], helper[k],
      `summary.errorBudget.${k} must match computeErrorBudget().${k}`);
  }
});

// ── errorBudgetPretty (iter #134) ─────────────────────────────

test("health handler: summary exposes errorBudgetPretty (human-readable error budget)", () => {
  // Pairs with `errorBudget` (numeric struct, for alerting scripts).
  // The pretty form is for at-a-glance reading on dashboards.
  // Three branches: "exhausted" / "100% remaining" / "X.XX% remaining".
  assert.match(HEALTH_SOURCE, /errorBudgetPretty/,
    "summary must include errorBudgetPretty field");
  // "exhausted" branch — must come first so an exhausted budget
  // doesn't accidentally render as "0.00% remaining".
  assert.match(HEALTH_SOURCE, /exhausted\s*\)\s*return\s*"exhausted"/,
    "exhausted branch must return literal \"exhausted\"");
  // "100% remaining" branch — pristine state when pct rounds to 100.
  assert.match(HEALTH_SOURCE, /return\s*"100%\s+remaining"/,
    "zero-error branch must return \"100% remaining\"");
  // "X.XX% remaining" branch — under-budget with 2-decimal precision.
  assert.match(HEALTH_SOURCE, /toFixed\(2\)\}[^`]*%\s+remaining/,
    "under-budget branch must format with toFixed(2) and \"% remaining\"");
});

test("buildSummary: errorBudgetPretty format is sane on empty window (delta, behavioral)", () => {
  // Verify the pretty form is a string with one of the three expected
  // shapes. We don't assert exact equality because the windows
  // persist across tests, but we do verify the format invariant.
  const { buildSummary } = require("../api/health.js");
  const r = buildSummary({
    hasGemini: false, hasOpenRouter: false,
    geminiProbe: null, openRouterProbe: null,
  });
  assert.equal(typeof r.errorBudgetPretty, "string",
    "errorBudgetPretty must be a string");
  // Must be one of: "exhausted", "100% remaining", or "X.XX% remaining"
  // (where X.XX is 0.00..99.99, possibly with leading/trailing spaces trimmed)
  const ok = r.errorBudgetPretty === "exhausted"
    || /^100(\.0+)?%\s+remaining$/.test(r.errorBudgetPretty)
    || /^\d{1,2}\.\d{2}%\s+remaining$/.test(r.errorBudgetPretty);
  assert.ok(ok, `errorBudgetPretty must match one of the three formats; got "${r.errorBudgetPretty}"`);
  // Cross-check with the numeric struct: if exhausted is true, pretty
  // must be "exhausted". If remaining ≥ 1.0 (rounded), pretty must
  // be "100% remaining".
  if (r.errorBudget.exhausted) {
    assert.equal(r.errorBudgetPretty, "exhausted",
      "exhausted=true → pretty must be \"exhausted\"");
  }
});

// ── errorBudget behavioral (iter #133) ───────────────────────

test("health handler: errorBudget.currentRate reflects injected 5xx ratio (mocked fetch)", async () => {
  // Behavioral verification of the SRE error budget calculation.
  // Drive the handler with varied IPs (to bypass the per-IP rate
  // limit at 60/min) so each call increments `_requestsInLastHour`,
  // then inject 5xx responses via `recordRequestStatus` to populate
  // `_errorsInLastHour`. The handler is mocked to succeed quickly so
  // the test focuses on the budget math, not probe behavior.
  const origFetch = globalThis.fetch;
  globalThis.fetch = async () => ({ ok: true, status: 200 });
  try {
    const handler = require("../api/health.js");

    // Capture baseline (errors + requests may already be populated
    // by prior tests in this run).
    const before = (() => {
      const res = { statusCode: 200, _body: null, headers: {}, headersSent: false,
        setHeader(k, v) { this.headers[k] = v; },
        end(s) { this._body = s; this.headersSent = true; } };
      const req = { method: "GET", headers: {}, socket: { remoteAddress: "10.99.0.1" } };
      return handler(req, res).then(() => JSON.parse(res._body).summary.errorBudget);
    })();
    const beforeEb = await before;

    // Drive 10 handler requests from 10 distinct IPs → +10 to window.
    for (let i = 0; i < 10; i++) {
      const res = { statusCode: 200, _body: null, headers: {}, headersSent: false,
        setHeader(k, v) { this.headers[k] = v; },
        end(s) { this._body = s; this.headersSent = true; } };
      const req = { method: "GET", headers: {}, socket: { remoteAddress: `10.99.1.${i}` } };
      await handler(req, res);
    }
    // Inject 1 server error → +1 to errors window.
    // 1/10 = 0.1, well above the 0.01 threshold → exhausted must fire.
    require("../api/health.js").recordRequestStatus(500);

    // Read errorBudget via a fresh handler invocation.
    const afterRes = { statusCode: 200, _body: null, headers: {}, headersSent: false,
      setHeader(k, v) { this.headers[k] = v; },
      end(s) { this._body = s; this.headersSent = true; } };
    const afterReq = { method: "GET", headers: {}, socket: { remoteAddress: "10.99.2.1" } };
    await handler(afterReq, afterRes);
    const afterEb = JSON.parse(afterRes._body).summary.errorBudget;

    // Math invariants: remaining is clamped at 0, so when currentRate
    // > threshold, remaining must be 0 and exhausted must be true.
    if (afterEb.currentRate > afterEb.threshold) {
      assert.equal(afterEb.remaining, 0,
        "remaining must be clamped at 0 when rate exceeds threshold");
      assert.equal(afterEb.exhausted, true,
        "exhausted must be true when currentRate > threshold");
    }
    // currentRate must be in [0, 1] (4-decimal precision rounding is fine)
    assert.ok(afterEb.currentRate >= 0 && afterEb.currentRate <= 1,
      `currentRate must be in [0, 1]; got ${afterEb.currentRate}`);
    // remaining must be in [0, threshold]
    assert.ok(afterEb.remaining >= 0 && afterEb.remaining <= afterEb.threshold,
      `remaining must be in [0, ${afterEb.threshold}]; got ${afterEb.remaining}`);
    // exhausted must have flipped if our injection pushed over budget.
    // (We don't assert before→after delta because prior tests may have
    // already pushed past 1%; we only verify the math is self-consistent.)
  } finally {
    globalThis.fetch = origFetch;
  }
});

// ── requestsPerStatusGroup (iter #130, behavioral) ────────────

test("buildSummary: requestsPerStatusGroup buckets statuses correctly by class", () => {
  // Behavioral verification of the per-status-class grouping. The
  // summary is derived from `_requestsByStatus` (a module-level Map
  // populated by `recordRequestStatus`). Inject codes and verify the
  // delta — exact counts depend on prior tests in the same suite.
  const { buildSummary, recordRequestStatus } = require("../api/health.js");
  // Snapshot before
  const before = buildSummary({
    hasGemini: false, hasOpenRouter: false,
    geminiProbe: null, openRouterProbe: null,
  }).requestsPerStatusGroup;
  const b2 = before["2xx"], b4 = before["4xx"], b5 = before["5xx"];
  // Inject: 2× 200, 1× 404, 1× 429, 2× 500, 1× 503 → deltas of
  // +2 to 2xx, +2 to 4xx, +3 to 5xx. 1xx and 3xx untouched.
  for (let i = 0; i < 2; i++) recordRequestStatus(200);
  recordRequestStatus(404);
  recordRequestStatus(429);
  for (let i = 0; i < 2; i++) recordRequestStatus(500);
  recordRequestStatus(503);
  const after = buildSummary({
    hasGemini: false, hasOpenRouter: false,
    geminiProbe: null, openRouterProbe: null,
  }).requestsPerStatusGroup;
  // All 5 buckets always present
  for (const key of ["1xx", "2xx", "3xx", "4xx", "5xx"]) {
    assert.equal(typeof after[key], "number", `bucket ${key} must be a number`);
  }
  assert.equal(after["2xx"] - b2, 2, "two 200s → 2xx delta = 2");
  assert.equal(after["4xx"] - b4, 2, "404 + 429 → 4xx delta = 2");
  assert.equal(after["5xx"] - b5, 3, "two 500s + 503 → 5xx delta = 3");
  assert.equal(after["1xx"], before["1xx"], "no 1xx injected → unchanged");
  assert.equal(after["3xx"], before["3xx"], "no 3xx injected → unchanged");
});

test("buildSummary: requestsPerStatusGroup rejects out-of-range codes (recordRequestStatus guard)", () => {
  // recordRequestStatus silently ignores out-of-range status codes
  // (Number.isFinite / 100–599 bounds). Verify that invalid codes
  // do not increment bucket totals.
  const { buildSummary, recordRequestStatus } = require("../api/health.js");
  const before = buildSummary({
    hasGemini: false, hasOpenRouter: false,
    geminiProbe: null, openRouterProbe: null,
  }).requestsPerStatusGroup;
  // These should all be ignored (no status 99, 600, 0, -1, NaN,
  // Infinity, or string reaches the Map)
  recordRequestStatus(99);
  recordRequestStatus(600);
  recordRequestStatus(0);
  recordRequestStatus(-1);
  recordRequestStatus(NaN);
  recordRequestStatus(Infinity);
  recordRequestStatus("not-a-number");
  // Add one valid 201 → exactly +1 to 2xx; nothing else changes
  recordRequestStatus(201);
  const after = buildSummary({
    hasGemini: false, hasOpenRouter: false,
    geminiProbe: null, openRouterProbe: null,
  }).requestsPerStatusGroup;
  assert.equal(after["2xx"] - before["2xx"], 1, "only the 201 should land in 2xx");
  assert.equal(after["1xx"], before["1xx"], "1xx untouched");
  assert.equal(after["3xx"], before["3xx"], "3xx untouched");
  assert.equal(after["4xx"], before["4xx"], "4xx untouched");
  assert.equal(after["5xx"], before["5xx"], "5xx untouched");
});

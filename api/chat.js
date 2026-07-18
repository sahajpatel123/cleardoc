/* api/chat.js — per-analysis chat endpoint with provider-fallback chain.
 *
 * Mirrors the /api/analyze provider chain so chat isn't a single point of
 * failure if one provider is rate-limited or down. The chain is:
 *
 *   1. Gemini  (primary — configured via GEMINI_API_KEY / GOOGLE_GEMINI_API_KEY)
 *   2. OpenRouter (fallback — configured via OPENROUTER_API_KEY)
 *
 * Either can be absent; the chain degrades gracefully. If both are absent
 * we surface a clear 503 ("No AI provider is configured.") up front rather
 * than burning a request slot on a guaranteed 502.
 *
 * Strict fail-closed validation (RULES.md #3) applies identically to either
 * provider: malformed AI responses are rejected as 502 invalid_ai_response.
 *
 * Response shape (parity with /api/analyze):
 *   { answer, citation, model, provider }
 *
 * Run with: node --test test/chat-error.test.js test/chat-schema.test.js
 */

const DEFAULT_MODEL = "gemini-2.5-flash";
const OPENROUTER_CHAT_MODEL_DEFAULT = "google/gemma-4-31b-it:free";
const MAX_DOCUMENT_CHARS = 30000;
const MAX_REWRITE_CHARS = 6000;
const MAX_QUESTION_CHARS = 1000;
const MAX_REQUEST_BYTES = 128 * 1024;       // 128KB hard cap on raw body
const MIN_QUESTION_CHARS = 3;
const MIN_DOCUMENT_CHARS = 10;
const MAX_HISTORY_TURNS = 10;               // max prior Q&A pairs in chat context
const MAX_HISTORY_FIELD_CHARS = 500;        // per-field cap inside each turn
const RATE_LIMIT_PER_MINUTE = 30;           // per-IP cap (chat is cheaper)
const REQUEST_TIMEOUT_MS = 25000;           // per-provider budget — keeps total < 60s Vercel ceiling

const { json, asString, getIp, rateLimit, applyRateLimitHeaders, applyAiResponseHeaders, attachRequestId, errLog, accessLog, readCappedBody, safeParseChatResult, logProviderError } = require("./_safety.js");

/* ── prompt ──────────────────────────────────────────────── */

function buildPrompt({ question, document, rewrite, risks, fileName, history }) {
  const riskLines = Array.isArray(risks)
    ? risks
        .slice(0, 12)
        .map((risk, i) => {
          const label = asString(risk?.label, 40) || "Flag";
          const reason = asString(risk?.reason, 240);
          const sentence = asString(risk?.sentence, 600);
          return `${i + 1}. ${label}: ${reason}\n   Source: ${sentence}`;
        })
        .join("\n")
    : "";

  // Prior conversation turns (multi-turn Ask thread). Each turn is
  // { q: string, a: string }. Validate shape and cap length so a
  // malicious client can't pad the prompt with megabytes of garbage.
  const safeHistory = Array.isArray(history)
    ? history.slice(0, MAX_HISTORY_TURNS).map((t) => ({
        q: typeof t?.q === "string" ? t.q.slice(0, MAX_HISTORY_FIELD_CHARS) : "",
        a: typeof t?.a === "string" ? t.a.slice(0, MAX_HISTORY_FIELD_CHARS) : "",
      })).filter((t) => t.q || t.a)
    : [];
  const historyBlock = safeHistory.length
    ? safeHistory.map((t, i) => `${i + 1}. Q: ${t.q}\n   A: ${t.a}`).join("\n")
    : "";

  return [
    "You are ClearDoc's document chat assistant.",
    "Answer the user's specific question first. Do not repeat the plain-English rewrite as the whole answer.",
    "Use only the document text, rewrite, and risk notes below. If the document does not answer the question, say what is missing.",
    "Be practical and direct. Mention next action when useful. Do not claim to be a lawyer.",
    "Return concise natural language, not JSON or markdown tables.",
    "",
    fileName ? `Attached file name: ${fileName}` : "",
    "DOCUMENT TEXT:",
    document,
    "",
    "PLAIN-ENGLISH REWRITE:",
    rewrite,
    "",
    "RISK NOTES:",
    riskLines || "No risk notes.",
    historyBlock ? ["PRIOR CONVERSATION:", historyBlock, ""].join("\n") : "",
    "USER QUESTION:",
    question,
  ]
    .filter(Boolean)
    .join("\n");
}

/* ── Gemini path (primary) ────────────────────────────────── */

function extractGeminiText(data) {
  const candidate = data?.candidates?.[0];
  const parts = candidate?.content?.parts;
  if (!Array.isArray(parts)) return "";
  return parts.map((part) => (typeof part.text === "string" ? part.text : "")).join("").trim();
}

async function callGeminiChat(prompt, reqId) {
  const apiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_GEMINI_API_KEY;
  if (!apiKey) return null;

  const model = (process.env.GEMINI_CHAT_MODEL || DEFAULT_MODEL).trim();
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const res = await fetch(url, {
      method: "POST",
      signal: controller.signal,
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": apiKey,
      },
      body: JSON.stringify({
        contents: [
          {
            role: "user",
            parts: [{ text: prompt }],
          },
        ],
        generationConfig: {
          temperature: 0.2,
          maxOutputTokens: 700,
        },
      }),
    });

    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      logProviderError(reqId, "chat-gemini", `HTTP ${res.status}: ${data?.error?.message || "(no error message)"}`);
      return null;
    }

    const text = extractGeminiText(data);
    if (!text) {
      logProviderError(reqId, "chat-gemini", "returned empty content");
      return null;
    }

    return { answer: text, model };
  } catch (err) {
    const timedOut = err && err.name === "AbortError";
    logProviderError(reqId, "chat-gemini", timedOut ? "timeout" : ((err && err.message) || String(err)));
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/* ── OpenRouter path (fallback) ───────────────────────────── */

async function callOpenRouterChat(prompt, reqId) {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) return null;

  const model = (process.env.OPENROUTER_CHAT_MODEL || OPENROUTER_CHAT_MODEL_DEFAULT).trim();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      signal: controller.signal,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
        "HTTP-Referer": "https://cleardoc.app",
        "X-Title": "ClearDoc Chat",
      },
      body: JSON.stringify({
        model,
        messages: [
          {
            role: "user",
            content: prompt,
          },
        ],
        temperature: 0.2,
        max_tokens: 700,
      }),
    });

    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      logProviderError(reqId, "chat-openrouter", `HTTP ${res.status}: ${data?.error?.message || "(no error message)"}`);
      return null;
    }

    const text = data?.choices?.[0]?.message?.content?.trim();
    if (!text) {
      logProviderError(reqId, "chat-openrouter", "returned empty content");
      return null;
    }

    return { answer: text, model };
  } catch (err) {
    logProviderError(reqId, "chat-openrouter", (err && (err.name || err.message)) || String(err));
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/* ── Fallback orchestrator ────────────────────────────────── */

async function callChatWithFallback(prompt, reqId) {
  // Try the primary provider first, then fall through to the next on any
  // non-result (null = provider missing, errored, timed out, or returned
  // empty content). Either provider can be absent: the chain degrades
  // gracefully to whichever is configured.
  //
  // Per-provider latency is tracked so the X-AI-Gemini-Ms / X-AI-OpenRouter-Ms
  // headers can break down which provider was the bottleneck when a fallback
  // activation happens. Provider call return value is checked; null means
  // "didn't fire or didn't produce a result" — those still count toward the
  // chain's wall-clock latency.
  const geminiStart = Date.now();
  const gemini = await callGeminiChat(prompt, reqId);
  const geminiMs = Date.now() - geminiStart;
  if (gemini) {
    return {
      provider: "gemini",
      answer: gemini.answer,
      model: gemini.model,
      perProviderMs: { gemini: geminiMs, openrouter: 0 },
    };
  }

  const openrouterStart = Date.now();
  const openrouter = await callOpenRouterChat(prompt, reqId);
  const openrouterMs = Date.now() - openrouterStart;
  if (openrouter) {
    return {
      provider: "openrouter",
      answer: openrouter.answer,
      model: openrouter.model,
      perProviderMs: { gemini: 0, openrouter: openrouterMs },
    };
  }

  return {
    provider: "none",
    answer: null,
    model: null,
    perProviderMs: { gemini: geminiMs, openrouter: openrouterMs },
  };
}

/* ── handler ──────────────────────────────────────────────── */

module.exports = async function handler(req, res) {
  attachRequestId(res, req);
  try {
    if (req.method !== "POST") {
      return json(res, 405, { error: "Method not allowed." });
    }

    // Rate limit before doing any work — fail-closed on excess traffic
    const ip = getIp(req);
    const rl = rateLimit(ip, RATE_LIMIT_PER_MINUTE);
    applyRateLimitHeaders(res, rl);
    if (!rl.ok) {
      return json(res, 429, { error: "Too many requests. Try again shortly." });
    }

    // Surface a clear 503 if NEITHER provider is configured — otherwise the
    // user gets a misleading "Chat failed" 502 every time. This is a config
    // problem, not an outage, and the message tells ops exactly what to fix.
    const hasGemini = !!(process.env.GEMINI_API_KEY || process.env.GOOGLE_GEMINI_API_KEY);
    const hasOpenRouter = !!process.env.OPENROUTER_API_KEY;
    if (!hasGemini && !hasOpenRouter) {
      return json(res, 503, { error: "No AI provider is configured." });
    }

    // Read body with a hard byte cap
    const got = await readCappedBody(req, MAX_REQUEST_BYTES);
    if (got.error) return json(res, got.error.status, { error: got.error.message });

    // Content-Type must be application/json — mirrors /api/analyze.
    // Without this we'd 400 with a confusing "Invalid JSON" message
    // for callers that posted form-encoded or plain text by accident.
    const ct = (req && req.headers && (req.headers["content-type"] || req.headers["Content-Type"])) || "";
    if (ct.length > 0 && !/^\s*application\/json\b/i.test(ct)) {
      return json(res, 415, { error: "Content-Type must be application/json." });
    }

    let body;
    if (!got.raw) {
      body = req.body;
    } else {
      try {
        body = JSON.parse(got.raw);
      } catch (_) {
        return json(res, 400, { error: "Invalid JSON." });
      }
    }

    const question = asString(body?.question, MAX_QUESTION_CHARS);
    const document = asString(body?.document, MAX_DOCUMENT_CHARS);
    const rewrite = asString(body?.rewrite, MAX_REWRITE_CHARS);
    const fileName = asString(body?.fileName, 240);

    if (!question || !document) {
      return json(res, 400, { error: "Question and analyzed document are required." });
    }
    if (question.length < MIN_QUESTION_CHARS) {
      return json(res, 400, { error: "Question is too short." });
    }
    if (document.length < MIN_DOCUMENT_CHARS) {
      return json(res, 400, { error: "Document is too short to chat about." });
    }

    const aiStart = Date.now();
    const out = await callChatWithFallback(
      buildPrompt({ question, document, rewrite, risks: body?.risks, fileName, history: body?.history }),
      res.__requestId
    );
    const aiLatencyMs = Date.now() - aiStart;

    if (!out || !out.answer) {
      // Both providers were unreachable, errored, timed out, or returned
      // empty content. Fallback was attempted (OpenRouter fired after
      // Gemini failed) but neither ultimately answered. The orchestrator
      // returns a "none"-shaped envelope with the per-provider latencies
      // captured so the X-AI-<Provider>-Ms breakdown still fires.
      applyAiResponseHeaders(res, "none", aiLatencyMs, undefined, true, (out && out.perProviderMs) || { gemini: 0, openrouter: 0 });
      res.setHeader("Retry-After", "60");
      return json(res, 502, { error: "Chat failed. Both providers were unreachable." });
    }

    // Strict fail-closed schema validation (RULES.md #3). Same principle as
    // /api/analyze: any malformed field (wrong type, missing, overflow) fails
    // the whole response rather than shipping a degraded shape to the user.
    // For /api/chat, the PRIMARY is Gemini — so fallback activated iff
    // out.provider === "openrouter".
    const fallbackUsed = out.provider === "openrouter";
    const providerLabel = out.provider === "openrouter" ? "OpenRouter" : "Gemini";
    const parsed = safeParseChatResult({
      answer: out.answer,
      citation: `${providerLabel} answer · based on analyzed document`,
      model: out.model,
    });
    if (!parsed.ok) {
      applyAiResponseHeaders(res, out.provider, aiLatencyMs, out.model, fallbackUsed, out.perProviderMs);
      errLog(res, "chat", new Error(`invalid AI response from ${out.provider}: ${JSON.stringify(parsed.errors)}`));
      // Schema-invalid responses are transient (next sample usually ok).
      res.setHeader("Retry-After", "60");
      return json(res, 502, {
        error: "Chat returned an invalid response. Please try again.",
        reason: "invalid_ai_response",
      });
    }

    applyAiResponseHeaders(res, out.provider, aiLatencyMs, out.model, fallbackUsed, out.perProviderMs);
    return json(res, 200, Object.assign({}, parsed.value, { provider: out.provider }));
  } catch (err) {
    // Last-resort safety net: never let an uncaught throw leak Vercel's
    // HTML 500 page (which echoes stack frames and module paths). Surface
    // a structured JSON 500 with no internals. If the response has already
    // started streaming, just bail — there's nothing safe left to send.
    if (res && res.headersSent) return;
    errLog(res, "chat", err);
    try {
      return json(res, 500, { error: "An internal error occurred. Please try again." });
    } catch (_) {
      // res.end() threw (broken pipe, etc.) — nothing more we can do.
    }
  } finally {
    accessLog(req, res, res.statusCode);
  }
};

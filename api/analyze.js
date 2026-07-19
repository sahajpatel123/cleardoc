const GEMMA_MODEL = "google/gemma-4-31b-it:free";
const GEMINI_MODEL_DEFAULT = "gemini-2.5-flash";
const MAX_DOCUMENT_CHARS = 40000;
const REQUEST_TIMEOUT_MS = 25000;            // per-provider budget — keeps primary + fallback chain < 60s Vercel ceiling
const MAX_REQUEST_BYTES = 256 * 1024;       // 256KB hard cap on raw body
const MAX_DOCUMENT_MIN_CHARS = 10;          // reject empty / trivial inputs
const RATE_LIMIT_PER_MINUTE = 10;           // per-IP cap (analyze is expensive)

const {
  json,
  asString,
  getIp,
  rateLimit,
  applyRateLimitHeaders,
  applyAiResponseHeaders,
  applyEndpointHeader,
  attachRequestId,
  errLog,
  accessLog,
  readCappedBody,
  safeParseAnalysisResult,
  safeParseCompactAnalysisResult,
  logProviderError,
} = require("./_safety.js");

/* ── prompt ──────────────────────────────────────────────── */

function buildAnalysisPrompt(document) {
  return `You are ClearDoc, a document analysis assistant that helps everyday people understand intimidating legal, medical, and financial documents.

Analyze the following document and return a JSON object with exactly this structure (no markdown, no code fences, just raw JSON):

{
  "plainEnglishRewrite": "The full document rewritten in plain English at an 8th-grade reading level. Preserve the meaning exactly. Use <b> tags to highlight the most important or concerning phrases. Each original paragraph should map to a rewritten paragraph separated by <br><br>.",
  "risks": [
    {
      "severity": "trap",
      "clause": "The exact original text that is risky (verbatim from document, max 200 chars)",
      "explanation": "Why this is risky, in plain English. What it means for the reader practically.",
      "impact": "What could happen if the reader doesn't address this (1-2 sentences)"
    }
  ],
  "verdict": {
    "label": "one of: Likely Fair | Needs Review | Suspicious | Likely Illegal",
    "summary": "1-2 sentence overall assessment of this document"
  },
  "deadlines": [
    {
      "date": "Any deadline found (exact date or 'X days from signing' etc.)",
      "description": "What the deadline is for"
    }
  ],
  "nextSteps": [
    "Specific, actionable step the reader should take (numbered list of 3-6 items)"
  ],
  "readingLevel": {
    "before": 14,
    "after": 7
  },
  "jargonFound": 5
}

RULES for the analysis:
- The plainEnglishRewrite MUST cover the ENTIRE document, not just a summary
- Find ALL risks — be thorough. Classify as "trap" (harmful/you lose rights), "watch" (concerning, needs attention), or "note" (informational, not harmful)
- If there are no risks, return an empty risks array
- deadlines should capture EVERY date, time limit, or expiration mentioned
- nextSteps should be practical actions (e.g., "Contact X by Y date", "Get this in writing", "Consult a lawyer about Z")
- readingLevel should be realistic: "before" = estimated Flesch-Kincaid of original, "after" = estimated of your rewrite
- jargonFound = count of technical/legal/medical terms you replaced
- Never fabricate information not in the document
- Never give legal, medical, or financial advice — explain what the document says, not what to do about it (except in nextSteps which are procedural)
- If the document is very short (< 50 words), still analyze it fully

DOCUMENT TO ANALYZE:
${document}`;
}

/* ── OpenRouter path ─────────────────────────────────────── */

async function callOpenRouter(document, reqId) {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) return null;

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
        "X-Title": "ClearDoc Document Analysis",
      },
      body: JSON.stringify({
        model: GEMMA_MODEL,
        messages: [
          {
            role: "system",
            content:
              "You are a precise document analysis assistant. Always return valid JSON matching the requested schema. Never include markdown code fences.",
          },
          {
            role: "user",
            content: buildAnalysisPrompt(document),
          },
        ],
        temperature: 0.3,
        max_tokens: 4000,
      }),
    });

    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      logProviderError(reqId, "analyze-openrouter", `HTTP ${res.status}: ${data?.error?.message || "(no error message)"}`);
      return null;
    }

    const text = data?.choices?.[0]?.message?.content?.trim();
    if (!text) return null;

    return parseJsonFromText(text);
  } catch (err) {
    logProviderError(reqId, "analyze-openrouter", (err && (err.name || err.message)) || String(err));
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/* ── Gemini path ─────────────────────────────────────────── */

async function callGemini(document, reqId) {
  const apiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_GEMINI_API_KEY;
  if (!apiKey) return null;

  const model = (process.env.GEMINI_CHAT_MODEL || GEMINI_MODEL_DEFAULT).trim();
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
            parts: [{ text: buildAnalysisPrompt(document) }],
          },
        ],
        systemInstruction: {
          parts: [
            {
              text: "You are a precise document analysis assistant. Always return valid JSON matching the requested schema. Never include markdown code fences.",
            },
          ],
        },
        generationConfig: {
          temperature: 0.3,
          maxOutputTokens: 4000,
          responseMimeType: "application/json",
        },
      }),
    });

    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      logProviderError(reqId, "analyze-gemini", `HTTP ${res.status}: ${data?.error?.message || "(no error message)"}`);
      return null;
    }

    const candidate = data?.candidates?.[0];
    const parts = candidate?.content?.parts;
    if (!Array.isArray(parts)) return null;

    const text = parts.map((p) => (typeof p.text === "string" ? p.text : "")).join("").trim();
    if (!text) return null;

    return parseJsonFromText(text);
  } catch (err) {
    logProviderError(reqId, "analyze-gemini", (err && (err.name || err.message)) || String(err));
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/* Compact-mode (verdict-only) variants: shorter prompts, much cheaper
 * per request. Same provider-fallback logic as the full-mode helpers
 * — just call the right one based on reqId-from-thread. Adds the
 * `compact: true` flag to the request so the AI returns the slim
 * schema (verdict + risks; no rewrite/deadlines/nextSteps).
 *
 * The contract here is intentionally minimal: the helpers are
 * deliberately separate from the full-mode ones (rather than
 * parameterizing the existing ones) so the prompt engineering stays
 * unambiguous and the schema validation can be tighter per mode.
 */

function buildCompactPrompt(document) {
  return `You are ClearDoc's document analysis assistant.

Analyze the following document and return a JSON object with exactly this structure (no markdown, no code fences, just raw JSON):

{
  "risks": [
    {
      "severity": "trap",
      "clause": "The exact original text that is risky (verbatim from document, max 200 chars)",
      "explanation": "Why this is risky, in plain English."
    }
  ],
  "verdict": {
    "label": "one of: Likely Fair | Needs Review | Suspicious | Likely Illegal",
    "summary": "1-2 sentence overall assessment of this document"
  }
}

RULES for the analysis:
- Find ALL risks — be thorough. Classify as "trap" (harmful/you lose rights), "watch" (concerning, needs attention), or "note" (informational, not harmful)
- If there are no risks, return an empty risks array
- Be concise. No plain-English rewrite, no deadlines, no next steps.
- Never give legal, medical, or financial advice.
- Even if the document is very short (< 50 words), analyze it fully

DOCUMENT TO ANALYZE:
${document}`;
}

async function callOpenRouterCompact(document, reqId) {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) return null;

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
        "X-Title": "ClearDoc Document Analysis (Compact)",
      },
      body: JSON.stringify({
        model: GEMMA_MODEL,
        messages: [
          { role: "system", content: "You are a precise document analysis assistant. Always return valid JSON matching the requested schema. Never include markdown code fences." },
          { role: "user", content: buildCompactPrompt(document) },
        ],
        temperature: 0.3,
        max_tokens: 1500,
      }),
    });

    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      logProviderError(reqId, "analyze-openrouter-compact", `HTTP ${res.status}: ${data?.error?.message || "(no error message)"}`);
      return null;
    }

    const text = data?.choices?.[0]?.message?.content?.trim();
    if (!text) return null;

    return parseJsonFromText(text);
  } catch (err) {
    logProviderError(reqId, "analyze-openrouter-compact", (err && (err.name || err.message)) || String(err));
    return null;
  } finally {
    clearTimeout(timer);
  }
}

async function callGeminiCompact(document, reqId) {
  const apiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_GEMINI_API_KEY;
  if (!apiKey) return null;

  const model = (process.env.GEMINI_CHAT_MODEL || GEMINI_MODEL_DEFAULT).trim();
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
        contents: [{ role: "user", parts: [{ text: buildCompactPrompt(document) }] }],
        systemInstruction: {
          parts: [{ text: "You are a precise document analysis assistant. Always return valid JSON matching the requested schema. Never include markdown code fences." }],
        },
        generationConfig: { temperature: 0.3, maxOutputTokens: 1500, responseMimeType: "application/json" },
      }),
    });

    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      logProviderError(reqId, "analyze-gemini-compact", `HTTP ${res.status}: ${data?.error?.message || "(no error message)"}`);
      return null;
    }

    const candidate = data?.candidates?.[0];
    const parts = candidate?.content?.parts;
    if (!Array.isArray(parts)) return null;

    const text = parts.map((p) => (typeof p.text === "string" ? p.text : "")).join("").trim();
    if (!text) return null;

    return parseJsonFromText(text);
  } catch (err) {
    logProviderError(reqId, "analyze-gemini-compact", (err && (err.name || err.message)) || String(err));
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/* ── JSON extraction ─────────────────────────────────────── */

function parseJsonFromText(text) {
  // Strip markdown code fences if present
  let cleaned = text.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();

  // Try direct parse
  try {
    return JSON.parse(cleaned);
  } catch (_) {}

  // Try to find a JSON object in the text
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start !== -1 && end > start) {
    try {
      return JSON.parse(cleaned.slice(start, end + 1));
    } catch (_) {}
  }

  return null;
}

/* ── handler ─────────────────────────────────────────────── */

module.exports = async function handler(req, res) {
  attachRequestId(res, req);
  applyEndpointHeader(res, "analyze");
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

    // Read body with a hard byte cap (rejects 413 before parsing)
    const got = await readCappedBody(req, MAX_REQUEST_BYTES);
    if (got.error) return json(res, got.error.status, { error: got.error.message });

    // Content-Type must be application/json. Browsers and API clients
    // can post form-encoded, multipart, or even plain text by accident
    // — accept any of those and JSON.parse below would 400 with a
    // confusing "Invalid JSON" message. Fail more precisely with a
    // 415 so callers know to set the right header.
    const ct = (req && req.headers && (req.headers["content-type"] || req.headers["Content-Type"])) || "";
    if (ct.length > 0 && !/^\s*application\/json(?:\s*;|\s*$)/i.test(ct)) {
      return json(res, 415, { error: "Content-Type must be application/json." });
    }

    let body;
    if (!got.raw) {
      body = req.body; // tolerate Vercel-parsed bodies when present
    } else {
      try {
        body = JSON.parse(got.raw);
      } catch (_) {
        return json(res, 400, { error: "Invalid JSON." });
      }
    }

    const document = asString(body?.document, MAX_DOCUMENT_CHARS);
    if (!document) {
      return json(res, 400, { error: "Document text is required." });
    }
    if (document.length < MAX_DOCUMENT_MIN_CHARS) {
      return json(res, 400, { error: "Document is too short to analyze." });
    }

    // Optional `?format=verdict-only` mode: skip the rewrite, deadlines,
    // and nextSteps analysis — return just verdict + risks. Saves AI cost
    // and latency for callers who only need the bottom line (e.g., a
    // dashboard that scans many docs in batch). Extracted from req.url
    // (no body parsing needed) so it's safe to thread into the prompt
    // without touching the JSON-body contract.
    const compactMode = /[?&]format=verdict-only(?:&|$)/i.test(req && req.url ? req.url : "");

    // Try OpenRouter first, then fall back to Gemini. We capture the wall-
    // clock AI latency so the X-AI-Response-Time-Ms header reports the
    // total time spent across the chain (OpenRouter + Gemini if both fire).
    // Per-provider latency is captured separately so X-AI-OpenRouter-Ms /
    // X-AI-Gemini-Ms can break down which provider was the bottleneck when
    // a fallback activation happens.
    const aiStart = Date.now();
    let openrouterMs = 0;
    let geminiMs = 0;
    let result = compactMode
      ? await callOpenRouterCompact(document, res.__requestId)
      : await callOpenRouter(document, res.__requestId);
    let provider = "openrouter";
    let model = GEMMA_MODEL;
    if (result) {
      openrouterMs = Date.now() - aiStart;
    } else {
      const geminiStart = Date.now();
      result = compactMode
        ? await callGeminiCompact(document, res.__requestId)
        : await callGemini(document, res.__requestId);
      geminiMs = Date.now() - geminiStart;
      provider = "gemini";
      model = (process.env.GEMINI_CHAT_MODEL || GEMINI_MODEL_DEFAULT).trim();
    }
    const aiLatencyMs = Date.now() - aiStart;
    const perProviderMs = { openrouter: openrouterMs, gemini: geminiMs };

    if (!result) {
      // Both providers in the chain are unreachable / errored / rate-limited.
      // Fallback was attempted (gemini did fire after openrouter failed) but
      // neither provider ultimately answered. Emit Retry-After + the standard
      // header family so monitoring can correlate.
      applyAiResponseHeaders(res, "none", aiLatencyMs, undefined, true, perProviderMs);
      res.setHeader("Retry-After", "60");
      return json(res, 502, {
        error: "AI analysis failed. Please try again.",
        provider: "none",
      });
    }

    // Strict fail-closed schema validation (RULES.md: "Strict zod validation").
    // Partial legal data is more dangerous than no data — if the AI's payload
    // has wrong types, missing fields, or out-of-enum values, reject the whole
    // response rather than shipping a degraded shape to the user. Two modes:
    //   - compact mode → safeParseCompactAnalysisResult (verdict + risks only)
    //   - full mode    → safeParseAnalysisResult (everything)
    const fallbackUsed = provider === "gemini";
    const parsed = compactMode
      ? safeParseCompactAnalysisResult(result)
      : safeParseAnalysisResult(result);
    if (!parsed.ok) {
      applyAiResponseHeaders(res, provider, aiLatencyMs, model, fallbackUsed, perProviderMs);
      errLog(res, "analyze", new Error(`invalid AI response from ${provider}: ${JSON.stringify(parsed.errors)}`));
      // Malformed-shape responses are typically transient (retry lands on a
      // different sample). 60s is a sensible back-off window.
      res.setHeader("Retry-After", "60");
      return json(res, 502, {
        error: "AI returned an invalid response. Please try again.",
        reason: "invalid_ai_response",
        provider,
      });
    }

    applyAiResponseHeaders(res, provider, aiLatencyMs, model, fallbackUsed, perProviderMs);
    if (compactMode) {
      return json(res, 200, {
        analysis: parsed.value,
        provider,
        model,
        format: "verdict-only",
      });
    }
    return json(res, 200, {
      analysis: parsed.value,
      provider,
      model,
    });
  } catch (err) {
    // Last-resort safety net: never let an uncaught throw leak Vercel's
    // HTML 500 page (which echoes stack frames and module paths). Surface
    // a structured JSON 500 with no internals. If the response has already
    // started streaming, just bail — there's nothing safe left to send.
    if (res && res.headersSent) return;
    errLog(res, "analyze", err);
    try {
      return json(res, 500, { error: "An internal error occurred. Please try again." });
    } catch (_) {
      // res.end() threw (broken pipe, etc.) — nothing more we can do.
    }
  } finally {
    accessLog(req, res, res.statusCode);
  }
};

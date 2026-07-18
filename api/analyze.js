const GEMMA_MODEL = "google/gemma-4-31b-it:free";
const GEMINI_MODEL_DEFAULT = "gemini-2.5-flash";
const MAX_DOCUMENT_CHARS = 40000;
const REQUEST_TIMEOUT_MS = 50000;
const MAX_REQUEST_BYTES = 256 * 1024;       // 256KB hard cap on raw body
const MAX_DOCUMENT_MIN_CHARS = 10;          // reject empty / trivial inputs
const RATE_LIMIT_PER_MINUTE = 10;           // per-IP cap (analyze is expensive)

const {
  json,
  asString,
  getIp,
  rateLimit,
  applyRateLimitHeaders,
  readCappedBody,
  safeParseAnalysisResult,
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

async function callOpenRouter(document) {
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
      console.error("[analyze] OpenRouter error:", res.status, data?.error?.message || "");
      return null;
    }

    const text = data?.choices?.[0]?.message?.content?.trim();
    if (!text) return null;

    return parseJsonFromText(text);
  } catch (err) {
    console.error("[analyze] OpenRouter failed:", err?.name || err?.message || err);
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/* ── Gemini path ─────────────────────────────────────────── */

async function callGemini(document) {
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
      console.error("[analyze] Gemini error:", res.status, data?.error?.message || "");
      return null;
    }

    const candidate = data?.candidates?.[0];
    const parts = candidate?.content?.parts;
    if (!Array.isArray(parts)) return null;

    const text = parts.map((p) => (typeof p.text === "string" ? p.text : "")).join("").trim();
    if (!text) return null;

    return parseJsonFromText(text);
  } catch (err) {
    console.error("[analyze] Gemini failed:", err?.name || err?.message || err);
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

  // Try OpenRouter first, then fall back to Gemini
  let result = await callOpenRouter(document);
  let provider = "openrouter";

  if (!result) {
    result = await callGemini(document);
    provider = "gemini";
  }

  if (!result) {
    return json(res, 502, {
      error: "AI analysis failed. Please try again.",
      provider: "none",
    });
  }

  // Strict fail-closed schema validation (RULES.md: "Strict zod validation").
  // Partial legal data is more dangerous than no data — if the AI's payload
  // has wrong types, missing fields, or out-of-enum values, reject the whole
  // response rather than shipping a degraded shape to the user.
  const parsed = safeParseAnalysisResult(result);
  if (!parsed.ok) {
    console.error("[analyze] AI returned an invalid response shape:", {
      provider,
      errors: parsed.errors,
    });
    return json(res, 502, {
      error: "AI returned an invalid response. Please try again.",
      reason: "invalid_ai_response",
      provider,
    });
  }

  return json(res, 200, {
    analysis: parsed.value,
    provider,
    model: provider === "openrouter" ? GEMMA_MODEL : GEMINI_MODEL_DEFAULT,
  });
};

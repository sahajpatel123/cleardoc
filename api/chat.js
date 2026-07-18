const DEFAULT_MODEL = "gemini-2.5-flash";
const MAX_DOCUMENT_CHARS = 30000;
const MAX_REWRITE_CHARS = 6000;
const MAX_QUESTION_CHARS = 1000;
const MAX_REQUEST_BYTES = 128 * 1024;       // 128KB hard cap on raw body
const MIN_QUESTION_CHARS = 3;
const MIN_DOCUMENT_CHARS = 10;
const RATE_LIMIT_PER_MINUTE = 30;           // per-IP cap (chat is cheaper)

const { json, asString, getIp, rateLimit, applyRateLimitHeaders, attachRequestId, errLog, readCappedBody, safeParseChatResult } = require("./_safety.js");

function extractText(data) {
  const candidate = data?.candidates?.[0];
  const parts = candidate?.content?.parts;
  if (!Array.isArray(parts)) return "";
  return parts.map((part) => (typeof part.text === "string" ? part.text : "")).join("").trim();
}

function buildPrompt({ question, document, rewrite, risks, fileName }) {
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
    "",
    "USER QUESTION:",
    question,
  ]
    .filter(Boolean)
    .join("\n");
}

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

    const apiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_GEMINI_API_KEY;
    if (!apiKey) {
      return json(res, 503, { error: "Gemini is not configured." });
    }

    // Read body with a hard byte cap
    const got = await readCappedBody(req, MAX_REQUEST_BYTES);
    if (got.error) return json(res, got.error.status, { error: got.error.message });

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

    const model = (process.env.GEMINI_CHAT_MODEL || DEFAULT_MODEL).trim();
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 25000);

    try {
      const geminiRes = await fetch(url, {
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
              parts: [{ text: buildPrompt({ question, document, rewrite, risks: body?.risks, fileName }) }],
            },
          ],
          generationConfig: {
            temperature: 0.2,
            maxOutputTokens: 700,
          },
        }),
      });

      const data = await geminiRes.json().catch(() => ({}));
      if (!geminiRes.ok) {
        return json(res, 502, { error: "Gemini response failed." });
      }

      const answer = extractText(data);
      if (!answer) {
        return json(res, 502, { error: "Gemini returned an empty answer." });
      }

      // Strict fail-closed schema validation (RULES.md #3). Same principle as
      // /api/analyze: any malformed field (wrong type, missing, overflow) fails
      // the whole response rather than shipping a degraded shape to the user.
      const parsed = safeParseChatResult({
        answer,
        citation: "Gemini answer · based on analyzed document",
        model,
      });
      if (!parsed.ok) {
        errLog(res, "chat", new Error(`invalid AI response: ${JSON.stringify(parsed.errors)}`));
        return json(res, 502, {
          error: "Chat returned an invalid response. Please try again.",
          reason: "invalid_ai_response",
        });
      }

      return json(res, 200, parsed.value);
    } catch (err) {
      const timedOut = err && err.name === "AbortError";
      return json(res, timedOut ? 504 : 502, {
        error: timedOut ? "Gemini timed out." : "Chat failed.",
      });
    } finally {
      clearTimeout(timer);
    }
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
  }
};

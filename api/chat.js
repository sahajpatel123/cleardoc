const DEFAULT_MODEL = "gemini-2.5-flash";
const MAX_DOCUMENT_CHARS = 30000;
const MAX_REWRITE_CHARS = 6000;
const MAX_QUESTION_CHARS = 1000;

function json(res, status, body) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json");
  res.setHeader("Cache-Control", "no-store");
  res.end(JSON.stringify(body));
}

function asString(value, max) {
  return typeof value === "string" ? value.slice(0, max).trim() : "";
}

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
  if (req.method !== "POST") {
    return json(res, 405, { error: "Method not allowed." });
  }

  const apiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_GEMINI_API_KEY;
  if (!apiKey) {
    return json(res, 503, { error: "Gemini is not configured." });
  }

  let body = req.body;
  if (typeof body === "string") {
    try {
      body = JSON.parse(body);
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

  const model = (process.env.GEMINI_CHAT_MODEL || DEFAULT_MODEL).trim();
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 25000);

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

    return json(res, 200, {
      answer,
      citation: "Gemini answer · based on analyzed document",
      model,
    });
  } catch (err) {
    const timedOut = err && err.name === "AbortError";
    return json(res, timedOut ? 504 : 500, {
      error: timedOut ? "Gemini timed out." : "Chat failed.",
    });
  } finally {
    clearTimeout(timeout);
  }
};

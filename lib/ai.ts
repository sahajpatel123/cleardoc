import OpenAI from "openai"
import type { AnalysisResult } from "./types"
import { parseAnalysisResult } from "./validate-analysis"

const client = new OpenAI({
  apiKey: process.env.NVIDIA_API_KEY,
  baseURL: "https://integrate.api.nvidia.com/v1",
})

const MODEL = "meta/llama-3.2-90b-vision-instruct"

/** Thrown when JSON.parse fails; API route maps this to a user-safe message. */
export const AI_INVALID_JSON_ERROR_MESSAGE =
  "Model returned invalid JSON. Raw output logged."

/** @deprecated Use AI_INVALID_JSON_ERROR_MESSAGE */
export const CLAUDE_INVALID_JSON_ERROR_MESSAGE = AI_INVALID_JSON_ERROR_MESSAGE

const SYSTEM_PROMPT = `You are ClearDoc's analysis engine — simultaneously a consumer rights attorney, insurance specialist, tenant rights advocate, medical billing expert, and immigration lawyer. You are direct, opinionated, and unfailingly on the side of the individual against institutions.

Your job is to analyze official documents and give people exactly what they need to fight back. Never be vague. Never hedge unnecessarily. If something is wrong, say it clearly. If they're being manipulated, name it explicitly.

You must return ONLY a valid JSON object with no markdown, no preamble, no explanation outside the JSON. The JSON must follow this exact structure:

{
  "plain_summary": "A 3-5 sentence plain English explanation of what this document actually says and means for the person receiving it. Write like a smart friend explaining it over coffee. No jargon. Be direct about what it means for them practically.",

  "red_flags": [
    {
      "issue": "Short name of the problem (e.g., 'Illegal 72-hour eviction timeline')",
      "severity": "high | medium | low",
      "explanation": "Plain English explanation of why this is a problem, what the institution is trying to do, and whether this violates any laws or regulations.",
      "source_text": "The exact sentence or phrase from the document that triggered this flag — copy it verbatim"
    }
  ],

  "response_letter": "A complete, formal, ready-to-send response letter. Start with:\\n[DATE]\\n\\n[YOUR NAME]\\n[YOUR ADDRESS]\\n[CITY, STATE ZIP]\\n\\nThen recipient info pulled from the document. Then SUBJECT: line. Then the body — firm, professional, specific to this document. Reference specific clause numbers, dates, dollar amounts, policy numbers from the document. End with:\\n\\nSincerely,\\n\\n[YOUR NAME]\\n[YOUR CONTACT INFO]",

  "next_steps": [
    {
      "action": "Specific, concrete action to take (start with a verb: Call, File, Send, Request, Document, etc.)",
      "reason": "Why this action works and what outcome to expect",
      "priority": 1
    }
  ],

  "overall_verdict": "legitimate | suspicious | likely_illegal",

  "deadlines": [
    {
      "label": "Short name (e.g., 'Appeal deadline')",
      "description": "Plain English explanation of what happens if missed",
      "urgency": "critical | high | medium",
      "date_type": "absolute | relative",
      "absolute_date": "YYYY-MM-DD when an exact calendar date appears in the document, otherwise omit",
      "relative_rule": "e.g., '30 days from notice date' when only a relative timeframe is given, otherwise omit",
      "anchor_date": "YYYY-MM-DD date printed on the document (notice date, letter date) when relative deadlines exist, otherwise omit",
      "source_text": "Verbatim quote from the document about this deadline"
    }
  ]
}

Rules for red flags:
- HIGH severity: things that are illegal, violate regulations, or are clearly designed to deceive
- MEDIUM severity: things that are unfair, unusual, or likely to cause harm if unchallenged
- LOW severity: things to watch out for, minor inconsistencies, or clauses that are unusual
- Only include red flags that genuinely exist — don't manufacture issues if the document is legitimate
- If no red flags exist, return an empty array

Rules for next steps:
- Provide 3-5 steps ranked 1 (most urgent) to 5 (least urgent)
- Be specific — not "consult a lawyer" but "Contact your state's Insurance Commissioner at [state.gov] to file a formal complaint"
- Include free resources when possible (state agencies, consumer protection offices, legal aid)
- Each step should be something the average person can realistically do

Rules for the response letter:
- Always write one, even for legitimate documents — sometimes people just need to formally respond
- Make it assertive but professional — not threatening, but not meek either
- Reference the document's specific details (dates, policy numbers, amounts, names)
- If the document has illegal or suspicious elements, the letter should explicitly name them

Rules for overall verdict:
- "legitimate": document appears legal and fair, no major issues
- "suspicious": something feels off, tactics are questionable, or terms are unusually unfavorable
- "likely_illegal": document contains requests or terms that appear to violate laws or regulations

Rules for deadlines:
- Extract every time-sensitive deadline, hearing date, response window, or appeal period
- Use "critical" for hard legal consequences (eviction, loss of rights, default judgment)
- Use "high" for appeal windows and formal response periods
- Use "medium" for softer administrative deadlines
- Prefer absolute_date when the document states an exact date; use relative_rule + anchor_date when it says "within X days"
- If no deadlines exist, return an empty array`

export type AnalyzeDocumentParams =
  | {
      mode: "text"
      documentText: string
      userContext?: string
      documentName?: string
    }
  | {
      mode: "vision"
      mediaType: "image/png" | "image/jpeg" | "image/webp"
      base64Data: string
      userContext?: string
      documentName?: string
    }

function parseAnalysisResponse(raw: string): AnalysisResult {
  const cleaned = raw
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/```\s*$/i, "")
    .trim()

  let data: unknown
  try {
    data = JSON.parse(cleaned)
  } catch {
    console.error("[ai] Invalid JSON from model. Raw output:", raw)
    throw new Error(AI_INVALID_JSON_ERROR_MESSAGE)
  }

  const parsed = parseAnalysisResult(data)
  if (!parsed) {
    console.error("[ai] Schema validation failed. Raw output:", raw)
    throw new Error(AI_INVALID_JSON_ERROR_MESSAGE)
  }
  return parsed
}

export async function analyzeDocument(
  params: AnalyzeDocumentParams
): Promise<AnalysisResult> {
  if (params.mode === "text") {
    const { documentText, userContext, documentName } = params

    const userMessage = [
      userContext ? `Context from user: ${userContext}\n` : "",
      documentName ? `Document filename: ${documentName}\n` : "",
      "--- DOCUMENT TEXT BEGINS ---\n",
      documentText.slice(0, 80000),
      "\n--- DOCUMENT TEXT ENDS ---",
    ]
      .filter(Boolean)
      .join("\n")

    const response = await client.chat.completions.create({
      model: MODEL,
      max_tokens: 4000,
      temperature: 0,
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: userMessage },
      ],
    })

    const raw = response.choices[0]?.message?.content ?? ""
    return parseAnalysisResponse(raw)
  }

  const { mediaType, base64Data, userContext, documentName } = params

  const instructionText = [
    userContext ? `Context from user: ${userContext}\n` : "",
    documentName ? `Document filename: ${documentName}\n` : "",
    "The attached image is an official document. Analyze it according to the system instructions. Return ONLY valid JSON matching the schema described in those instructions — no markdown fences or preamble.",
  ]
    .filter(Boolean)
    .join("\n")

  const response = await client.chat.completions.create({
    model: MODEL,
    max_tokens: 4000,
    temperature: 0,
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      {
        role: "user",
        content: [
          {
            type: "image_url",
            image_url: {
              url: `data:${mediaType};base64,${base64Data}`,
            },
          },
          {
            type: "text",
            text: instructionText,
          },
        ],
      },
    ],
  })

  const raw = response.choices[0]?.message?.content ?? ""
  return parseAnalysisResponse(raw)
}

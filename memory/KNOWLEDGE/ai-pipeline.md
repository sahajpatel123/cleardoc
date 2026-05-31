# AI Pipeline

> Last verified: 2026-05-31 against `lib/ai.ts` + `lib/ai-model.ts`. Trust code over this note.

## Model

- **`nvidia/nemotron-3-nano-omni-30b-a3b-reasoning`** via NVIDIA NIM (`baseURL: https://integrate.api.nvidia.com/v1`), called with the `openai` SDK.
- Multimodal (text + images), MoE (30B total / 3B active). Chosen for speed + document intelligence over the shared 90B vision pool (commit `533aa4a`).
- **Chain-of-thought disabled** via NIM `extra_body: { chat_template_kwargs: { enable_thinking: false } }` — faster, cleaner structured JSON. Passed through `nimCompletionParams()` because the OpenAI SDK types omit `extra_body`.
- Auth: `NVIDIA_API_KEY` env var.

## Call parameters

| Param | Value |
|-------|-------|
| `temperature` | `0` (deterministic) |
| `max_tokens` | `4000` |
| Retries | `3`, exponential backoff (`2^attempt * 1000ms`) |
| Doc truncation | `documentText.slice(0, 80000)` chars |

Two modes (`AnalyzeDocumentParams`):
- **text** — `documentText` (from `pdf2json`) + optional `userContext` + `documentName`.
- **vision** — base64 image (`image/png|jpeg|webp`) sent as `image_url` data URL + instruction text.

## Output contract (the system prompt)

The model is instructed to act as a multi-domain consumer advocate and return **ONLY** a JSON object (no markdown, no preamble) with this shape:

```jsonc
{
  "plain_summary": "3–5 sentence plain-English explanation",
  "red_flags": [{ "issue", "severity": "high|medium|low", "explanation", "source_text" }],
  "response_letter": "complete ready-to-send formal letter with [PLACEHOLDERS]",
  "next_steps": [{ "action", "reason", "priority": 1 }],          // 3–5, ranked 1..5
  "overall_verdict": "legitimate | suspicious | likely_illegal",
  "deadlines": [{
    "label", "description", "urgency": "critical|high|medium",
    "date_type": "absolute|relative",
    "absolute_date?": "YYYY-MM-DD", "relative_rule?": "30 days from notice",
    "anchor_date?": "YYYY-MM-DD", "source_text"
  }]
}
```

Severity / verdict / urgency semantics are spelled out in the prompt (e.g. HIGH = illegal/deceptive; verdict `likely_illegal` = appears to violate law). Empty arrays are allowed when nothing applies. `deadlines` feed `lib/ics.ts` calendar export.

## Parsing & validation (defense in depth)

`parseAnalysisResponse(raw)` in `lib/ai.ts`:
1. Strips ```` ```json ```` / ``` fences and trims.
2. `JSON.parse` — on failure logs raw output and throws `AI_INVALID_JSON_ERROR_MESSAGE` ("Model returned invalid JSON…"), which the API maps to a user-safe message.
3. `parseAnalysisResult(data)` (`lib/validate-analysis.ts`) — runtime schema check; null → throw same error.

⚠️ **Logging note:** parse/validation failures `console.error(... raw)` the full model output, which can contain sensitive document content. Gate/scrub in production — see [[KNOWLEDGE/security]] and [[TODO]].

## Reuse

The same model/client is reused for `/api/chat` (per-analysis Q&A) and `/api/rephrase-letter` (tone adjustment). Keep config centralized in `lib/ai-model.ts`.

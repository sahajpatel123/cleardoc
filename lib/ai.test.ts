/**
 * Tests for the vision fallback chain in lib/ai.ts.
 *
 * Mocking strategy:
 *
 * 1. Set process.env.AI_VISION_FALLBACK_MODELS at the TOP of the file
 *    (before any import of ai-model.ts / ai.ts) so the IIFE in
 *    ai-model.ts picks up the fallback list when the module is first
 *    loaded. The import of `ai` itself happens lazily via require()
 *    after the env is set, so the module evaluation sees the env.
 *
 * 2. The OpenAI client is mocked by replacing the singleton inside
 *    `lib/ai-client.ts` via its test-only export
 *    `_setAiClientForTesting`. Because the OpenAI client is module-
 *    scoped, we MUST swap the singleton on the SAME module instance
 *    that `lib/ai.ts` imports. `Module._cache` lets us look up that
 *    instance by its resolved file path.
 *
 * 3. The fake client implements the minimum surface used by
 *    `runVisionCall` / `analyzeDocument` — just `chat.completions.create`.
 */
import { describe, it, before, after, afterEach } from "node:test"
import assert from "node:assert/strict"

// Set the env BEFORE any module that reads it loads. Top-level
// assignment in a CommonJS module runs at module-load time, before any
// requires below.
process.env.NVIDIA_API_KEY = process.env.NVIDIA_API_KEY ?? "test-key-do-not-use-in-prod"
process.env.AI_VISION_FALLBACK_MODELS = "fallback-a,fallback-b"


// ── Fake OpenAI client ──────────────────────────────────────────────

type ScriptedCompletion = {
  content: string
  prompt_tokens?: number
  completion_tokens?: number
  status?: number
  errorMessage?: string
}

let script: ScriptedCompletion[] = []
let callIndex = 0

function makeFakeClient() {
  return {
    chat: {
      completions: {
        create: async () => {
          const next = script[callIndex++]
          if (!next) {
            throw new Error(`fakeClient: no more scripted completions (call ${callIndex})`)
          }
          if (next.status && next.status >= 400) {
            // Simulate an HTTP error from the SDK. The OpenAI SDK throws
            // APIError on non-2xx; we mimic that with a plain Error that
            // matches the shape enough for runVisionCall / withCircuit.
            const err = new Error(next.errorMessage ?? `HTTP ${next.status}`) as Error & {
              status?: number
            }
            err.status = next.status
            throw err
          }
          return {
            choices: [{ message: { content: next.content } }],
            usage: {
              prompt_tokens: next.prompt_tokens ?? 100,
              completion_tokens: next.completion_tokens ?? 50,
              total_tokens: (next.prompt_tokens ?? 100) + (next.completion_tokens ?? 50),
            },
          }
        },
      },
    },
  }
}

const aiClientModule = require("./ai-client")
const __forTesting = aiClientModule.__forTesting
// Now require ai.ts AFTER the mock
const aiModule = require("./ai") as typeof import("./ai")
const analyzeDocument = aiModule.analyzeDocument

const validAnalysisJson = JSON.stringify({
  plain_summary: "x",
  red_flags: [],
  response_letter: "x",
  next_steps: [],
  overall_verdict: "legitimate",
  deadlines: [],
})

describe("analyzeDocument vision fallback chain", () => {
  let restoreClient: (() => void) | undefined

  before(() => {
    restoreClient = __forTesting!.setAiClientForTesting(makeFakeClient() as any)
  })

  afterEach(() => {
    script = []
    callIndex = 0
  })

  after(() => {
    restoreClient?.()
    delete process.env.AI_VISION_FALLBACK_MODELS
  })

  it("returns analysis when the primary model succeeds", async () => {
    script = [{ content: validAnalysisJson }]
    const result = await analyzeDocument({
      mode: "vision",
      mediaType: "image/png",
      base64Data: "aGVsbG8=",
      documentName: "test.png",
    })
    assert.equal(result.overall_verdict, "legitimate")
    assert.equal(callIndex, 1, "primary model should be called exactly once")
  })

  it("falls back to the first fallback when primary returns empty content", async () => {
    script = [
      { content: "" }, // primary empty -> 200 + empty content
      { content: validAnalysisJson.replace('"legitimate"', '"suspicious"') }, // fallback-a succeeds
    ]
    const result = await analyzeDocument({
      mode: "vision",
      mediaType: "image/jpeg",
      base64Data: "aGVsbG8=",
      documentName: "test.jpg",
    })
    assert.equal(result.overall_verdict, "suspicious")
    assert.equal(callIndex, 2, "primary then fallback-a should be called")
  })

  it("skips empty fallbacks and uses the first non-empty one", async () => {
    script = [
      { content: "" }, // primary empty
      { content: "" }, // fallback-a empty
      { content: validAnalysisJson.replace('"legitimate"', '"likely_illegal"') }, // fallback-b succeeds
    ]
    const result = await analyzeDocument({
      mode: "vision",
      mediaType: "image/png",
      base64Data: "aGVsbG8=",
      documentName: "test.png",
    })
    assert.equal(result.overall_verdict, "likely_illegal")
    assert.equal(callIndex, 3, "all three models should be tried in order")
  })

  it("throws AI_INVALID_JSON_ERROR_MESSAGE when every model returns empty", async () => {
    script = [{ content: "" }, { content: "" }, { content: "" }]
    await assert.rejects(
      analyzeDocument({
        mode: "vision",
        mediaType: "image/jpeg",
        base64Data: "aGVsbG8=",
        documentName: "test.jpg",
      }),
      /Model returned invalid JSON/,
    )
    assert.equal(callIndex, 3, "all three models should be tried before giving up")
  })

  it("a transport error on a fallback does not poison the chain", async () => {
    script = [
      { content: "" }, // primary empty
      { content: "", status: 503, errorMessage: "upstream 503" }, // fallback-a transport error
      { content: validAnalysisJson.replace('"legitimate"', '"suspicious"') }, // fallback-b succeeds
    ]
    const result = await analyzeDocument({
      mode: "vision",
      mediaType: "image/webp",
      base64Data: "aGVsbG8=",
      documentName: "test.webp",
    })
    assert.equal(result.overall_verdict, "suspicious")
    assert.equal(callIndex, 3, "primary then both fallbacks should be tried")
  })
})

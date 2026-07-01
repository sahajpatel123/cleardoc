# Vision Empty Completion Diagnosis (2026-06-02)

## Symptom (production log, 2026-06-02 05:00-05:01 UTC)

`POST /api/analyze` failing in the **vision path only** with:

- `"stage":"Model returned empty response (vision).","rawLength":0`
- Followed by `"label":"document analysis","attempts":2` (one retry, same failure)
- `phase:"ai"`, `status:500`
- ~23 seconds elapsed end-to-end
- User is `cmpw2xd8u0000la04ecw95rwz` (free tier)

Text/PDF path is unaffected (separate code path). Auth and DB are fine — quota was reserved successfully, failure is purely on the AI call.

## Three candidate causes (user-proposed)

1. **A — Trial quota/rate limit** (user ranked: primary)
2. **B — `enable_thinking: false` + vision + complex JSON = silent refusal** (user ranked: secondary)
3. **C — No image size enforcement** (user ranked: compounding)

## My re-ranking: **C is most likely primary**

### Evidence for C (image size)

- **`rawLength: 0` with `(vision)` suffix** is the textbook signature of an oversized image exhausting the model's per-image token budget. Nemotron-class vision models cap input dimensions; images over the budget are silently dropped, returning 200 with empty `content`.
- **Vision-only failure.** Text path uses the same model and works. The differential is the multimodal input.
- **23-second elapsed** is consistent with the model trying to process an oversized image, failing, and returning empty — not with a quota error (quota errors are typically fast).
- **2/2 attempts failed identically** rules out transient causes.
- **No image resize/normalize step exists** in the codebase before base64-encoding for the vision API. Raw buffer → base64, no dimensions cap.

### Evidence against A (trial quota) as primary

- Quota exhaustion on NVIDIA trial typically returns **faster** empty responses (the model returns empty as soon as the budget check fails) — not 23-second ones.
- Quota errors usually come with HTTP 429 or a structured error field — empty 200 is more often a content-policy or size issue.
- The env-safety warning is a **log warning, not a hard fail** — the model is reachable, the endpoint is alive.

### Evidence against B (thinking disabled)

- Nemotron's `enable_thinking: false` only hides thinking tokens in the **output**. The model still reasons internally during inference.
- A reasoning model that struggles to produce complex JSON typically emits **low-quality or truncated JSON**, not empty content.
- Empty completion is the canonical "I can't process this input" response, not the canonical "I can't think my way out" response.

## Confirmation test (user-proposed, sharpened)

1. Send a **small image** (512×512 PNG, <100 KB) through the same flow. If it succeeds → **C confirmed**.
2. Send a **PDF** through the same flow. If PDFs work and images don't → image-specific issue confirmed (eliminates A as primary).
3. Send the same small image 20 times in 5 minutes. If the 11th–20th start failing → **A confirmed as a separate compounding issue** (both can be true).

**The single most diagnostic test is #1** — a working small image with a failing large image = image budget issue, period.

## Recommended fix (highest-leverage)

Add a server-side image dimension cap in `app/api/analyze/route.ts`:

- Reject images > 2048×2048 with a clear 413 error (better UX than a 500 from the model).
- Resize to 1024×1024 max before base64-encoding (or accept-resize on the client).
- Apply before the model call, after the magic-byte check.

This is a 1-2 file change. The fix is independent of whether A is also active.

## Separate problem: env-safety log noise

`assertProductionEnvSafety` fires on every `/api/analyze` request:

- 1 Sentry exception event (from `captureException`)
- 2 error-level log lines in Vercel

This is burning through the Sentry free tier and cluttering logs. The privacy concern is real but should be a one-time `console.warn` at boot, not a per-request Sentry event.

### Recommended fix

- Demote `assertProductionEnvSafety` from `log.error` to `log.warn` (known configuration, not a new error)
- Gate `captureException` on first-failure-only (pattern already used in `lib/rate-limit.ts:8`) so the boot warning fires once per process lifetime, not once per request
- 10-line change in `lib/env.ts` and `lib/observability.ts`

## Why this matters

The image-size fix is the highest-leverage change in the audit-to-fix pipeline:

- Restores the vision path entirely (currently 100% failing on oversize images).
- Saves Sentry quota immediately.
- Independent of the longer-term NVIDIA enterprise DPA / self-host work tracked as a High-priority TODO.

The Cause-A fix (DPA or self-host) is a longer-term concern. The Cause-C fix unblocks all free-tier users uploading photos today.

## How to apply

When debugging a vision-path 500 with `rawLength: 0`:

1. Check the user-uploaded image's dimensions and file size first.
2. If oversized → resize/reject server-side. This is the fix.
3. Only after the size fix is in place should you investigate trial quota or thinking-mode concerns as separate issues.

When reading the env-safety warnings: they are **known configuration, not new errors**. They are not actionable per-request; treat them as boot-time configuration noise.

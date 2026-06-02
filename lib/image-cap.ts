/**
 * Server-side image dimension cap and resize for the vision path.
 *
 * ## Why this exists
 *
 * The NVIDIA NIM vision endpoint (nvidia/nemotron-3-nano-omni-30b-a3b-reasoning
 * via the OpenAI SDK) returns a 200 with an empty `choices[0].message.content`
 * when the input image exceeds the model's per-image token budget. The
 * symptom in `/api/analyze` is `rawLength: 0` after ~23 seconds.
 *
 * Cause-C diagnosis (2026-06-02): the model silently drops oversized images
 * rather than returning a structured error. The previous code path
 * (`extractDocumentFromBuffer` in `lib/pdf-parser.ts`) sent raw buffer →
 * base64 with no dimension check.
 *
 * ## What this module does
 *
 * For PNG/JPEG/WEBP inputs:
 * 1. Read dimensions with sharp (no decode, just metadata).
 * 2. If either dimension > `MAX_INPUT_DIMENSION` (2048px), reject with a
 *    clear 413-style error so the client can resize and retry.
 * 3. Otherwise, resize to fit within `TARGET_DIMENSION` (1024px) on the
 *    longer edge with `withoutEnlargement: true`. Output format matches
 *    input format (PNG stays PNG, JPEG stays JPEG, WEBP stays WEBP).
 *
 * Re-encoding is lossless for PNG and acceptable for JPEG at quality 90.
 * The output buffer is always smaller than the input (modulo PNG metadata
 * for already-tiny images), keeping token cost low and the model happy.
 *
 * ## What this module does NOT do
 *
 * - Decode-then-re-encode if the input is already within the target size
 *   (sharp's `withoutEnlargement: true` skips the work in that case).
 * - Strip EXIF metadata. We keep it by default because documents may
 *   have relevant orientation tags. A future strict-privacy build can
 *   add `.withMetadata({})` to strip.
 * - Handle non-image inputs. Those are rejected upstream by
 *   `contentMatchesMime` in `lib/pdf-parser.ts`.
 */

import sharp from "sharp"

export const MAX_INPUT_DIMENSION = 2048
export const TARGET_DIMENSION = 1024
const JPEG_QUALITY = 90

/** Permitted input media types — must match the vision branch in pdf-parser.ts. */
export type ImageMediaType = "image/png" | "image/jpeg" | "image/webp"

export type ImageCapResult =
  | {
      ok: true
      buffer: Buffer
      mediaType: ImageMediaType
      /** True if the image was re-encoded; false if it passed through unchanged. */
      wasResized: boolean
      original: { width: number; height: number; bytes: number }
      final: { width: number; height: number; bytes: number }
    }
  | {
      ok: false
      reason: "unsupported_media_type" | "too_large" | "decode_failed"
      message: string
      /** Present when reason is "too_large" so the client can show the limit. */
      maxDimension?: number
      actualDimension?: { width: number; height: number }
    }

/**
 * Validate, dimension-check, and (if needed) resize an image buffer for
 * the vision API. Pure function — no side effects beyond CPU/memory work
 * inside sharp.
 *
 * @param buffer   Raw image bytes (must already have passed magic-byte
 *                 validation in `contentMatchesMime`).
 * @param mediaType One of the three supported image MIME types.
 */
export async function capImageForVision(
  buffer: Buffer,
  mediaType: ImageMediaType,
): Promise<ImageCapResult> {
  let metadata: sharp.Metadata
  try {
    metadata = await sharp(buffer).metadata()
  } catch {
    return {
      ok: false,
      reason: "decode_failed",
      message:
        "We couldn't read this image. It may be corrupted — try re-exporting it, or describe it in the context field.",
    }
  }

  const width = metadata.width ?? 0
  const height = metadata.height ?? 0
  if (width <= 0 || height <= 0) {
    return {
      ok: false,
      reason: "decode_failed",
      message:
        "We couldn't read this image. It may be corrupted — try re-exporting it, or describe it in the context field.",
    }
  }

  if (width > MAX_INPUT_DIMENSION || height > MAX_INPUT_DIMENSION) {
    return {
      ok: false,
      reason: "too_large",
      message: `Image dimensions ${width}×${height} exceed the maximum of ${MAX_INPUT_DIMENSION}×${MAX_INPUT_DIMENSION}. Please resize the image and try again.`,
      maxDimension: MAX_INPUT_DIMENSION,
      actualDimension: { width, height },
    }
  }

  const needsResize = width > TARGET_DIMENSION || height > TARGET_DIMENSION

  if (!needsResize) {
    return {
      ok: true,
      buffer,
      mediaType,
      wasResized: false,
      original: { width, height, bytes: buffer.byteLength },
      final: { width, height, bytes: buffer.byteLength },
    }
  }

  let pipeline = sharp(buffer).resize({
    width: TARGET_DIMENSION,
    height: TARGET_DIMENSION,
    fit: "inside",
    withoutEnlargement: true,
  })

  if (mediaType === "image/jpeg") {
    pipeline = pipeline.jpeg({ quality: JPEG_QUALITY })
  } else if (mediaType === "image/webp") {
    pipeline = pipeline.webp({ quality: JPEG_QUALITY })
  } else {
    pipeline = pipeline.png({ compressionLevel: 9 })
  }

  const out = await pipeline.toBuffer({ resolveWithObject: true })

  return {
    ok: true,
    buffer: out.data,
    mediaType,
    wasResized: true,
    original: { width, height, bytes: buffer.byteLength },
    final: { width: out.info.width, height: out.info.height, bytes: out.data.byteLength },
  }
}

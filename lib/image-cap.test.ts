import { describe, it } from "node:test"
import assert from "node:assert/strict"
import sharp from "sharp"
import { capImageForVision, MAX_INPUT_DIMENSION, TARGET_DIMENSION } from "./image-cap"

async function makePng(width: number, height: number): Promise<Buffer> {
  return sharp({
    create: {
      width,
      height,
      channels: 3,
      background: { r: 80, g: 120, b: 200 },
    },
  })
    .png()
    .toBuffer()
}

async function makeJpeg(width: number, height: number): Promise<Buffer> {
  return sharp({
    create: {
      width,
      height,
      channels: 3,
      background: { r: 200, g: 60, b: 80 },
    },
  })
    .jpeg({ quality: 90 })
    .toBuffer()
}

describe("capImageForVision", () => {
  it("passes through small images unchanged", async () => {
    const buf = await makePng(800, 600)
    const result = await capImageForVision(buf, "image/png")
    assert.equal(result.ok, true)
    if (!result.ok) return
    assert.equal(result.wasResized, false)
    assert.equal(result.original.width, 800)
    assert.equal(result.original.height, 600)
    assert.equal(result.final.width, 800)
    assert.equal(result.final.height, 600)
    assert.equal(result.buffer, buf) // same Buffer instance — no re-encoding
    assert.equal(result.mediaType, "image/png")
  })

  it("resizes an image whose longer edge exceeds TARGET_DIMENSION", async () => {
    const buf = await makeJpeg(1500, 1000)
    const result = await capImageForVision(buf, "image/jpeg")
    assert.equal(result.ok, true)
    if (!result.ok) return
    assert.equal(result.wasResized, true)
    assert.equal(result.original.width, 1500)
    assert.equal(result.original.height, 1000)
    // Resized so longer edge is TARGET_DIMENSION and aspect ratio is preserved.
    assert.equal(result.final.width, TARGET_DIMENSION)
    assert.equal(Math.round(result.final.height), Math.round((1000 * TARGET_DIMENSION) / 1500))
    assert.equal(result.mediaType, "image/jpeg")
    // Output bytes should be smaller than input (1500×1000 JPEG q90 > 1024×683 JPEG q90).
    assert.ok(result.final.bytes < result.original.bytes, "expected resize to shrink bytes")
    // Sanity check: the resized buffer is a valid JPEG of the expected dimensions.
    const out = await sharp(result.buffer).metadata()
    assert.equal(out.format, "jpeg")
    assert.equal(out.width, result.final.width)
    assert.equal(out.height, result.final.height)
  })

  it("rejects images whose dimensions exceed MAX_INPUT_DIMENSION", async () => {
    // Make an image just above the limit.
    const overWide = await makePng(MAX_INPUT_DIMENSION + 1, 1000)
    const resultWide = await capImageForVision(overWide, "image/png")
    assert.equal(resultWide.ok, false)
    if (resultWide.ok) return
    assert.equal(resultWide.reason, "too_large")
    assert.equal(resultWide.maxDimension, MAX_INPUT_DIMENSION)
    assert.equal(resultWide.actualDimension?.width, MAX_INPUT_DIMENSION + 1)
    assert.equal(resultWide.actualDimension?.height, 1000)
    assert.match(resultWide.message, /exceed the maximum/)

    // Make an image just above the limit on the other axis.
    const overTall = await makePng(1000, MAX_INPUT_DIMENSION + 1)
    const resultTall = await capImageForVision(overTall, "image/png")
    assert.equal(resultTall.ok, false)
    if (resultTall.ok) return
    assert.equal(resultTall.reason, "too_large")
    assert.equal(resultTall.actualDimension?.height, MAX_INPUT_DIMENSION + 1)
  })

  it("accepts an image at exactly the maximum dimension (no resize needed)", async () => {
    const buf = await makePng(MAX_INPUT_DIMENSION, MAX_INPUT_DIMENSION)
    const result = await capImageForVision(buf, "image/png")
    assert.equal(result.ok, true)
    if (!result.ok) return
    assert.equal(result.wasResized, true) // 2048 > 1024 target, so it must resize
    assert.equal(result.original.width, MAX_INPUT_DIMENSION)
    assert.equal(result.final.width, TARGET_DIMENSION)
  })

  it("preserves PNG format on output for PNG input", async () => {
    const buf = await makePng(1500, 1500)
    const result = await capImageForVision(buf, "image/png")
    assert.equal(result.ok, true)
    if (!result.ok) return
    const out = await sharp(result.buffer).metadata()
    assert.equal(out.format, "png")
  })

  it("preserves WEBP format on output for WEBP input", async () => {
    const buf = await sharp({
      create: { width: 1500, height: 1000, channels: 3, background: { r: 100, g: 200, b: 50 } },
    })
      .webp({ quality: 90 })
      .toBuffer()
    const result = await capImageForVision(buf, "image/webp")
    assert.equal(result.ok, true)
    if (!result.ok) return
    assert.equal(result.mediaType, "image/webp")
    const out = await sharp(result.buffer).metadata()
    assert.equal(out.format, "webp")
  })

  it("returns decode_failed for an invalid image buffer", async () => {
    const garbage = Buffer.from("not an image, just some text bytes that look like nothing to a JPEG decoder")
    const result = await capImageForVision(garbage, "image/jpeg")
    assert.equal(result.ok, false)
    if (result.ok) return
    assert.equal(result.reason, "decode_failed")
    assert.match(result.message, /couldn't read this image/)
  })
})

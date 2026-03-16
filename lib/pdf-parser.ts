/**
 * Server-side document text extraction.
 *
 * Uses `pdf-parse` instead of `pdfjs-dist` — pdf-parse is a pure Node.js library
 * with zero browser dependencies (no DOMMatrix, Canvas, etc.) and works correctly
 * in Vercel serverless functions.
 */

export async function extractTextFromBuffer(
  buffer: Buffer,
  mimeType: string
): Promise<string> {
  if (mimeType === "application/pdf") {
    return extractPdfText(buffer)
  }

  if (mimeType.startsWith("image/")) {
    return extractImageText(buffer, mimeType)
  }

  throw new Error(`Unsupported file type: ${mimeType}`)
}

async function extractPdfText(buffer: Buffer): Promise<string> {
  // Dynamic import — pdf-parse has a quirk where it tries to load a test file
  // at module init time; dynamic import avoids that at build time.
  // pdf-parse v2 exports as named or default depending on the bundler
  const mod = await import("pdf-parse")
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const pdfParse: (buf: Buffer, opts?: { max?: number }) => Promise<{ text: string; numpages: number }> = (mod as any).default ?? mod

  const data = await pdfParse(buffer, {
    // Cap pages to avoid token overrun on very large documents
    max: 50,
  })

  const text = data.text?.trim() ?? ""

  if (!text || text.replace(/\s/g, "").length < 50) {
    return `[This appears to be a scanned PDF with no extractable text. The document contains ${data.numpages} page(s). Please describe the document contents in the context field above for accurate analysis.]`
  }

  // pdf-parse returns all text as one block — add page count info for context
  return `[Document: ${data.numpages} page(s)]\n\n${text}`
}

async function extractImageText(
  buffer: Buffer,
  mimeType: string
): Promise<string> {
  const base64 = buffer.toString("base64")
  const dataUrl = `data:${mimeType};base64,${base64}`
  return `[IMAGE_DOCUMENT:${dataUrl}]\n\nNote: This is an image file. Please describe what the document says in the context field for more accurate analysis.`
}

export function getFileMimeType(filename: string): string {
  const ext = filename.split(".").pop()?.toLowerCase()
  const mimeTypes: Record<string, string> = {
    pdf: "application/pdf",
    png: "image/png",
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    webp: "image/webp",
  }
  return mimeTypes[ext ?? ""] ?? "application/octet-stream"
}

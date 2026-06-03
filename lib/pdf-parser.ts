/**
 * Server-side document handling using pdf2json for PDFs.
 *
 * pdf2json uses its own parser engine (@xmldom/xmldom) and has ZERO dependency
 * on pdfjs-dist, DOMMatrix, Canvas, or any other browser API.
 * It works correctly in Vercel serverless functions.
 *
 * Images are returned as vision payloads (base64 + media type) for Claude's
 * native image API — not as placeholder text.
 *
 * DEPENDENCY RISK (DR-3): pdf2json is maintained on a sporadic schedule and
 * depends on @xmldom/xmldom, which has a CVE history. Monitor Dependabot
 * alerts for xmldom updates; a future CVE may require switching to
 * pdfjs-dist or another parser.
 */

export type VisionMediaType = "image/png" | "image/jpeg" | "image/webp"

export type ExtractDocumentResult =
  | { kind: "text"; text: string; isScanned: boolean; truncated: boolean; totalPages: number }
  | {
      kind: "vision"
      mediaType: VisionMediaType
      buffer: Buffer
    }

/** Decode pdf2json's URL-encoded text, tolerating malformed percent-escapes. */
function safeDecode(s: string): string {
  try {
    return decodeURIComponent(s)
  } catch {
    return s
  }
}

/**
 * Verify the uploaded bytes actually match the MIME type derived from the
 * filename extension. getFileMimeType() trusts the extension, so a non-image
 * (or HTML/binary) renamed to .png would otherwise be base64-encoded and sent
 * to the paid vision model, wasting a call on garbage. Magic-byte signatures
 * are stable across all valid files of each type, so this never rejects a
 * legitimate upload.
 */
export function contentMatchesMime(buffer: Buffer, mimeType: string): boolean {
  if (buffer.length < 4) return false
  switch (mimeType) {
    case "application/pdf": // %PDF
      return buffer[0] === 0x25 && buffer[1] === 0x50 && buffer[2] === 0x44 && buffer[3] === 0x46
    case "image/png":
      return buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47
    case "image/jpeg":
      return buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff
    case "image/webp":
      return (
        buffer.length >= 12 &&
        buffer.toString("ascii", 0, 4) === "RIFF" &&
        buffer.toString("ascii", 8, 12) === "WEBP"
      )
    default:
      return false
  }
}

export async function extractDocumentFromBuffer(
  buffer: Buffer,
  mimeType: string
): Promise<ExtractDocumentResult> {
  if (!contentMatchesMime(buffer, mimeType)) {
    throw new Error("File content does not match its extension.")
  }

  if (mimeType === "application/pdf") {
    const { text, isScanned, truncated, totalPages } = await extractPdfText(buffer)
    return { kind: "text", text, isScanned, truncated, totalPages }
  }

  if (mimeType === "image/png" || mimeType === "image/jpeg" || mimeType === "image/webp") {
    return {
      kind: "vision",
      mediaType: mimeType,
      buffer: buffer,
    }
  }

  throw new Error(`Unsupported file type: ${mimeType}`)
}

/** Maximum time to spend parsing a PDF before aborting to prevent slot exhaustion. */
const PDF_PARSE_TIMEOUT_MS = 30_000

async function extractPdfText(buffer: Buffer): Promise<{ text: string; isScanned: boolean; truncated: boolean; totalPages: number }> {
  // Dynamic import keeps pdf2json out of the module graph at build time.
  // pdf2json has no TypeScript types, so we declare a narrow interface for
  // the two methods we actually call (on / parseBuffer).
  interface PdfParser {
    on(event: string, handler: unknown): void
    parseBuffer(buffer: Buffer): void
    removeAllListeners(): void
  }
  let PdfParserCtor: new (...args: unknown[]) => PdfParser
  try {
    const mod = await import("pdf2json")
    PdfParserCtor = (mod.default ?? mod) as new (...args: unknown[]) => PdfParser
  } catch {
    throw new Error("PDF parser (pdf2json) is unavailable in this environment.")
  }

  const parser = new PdfParserCtor(null, true)

  const parsePromise = new Promise<{ text: string; isScanned: boolean; truncated: boolean; totalPages: number }>((resolve, reject) => {
    parser.on("pdfParser_dataReady", (data: PDFData) => {
      const pages: PDFPage[] = data?.Pages ?? []

      if (pages.length === 0) {
        resolve({
          text: "[No text content found. Please describe the document in the context field for accurate analysis.]",
          isScanned: true,
          truncated: false,
          totalPages: 0,
        })
        return
      }

      // Cap at 50 pages to avoid token overrun
      const capped = pages.slice(0, 50)

      const text = capped
        .map((page, i) => {
          const pageText = (page.Texts ?? [])
            .map((t) =>
              (t.R ?? [])
                .map((r) => safeDecode(r.T))
                .join("")
            )
            .join(" ")
          return `[Page ${i + 1}]\n${pageText}`
        })
        .join("\n\n")

      if (!text.trim() || text.replace(/\s/g, "").length < 50) {
        resolve({
          text: `[This appears to be a scanned PDF with no extractable text. The document contains ${pages.length} page(s). Please describe the document contents in the context field above for accurate analysis.]`,
          isScanned: true,
          truncated: pages.length > 50,
          totalPages: pages.length,
        })
        return
      }

      resolve({
        text: `[Document: ${pages.length} page(s)]\n\n${text}`,
        isScanned: false,
        truncated: pages.length > 50,
        totalPages: pages.length,
      })
    })

    parser.on("pdfParser_dataError", (err: Error | { parserError: Error }) => {
      const message = 'parserError' in err ? String(err.parserError) : err.message
      reject(new Error(`PDF parsing failed: ${message ?? "unknown error"}`))
    })

    parser.parseBuffer(buffer)
  })

  // Guard against pathological PDFs (deep XObject trees, circular references)
  // that can make pdf2json spin indefinitely, exhausting the serverless slot.
  const timeoutPromise = new Promise<never>((_, reject) =>
    setTimeout(
      () => reject(new Error(`PDF parsing timed out after ${PDF_PARSE_TIMEOUT_MS}ms`)),
      PDF_PARSE_TIMEOUT_MS,
    )
  )

  try {
    return await Promise.race([parsePromise, timeoutPromise])
  } finally {
    // Cleanup: remove listeners and dereference parser so the background
    // pdf2json work can be GC'd even if the timeout won the race.
    try {
      parser.removeAllListeners()
    } catch {}
  }
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

// ── Minimal types for pdf2json data shape ────────────────────────────────────

interface PDFRun {
  T: string // URL-encoded text
}

interface PDFText {
  R: PDFRun[]
}

interface PDFPage {
  Texts: PDFText[]
}

interface PDFData {
  Pages: PDFPage[]
}

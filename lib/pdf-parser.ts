/**
 * Server-side document handling using pdf2json for PDFs.
 *
 * pdf2json uses its own parser engine (@xmldom/xmldom) and has ZERO dependency
 * on pdfjs-dist, DOMMatrix, Canvas, or any other browser API.
 * It works correctly in Vercel serverless functions.
 *
 * Images are returned as vision payloads (base64 + media type) for Claude's
 * native image API — not as placeholder text.
 */

export type VisionMediaType = "image/png" | "image/jpeg" | "image/webp"

export type ExtractDocumentResult =
  | { kind: "text"; text: string }
  | {
      kind: "vision"
      mediaType: VisionMediaType
      base64Data: string
    }

export async function extractDocumentFromBuffer(
  buffer: Buffer,
  mimeType: string
): Promise<ExtractDocumentResult> {
  if (mimeType === "application/pdf") {
    const text = await extractPdfText(buffer)
    return { kind: "text", text }
  }

  if (mimeType === "image/png" || mimeType === "image/jpeg" || mimeType === "image/webp") {
    return {
      kind: "vision",
      mediaType: mimeType,
      base64Data: buffer.toString("base64"),
    }
  }

  throw new Error(`Unsupported file type: ${mimeType}`)
}

async function extractPdfText(buffer: Buffer): Promise<string> {
  // Dynamic import keeps pdf2json out of the module graph at build time
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let PdfParserCtor: any
  try {
    const mod = await import("pdf2json")
    PdfParserCtor = mod.default ?? mod
  } catch {
    throw new Error("PDF parser (pdf2json) is unavailable in this environment.")
  }

  const parser = new PdfParserCtor(null, true)

  return new Promise((resolve, reject) => {
    parser.on("pdfParser_dataReady", (data: PDFData) => {
      const pages: PDFPage[] = data?.Pages ?? []

      if (pages.length === 0) {
        resolve(
          "[No text content found. Please describe the document in the context field for accurate analysis.]"
        )
        return
      }

      // Cap at 50 pages to avoid token overrun
      const capped = pages.slice(0, 50)

      const text = capped
        .map((page, i) => {
          const pageText = (page.Texts ?? [])
            .map((t) =>
              (t.R ?? [])
                .map((r) => decodeURIComponent(r.T))
                .join("")
            )
            .join(" ")
          return `[Page ${i + 1}]\n${pageText}`
        })
        .join("\n\n")

      if (!text.trim() || text.replace(/\s/g, "").length < 50) {
        resolve(
          `[This appears to be a scanned PDF with no extractable text. The document contains ${pages.length} page(s). Please describe the document contents in the context field above for accurate analysis.]`
        )
        return
      }

      resolve(`[Document: ${pages.length} page(s)]\n\n${text}`)
    })

    parser.on("pdfParser_dataError", (err: Error | { parserError: Error }) => {
      const message = 'parserError' in err ? String(err.parserError) : err.message
      reject(new Error(`PDF parsing failed: ${message ?? "unknown error"}`))
    })

    parser.parseBuffer(buffer)
  })
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

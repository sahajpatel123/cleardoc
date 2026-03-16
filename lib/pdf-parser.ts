/**
 * Server-side document text extraction using pdf2json.
 *
 * pdf2json uses its own parser engine (@xmldom/xmldom) and has ZERO dependency
 * on pdfjs-dist, DOMMatrix, Canvas, or any other browser API.
 * It works correctly in Vercel serverless functions.
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
  // Dynamic import keeps pdf2json out of the module graph at build time
  const PDFParserMod = await import("pdf2json")
  const PDFParser = PDFParserMod.default ?? PDFParserMod

  return new Promise((resolve, reject) => {
    // Second arg = 1 enables raw text mode (returns decoded strings directly)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const parser = new (PDFParser as any)(null, 1)

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

    parser.on("pdfParser_dataError", (err: { parserError: unknown }) => {
      reject(new Error(`PDF parsing failed: ${String(err?.parserError ?? "unknown error")}`))
    })

    parser.parseBuffer(buffer)
  })
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

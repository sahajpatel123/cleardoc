/**
 * Worker thread entry point for PDF parsing.
 *
 * Receives a Buffer via parentPort, runs pdf2json's synchronous parseBuffer
 * off the main thread, and posts the parsed result (or error) back.
 *
 * Moving parseBuffer into a worker ensures the event loop stays responsive so
 * that Promise.race timeouts in the caller can actually fire — the main thread
 * is never blocked by CPU-bound PDF work.
 */

import { parentPort, workerData } from "node:worker_threads"

// Minimal type declarations for pdf2json (no @types available)
interface PdfParser {
  on(event: string, handler: unknown): void
  parseBuffer(buffer: Buffer): void
  removeAllListeners(): void
}

interface PDFRun {
  T: string
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

/** Decode pdf2json's URL-encoded text, tolerating malformed percent-escapes. */
function safeDecode(s: string): string {
  try {
    return decodeURIComponent(s)
  } catch {
    return s
  }
}

interface ParseResult {
  text: string
  isScanned: boolean
  truncated: boolean
  totalPages: number
}

async function run(): Promise<void> {
  if (!parentPort) return // Not running in a worker — nothing to do.

  const buffer: Buffer = workerData.buffer

  // Dynamic import keeps pdf2json out of the module graph at build time.
  let PdfParserCtor: new (...args: unknown[]) => PdfParser
  try {
    const mod = await import("pdf2json")
    PdfParserCtor = (mod.default ?? mod) as new (...args: unknown[]) => PdfParser
  } catch (err) {
    parentPort.postMessage({
      ok: false,
      error: "PDF parser (pdf2json) is unavailable in this environment.",
    })
    return
  }

  const parser = new PdfParserCtor(null, true)

  const parsePromise = new Promise<ParseResult>((resolve, reject) => {
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
      const message = "parserError" in err ? String(err.parserError) : err.message
      reject(new Error(`PDF parsing failed: ${message ?? "unknown error"}`))
    })

    parser.parseBuffer(buffer)
  })

  try {
    const result = await parsePromise
    parentPort.postMessage({ ok: true, value: result })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    parentPort.postMessage({ ok: false, error: message })
  } finally {
    try {
      parser.removeAllListeners()
    } catch {}
  }
}

run()
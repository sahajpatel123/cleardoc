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

import { emitMetric, captureException } from "@/lib/observability"

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

/**
 * Parse PDF text inside a worker thread so the event loop is never blocked.
 *
 * pdf2json's parseBuffer is CPU-synchronous — on the main thread it would
 * block the event loop for the entire parse, making Promise.race timeouts
 * useless. By running parseBuffer in a worker_thread the timeout can actually
 * fire, and the worker is forcefully terminated if it exceeds the limit.
 */
async function extractPdfText(buffer: Buffer): Promise<{ text: string; isScanned: boolean; truncated: boolean; totalPages: number }> {
  // Attempt to use a worker thread so the event loop stays responsive.
  // If worker_threads are unavailable (e.g. some Edge/minimal runtimes),
  // fall back to main-thread parsing with a warning.
  let Worker: typeof import("node:worker_threads").Worker | undefined
  try {
    const wt = await import("node:worker_threads")
    Worker = wt.Worker
  } catch {
    // worker_threads not available — fall back to main-thread parsing.
  }

  if (Worker) {
    return extractPdfTextViaWorker(buffer, Worker)
  }

  // Fallback: parse on main thread (timeout will be best-effort for CPU work).
  // This path runs when worker_threads is unavailable (e.g. some Edge/minimal
  // runtimes). Emit a metric and Sentry event so operators can track how often
  // this degraded path is hit — sustained hits indicate an environment problem.
  emitMetric("pdf", "main_thread_fallback", { reason: "worker_threads_unavailable" })
  captureException(new Error("PDF parser fell back to main thread — worker_threads unavailable"), {
    component: "pdf-parser",
    extra: { fallback: true },
  })
  if (typeof console !== "undefined") {
    // eslint-disable-next-line no-console
    console.warn("[pdf-parser] worker_threads unavailable — PDF parsing will block the event loop. Timeouts may not interrupt CPU-bound work.")
  }
  return extractPdfTextMainThread(buffer)
}

/** Worker-thread implementation: parseBuffer runs off the main thread. */
async function extractPdfTextViaWorker(
  buffer: Buffer,
  Worker: typeof import("node:worker_threads").Worker,
): Promise<{ text: string; isScanned: boolean; truncated: boolean; totalPages: number }> {
  const worker = new Worker(new URL("./pdf-parser-worker.ts", import.meta.url), {
    workerData: { buffer },
  })

  const resultPromise = new Promise<{ text: string; isScanned: boolean; truncated: boolean; totalPages: number }>((resolve, reject) => {
    worker.on("message", (msg: { ok: boolean; value?: unknown; error?: string }) => {
      if (msg.ok) {
        resolve(msg.value as { text: string; isScanned: boolean; truncated: boolean; totalPages: number })
      } else {
        reject(new Error(msg.error ?? "Unknown PDF parsing error in worker"))
      }
    })

    worker.on("error", (err: Error) => {
      reject(new Error(`PDF worker error: ${err.message}`))
    })

    worker.on("exit", (code: number) => {
      // If the worker exits without sending a message, reject.
      if (code !== 0) {
        reject(new Error(`PDF worker exited with code ${code}`))
      }
    })
  })

  let timeoutId: ReturnType<typeof setTimeout> | undefined
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(
      () => reject(new Error(`PDF parsing timed out after ${PDF_PARSE_TIMEOUT_MS}ms`)),
      PDF_PARSE_TIMEOUT_MS,
    )
  })

  try {
    return await Promise.race([resultPromise, timeoutPromise])
  } finally {
    if (timeoutId !== undefined) clearTimeout(timeoutId)
    // Terminate the worker regardless of outcome. If the timeout won the
    // race the worker may still be running CPU-synchronous work — terminate()
    // kills the thread immediately.
    try {
      worker.terminate()
    } catch {}
  }
}

/**
 * Main-thread fallback for environments without worker_threads.
 * Identical logic to pdf-parser-worker.ts but runs on the event loop, so
 * the timeout cannot interrupt CPU-synchronous parseBuffer work.
 */
async function extractPdfTextMainThread(buffer: Buffer): Promise<{ text: string; isScanned: boolean; truncated: boolean; totalPages: number }> {
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

  let timeoutId: ReturnType<typeof setTimeout> | undefined
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(
      () => reject(new Error(`PDF parsing timed out after ${PDF_PARSE_TIMEOUT_MS}ms`)),
      PDF_PARSE_TIMEOUT_MS,
    )
  })

  try {
    return await Promise.race([parsePromise, timeoutPromise])
  } finally {
    if (timeoutId !== undefined) clearTimeout(timeoutId)
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

// Server-side PDF text extraction using pdfjs-dist
// Images (PNG/JPG) return a placeholder — users should describe the content via context

export async function extractTextFromBuffer(
  buffer: Buffer,
  mimeType: string
): Promise<string> {
  if (mimeType === "application/pdf") {
    return extractPdfText(buffer)
  }

  // For image files, we can't do OCR server-side without a dedicated service.
  // Return a clear message so Claude knows what happened.
  if (mimeType.startsWith("image/")) {
    return extractImageText(buffer, mimeType)
  }

  throw new Error(`Unsupported file type: ${mimeType}`)
}

async function extractPdfText(buffer: Buffer): Promise<string> {
  // Dynamic import to avoid SSR issues with the canvas dependency
  const pdfjsLib = await import("pdfjs-dist/legacy/build/pdf.mjs")

  // Use the legacy build without a worker for server-side Node.js
  const pdf = await pdfjsLib.getDocument({
    data: new Uint8Array(buffer),
    useWorkerFetch: false,
    isEvalSupported: false,
    useSystemFonts: true,
  }).promise

  const totalPages = pdf.numPages
  const textParts: string[] = []

  // Cap at 50 pages to avoid token overrun
  const pagesToRead = Math.min(totalPages, 50)

  for (let pageNum = 1; pageNum <= pagesToRead; pageNum++) {
    const page = await pdf.getPage(pageNum)
    const content = await page.getTextContent()
    const pageText = content.items
      .map((item) => ("str" in item ? (item.str as string) : ""))
      .join(" ")
    textParts.push(`[Page ${pageNum}]\n${pageText}`)
  }

  const fullText = textParts.join("\n\n")

  if (!fullText.trim() || fullText.replace(/\s/g, "").length < 50) {
    return `[This appears to be a scanned PDF with no extractable text. The document contains ${totalPages} page(s). Please describe the document contents in the context field above for accurate analysis.]`
  }

  return fullText
}

async function extractImageText(
  buffer: Buffer,
  mimeType: string
): Promise<string> {
  // Convert to base64 for potential future vision API integration
  const base64 = buffer.toString("base64")
  const dataUrl = `data:${mimeType};base64,${base64}`

  // For now, return a placeholder with the image data URL embedded
  // In production, you'd call a vision API here
  return `[IMAGE_DOCUMENT:${dataUrl}]\n\nNote: This is an image file. Please describe what the document says in the context field for more accurate analysis. The image has been uploaded for reference.`
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

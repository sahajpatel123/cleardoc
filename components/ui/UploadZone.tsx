"use client"

import { useCallback, useState } from "react"
import { useDropzone } from "react-dropzone"
import { motion, AnimatePresence } from "framer-motion"
import { FileText, X, ImageIcon, Plus } from "lucide-react"

interface Props {
  onFileSelect: (file: File) => void
  file: File | null
  onClear: () => void
  disabled?: boolean
}

const ACCEPTED: Record<string, string[]> = {
  "application/pdf": [".pdf"],
  "image/png": [".png"],
  "image/jpeg": [".jpg", ".jpeg"],
  "image/webp": [".webp"],
}
const MAX_SIZE = 10 * 1024 * 1024
const EASE = [0.16, 1, 0.3, 1] as [number, number, number, number]

export default function UploadZone({ onFileSelect, file, onClear, disabled }: Props) {
  const [error, setError] = useState<string | null>(null)

  const onDrop = useCallback(
    (
      accepted: File[],
      rejected: { errors: readonly { message: string; code: string }[] }[],
    ) => {
      setError(null)
      if (rejected.length > 0) {
        const msg = rejected[0]?.errors[0]?.message
        setError(msg?.includes("size") ? "File too large. Max 10MB." : "Please upload a PDF, PNG, JPG, or WebP.")
        return
      }
      if (accepted[0]) onFileSelect(accepted[0])
    },
    [onFileSelect],
  )

  const { getRootProps, getInputProps, isDragActive, isDragReject } = useDropzone({
    onDrop,
    accept: ACCEPTED,
    maxSize: MAX_SIZE,
    maxFiles: 1,
    disabled: disabled || !!file,
  })

  return (
    <div className="w-full">
      <AnimatePresence mode="wait">
        {file ? (
          <motion.div
            key="file"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.35, ease: EASE }}
            className="flex items-center gap-5 py-5 border-t border-b"
            style={{ borderColor: "var(--hairline-2)" }}
          >
            <span
              className="mono text-[10px] tracking-[0.2em] shrink-0"
              style={{ color: "var(--text-mute)" }}
            >
              FILE
            </span>
            <div className="flex-1 min-w-0 flex items-center gap-3">
              {file.type === "application/pdf" ? (
                <FileText className="w-4 h-4 shrink-0" style={{ color: "var(--ember)" }} />
              ) : (
                <ImageIcon className="w-4 h-4 shrink-0" style={{ color: "var(--ember)" }} />
              )}
              <div className="flex-1 min-w-0">
                <p
                  className="truncate"
                  style={{
                    color: "var(--text)",
                    fontFamily: "var(--font-syne,'Syne',sans-serif)",
                    fontWeight: 500,
                    letterSpacing: "-0.02em",
                  }}
                >
                  {file.name}
                </p>
                <p className="mono text-[10px] mt-0.5" style={{ color: "var(--text-mute)" }}>
                  {(file.size / 1024 / 1024).toFixed(2)} MB · {file.type === "application/pdf" ? "PDF" : "Image"}
                </p>
              </div>
            </div>
            <button
              onClick={(e) => {
                e.stopPropagation()
                onClear()
                setError(null)
              }}
              className="shrink-0 p-2 rounded-full transition-colors"
              style={{ color: "var(--text-3)" }}
              aria-label="Remove"
            >
              <X className="w-4 h-4" />
            </button>
          </motion.div>
        ) : (
          <motion.div
            key="dropzone"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className={`relative transition-all duration-500 cursor-pointer group ${disabled ? "opacity-50 cursor-not-allowed" : ""}`}
          >
            <div
              {...getRootProps()}
              className="relative w-full"
              style={{
                borderTop: "1px solid var(--hairline-2)",
                borderBottom: "1px solid var(--hairline-2)",
              }}
            >
              <input {...getInputProps()} />
              <div className="py-12 sm:py-16 relative">
                {/* The big drag-here line, designed like a magazine pull-quote */}
                <div className="flex items-baseline gap-4 sm:gap-6">
                  <span
                    className="mono text-[10px] tracking-[0.2em] mt-2 shrink-0"
                    style={{ color: "var(--text-mute)" }}
                  >
                    01
                  </span>
                  <motion.div
                    className="flex-1"
                    animate={
                      isDragActive
                        ? { x: 4 }
                        : { x: 0 }
                    }
                    transition={{ duration: 0.3, ease: EASE }}
                  >
                    <p
                      className="display"
                      style={{
                        fontSize: "clamp(1.8rem, 3.5vw, 3rem)",
                        color: isDragReject
                          ? "var(--red)"
                          : isDragActive
                            ? "var(--ember)"
                            : "var(--text)",
                        transition: "color 0.3s",
                      }}
                    >
                      {isDragReject ? (
                        "PDF, PNG, or JPG only."
                      ) : isDragActive ? (
                        "Drop it on the desk."
                      ) : (
                        <>
                          Drop your document here
                          <span style={{ color: "var(--text-mute)" }}>,</span>{" "}
                          <span className="serif-italic" style={{ color: "var(--text-3)" }}>
                            or click to browse.
                          </span>
                        </>
                      )}
                    </p>
                    <div className="mt-6 flex items-center gap-3 flex-wrap mono text-[10px] tracking-[0.16em] uppercase" style={{ color: "var(--text-mute)" }}>
                      <span>PDF</span>
                      <Plus className="w-2.5 h-2.5" />
                      <span>PNG</span>
                      <Plus className="w-2.5 h-2.5" />
                      <span>JPG</span>
                      <span className="w-px h-3 mx-1" style={{ background: "var(--hairline-2)" }} />
                      <span>Max 10MB</span>
                    </div>
                  </motion.div>

                  {/* Plus mark — quiet visual anchor on the right */}
                  <motion.div
                    className="shrink-0 mt-2"
                    animate={
                      isDragActive
                        ? { rotate: 90, scale: 1.1 }
                        : { rotate: 0, scale: 1 }
                    }
                    transition={{ type: "spring", stiffness: 200, damping: 18 }}
                  >
                    <Plus
                      className="w-8 h-8 sm:w-10 sm:h-10"
                      style={{ color: isDragActive ? "var(--ember)" : "var(--text-3)", transition: "color 0.3s" }}
                    />
                  </motion.div>
                </div>

                {/* Subtle bar that slides on drag-over */}
                <motion.div
                  className="absolute left-0 right-0 bottom-[-1px] h-[2px] origin-left"
                  style={{ background: "var(--ember)" }}
                  initial={{ scaleX: 0 }}
                  animate={{ scaleX: isDragActive ? 1 : 0 }}
                  transition={{ duration: 0.6, ease: EASE }}
                />
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {error && (
          <motion.div
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            className="flex items-center gap-2 mt-4 text-xs"
            style={{ color: "var(--red)" }}
          >
            <span className="w-1 h-1 rounded-full" style={{ background: "var(--red)" }} />
            {error}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

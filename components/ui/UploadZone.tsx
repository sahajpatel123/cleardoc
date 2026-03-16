"use client"

import { useCallback, useState } from "react"
import { useDropzone } from "react-dropzone"
import { motion, AnimatePresence } from "framer-motion"
import { Upload, FileText, X, ImageIcon, AlertCircle } from "lucide-react"

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
}
const MAX_SIZE = 10 * 1024 * 1024

export default function UploadZone({ onFileSelect, file, onClear, disabled }: Props) {
  const [error, setError] = useState<string | null>(null)

  const onDrop = useCallback(
    (accepted: File[], rejected: { errors: readonly { message: string; code: string }[] }[]) => {
      setError(null)
      if (rejected.length > 0) {
        const msg = rejected[0]?.errors[0]?.message
        setError(msg?.includes("size") ? "File too large. Max 10MB." : "Please upload a PDF, PNG, or JPG.")
        return
      }
      if (accepted[0]) onFileSelect(accepted[0])
    },
    [onFileSelect]
  )

  const { getRootProps, getInputProps, isDragActive, isDragReject } = useDropzone({
    onDrop, accept: ACCEPTED, maxSize: MAX_SIZE, maxFiles: 1, disabled: disabled || !!file,
  })

  return (
    <div className="w-full">
      <AnimatePresence mode="wait">
        {file ? (
          <motion.div key="file"
            initial={{ opacity: 0, scale: 0.97 }} animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.97 }} transition={{ duration: 0.25 }}
            className="rounded-2xl border flex items-center gap-4 p-5 relative overflow-hidden"
            style={{ background: "#FEF0E6", borderColor: "rgba(232,101,26,0.25)" }}
          >
            <div className="absolute top-0 left-0 right-0 h-0.5"
              style={{ background: "linear-gradient(90deg, transparent, #E8651A50, transparent)" }} />
            <div className="w-11 h-11 rounded-xl flex items-center justify-center shrink-0"
              style={{ background: "white", border: "1px solid rgba(232,101,26,0.2)" }}>
              {file.type === "application/pdf"
                ? <FileText className="w-5 h-5" style={{ color: "#E8651A" }} />
                : <ImageIcon className="w-5 h-5" style={{ color: "#E8651A" }} />}
            </div>
            <div className="flex-1 min-w-0">
              <p className="font-semibold text-sm truncate" style={{ color: "#18130E" }}>{file.name}</p>
              <p className="text-xs mt-0.5" style={{ color: "#A89484" }}>
                {(file.size / 1024 / 1024).toFixed(2)} MB · {file.type === "application/pdf" ? "PDF" : "Image"}
              </p>
            </div>
            <motion.button whileHover={{ scale: 1.1 }} whileTap={{ scale: 0.9 }}
              onClick={e => { e.stopPropagation(); onClear(); setError(null) }}
              className="shrink-0 p-1.5 rounded-lg transition-colors"
              style={{ color: "#A89484" }}>
              <X className="w-4 h-4" />
            </motion.button>
          </motion.div>
        ) : (
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          <motion.div key="dropzone" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            {...(getRootProps() as any)}
            className={`rounded-2xl border-2 border-dashed transition-all duration-300 cursor-pointer group ${disabled ? "opacity-50 cursor-not-allowed" : ""}`}
            style={{
              borderColor: isDragReject ? "#DC2626" : isDragActive ? "#E8651A" : "#E8E2D9",
              background: isDragReject ? "#FEF2F2" : isDragActive ? "#FEF0E6" : "transparent",
            }}
          >
            <input {...getInputProps()} />
            <div className="flex flex-col items-center justify-center py-12 px-6 text-center">
              <motion.div
                animate={isDragActive ? { scale: 1.15, rotate: 5 } : { scale: 1, rotate: 0 }}
                transition={{ type: "spring", stiffness: 300 }}
                className="w-16 h-16 rounded-2xl flex items-center justify-center mb-5 border transition-all duration-300"
                style={{
                  background: isDragActive ? "#FEF0E6" : "#F9F6F1",
                  borderColor: isDragActive ? "rgba(232,101,26,0.3)" : "#E8E2D9",
                }}
              >
                <Upload className="w-7 h-7 transition-colors duration-300"
                  style={{ color: isDragActive ? "#E8651A" : "#A89484" }} />
              </motion.div>

              {isDragReject ? (
                <><p className="font-semibold text-sm mb-1" style={{ color: "#DC2626" }}>File type not supported</p>
                  <p className="text-xs" style={{ color: "#A89484" }}>Use PDF, PNG, or JPG</p></>
              ) : isDragActive ? (
                <><p className="font-bold text-base mb-1" style={{ color: "#E8651A" }}>Drop it here!</p>
                  <p className="text-sm" style={{ color: "#6B5E52" }}>Release to upload your document</p></>
              ) : (
                <>
                  <p className="font-semibold text-base mb-1" style={{ color: "#18130E" }}>
                    Drop your document here
                  </p>
                  <p className="text-sm mb-5" style={{ color: "#A89484" }}>or click to browse files</p>
                  <div className="flex items-center gap-2 text-xs">
                    {["PDF", "PNG", "JPG"].map(t => (
                      <span key={t} className="px-2.5 py-1 rounded-lg font-medium"
                        style={{ background: "#F2EDE6", color: "#6B5E52", border: "1px solid #E8E2D9" }}>
                        {t}
                      </span>
                    ))}
                    <span style={{ color: "#CFC8BE" }}>· Max 10MB</span>
                  </div>
                </>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {error && (
          <motion.div initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            className="flex items-center gap-2 mt-2 text-xs px-3 py-2 rounded-xl"
            style={{ background: "#FEF2F2", color: "#991B1B", border: "1px solid rgba(220,38,38,0.15)" }}>
            <AlertCircle className="w-3.5 h-3.5 shrink-0" />
            {error}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

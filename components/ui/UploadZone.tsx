"use client"

import { useCallback, useState } from "react"
import { useDropzone } from "react-dropzone"
import { Upload, FileText, X, ImageIcon, AlertCircle } from "lucide-react"

interface Props {
  onFileSelect: (file: File) => void
  file: File | null
  onClear: () => void
  disabled?: boolean
}

const ACCEPTED_TYPES: Record<string, string[]> = {
  "application/pdf": [".pdf"],
  "image/png": [".png"],
  "image/jpeg": [".jpg", ".jpeg"],
}

const MAX_SIZE = 10 * 1024 * 1024 // 10MB

export default function UploadZone({ onFileSelect, file, onClear, disabled }: Props) {
  const [error, setError] = useState<string | null>(null)

  const onDrop = useCallback(
    (accepted: File[], rejected: { errors: readonly { message: string; code: string }[] }[]) => {
      setError(null)
      if (rejected.length > 0) {
        const firstError = rejected[0]?.errors[0]?.message
        if (firstError?.includes("size")) {
          setError("File is too large. Maximum size is 10MB.")
        } else {
          setError("Please upload a PDF, PNG, or JPG file.")
        }
        return
      }
      if (accepted.length > 0 && accepted[0]) {
        onFileSelect(accepted[0])
      }
    },
    [onFileSelect]
  )

  const { getRootProps, getInputProps, isDragActive, isDragReject } = useDropzone({
    onDrop,
    accept: ACCEPTED_TYPES,
    maxSize: MAX_SIZE,
    maxFiles: 1,
    disabled: disabled || !!file,
  })

  const isPDF = file?.type === "application/pdf"

  return (
    <div className="w-full">
      {file ? (
        // Selected file state
        <div className="relative rounded-2xl border border-amber-400/30 bg-amber-400/5 p-6 flex items-center gap-4">
          <div className="w-12 h-12 rounded-xl bg-amber-400/10 border border-amber-400/20 flex items-center justify-center shrink-0">
            {isPDF ? (
              <FileText className="w-6 h-6 text-amber-400" />
            ) : (
              <ImageIcon className="w-6 h-6 text-amber-400" />
            )}
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-white font-medium text-sm truncate">{file.name}</p>
            <p className="text-slate-500 text-xs mt-0.5">
              {(file.size / 1024 / 1024).toFixed(2)} MB ·{" "}
              {isPDF ? "PDF Document" : "Image"}
            </p>
          </div>
          <button
            onClick={(e) => {
              e.stopPropagation()
              onClear()
              setError(null)
            }}
            className="shrink-0 p-1.5 rounded-lg text-slate-500 hover:text-white hover:bg-white/10 transition-all"
            title="Remove file"
          >
            <X className="w-4 h-4" />
          </button>
          <div className="absolute top-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-amber-400/40 to-transparent rounded-t-2xl" />
        </div>
      ) : (
        // Drop zone
        <div
          {...getRootProps()}
          className={`relative rounded-2xl border-2 border-dashed transition-all duration-300 cursor-pointer group ${
            isDragReject
              ? "border-red-500/60 bg-red-500/5"
              : isDragActive
              ? "border-amber-400/80 bg-amber-400/10 scale-[1.01]"
              : "border-white/10 hover:border-amber-400/40 hover:bg-white/[0.02]"
          } ${disabled ? "opacity-50 cursor-not-allowed" : ""}`}
        >
          <input {...getInputProps()} />

          <div className="flex flex-col items-center justify-center py-12 px-6 text-center">
            {/* Animated upload icon */}
            <div
              className={`relative mb-5 transition-all duration-300 ${
                isDragActive ? "scale-110" : "group-hover:scale-105"
              }`}
            >
              <div
                className={`w-16 h-16 rounded-2xl flex items-center justify-center border transition-all duration-300 ${
                  isDragActive
                    ? "bg-amber-400/20 border-amber-400/40"
                    : "bg-white/5 border-white/10 group-hover:bg-amber-400/10 group-hover:border-amber-400/20"
                }`}
              >
                <Upload
                  className={`w-7 h-7 transition-all duration-300 ${
                    isDragActive
                      ? "text-amber-400 -translate-y-1"
                      : "text-slate-400 group-hover:text-amber-400"
                  }`}
                />
              </div>
              {isDragActive && (
                <div className="absolute inset-0 rounded-2xl border border-amber-400/40 animate-ping" />
              )}
            </div>

            {isDragReject ? (
              <>
                <p className="text-red-400 font-semibold text-base mb-1">
                  File type not supported
                </p>
                <p className="text-slate-500 text-sm">
                  Please use PDF, PNG, or JPG
                </p>
              </>
            ) : isDragActive ? (
              <>
                <p className="text-amber-400 font-semibold text-base mb-1">
                  Drop it here
                </p>
                <p className="text-slate-400 text-sm">Release to upload your document</p>
              </>
            ) : (
              <>
                <p className="text-white font-semibold text-base mb-1">
                  Drop your document here
                </p>
                <p className="text-slate-500 text-sm mb-4">
                  or click to browse your files
                </p>
                <div className="flex items-center gap-2 text-xs text-slate-600">
                  <span className="bg-white/5 border border-white/10 px-2.5 py-1 rounded-lg">
                    PDF
                  </span>
                  <span className="bg-white/5 border border-white/10 px-2.5 py-1 rounded-lg">
                    PNG
                  </span>
                  <span className="bg-white/5 border border-white/10 px-2.5 py-1 rounded-lg">
                    JPG
                  </span>
                  <span className="text-slate-700">· Max 10MB</span>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {error && (
        <div className="flex items-center gap-2 mt-2 text-xs text-red-400 bg-red-400/10 border border-red-400/20 rounded-lg px-3 py-2">
          <AlertCircle className="w-3.5 h-3.5 shrink-0" />
          {error}
        </div>
      )}
    </div>
  )
}

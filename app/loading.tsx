export default function Loading() {
  return (
    <div className="min-h-screen flex items-center justify-center">
      <span
        className="mono text-[11px] tracking-[0.3em] animate-pulse"
        style={{ color: "var(--text-3)" }}
      >
        LOADING
      </span>
    </div>
  )
}

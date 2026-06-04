export default function Loading() {
  return (
    <div className="min-h-screen pt-32 pb-32 max-md:pt-20 max-md:pb-20">
      <div className="container-edition">
        <div className="max-w-3xl">
          <p className="eyebrow mb-4 animate-pulse" style={{ color: "var(--text-3)" }}>
            Loading analysis
          </p>
          <div
            className="h-12 w-3/4 rounded animate-pulse mb-4"
            style={{ background: "var(--hairline-2)" }}
          />
          <div
            className="h-4 w-full rounded animate-pulse mb-2"
            style={{ background: "var(--hairline-2)" }}
          />
          <div
            className="h-4 w-5/6 rounded animate-pulse"
            style={{ background: "var(--hairline-2)" }}
          />
        </div>
      </div>
    </div>
  )
}

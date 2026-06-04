export default function Loading() {
  return (
    <div className="min-h-screen pt-32 pb-32 max-md:pt-20 max-md:pb-20">
      <div className="container-edition">
        <p className="eyebrow mb-6">Account</p>
        <h1
          className="display max-w-[18ch] mb-6 animate-pulse"
          style={{ fontSize: "clamp(2.4rem, 7vw, 6rem)", color: "var(--text-2)" }}
        >
          Your desk.
        </h1>
        <p className="max-w-md text-base animate-pulse" style={{ color: "var(--text-3)" }}>
          Loading your history…
        </p>
        <div className="mt-20 grid grid-cols-2 md:grid-cols-3 gap-0 border-t border-l max-md:mt-12" style={{ borderColor: "var(--hairline-2)" }}>
          {[0, 1, 2].map((i) => (
            <div
              key={i}
              className="p-6 sm:p-8 border-b border-r min-h-[160px] flex flex-col justify-between max-md:p-4 max-md:min-h-[120px]"
              style={{ borderColor: "var(--hairline-2)" }}
            >
              <p className="mono text-[10px] tracking-[0.22em]" style={{ color: "var(--text-mute)" }}>
                {["PLAN", "ANALYZED", "STATUS"][i]}
              </p>
              <div className="h-8 w-16 rounded animate-pulse" style={{ background: "var(--hairline-2)" }} />
              <p className="mono text-[10px]" style={{ color: "var(--text-3)" }}>
                &nbsp;
              </p>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

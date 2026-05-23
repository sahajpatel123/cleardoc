import type { ReactNode } from "react"

interface Props {
  title: string
  subtitle?: string
  icon?: ReactNode
  accent?: "orange" | "red" | "green" | "blue"
  number?: string
  children: ReactNode
  className?: string
}

const accentMap = {
  orange: "var(--ember)",
  red:    "var(--red)",
  green:  "var(--moss)",
  blue:   "var(--sky)",
}

export default function ResultCard({
  title,
  subtitle,
  accent = "orange",
  number,
  children,
  className = "",
}: Props) {
  const accentColor = accentMap[accent]
  return (
    <section
      className={`relative ${className}`}
      style={{ borderTop: "1px solid var(--hairline-2)" }}
    >
      {/* Top tick accent */}
      <div
        className="absolute top-[-1px] left-0 h-px"
        style={{ width: 72, background: accentColor }}
      />

      <div className="py-10 sm:py-12">
        <div className="grid grid-cols-1 md:grid-cols-12 gap-6 sm:gap-10 mb-8">
          <div className="md:col-span-3">
            {number && (
              <p
                className="mono text-[10px] tracking-[0.22em]"
                style={{ color: "var(--text-mute)" }}
              >
                {number}
              </p>
            )}
            <h3
              className="display mt-3"
              style={{
                fontSize: "clamp(1.4rem, 2.4vw, 2rem)",
                color: "var(--text)",
              }}
            >
              {title}
            </h3>
            {subtitle && (
              <p className="mt-2 text-xs" style={{ color: "var(--text-3)" }}>
                {subtitle}
              </p>
            )}
          </div>

          <div className="md:col-span-9">{children}</div>
        </div>
      </div>
    </section>
  )
}

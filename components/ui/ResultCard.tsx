import type { ReactNode } from "react"

interface Props {
  title: string
  subtitle?: string
  icon: ReactNode
  accent?: "orange" | "red" | "green" | "blue"
  children: ReactNode
  className?: string
}

const accentConfig = {
  orange: { iconBg: "#FEF0E6", iconColor: "#E8651A", border: "rgba(232,101,26,0.15)" },
  red:    { iconBg: "#FEF2F2", iconColor: "#DC2626", border: "rgba(220,38,38,0.15)" },
  green:  { iconBg: "#ECFDF5", iconColor: "#059669", border: "rgba(5,150,105,0.15)" },
  blue:   { iconBg: "#EFF6FF", iconColor: "#2563EB", border: "rgba(37,99,235,0.15)" },
}

export default function ResultCard({ title, subtitle, icon, accent = "orange", children, className = "" }: Props) {
  const cfg = accentConfig[accent]
  return (
    <div
      className={`premium-card overflow-hidden ${className}`}
      style={{ background: "white" }}
    >
      {/* Card header */}
      <div className="px-6 pt-6 pb-4 border-b" style={{ borderColor: "#F2EDE6" }}>
        <div className="flex items-center gap-3">
          <div className="p-2.5 rounded-xl border flex items-center justify-center"
            style={{ background: cfg.iconBg, borderColor: cfg.border, color: cfg.iconColor }}>
            {icon}
          </div>
          <div>
            <h3 className="font-bold text-base" style={{ color: "#18130E", fontFamily: "var(--font-syne,'Syne',sans-serif)" }}>
              {title}
            </h3>
            {subtitle && <p className="text-xs mt-0.5" style={{ color: "#A89484" }}>{subtitle}</p>}
          </div>
        </div>
      </div>
      {/* Card body */}
      <div className="px-6 py-5">{children}</div>
    </div>
  )
}

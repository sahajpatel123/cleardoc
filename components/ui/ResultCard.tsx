import type { ReactNode } from "react"

interface Props {
  title: string
  subtitle?: string
  icon: ReactNode
  accent?: "amber" | "red" | "emerald" | "blue"
  children: ReactNode
  className?: string
}

const accentConfig = {
  amber: {
    iconBg: "bg-amber-400/10 border-amber-400/20",
    iconColor: "text-amber-400",
    titleAccent: "text-amber-400",
    border: "border-white/5 hover:border-amber-400/20",
  },
  red: {
    iconBg: "bg-red-500/10 border-red-500/20",
    iconColor: "text-red-400",
    titleAccent: "text-red-400",
    border: "border-white/5 hover:border-red-500/20",
  },
  emerald: {
    iconBg: "bg-emerald-500/10 border-emerald-500/20",
    iconColor: "text-emerald-400",
    titleAccent: "text-emerald-400",
    border: "border-white/5 hover:border-emerald-500/20",
  },
  blue: {
    iconBg: "bg-blue-500/10 border-blue-500/20",
    iconColor: "text-blue-400",
    titleAccent: "text-blue-400",
    border: "border-white/5 hover:border-blue-500/20",
  },
}

export default function ResultCard({
  title,
  subtitle,
  icon,
  accent = "amber",
  children,
  className = "",
}: Props) {
  const config = accentConfig[accent]

  return (
    <div
      className={`bg-[#0F1117] border rounded-2xl overflow-hidden transition-all duration-300 ${config.border} ${className}`}
    >
      {/* Card header */}
      <div className="px-6 pt-6 pb-4 border-b border-white/5">
        <div className="flex items-center gap-3">
          <div
            className={`p-2.5 rounded-xl border ${config.iconBg} ${config.iconColor}`}
          >
            {icon}
          </div>
          <div>
            <h3 className="font-bold text-white text-base">{title}</h3>
            {subtitle && (
              <p className="text-xs text-slate-500 mt-0.5">{subtitle}</p>
            )}
          </div>
        </div>
      </div>

      {/* Card body */}
      <div className="px-6 py-5">{children}</div>
    </div>
  )
}

import type { RedFlag } from "@/lib/types"
import { AlertTriangle, AlertCircle, Info } from "lucide-react"

interface Props {
  flag: RedFlag
  index: number
}

const severityConfig = {
  high: {
    icon: AlertTriangle,
    badge: "bg-red-500/15 text-red-400 border-red-500/30",
    border: "border-red-500/30",
    bg: "bg-red-500/5",
    dot: "bg-red-500",
    label: "HIGH",
    iconColor: "text-red-400",
  },
  medium: {
    icon: AlertCircle,
    badge: "bg-amber-400/15 text-amber-400 border-amber-400/30",
    border: "border-amber-400/30",
    bg: "bg-amber-400/5",
    dot: "bg-amber-400",
    label: "MEDIUM",
    iconColor: "text-amber-400",
  },
  low: {
    icon: Info,
    badge: "bg-blue-400/15 text-blue-400 border-blue-400/30",
    border: "border-blue-400/30",
    bg: "bg-blue-400/5",
    dot: "bg-blue-400",
    label: "LOW",
    iconColor: "text-blue-400",
  },
}

export default function RedFlagItem({ flag, index }: Props) {
  const config = severityConfig[flag.severity]
  const Icon = config.icon

  return (
    <div
      className={`rounded-xl border ${config.border} ${config.bg} p-4 transition-all hover:border-opacity-60`}
      style={{ animationDelay: `${index * 80}ms` }}
    >
      <div className="flex items-start gap-3">
        <div className={`mt-0.5 shrink-0 p-1.5 rounded-lg ${config.bg} border ${config.border}`}>
          <Icon className={`w-3.5 h-3.5 ${config.iconColor}`} />
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap mb-2">
            <h4 className="font-semibold text-white text-sm">{flag.issue}</h4>
            <span
              className={`text-xs font-bold tracking-wider px-2 py-0.5 rounded-full border ${config.badge}`}
            >
              {config.label}
            </span>
          </div>

          {/* Source text */}
          {flag.source_text && (
            <blockquote className="text-xs text-slate-500 italic border-l-2 border-white/10 pl-3 mb-2 line-clamp-3">
              &ldquo;{flag.source_text}&rdquo;
            </blockquote>
          )}

          {/* Explanation */}
          <p className="text-sm text-slate-300 leading-relaxed">
            {flag.explanation}
          </p>
        </div>
      </div>
    </div>
  )
}

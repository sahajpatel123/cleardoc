import type { RedFlag } from "@/lib/types"
import { AlertTriangle, AlertCircle, Info } from "lucide-react"

interface Props { flag: RedFlag; index: number }

const cfg = {
  high:   { Icon: AlertTriangle, badge: "tag-red",    border: "rgba(220,38,38,0.15)",   bg: "#FEF9F9", dot: "#DC2626", label: "HIGH" },
  medium: { Icon: AlertCircle,   badge: "tag-orange",  border: "rgba(232,101,26,0.15)",  bg: "#FFFBF8", dot: "#E8651A", label: "MED" },
  low:    { Icon: Info,          badge: "tag-warm",    border: "rgba(37,99,235,0.12)",   bg: "#F8FAFF", dot: "#2563EB", label: "LOW" },
}

export default function RedFlagItem({ flag, index }: Props) {
  const c = cfg[flag.severity]
  const Icon = c.Icon
  return (
    <div
      className="rounded-xl border p-4 transition-all hover:shadow-sm"
      style={{ borderColor: c.border, background: c.bg, animationDelay: `${index * 70}ms` }}
    >
      <div className="flex items-start gap-3">
        <div className="shrink-0 mt-0.5 w-7 h-7 rounded-lg flex items-center justify-center border"
          style={{ background: "white", borderColor: c.border }}>
          <Icon className="w-3.5 h-3.5" style={{ color: c.dot }} />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap mb-2">
            <h4 className="font-bold text-sm" style={{ color: "#18130E" }}>{flag.issue}</h4>
            <span className={`tag ${c.badge} !text-[10px] !py-0.5 !px-2`}>{c.label}</span>
          </div>
          {flag.source_text && (
            <blockquote className="text-xs italic border-l-2 pl-3 mb-2 line-clamp-3"
              style={{ color: "#A89484", borderColor: "#E8E2D9" }}>
              &ldquo;{flag.source_text}&rdquo;
            </blockquote>
          )}
          <p className="text-sm leading-relaxed" style={{ color: "#4A3F35" }}>{flag.explanation}</p>
        </div>
      </div>
    </div>
  )
}

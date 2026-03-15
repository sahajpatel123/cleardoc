import type { NextStep } from "@/lib/types"

interface Props {
  step: NextStep
  index: number
}

const priorityColors = [
  "text-red-400 border-red-400/40 bg-red-400/10",
  "text-amber-400 border-amber-400/40 bg-amber-400/10",
  "text-blue-400 border-blue-400/40 bg-blue-400/10",
  "text-emerald-400 border-emerald-400/40 bg-emerald-400/10",
  "text-slate-400 border-slate-400/40 bg-slate-400/10",
]

export default function NextStepItem({ step, index }: Props) {
  const colorClass = priorityColors[Math.min(step.priority - 1, 4)]

  return (
    <div
      className="flex items-start gap-4 p-4 rounded-xl border border-white/5 bg-white/[0.02] hover:bg-white/[0.04] transition-all group"
      style={{ animationDelay: `${index * 80}ms` }}
    >
      {/* Priority number */}
      <div
        className={`shrink-0 w-8 h-8 rounded-full border flex items-center justify-center font-bold text-sm ${colorClass}`}
      >
        {step.priority}
      </div>

      <div className="flex-1 min-w-0">
        <h4 className="font-semibold text-white text-sm mb-1 group-hover:text-amber-100 transition-colors">
          {step.action}
        </h4>
        <p className="text-sm text-slate-400 leading-relaxed">{step.reason}</p>
      </div>
    </div>
  )
}

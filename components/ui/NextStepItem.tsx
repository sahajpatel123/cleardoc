import type { NextStep } from "@/lib/types"
import { motion } from "framer-motion"

interface Props { step: NextStep; index: number }

const priorityColors = [
  { num: "#DC2626", bg: "#FEF2F2", border: "rgba(220,38,38,0.2)" },
  { num: "#E8651A", bg: "#FEF0E6", border: "rgba(232,101,26,0.2)" },
  { num: "#2563EB", bg: "#EFF6FF", border: "rgba(37,99,235,0.2)" },
  { num: "#059669", bg: "#ECFDF5", border: "rgba(5,150,105,0.2)" },
  { num: "#6B5E52", bg: "#F9F6F1", border: "#E8E2D9" },
]

export default function NextStepItem({ step, index }: Props) {
  const c = priorityColors[Math.min(step.priority - 1, 4)]
  return (
    <motion.div
      whileHover={{ x: 4 }}
      transition={{ type: "spring", stiffness: 300 }}
      className="flex items-start gap-4 p-4 rounded-xl border transition-all cursor-default"
      style={{ background: "white", borderColor: "#E8E2D9" }}
    >
      <div className="shrink-0 w-8 h-8 rounded-full flex items-center justify-center font-bold text-sm border"
        style={{ color: c.num, background: c.bg, borderColor: c.border }}>
        {step.priority}
      </div>
      <div className="flex-1 min-w-0">
        <h4 className="font-bold text-sm mb-1" style={{ color: "#18130E" }}>{step.action}</h4>
        <p className="text-sm leading-relaxed" style={{ color: "#6B5E52" }}>{step.reason}</p>
      </div>
    </motion.div>
  )
}

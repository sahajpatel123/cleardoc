import { redirect } from "next/navigation"

/** Legacy URL — fresh analyses run on the dedicated session page. */
export default function AnalyzeRedirectPage() {
  redirect("/analyze/session")
}

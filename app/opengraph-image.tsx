import { ImageResponse } from "next/og"

export const alt =
  "ClearDoc — A second pair of eyes on the document that scares you."
export const size = { width: 1200, height: 630 }
export const contentType = "image/png"

// Dynamically generated social card. Uses only flexbox + the brand palette so
// it renders reliably without external font/asset fetches.
export default function OpengraphImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          background: "#050505",
          padding: "72px 80px",
          position: "relative",
        }}
      >
        {/* top ember rule */}
        <div
          style={{
            position: "absolute",
            top: 0,
            left: 0,
            right: 0,
            height: 6,
            background:
              "linear-gradient(90deg, transparent 0%, #FF6A1F 20%, #FF6A1F 80%, transparent 100%)",
          }}
        />

        <div style={{ display: "flex", alignItems: "center" }}>
          <div
            style={{
              fontSize: 30,
              fontWeight: 700,
              letterSpacing: "-0.04em",
              color: "#F5F2EB",
              display: "flex",
            }}
          >
            Clear<span style={{ color: "#FF6A1F" }}>Doc</span>
          </div>
        </div>

        <div style={{ display: "flex", flexDirection: "column" }}>
          <div
            style={{
              fontSize: 68,
              fontWeight: 700,
              lineHeight: 1.05,
              letterSpacing: "-0.04em",
              color: "#F5F2EB",
              maxWidth: 920,
              display: "flex",
              flexDirection: "column",
            }}
          >
            <span>A second pair of eyes on</span>
            <span>
              the document that{" "}
              <span style={{ color: "#FF6A1F" }}>scares you.</span>
            </span>
          </div>
          <div
            style={{
              marginTop: 28,
              fontSize: 27,
              lineHeight: 1.4,
              color: "rgba(245, 242, 235, 0.55)",
              maxWidth: 880,
              display: "flex",
            }}
          >
            Plain English, red flags named, a ready-to-send counter-letter, and
            your next moves — in thirty seconds.
          </div>
        </div>

        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 24,
            fontSize: 20,
            color: "rgba(245, 242, 235, 0.4)",
          }}
        >
          <span>Insurance denials</span>
          <span style={{ color: "#FF6A1F" }}>·</span>
          <span>Eviction notices</span>
          <span style={{ color: "#FF6A1F" }}>·</span>
          <span>Medical bills</span>
          <span style={{ color: "#FF6A1F" }}>·</span>
          <span>IRS letters</span>
        </div>
      </div>
    ),
    { ...size },
  )
}

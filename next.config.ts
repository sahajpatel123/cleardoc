import type { NextConfig } from "next"

const nextConfig: NextConfig = {
  serverExternalPackages: ["firebase-admin", "pdfjs-dist"],
  turbopack: {
    resolveAlias: {
      canvas: "./empty-module.js",
    },
  },
}

export default nextConfig

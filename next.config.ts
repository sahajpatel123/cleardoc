import type { NextConfig } from "next"

const nextConfig: NextConfig = {
  serverExternalPackages: ["firebase-admin", "pdf2json"],
}

export default nextConfig

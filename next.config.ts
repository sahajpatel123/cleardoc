import type { NextConfig } from "next"
import path from "path"

const nextConfig: NextConfig = {
  serverExternalPackages: ["pdf2json"],
  turbopack: {
    root: path.resolve(__dirname),
  },
}

export default nextConfig

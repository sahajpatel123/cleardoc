import type { NextConfig } from "next"

const nextConfig: NextConfig = {
  experimental: {
    serverComponentsExternalPackages: ["firebase-admin", "pdfjs-dist"],
  },
  webpack: (config, { isServer }) => {
    if (isServer) {
      // Prevent pdfjs canvas dependency issues
      config.resolve.alias = {
        ...config.resolve.alias,
        canvas: false,
      }
    }
    return config
  },
}

export default nextConfig

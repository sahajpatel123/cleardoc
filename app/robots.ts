import type { MetadataRoute } from "next"
import { resolveSiteUrl } from "@/lib/site-url"

export default function robots(): MetadataRoute.Robots {
  const base = resolveSiteUrl()
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      // Authenticated / transient surfaces add no SEO value and may expose
      // user-specific content patterns — keep them out of the index.
      disallow: ["/api/", "/analyze", "/dashboard", "/login"],
    },
    sitemap: `${base}/sitemap.xml`,
    host: base,
  }
}

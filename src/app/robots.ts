import type { MetadataRoute } from "next";

const SITE_URL = (
  process.env.NEXT_PUBLIC_SITE_URL || "https://aksaranetra.rafifernanda.site"
).replace(/\/$/, "");

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: "*",
        allow: ["/", "/periksa"],
        disallow: ["/result", "/katalog"],
      },
    ],
    sitemap: `${SITE_URL}/sitemap.xml`,
  };
}

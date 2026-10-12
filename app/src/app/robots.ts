import type { MetadataRoute } from "next";

// Disallow indexing until a public launch is explicitly approved.
export default function robots(): MetadataRoute.Robots {
  const isPublic = process.env.SITE_ACCESS_MODE === "public" && process.env.PUBLIC_LAUNCH_APPROVED === "true";
  return isPublic ? { rules: { userAgent: "*", allow: "/" } } : { rules: { userAgent: "*", disallow: "/" } };
}

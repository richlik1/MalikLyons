import type { Metadata, Viewport } from "next";
import Link from "next/link";
import { SiteHeader } from "@/components/SiteHeader";
import "./globals.css";

export const metadata: Metadata = {
  title: "TrendSet — AI try-on for independent fashion brands",
  description: "Let shoppers preview your garments on themselves before they buy.",
};

export const viewport: Viewport = { width: "device-width", initialScale: 1, themeColor: "#fafaf7" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen font-sans">
        <SiteHeader />
        <main>{children}</main>
        <footer className="mt-20 border-t border-line py-8 text-sm text-ink-muted">
          <div className="container-page flex flex-wrap justify-between gap-4">
            <span>© {new Date().getFullYear()} TrendSet</span>
            <Link href="/privacy" className="underline underline-offset-4">Privacy &amp; photo policy</Link>
          </div>
        </footer>
      </body>
    </html>
  );
}

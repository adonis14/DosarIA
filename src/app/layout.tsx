import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

// next/font self-hosts the font files at build time: no runtime requests to
// third-party font CDNs (keeps the CSP at font-src 'self').
const sans = Geist({ variable: "--font-sans", subsets: ["latin", "latin-ext"] });
const mono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

// Every page is rendered per request: the nonce-based CSP (src/proxy.ts) can only
// be applied to dynamically rendered HTML, and private pages must never be cached.
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: { default: "DosarIA", template: "%s · DosarIA" },
  description: "Monitorizarea dosarelor și a termenelor procedurale pentru cabinete de avocatură.",
  robots: { index: false, follow: false },
  referrer: "strict-origin-when-cross-origin",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="ro" className={`${sans.variable} ${mono.variable} h-full antialiased`}>
      <body className="min-h-full bg-background font-sans text-foreground">{children}</body>
    </html>
  );
}

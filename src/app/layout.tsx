import type { Metadata } from "next";
import { GeistMono } from "geist/font/mono";
import { GeistSans } from "geist/font/sans";
import { I18nProvider } from "@/i18n/client";
import { getLocale, getT } from "@/i18n/server";
import "./globals.css";

// The font files ship inside the `geist` package (next/font/local), so neither
// build nor dev needs network access to a font CDN, and the browser never
// requests third-party fonts (keeps the CSP at font-src 'self').
// Variables set on <html>: --font-geist-sans, --font-geist-mono (see globals.css).
const sans = GeistSans;
const mono = GeistMono;

// Every page is rendered per request: the nonce-based CSP (src/proxy.ts) can only
// be applied to dynamically rendered HTML, and private pages must never be cached.
export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT();
  return {
    title: { default: "DosarIA", template: "%s · DosarIA" },
    description: t.meta.appDescription,
    robots: { index: false, follow: false },
    referrer: "strict-origin-when-cross-origin",
  };
}

export default async function RootLayout({ children }: LayoutProps<"/">) {
  const [locale, t] = await Promise.all([getLocale(), getT()]);
  return (
    <html lang={locale} className={`${sans.variable} ${mono.variable} h-full antialiased`}>
      <body className="min-h-full bg-background font-sans text-foreground">
        <I18nProvider value={{ locale, messages: t.client, roles: t.labels.roles }}>{children}</I18nProvider>
      </body>
    </html>
  );
}

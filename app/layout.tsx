import type { Metadata, Viewport } from "next";
import { Barlow } from "next/font/google";
import "./globals.css";
import { RuntimeRecovery } from "@/components/runtime-recovery";
import { OfflineSupport } from "@/components/offline-support";

const barlow = Barlow({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  display: "swap",
  variable: "--font-barlow",
});

export const metadata: Metadata = {
  title: "Home Camera Access",
  description: "Private authorised access only.",
  // Let iOS size its native status bar. The legacy black-translucent mode can
  // leave a status-bar-height strip below standalone pages (WebKit 313800).
  // appleWebApp would reinsert a status-bar-style tag even when that field is omitted.
  other: { "mobile-web-app-capable": "yes", "apple-mobile-web-app-capable": "yes", "apple-mobile-web-app-title": "MPDEE Vision" },
  robots: {
    index: false,
    follow: false,
    nocache: true,
    googleBot: {
      index: false,
      follow: false,
      noimageindex: true,
    },
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#0c0d0f",
  colorScheme: "dark",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${barlow.variable} h-full antialiased`}>
      <body className="min-h-full bg-canvas font-sans text-ink">
        <noscript><div className="vision-noscript"><h1>MPDEE Vision needs JavaScript</h1>
          <p>Enable JavaScript for this site, then reload to sign in and view cameras.</p><a href="/watch">Reload cameras</a></div></noscript>
        {children}<RuntimeRecovery /><OfflineSupport />
      </body>
    </html>
  );
}

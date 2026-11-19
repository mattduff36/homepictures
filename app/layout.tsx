import type { Metadata, Viewport } from "next";
import { Barlow } from "next/font/google";
import "./globals.css";
import { RuntimeRecovery } from "@/components/runtime-recovery";

const barlow = Barlow({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  display: "swap",
  variable: "--font-barlow",
});

export const metadata: Metadata = {
  title: "Home Camera Access",
  description: "Private authorised access only.",
  appleWebApp: { capable: true, title: "MPDEE Vision", statusBarStyle: "black-translucent" },
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
        {children}<RuntimeRecovery />
      </body>
    </html>
  );
}

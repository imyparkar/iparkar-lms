import type { Metadata, Viewport } from "next";
import "./globals.css";


export const metadata: Metadata = {
  title: { default: "iParkar Learning", template: "%s · iParkar Learning" },
  description: "Practice examinations and study analytics for ASP, CSP and CIH candidates.",
  icons: { icon: "/favicon.svg", apple: "/apple-touch-icon.png" },
  robots: { index: false, follow: false },
};

export const viewport: Viewport = { themeColor: "#02093a", width: "device-width", initialScale: 1 };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        {/* Same Google Fonts the marketing site loads (Inter + Source Serif 4) */}
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        {/* eslint-disable-next-line @next/next/no-page-custom-font */}
        <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=Source+Serif+4:wght@400&display=swap" />
      </head>
      <body>{children}</body>
    </html>
  );
}

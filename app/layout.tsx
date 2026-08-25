import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import PwaInstall from "./pwa-install";
import "./globals.css";
import "./modal-fix.css";
import "./modern-ui.css";
import "./aim-ui.css";
import "./portal-ui.css";
import "./lead-location.css";
import "./client-auth.css";
import "./pwa.css";
import "./platform-admin.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Hamro Afno Enterprises — Accounts & CRM",
  description: "Sales, purchases, inventory, payments and party ledgers in one simple accounting workspace.",
  robots: { index: false, follow: false, nocache: true },
  manifest: "/manifest.webmanifest",
  applicationName: "Hamro Afno",
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: "Hamro Afno",
  },
  icons: {
    icon: [
      { url: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
      { url: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
    ],
    shortcut: "/icons/icon-192.png",
    apple: "/icons/apple-touch-icon.png",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#245edb",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
      >
        {children}
        <PwaInstall />
      </body>
    </html>
  );
}

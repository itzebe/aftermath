import type { Metadata, Viewport } from "next";
import { Inter, JetBrains_Mono } from "next/font/google";
import "./globals.css";
import { Shell } from "@/components/shell";

const sans = Inter({
  subsets: ["latin"],
  variable: "--font-sans",
  display: "swap",
});

const mono = JetBrains_Mono({
  subsets: ["latin"],
  variable: "--font-mono",
  display: "swap",
});

export const metadata: Metadata = {
  title: {
    default: "AFTERMATH — Every failure should leave a safeguard",
    template: "%s · AFTERMATH",
  },
  description:
    "Evidence-based failure prevention: a submitted incident becomes a structured investigation — what is observed, what is confirmed, what is hypothesised, and what remains unknown — ending in a specific safeguard and an honest statement of how far it is verified.",
};

export const viewport: Viewport = {
  themeColor: "#06080b",
  colorScheme: "dark",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className={`${sans.variable} ${mono.variable}`}>
      <body className="min-h-screen antialiased">
        <Shell>{children}</Shell>
      </body>
    </html>
  );
}

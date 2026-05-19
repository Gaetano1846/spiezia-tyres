import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import Providers from "@/components/layout/Providers";

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
  display: "swap",
});

export const metadata: Metadata = {
  title: {
    default: "Spiezia Tyres — Gestionale",
    template: "%s | Spiezia Tyres",
  },
  robots: { index: false, follow: false },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="it" className={inter.variable}>
      <body className="min-h-screen antialiased bg-[#F5F6FA] text-[#111]">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}

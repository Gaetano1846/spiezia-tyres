import type { Metadata } from "next";
import { Poppins, Montserrat } from "next/font/google";
import "./globals.css";
import Providers from "@/components/layout/Providers";

const poppins = Poppins({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700", "800"],
  variable: "--font-poppins",
  display: "swap",
});

const montserrat = Montserrat({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-montserrat",
  display: "swap",
});

export const metadata: Metadata = {
  title: { default: "Spiezia Tyres — Gestionale", template: "%s | Spiezia Tyres" },
  robots: { index: false, follow: false },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="it" className={`${poppins.variable} ${montserrat.variable}`}>
      <body
        className="min-h-screen antialiased"
        style={{
          fontFamily: "var(--font-montserrat), system-ui, sans-serif",
          background: "var(--bg-primary)",
          color: "var(--text-primary)",
        }}
      >
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}

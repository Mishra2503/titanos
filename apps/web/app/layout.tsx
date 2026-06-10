import type { Metadata } from "next";
import { Inter, Space_Grotesk, Instrument_Serif, Geist_Mono } from "next/font/google";
import "./globals.css";

const display = Inter({
  subsets: ["latin"],
  variable: "--font-display",
  display: "swap",
});

const heading = Space_Grotesk({
  subsets: ["latin"],
  weight: ["500", "600", "700"],
  variable: "--font-heading",
  display: "swap",
});

const serif = Instrument_Serif({
  subsets: ["latin"],
  weight: "400",
  style: ["normal", "italic"],
  variable: "--font-serif",
  display: "swap",
});

const mono = Geist_Mono({
  subsets: ["latin"],
  variable: "--font-mono",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Titan OS",
  description: "Instagram creator-brand operations portal.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${display.variable} ${heading.variable} ${serif.variable} ${mono.variable}`}>
      <body className="font-display antialiased">{children}</body>
    </html>
  );
}

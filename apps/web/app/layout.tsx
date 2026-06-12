import type { Metadata } from "next";
import { Inter, Epilogue } from "next/font/google";
import "./globals.css";

const sans = Inter({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-sans",
  display: "swap",
});

const heading = Epilogue({
  subsets: ["latin"],
  weight: ["600", "700", "800"],
  variable: "--font-heading",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Aifluencee Content Hub",
  description: "Instagram creator-brand operations portal.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${sans.variable} ${heading.variable}`}>
      <body className="font-display antialiased">{children}</body>
    </html>
  );
}

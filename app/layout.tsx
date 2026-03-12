import type { Metadata } from "next";
import { Geist } from "next/font/google";
import "./globals.css";

const geist = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "BOQ Generator — AI-powered Bill of Quantities",
  description:
    "Upload a Scope of Work PDF and get a tender-ready Bill of Quantities in seconds.",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className="dark">
      <body className={`${geist.variable} font-sans antialiased bg-[#0f0f0f] text-white`}>
        {children}
      </body>
    </html>
  );
}

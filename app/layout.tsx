import type { Metadata } from "next";
import { GeistSans } from "geist/font/sans";
import "./globals.css";
import PostHogProvider from "@/components/PostHogProvider";

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
      <body className={`${GeistSans.variable} font-sans antialiased bg-[#0f0f0f] text-white`}>
        <PostHogProvider>{children}</PostHogProvider>
      </body>
    </html>
  );
}

import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { Toaster } from "@/components/ui/toaster";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Ghardan - Voxel Sandbox",
  description: "A browser-based voxel sandbox game inspired by Minecraft. Build, mine, craft, and survive.",
  keywords: ["Ghardan", "voxel", "sandbox", "Minecraft", "browser game", "Three.js"],
  authors: [{ name: "Ghardan" }],
  icons: {
    icon: "https://z-cdn.chatglm.cn/z-ai/static/logo.svg",
  },
  openGraph: {
    title: "Ghardan",
    description: "A browser-based voxel sandbox game",
    url: "https://chat.z.ai",
    siteName: "Ghardan",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "Ghardan",
    description: "A browser-based voxel sandbox game",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased bg-background text-foreground`}
      >
        {children}
        <Toaster />
      </body>
    </html>
  );
}

import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { MainLayout } from "@/components/layout/main-layout";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Agentic RAG - 智能知识库",
  description: "基于 Agentic RAG 的智能问答系统",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="zh-CN"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full">
        <MainLayout>{children}</MainLayout>
      </body>
    </html>
  );
}

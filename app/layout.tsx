import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "PipeSearch｜烟斗器具库存信息",
  description:
    "整理海外烟斗器具公开库存信息，提供图片、价格、参数与人工确认咨询参考。",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="zh-CN"
      className="h-full antialiased"
    >
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}

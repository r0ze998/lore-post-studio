import type { Metadata, Viewport } from "next";
import "./globals.css";
import { ToastProvider } from "@/components/ui";

export const metadata: Metadata = {
  title: "Lore Post Studio",
  description: "ゲームの世界観を守る X 投稿制作ツール（個人用・ローカル）",
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f6f5f1" },
    { media: "(prefers-color-scheme: dark)", color: "#141413" },
  ],
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ja">
      <body className="min-h-dvh antialiased">
        <ToastProvider>{children}</ToastProvider>
      </body>
    </html>
  );
}

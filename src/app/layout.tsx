import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "SukiTala — Alam mo ba kung magkano ang puwede mong gastusin ngayon?",
  description: "Know exactly how much business cash you can safely spend today.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className="h-full antialiased">
      <body className="min-h-full flex flex-col bg-gray-50 font-sans">{children}</body>
    </html>
  );
}

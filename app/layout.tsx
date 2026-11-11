import type { Metadata } from "next";
import "./globals.css";
export const metadata: Metadata = { title: "قارئ الكتب الصوتي اليومي", description: "إدارة مكتبة الكتب الصوتية من ملفات EPUB" };
export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="ar" dir="rtl"><body>{children}</body></html>;
}

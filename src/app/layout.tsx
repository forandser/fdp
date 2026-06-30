import type { Metadata } from "next"
import { ko } from "@/lib/i18n/ko"
import "./globals.css"

export const metadata: Metadata = {
  title: ko.app.metaTitle,
  description: ko.app.metaDescription,
  robots: { index: false, follow: false },
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="ko">
      <body>{children}</body>
    </html>
  )
}

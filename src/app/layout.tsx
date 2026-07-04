import type { Metadata } from "next"
import { ko } from "@/lib/i18n/ko"
import { FONT_FACE_CSS } from "@/lib/fonts/font-face-css"
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
      <body>
        {/* @font-face 주입 — globals.css 정적 선언은 basePath(/fdp)를 몰라 404였음 */}
        <style dangerouslySetInnerHTML={{ __html: FONT_FACE_CSS }} />
        {children}
      </body>
    </html>
  )
}

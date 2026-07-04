/**
 * 코어 @font-face CSS를 basePath 보정된 URL로 생성한다.
 *
 * globals.css의 정적 @font-face는 url('/fonts/...')이 basePath(/fdp)를 몰라
 * 배포에서 전부 404였다. 빌드 시점에 NEXT_PUBLIC_BASE_PATH가 인라인되는
 * TS 모듈에서 CSS 문자열을 만들어 layout.tsx가 <style>로 주입한다.
 * (html-to-image 캡처도 document.styleSheets를 읽으므로 JPG에도 적용됨)
 */
import { assetUrl } from "./asset-base"

interface CoreFace {
  family: string
  file: string
  weight: number
}

const CORE_FACES: CoreFace[] = [
  { family: "Pretendard", file: "/fonts/Pretendard-Regular.woff2", weight: 400 },
  { family: "Pretendard", file: "/fonts/Pretendard-Medium.woff2", weight: 500 },
  { family: "Pretendard", file: "/fonts/Pretendard-SemiBold.woff2", weight: 600 },
  { family: "Pretendard", file: "/fonts/Pretendard-Bold.woff2", weight: 700 },
  { family: "Pretendard", file: "/fonts/Pretendard-ExtraBold.woff2", weight: 800 },
  { family: "Pretendard", file: "/fonts/Pretendard-Black.woff2", weight: 900 },
  // v3.0.1: 기존 BlackHanSans.woff2(9KB)는 일부 글자만 담긴 서브셋이라
  // 등록 안 된 한글이 대체 폰트로 렌더돼 헤딩 굵기가 들쭉날쭉했음 → 전체 TTF로 교체
  { family: "BlackHanSans", file: "/fonts/BlackHanSans-Regular.ttf", weight: 400 },
  { family: "DoHyeon", file: "/fonts/DoHyeon.woff2", weight: 400 },
  { family: "Jua", file: "/fonts/Jua.woff2", weight: 400 },
  { family: "NanumPenScript", file: "/fonts/NanumPenScript.woff2", weight: 400 },
  { family: "GowunDodum", file: "/fonts/GowunDodum.woff2", weight: 400 },
  { family: "GowunBatang", file: "/fonts/GowunBatang-Bold.woff2", weight: 700 },
  { family: "NotoSansKR", file: "/fonts/NotoSansKR-Black.woff2", weight: 900 },
  { family: "Gugi", file: "/fonts/Gugi.woff2", weight: 400 },
]

export const FONT_FACE_CSS = CORE_FACES.map((f) => {
  const format = f.file.endsWith(".ttf") ? "truetype" : "woff2"
  return `@font-face{font-family:'${f.family}';src:url('${assetUrl(f.file)}') format('${format}');font-weight:${f.weight};font-style:normal;font-display:swap;}`
}).join("\n")

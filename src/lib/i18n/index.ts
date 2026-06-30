/**
 * i18n 진입점.
 * v1은 한국어만. 확장 시 useLocale() 훅이 ko/en/ja를 분기.
 */

import { ko } from "./ko"

export const t = ko

export type Locale = "ko" | "en" | "ja"

export function getLocale(): Locale {
  return "ko"
}

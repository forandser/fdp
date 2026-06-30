/**
 * AI 호출 어댑터 — 인터페이스 (공급자 추상화)
 *
 * 모든 AI 호출은 이 어댑터를 통한다. 컴포넌트가 @anthropic-ai/sdk를
 * 직접 import 금지. 미래 GPT/Gemini/자체 BFF 전환 시 어댑터만 교체.
 */

/** 지원 모델 ID — 단일 진실의 소스. anthropic-adapter / pricing이 같은 상수 참조. */
export const MODEL_IDS = {
  SONNET: "claude-sonnet-4-6",
  HAIKU: "claude-haiku-4-5",
  OPUS: "claude-opus-4-8",
} as const

export type ModelId = (typeof MODEL_IDS)[keyof typeof MODEL_IDS]
export const DEFAULT_MODEL: ModelId = MODEL_IDS.OPUS

export type CopyTone = "sincere" | "friendly" | "premium"
export type RecommendBadge = "top" | "best" | "new"

/** 카테고리 — 과일에서 야채/비신선식품으로 확장 가능. */
export type ProductCategory = "fruit" | "veggie" | "other"

export interface CopyInput {
  /** 카테고리 — 미래 확장 차원 2 대비 */
  category: ProductCategory
  /** 품목 이름 (이전 fruitType과 호환되도록 productType으로) */
  productType: string
  variety?: string
  origin: string
  weight: string
  price: number
  brix?: number
  harvestDate?: string
  storageHint?: string
  highlightKeywords: string[]
  recommendBadge?: RecommendBadge
  tone?: CopyTone
  /** 농가 한 줄 소개 — 사용자 자유 입력. AI가 farmStory로 정제. */
  farmIntro?: string
  /** 추천 대상 후보 — 사용자가 비우면 AI가 자동 생성. */
  recommendFor?: string[]
  /** 신뢰 옵션 — 셀러가 토글/입력한 사실만 반영. */
  trust?: TrustInfo
}

/** 신뢰 옵션 — 셀러가 직접 체크/입력한 사실. AI가 임의로 추가 못 함. */
export interface TrustInfo {
  /** 주문 후 산지에서 수확 */
  sameDayHarvest?: boolean
  /** 콜드체인 저온 배송 */
  coldChain?: boolean
  /** 산지 직거래 (중간 유통 없음) */
  directFromFarm?: boolean
  /** 손상/맛 이상 시 100% 환불 약속 */
  refundGuarantee?: boolean
  /** GAP 인증번호 (입력 시 "GAP 인증" 표기 허용) */
  gapNumber?: string
  /** 친환경/유기농 인증번호 */
  organicNumber?: string
  /** 무농약 인증번호 */
  pesticideFreeNumber?: string
  /** 수확일 (YYYY-MM-DD) */
  harvestDateLabel?: string
}

export interface CopySpec {
  label: string
  value: string
}

export interface CopyFAQ {
  q: string
  a: string
}

export interface CopyKeyPoint {
  /** "01" / "02" / "03" — 표시용 두 자리 문자열 */
  num: string
  /** 한 줄 강조 (10~25자) */
  title: string
  /** 본문 2~3문장 (60~150자) */
  body: string
}

export interface CopyOutput {
  /** 1차 헤드라인 — 가운데 큰 한글 (예: "썬프레 천도 복숭아") */
  headline: string
  /** 서브헤드라인 — 헤드 위 또는 아래 보조 한 줄 */
  subheadline: string
  /** 상품 메인 스토리 단락 (3~5문장) */
  story: string
  /** 상품 구성·정보 표 */
  spec: CopySpec[]
  /** 보관·먹는 법 (2~3문장) */
  storage: string
  /** 자주 묻는 질문 3~4개 */
  faq: CopyFAQ[]
  /** 헤드 영역에 노출할 1~4개의 짧은 강조 뱃지 (예: "당일수확", "11Brix↑") */
  highlightBadges: string[]
  /** dolfarmer 풍 "구매 포인트 3가지" — POINT 01/02/03 */
  keyPoints: CopyKeyPoint[]
  /** 한 줄 강조 박스 카피 — 말풍선·붉은 박스용 (예: "붉은 빛깔만 봐도 군침이 돌아요!") */
  highlightBox: string
  /** 구매 전 꼭 확인해주세요 — 농산물 특성·주의사항 2~4개 (정형) */
  cautions: string[]
  /** 이런 분께 추천드려요 — 4~6개 한 줄 ("부모님 선물용", "이유식 만드는 분" 등) */
  recommendFor: string[]
  /** 농가 한 줄 소개 (선택, 셀러가 입력한 farmIntro 기반으로 정제) */
  farmStory: string
}

export interface UsageInfo {
  inputTokens: number
  outputTokens: number
  estimatedCostKRW: number
  truncated: boolean
}

export interface CopyResult {
  output: CopyOutput
  usage: UsageInfo
  modelId: ModelId
}

export type DiagnosticStatus =
  | "ok"
  | "invalid_key"
  | "geo_blocked"
  | "rate_limited"
  | "network_error"
  | "unknown_error"

export interface DiagnosticResult {
  status: DiagnosticStatus
  reachable: boolean
  modelAvailable: boolean
  message: string
}

/** 소구점 추천 입력 — 기본 정보만 사용 (AI에 보낼 최소 컨텍스트) */
export interface SuggestPointsInput {
  category: ProductCategory
  productType: string
  variety?: string
  origin?: string
  weight?: string
  brix?: number
  price?: number
  tone?: CopyTone
}

export interface SuggestPointsResult {
  /** 추천 소구점 6~10개. 한 줄 15~30자 권장. */
  points: string[]
  inputTokens: number
  outputTokens: number
  estimatedCostKRW: number
}

/* ───────────────── 이미지 생성/합성 어댑터 (v1.5 인터페이스) ───────────────── */

/** 이미지 생성 모델 — 향후 Gemini, gpt-image-1, Firefly 등으로 확장. */
export type ImageProviderId =
  | "none"
  | "gemini-2.5-flash-image"
  | "gpt-image-1"
  | "photoroom"
  | "firefly-4"
  | "stable-diffusion-3.5"

export interface ImageGenInput {
  /** 영문 프롬프트 권장 (Claude가 만들어 넘겨주는 형태) */
  prompt: string
  /** 입력 사진 (선택). 합성/편집 모드에 사용. */
  referenceImage?: Blob
  /** 출력 비율 */
  ratio?: "1:1" | "4:5" | "16:9"
  /** 출력 폭(px). 미지정 시 모델 기본값. */
  width?: number
  seed?: number
}

export interface ImageGenResult {
  /** 결과 이미지 base64 dataURL */
  dataUrl: string
  modelId: ImageProviderId
  costKRW: number
}

export interface ImageProvider {
  /** 모델별 라벨 (UI 표시용) */
  readonly id: ImageProviderId
  readonly displayName: string
  /** 키 등록 직후 셀프 진단 */
  diagnose(): Promise<DiagnosticResult>
  /** 이미지 생성/합성 */
  generate(input: ImageGenInput): Promise<ImageGenResult>
  /** 배경 제거 (지원 모델만) */
  removeBackground?(image: Blob): Promise<ImageGenResult>
}

export interface AIProvider {
  /** 키 등록 직후 셀프 진단 (200/401/403/네트워크 확인) */
  diagnose(): Promise<DiagnosticResult>

  /** 과일/야채 카피 생성 */
  generateCopy(input: CopyInput): Promise<CopyResult>

  /** 입력 폼 기본 정보로 소구점(체크박스 추천 후보) 자동 생성 */
  suggestSellingPoints(input: SuggestPointsInput): Promise<SuggestPointsResult>
}

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
  /** Brix 측정일 (선택, YYYY-MM-DD). 셀러 신뢰도 차별점. */
  brixMeasuredOn?: string
  /** 개당 평균 g — "대과/특대과" 추상어 대신 g 단위 강제용 (v8 규칙 43). */
  avgWeightG?: number
  /** 등급 표기 ("특/상/중" 등) — 셀러가 직접 입력. */
  sizeGrade?: string
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
  /**
   * 고객 후기 — 셀러가 실제로 받은 후기만 직접 입력(AI 생성 금지).
   * ResultView의 ReviewsBlock이 렌더. 저장 하위호환: 구버전엔 없음(옵셔널).
   */
  reviews?: SellerReview[]
  /**
   * v5.8(작업①): 후기 집계(선택) — 셀러 스토어에서 "실제 집계된" 값만.
   * 개별 후기(reviews)와 별개의 스토어 전체 집계라 per-review인 SellerReview와 분리한다.
   * 전부 옵셔널 — 하나도 없으면 히어로 직하단 집계 스트립을 렌더하지 않는다(허위·자동채움 금지).
   */
  reviewStats?: ReviewStats
  /** 일반 농산물 확인 게이트 (건강기능식품/숙취해소 표시 상품 제외). v1.8 식약처 §10 보호. */
  isOrdinaryProduce?: boolean
  /**
   * v3.5: AI 리서치 모드 — web_search로 품종 일반 특성을 조사해 draft에 주입.
   * 기본 ON(생성 폼에서 토글). 실패 시 조용히 기존 2-step으로 폴백.
   * 리서치는 "품종 일반 참고 정보"만 — 산지·당도·중량 등 상품 고유 사실은
   * 여전히 입력값만 사용(규칙 55/56 유지).
   */
  researchEnabled?: boolean
}

/** v3.5: 리서치 인용 출처 1건. */
export interface ResearchSource {
  title: string
  url: string
}

/**
 * v3.5: 생성 시 실시간 리서치 결과 — "품종 일반 참고 정보"(이 상품의 고유 사실 아님).
 * web_search로 조사한 품종 일반 특성·제철·보관·소비자 관심사·FAQ 씨앗.
 * 절대 상품 고유 사실(이 셀러의 산지·당도·중량)로 승격 금지 — draft 프롬프트에서
 * fruit-facts와 동일한 안전 프레이밍으로만 주입한다.
 *
 * 하위호환: 구버전 저장본/리서치 미사용·실패 시 undefined — 요약 패널 미노출.
 */
export interface ResearchResult {
  /** 품종 일반 특성 — 맛·식감·당도 범위 등 (2~6개). */
  varietyNotes: string[]
  /** 제철/수확기 한 줄. */
  seasonInfo: string
  /** 보관법 한두 줄. */
  storageTips: string
  /** 소비자가 이 품종에서 중시하는 포인트 (2~6개). */
  consumerInterests: string[]
  /** 자주 묻는 질문 씨앗 (2~6개) — draft가 faq로 각색. */
  faqSeeds: string[]
  /**
   * v4.2: 시장 소구점 각도 (3~5개, 옵셔널·하위호환).
   * 이 품종이 시장에서 실제로 팔리는 "각도"의 일반화 — 특정 판매자 슬로건 복사 아님.
   * draft에서 keyPoints 각도의 우선 참고 재료로만 주입(고유 사실 승격 금지).
   */
  sellingAngles?: string[]
  /**
   * v4.2: 구매자 실제 불만·실패 경험 (2~4개, 옵셔널·하위호환).
   * 후기·커뮤니티에 반복되는 소비자 언어. draft에서 problemArc(문제 제기)의 우선 참고 재료.
   */
  commonComplaints?: string[]
  /**
   * v4.2: 품종 정확 명칭·별칭·혼동 주의 한두 줄 (옵셔널·하위호환).
   * 품종 오표기·오용 방지 참고. 못 찾았거나 품종 토큰이 없으면 undefined.
   */
  namingNotes?: string
  /**
   * v4.3: 시장에서 실제 쓰이는 후킹 문구·헤드라인 표현 (3~6개, 옵셔널·하위호환).
   * 상세페이지·후기·블로그가 이 품목에 실제로 쓰는 후킹 표현·헤드라인의 채집.
   * 카피 생성 시 headline/heroKicker/highlightBox 의 "리듬·구조·관용구" 재료로만 차용
   * (문장 그대로 복사 금지 — 표절 방지). 이 문구 안의 수치·산지는 이 상품 고유 사실이
   * 아니므로 승격 금지. 못 찾았으면 undefined(하위호환 — 요약 패널 섹션 미노출).
   */
  hookPhrases?: string[]
  /**
   * v6.0(작업R①): 확실도 게이트 재료 (옵셔널·하위호환).
   * 리서치가 모은 품종 일반 사실을 복수 출처 일치 여부로 나눈 것.
   * - certain: 복수 출처 일치 → draft가 "이 품종은 보통 ~" 톤으로 단정 서술 가능.
   * - tentative: 단일·불명·엇갈림 → draft가 완곡("~로 알려져 있어요") 또는 생략.
   * 어느 쪽도 이 상품 고유 사실이 아니다(승격 금지). 못 채웠으면 undefined(하위호환 — 게이트 미적용 = 현행).
   */
  certainty?: {
    certain: string[]
    tentative: string[]
  }
  /** 인용 출처 목록 (제목+URL). */
  sources: ResearchSource[]
}

/**
 * 셀러가 직접 입력한 고객 후기 1건.
 * - text: 후기 본문 (최대 200자).
 * - highlight: text 안에서 형광펜(accent 배경)으로 강조할 핵심 문장(선택).
 *   text에 포함된 부분 문자열이어야 강조가 붙는다(없으면 강조 없이 본문만 노출).
 * AI가 절대 생성하지 않는다 — 실제 받은 후기만 셀러가 입력.
 */
export interface SellerReview {
  text: string
  highlight?: string
  /**
   * 별점(1~5 정수). 셀러가 실제 받은 후기의 별점만 입력 — 자동 채움·기본값 금지.
   * 미입력(undefined)이면 별점 자체를 렌더하지 않는다(지어내기 방지·구버전 회귀 0).
   */
  rating?: number
  /**
   * 작성자 표기 — 셀러가 마스킹해 직접 입력(예: 김**). 미입력이면 표기 생략.
   * 개인정보 보호상 실명 금지 안내는 입력 UI 힌트가 담당한다.
   */
  author?: string
  /** 구매 옵션 라벨(예: 3kg). 후기 신뢰용 메타 표기. 미입력이면 생략. */
  optionLabel?: string
}

/**
 * v5.8(작업①): 후기 집계 — 셀러 스토어의 실제 집계 숫자만(추정치·기본값 금지).
 * 전부 옵셔널. 렌더는 입력된 필드만 스트립 셀로 표시하고 "판매자 스토어 집계 기준" 캡션을 자동 부착한다.
 */
export interface ReviewStats {
  /** 누적 후기 수 (0 이상 정수). */
  totalCount?: number
  /** 5점(만점) 비율 % (0~100 정수). */
  fiveStarPct?: number
  /** 재구매 지표 — 자유 문구(예: "재구매율 1위"). 셀러 직접 입력. */
  repurchase?: string
}

/** 신뢰 옵션 — 셀러가 직접 체크/입력한 사실. AI가 임의로 추가 못 함. */
export interface TrustInfo {
  /** 주문 후 산지에서 수확 */
  sameDayHarvest?: boolean
  /** 콜드체인 저온 배송 */
  coldChain?: boolean
  /** 산지 직거래 (중간 유통 없음) */
  directFromFarm?: boolean
  /** 손상/맛 이상 시 환불 약속 (객체화 — condition 미입력 시 "조건부 교환·환불"로 자동 다운그레이드). */
  refundGuarantee?: boolean | RefundGuaranteeInfo
  /** GAP 인증번호 (입력 시 "GAP 인증" 표기 허용) */
  gapNumber?: string
  /** 친환경/유기농 인증번호 */
  organicNumber?: string
  /** 무농약 인증번호 */
  pesticideFreeNumber?: string
  /** 수확일 (YYYY-MM-DD) */
  harvestDateLabel?: string
  /** v8: 농부 이름. */
  producerName?: string
  /** v8: 농부 산지 (시·군·구). */
  producerRegion?: string
  /** v8: 농부 연차. */
  farmerYears?: number
  /** v8: 농부 사진 URL (선택, 셀러 업로드). */
  farmerPhotoUrl?: string
  /** v8: 봉인 포장 여부 (콜드체인 봉인). */
  sealedPackage?: boolean
}

export interface RefundGuaranteeInfo {
  enabled: boolean
  /** 조건 — "맛 이상 시 100% 환불" 같은 구체 조건. */
  condition?: string
  /** 신청 기한 (시간 단위). */
  windowHours?: number
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

/**
 * 문제 제기 → 해결 서사 아크 (실물 키위 상세페이지 레퍼런스 패턴).
 * "왜 내가 고른 {과일}은 늘 맛이 아쉬울까?" 공감 질문 → 구매 실패의 실제 원인 2~3개.
 * 이어지는 keyPoints가 이 problems의 1:1 해결책이 되어 페이지에 서사 긴장을 만든다.
 *
 * 하위호환: 구버전 저장본/생성 실패 시 undefined — ProblemArcBlock 자체를 숨긴다.
 * 사실 정합: problems는 그 과일 구매 실패의 실제 원인(수확 시점·유통 기간·보관 등)만.
 * fruit-facts cautions/storage 범위 안에서. 지어내기 금지.
 */
export interface CopyProblemArc {
  /** 공감 질문 — "왜 (마트/내가 고른) {과일}은 ~할까?" 형식의 구매자 실패 경험 공감형 (20~40자). */
  question: string
  /** 구매 실패의 실제 원인 2~3개. 각 20자 내외 한 줄. keyPoints(해결책)와 1:1 호응. */
  problems: string[]
}

/**
 * v6.0(작업C): 동적 구성 힌트 (전부 옵셔널 — 구버전 회귀 0).
 * 생성 시 AI가 "이 상품·이 사진·이 리서치"에 근거가 있을 때만 내는 배치 판단.
 * 근거가 없으면 통째로 생략(auto) — 다양성 자체가 목표가 아니다.
 *
 * 렌더 소비 계약(결정적·검증 후):
 * - heroImageId: ResultView 히어로 선택 우선순위에 반영. 실재하지 않는 id면 현행 폴백.
 * - calloutTargetIndex: ResultView calloutIndex 오버라이드(범위·미숨김·사진 배정 유효할 때만).
 * - photobreakStyle: photoVariants 게이트에서 "이미 조건 충족된" 연출을 억제만 함(사진 수 조건 불변).
 * - sellingAngle/heroReason/emphasisOrder: AI 구성 판단의 근거 기록(렌더 비소비, 저장·추적용).
 *
 * 하위호환: 구버전 저장본/힌트 없음 시 undefined — 렌더 100% 현행 동일(회귀 0 불변식).
 * 저장: CopyOutput의 일부라 copy와 함께 Work에 저장돼 재렌더 결정성을 유지한다.
 */
export interface CompositionHints {
  /** 포지셔닝 각도 1개 — 리서치 sellingAngles 기반, AI가 이 상품에 고른 핵심 소구 각도. 기록용. */
  sellingAngle?: string
  /** 히어로 추천 사진의 imageId(사진 분석 id 중 하나). 근거 없으면 생략. 실재성은 렌더에서 검증. */
  heroImageId?: string
  /** 히어로 추천 근거 한 줄(관찰 기반 기록용). */
  heroReason?: string
  /** 콜아웃 칩을 얹을 POINT 인덱스(0~2). 근거 없으면 생략. 유효 범위는 렌더에서 검증. */
  calloutTargetIndex?: number
  /**
   * 포토브레이크 연출 선택.
   * - collage: 콜라주 강조(가능 시 컷 시퀀스 억제)
   * - cutseq: 절단면 시퀀스 강조(가능 시 콜라주 억제)
   * - fullbleed: 풀블리드 포토브레이크만(콜라주·컷 둘 다 억제)
   * - auto: 자동(현행 로직 그대로 — 억제 없음)
   * 힌트는 "이미 사진 수 조건을 충족한" 연출을 끌 수만 있고, 없는 조건을 켜지는 못한다(사진 수 불변).
   */
  photobreakStyle?: "collage" | "cutseq" | "fullbleed" | "auto"
  /** 강조 우선순위 축 2~4개(예: 당도, 산지, 선별). 기록용(렌더 비소비). */
  emphasisOrder?: string[]
}

/**
 * v6.2a: AI가 상품 맥락으로 다시 쓸 수 있는 섹션 제목 키 화이트리스트.
 * renderer가 쓸 "안정 문자열" 키 — 값은 그 섹션 제목 문구.
 * 종전 고정 문구(WHY 제목·특별한 이유·후기·타임라인·보관법·즐기기·FAQ·배송 4단계·추천)를
 * 대체할 수 있는 키만 정의한다. 여기 없는 키는 validate에서 드롭.
 * (렌더 위치 기준 안정 키 — 런타임 화이트리스트는 validate.SECTION_TITLE_KEYS가 단일 소유.)
 */
export type SectionTitleKey =
  | "why" // WHY 카드 제목 ("왜 ○○일까요")
  | "reason" // 특별한 이유 제목
  | "reviews" // 후기 제목
  | "timeline" // 타임라인 제목
  | "storage" // 보관법 제목
  | "enjoy" // 즐기기(먹는 법) 제목
  | "faq" // FAQ 제목
  | "deliverySteps" // 배송 4단계 제목
  | "recommend" // 추천 제목

export interface CopyOutput {
  /** 1차 헤드라인 — 가운데 큰 한글 (예: "썬프레 천도 복숭아") */
  headline: string
  /**
   * v4.3: 히어로 최상단 후킹 캡션 (선택) — 헤드라인 위에 얹는 12~24자 한 줄.
   * "오늘도 신선한 {상품명}" 류 범용 기본값을 대체하는, 상품 특화 후킹 문구.
   * 렌더 소비는 ResultView(A 에이전트) 담당. hookPhrases 의 리듬·구조·관용구를
   * 1순위 재료로 차용하되 문장 그대로 복사 금지, 입력에 없는 수치·산지·인증 금지,
   * headline 과 표현 중복 금지, 완결된 구/문장(규칙 58).
   * 하위호환: 구버전 저장본/생성 실패 시 undefined — A 렌더가 기본 캡션으로 폴백.
   */
  heroKicker?: string
  /**
   * 헤드라인 후보 목록 (선택). 서로 다른 후킹 유형 5개
   * (산지 고유명사형/정량 수치형/감각 트리거형/시간·시즌형/미니 서사형)을
   * 카피 생성 시 함께 받아 셀러가 칩으로 즉시 교체할 수 있게 한다.
   * 하위호환: 구버전 저장본/생성 실패 시 undefined — 칩 영역 자체를 숨긴다.
   * fruit-facts 매칭 시 무료 hookHeadlines가 합류할 수 있어 최대 8개.
   */
  headlineCandidates?: string[]
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
  /**
   * v3.5: AI 리서치 요약 (선택). 결과 화면 접이식 패널(아트보드 밖)에만 노출 —
   * JPG/아트보드에는 절대 포함하지 않는다. 리서치 미사용/실패 시 undefined.
   * 카피 필드가 아니라 "이 카피의 근거 참고 정보"로만 취급.
   */
  research?: ResearchResult
  /**
   * 문제 제기 → 해결 서사 아크 (선택). WHY 카드 다음, Story 앞의 ProblemArcBlock이 렌더.
   * 공감 질문 + 구매 실패의 실제 원인 2~3개. keyPoints가 그 해결책으로 호응.
   * 하위호환: 구버전 저장본엔 없음(undefined) — 블록 미노출.
   */
  problemArc?: CopyProblemArc
  /**
   * v6.0(작업C): 동적 구성 힌트 (선택). AI가 근거 있을 때만 내는 히어로·콜아웃·포토브레이크 배치 판단.
   * ResultView가 결정적으로 소비(힌트 없으면 현행 100% 동일). copy와 함께 저장돼 재렌더 결정성 유지.
   * 하위호환: 구버전 저장본엔 없음(undefined) — 전 렌더 현행 폴백.
   */
  compositionHints?: CompositionHints
  /**
   * v6.2a: 섹션 제목 오버라이드 맵 (선택) — AI가 "상품 맥락이 자연스럽게 배어들 때만"
   * 다시 쓴 섹션 제목(예: 자두 → "새콤달콤이 꽉 찬 이유"). 키는 SectionTitleKey 화이트리스트의
   * 안정 문자열, 값은 그 섹션 제목 문구. 억지 변주가 아니라 자신 있을 때만 채우고, 없으면 생략.
   *
   * ⚠️ 렌더 소비는 후속(v6.2b) — 이번엔 스키마·생성·검증만이라 미소비 상태로 무해하다.
   *   옵셔널이라 renderer가 이 맵을 아직 읽지 않아도 기존 고정 문구가 그대로 폴백된다(회귀 0).
   * 검증: validate.pickSectionTitles가 키 화이트리스트 + 길이 상한(길이 순증 방지) +
   *   금지어(효능·질병·최상급)로 거른다.
   * 하위호환: 구버전 저장본엔 없음(undefined) — 전부 기본 문구로 렌더.
   */
  sectionTitles?: Partial<Record<SectionTitleKey, string>>
  /**
   * v4.0: 고정 문구(섹션 제목·오버라인·아이콘 트리오 라벨·4단계 스텝·배송/교환/주의
   * 보일러플레이트·사진 캡션·CTA·클로징 서명 등) 인라인 편집 오버라이드 저장소.
   * 키는 렌더 위치 기준 안정 문자열(예: "sect.spec.title", "returns.body",
   * "flow.step1.title", "gallery.caption.0", "cta.top", "closing.note").
   * 값이 있으면 기본 문구 대신 그 값을 렌더하고, 빈 값이면 키를 삭제해 기본 문구로 복귀한다.
   * 하위호환: 구버전 저장본엔 없음(undefined) — 전부 기본 문구로 렌더.
   * 검수: compliance-report가 이 값들도 식약처 금지어·산지 불일치 스캔 대상에 포함한다.
   */
  textOverrides?: Record<string, string>
}

export interface UsageInfo {
  inputTokens: number
  outputTokens: number
  estimatedCostKRW: number
  truncated: boolean
  /** v3.5: web_search 도구 호출 횟수(리서치 단계). 미사용 시 0. 비용 추정에 합산. */
  webSearchRequests?: number
}

export interface CopyResult {
  output: CopyOutput
  usage: UsageInfo
  modelId: ModelId
}

/* ───────────────── v4.4: 사진 분석 (vision) ───────────────── */

/**
 * v4.4: 업로드 사진 1장의 분석 결과.
 * 생성 시 Claude vision 1콜로 사진을 훑어 히어로 선정·섹션 매칭·갤러리 순서·
 * 사실 기반 캡션의 재료를 만든다. **관찰 메모지, 사실값이 아니다** —
 * visibleNote 는 카피의 산지·당도·품종 같은 "사실값"으로 승격되지 않는다.
 *
 * 하위호환: 구버전 저장본엔 없음(Work.photoAnalysis undefined) — 소비 측이 폴백.
 */
export interface PhotoAnalysisItem {
  /** 분석 대상 사진 id — 업로드 사진과 1:1 매칭용(호출부가 부여한 값 그대로). */
  imageId: string
  /**
   * 사진 역할 분류:
   * - hero: 대표컷 후보 (원물이 꽉 차고 선명·밝은 상단용 사진)
   * - cut: 자른 단면·과육 클로즈업 (속살)
   * - whole: 원물 통째 (자르지 않은 전체)
   * - box: 포장·박스·구성 (배송/선물 포장, 담긴 구성)
   * - size: 크기 비교 (손·동전·자 등과 함께)
   * - farm: 농장·밭·나무·수확 현장
   * - table: 상차림·연출 (그릇·식탁·요리 스타일링)
   */
  role: "hero" | "cut" | "whole" | "box" | "size" | "farm" | "table"
  /** 대표컷 적합도 0~10 (선명·구도·원물중심·밝기 종합). 높을수록 히어로 후보. */
  heroScore: number
  /** 초점 안 맞음/흔들림 등으로 뭉개진 사진. */
  blurry?: boolean
  /** 전반적으로 어둡거나 노출 부족. */
  dark?: boolean
  /**
   * "사진에 실제로 보이는 것" 한 줄 (≤60자). 색·개수·배경·잘림·포장 형태 등
   * 눈에 보이는 관찰만. 품종·산지·당도·수확일·맛·신선도 추정 절대 금지
   * (사진만으로 알 수 없는 것은 관찰이 아님 — 카피 사실값으로 승격 금지).
   */
  visibleNote: string
  /**
   * v5.1: 과일/상품 주체의 사진 내 위치(바운딩 박스). 좌상단 기준 0~1 정규화
   * (x=왼쪽에서, y=위에서, w=너비, h=높이). ResultView 가 CSS 크롭(중심 맞춤·
   * 확대)에 쓴다 — 관찰 메모지, 사실값이 아니다.
   * 하위호환: 주체가 프레임 대부분(≥85%)이거나 불확실하거나 사람 얼굴·글자 위주
   * 사진이면 생략(undefined) — 소비 측이 원본 그대로 폴백.
   */
  subjectBox?: { x: number; y: number; w: number; h: number }
}

/** v4.4: 사진 분석 전체 결과 — 사진별 항목 + 토큰/비용(선택). */
export interface PhotoAnalysisResult {
  items: PhotoAnalysisItem[]
  usage?: UsageInfo
}

/* ───────────────── v5.1: 자가 검수 (self-review, vision) ───────────────── */

/**
 * v5.1: 완성된 아트보드(JPG 세그먼트)를 AI가 셀러 눈높이로 훑어 남긴 시각 위생 지적 1건.
 * 오직 "눈에 보이는 완성도"만 평가한다 — 오타·문구 내용·사실 여부는 판단하지 않는다
 * (사실/식약처 검수는 compliance-report 담당).
 * - severity: 심각도 (high/medium/low).
 * - area: 문제가 있는 구간 설명 (비개발자 셀러가 알아볼 표현 — 예: "맨 위 대표 이미지",
 *   "포인트 03 카드", "하단 배송 안내").
 * - message: 셀러가 바로 이해할 한국어 지적 한 줄 (개발 용어 금지).
 * - suggestion: 앱에서 바로 실행 가능한 조치 (선택 — 예: "사진 순서 변경", "무드 변주 전환",
 *   "해당 사진 교체", "문구 축약").
 */
export interface SelfReviewIssue {
  severity: "high" | "medium" | "low"
  area: string
  message: string
  suggestion?: string
}

/**
 * v5.1: 자가 검수 전체 결과 — 지적 목록(0~6건) + 잘한 점 한 줄(overall) + 토큰/비용(선택).
 * 반환 규칙(v5.1.1): 검수 미사용/실패/형식 위반이면 어댑터가 null 반환(패널 미노출).
 * AI가 '지적 없음'을 명시한 정상 응답은 issues:[] 로 반환 — 패널이 '깨끗함'을 렌더한다.
 */
export interface SelfReviewResult {
  issues: SelfReviewIssue[]
  overall: string
  usage?: UsageInfo
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

/**
 * 핵심 키워드 추천 결과.
 * 상품명/카테고리/산지 등 기본 정보로 한국 셀러가 자주 쓰는 짧은 키워드(2~6자) 5~8개.
 * 사용자는 받은 후보를 customKeywords로 추가할 수 있다.
 */
export interface SuggestKeywordsResult {
  /** 추천 핵심 키워드 5~8개. 2~6자 짧은 명사/명사구. */
  keywords: string[]
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

  /**
   * 과일/야채 카피 생성.
   * v6.0(작업R⑤): photoAnalysisPromise(선택) — 병렬로 시작한 사진 분석 Promise를 넘기면
   *   draft 프롬프트에 "사진에 보이는 것" 요약을 주입한다. 미전달·null·실패 시 주입 없음(회귀 0).
   */
  generateCopy(
    input: CopyInput,
    photoAnalysisPromise?: Promise<PhotoAnalysisResult | null>,
  ): Promise<CopyResult>

  /** 입력 폼 기본 정보로 소구점(체크박스 추천 후보) 자동 생성 */
  suggestSellingPoints(input: SuggestPointsInput): Promise<SuggestPointsResult>

  /** 입력 폼 기본 정보로 핵심 키워드(2~6자) 5~8개 추천 — SEO·해시태그·검색노출용 */
  suggestKeywords(input: SuggestPointsInput): Promise<SuggestKeywordsResult>

  /**
   * v4.4: 업로드 사진(512px 다운스케일 JPEG dataURL)들을 vision 1콜로 분석해
   * 사진별 역할·품질·"보이는 것" 메모를 만든다 — 히어로 선정·섹션 매칭·갤러리
   * 순서·사실 기반 캡션의 재료. 어떤 실패든(파싱·API·빈응답) null 을 반환하고,
   * 절대 throw 로 생성 흐름을 막지 않는다. 사진이 없으면 null.
   */
  analyzePhotos(
    photos: { id: string; dataUrl: string }[],
    context: { productType: string; category: string },
  ): Promise<PhotoAnalysisResult | null>

  /**
   * v5.1: 완성된 아트보드 세그먼트(JPG dataURL)들을 vision 1콜로 훑어
   * 셀러 눈높이의 시각 위생 지적 2~6건 + 잘한 점 한 줄(overall)을 만든다.
   * 관점 5개: 여백·정렬 / 사진 품질·배치(어둡거나 흐린 사진) / 텍스트 겹침·잘림 /
   * 색 부조화 / 섹션 리듬·반복감. 오타·문구 내용·사실 판정은 하지 않는다(시각만).
   *
   * **어떤 실패든(빈 입력·API 에러·빈 응답·JSON 파싱 실패·유효 지적 0개) null 반환.**
   * 절대 throw 로 흐름을 막지 않는다 — 자가 검수는 선택적 부가 신호일 뿐.
   */
  reviewArtboard(
    segments: { label: string; dataUrl: string }[],
    context: { productType: string },
  ): Promise<SelfReviewResult | null>
}

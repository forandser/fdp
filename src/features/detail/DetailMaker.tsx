"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import { ImageUploader, SingleSlotUploader, type UploadedImage } from "./ImageUploader"
import { KeywordPicker } from "./KeywordPicker"
import { ResultView, emptyCopy, type LayoutVariant } from "./ResultView"
import { SeasonHint } from "./SeasonHint"
import { SellingPointsSuggester } from "./SellingPointsSuggester"
import { SHELL_COLOR, RADIUS } from "./shell-theme"
import { SelfReviewPanel } from "./SelfReviewPanel"
import { getAIProvider, classifyError, type DiagnosticStatus } from "@/lib/ai/provider"
import { ApiKeyGate } from "@/features/api-key/ApiKeyGate"
import { getKeySource } from "@/lib/ai/key-source"
import { captureArtboardSegments } from "@/lib/exporters/artboard-segments"
import type {
  CopyInput,
  CopyOutput,
  CopySpec,
  CopyTone,
  PhotoAnalysisItem,
  PhotoAnalysisResult,
  ProductCategory,
  ReviewStats,
  SelfReviewResult,
  SellerReview,
  TrustInfo,
  TypoVerifyResult,
  UsageInfo,
} from "@/lib/ai/types"
import {
  regenerateSection,
  mergeSection,
  type SectionId,
} from "@/lib/ai/section-regenerate"
import {
  saveWork,
  newWorkId,
  makeThumbDataUrl,
  getWork,
  getLatestWork,
  type Work,
} from "@/lib/storage/works-db"
import {
  getDraft,
  saveDraftMeta,
  saveDraftPhotos,
  deleteDraft,
  computePhotoSig,
  type DraftForm,
  type DraftPhotos,
} from "@/lib/storage/draft-db"
import { PRESET_KEYWORDS } from "@/domain/keywords"
import { getEnhancedUrl } from "@/lib/image-enhance/enhance-runner"
import { t } from "@/lib/i18n"
import { validateProductNameSeo } from "@/lib/ai/validate"
// v5.9(작업L): 결정적 카피 린터 — 생성 직후 실행해 경고 배너로 노출.
import { lintCopyOutput, type CopyLintFinding } from "@/lib/ai/copy-lint"
import { detectFruitFactKey, FRUIT_FACTS } from "@/domain/fruit-facts"
// v6.3(작업4): AI 타이포 히어로 — 축색(프롬프트 accent)·Gemini provider(BYOK)·순수 프롬프트 유틸.
import { resolveAccent } from "./fruit-accent"
import {
  getImageProvider,
  getSavedImageProviderConfig,
} from "@/lib/ai/image-providers/registry"
import { buildFruitMoodHints, buildTypoPrompt } from "@/lib/ai/typo-headline"
import { DEMO_COPY } from "./demo-copy"
import { BrandKitPanel } from "./BrandKitPanel"
import {
  listBrands,
  getDefaultBrandId,
  toSnapshot,
  type BrandProfile,
  type BrandSnapshot,
} from "@/lib/storage/brand-db"

type Stage = "restoring" | "input" | "generating" | "result" | "error"

const EXTRA_DESC_PREFIX = "상품 추가 설명: "

const PRESET_LABEL_SET = new Set(PRESET_KEYWORDS.map((k) => k.label))

/** 좌/우 분할 분기점 (px). 이 아래는 적층 레이아웃. */
const SPLIT_BREAKPOINT = 1280

async function blobToUploadedImage(
  blob: Blob,
  idx: number,
  preferredId?: string,
): Promise<UploadedImage | null> {
  if (typeof window === "undefined") return null
  try {
    const type = blob.type || "image/jpeg"
    const ext = type.includes("png") ? "png" : "jpg"
    const file = new File([blob], `restored-${idx}.${ext}`, { type })
    const url = URL.createObjectURL(file)
    const dims = await new Promise<{ width: number; height: number }>((resolve, reject) => {
      const img = new window.Image()
      img.onload = () => resolve({ width: img.naturalWidth, height: img.naturalHeight })
      img.onerror = () => {
        URL.revokeObjectURL(url)
        reject(new Error("img load"))
      }
      img.src = url
    })
    return {
      // v4.4: 저장된 원본 upload id 를 그대로 되살린다(있을 때). 없으면 신규 restored id.
      //   이 정합이 있어야 복원 후에도 photoAnalysis[].imageId 가 매칭된다(재분석 캐시·배치·캡션).
      id: preferredId && preferredId.trim() ? preferredId : `restored-${Date.now()}-${idx}`,
      file,
      url,
      // 복원 직후엔 원본을 표시(url=rawUrl). 보정 ON이면 아래 동기화 effect가 보정본으로 스왑.
      rawUrl: url,
      ...dims,
    }
  } catch {
    return null
  }
}

/**
 * 단일 슬롯(포장/크기) 사진의 자동 보정 표시 상태를 토글에 맞춰 동기화.
 * - ON: 현재 원본을 표시 중이면(url===rawUrl) 보정본 URL로 스왑(캐시 dedup).
 * - OFF: 보정본을 표시 중이면 원본(rawUrl)으로 되돌림(재보정 없음).
 * setImages 계열과 동일하게, 변화가 없으면 이전 값을 그대로 반환해 불필요한 렌더/루프를 막는다.
 */
function syncSingleEnhance(
  img: UploadedImage | null,
  enabled: boolean,
  isCancelled: () => boolean,
  setImg: React.Dispatch<React.SetStateAction<UploadedImage | null>>,
): void {
  if (!img || !img.rawUrl) return
  if (enabled) {
    if (img.url !== img.rawUrl) return // 이미 보정본 표시 중
    const { id, file } = img
    void getEnhancedUrl(file)
      .then((enhUrl) => {
        if (isCancelled()) return
        setImg((cur) =>
          cur && cur.id === id && cur.file === file && cur.rawUrl && cur.url === cur.rawUrl
            ? { ...cur, url: enhUrl }
            : cur,
        )
      })
      .catch(() => {
        /* 보정 실패 시 원본 유지 */
      })
  } else {
    setImg((cur) =>
      cur && cur.rawUrl && cur.url !== cur.rawUrl ? { ...cur, url: cur.rawUrl } : cur,
    )
  }
}

const CATEGORY_OPTIONS: { value: ProductCategory; label: string }[] = [
  { value: "fruit", label: "🍑 과일" },
  { value: "veggie", label: "🥬 야채" },
  { value: "other", label: "그 외" },
]

const GENERATION_STEPS = [
  "이미지를 분석하고 있어요",
  "한국 신선식품 카피라이팅 패턴 적용 중",
  "헤드라인·스토리·스펙·FAQ 구성 중",
  "마무리 검토 중",
]

/** 입력값으로 임시 spec 배열 구성 — 실제 AI 결과가 없을 때 미리보기용. */
function buildLiveSpec(args: {
  origin: string
  variety: string
  weight: string
  brix: string
}): CopySpec[] {
  const spec: CopySpec[] = []
  if (args.origin.trim()) spec.push({ label: "산지", value: args.origin.trim() })
  if (args.variety.trim()) spec.push({ label: "품종", value: args.variety.trim() })
  if (args.weight.trim()) spec.push({ label: "중량", value: args.weight.trim() })
  if (args.brix.trim()) spec.push({ label: "당도", value: `${args.brix.trim()} Brix` })
  return spec
}

/**
 * v4.4: 사진 분석 입력용 512px 다운스케일 dataURL 생성.
 * img.url(원본/보정본 objectURL)을 fetch → bitmap → canvas → JPEG dataURL로 축소.
 * works-db의 makeThumbDataUrl 패턴을 따르되 maxSize 512·품질 0.8. 실패 시 null(해당 사진만 제외).
 */
async function toAnalysisDataUrl(url: string, maxSize = 512): Promise<string | null> {
  if (typeof window === "undefined") return null
  try {
    const res = await fetch(url)
    const blob = await res.blob()
    const bitmap = await createImageBitmap(blob)
    const scale = Math.min(1, maxSize / Math.max(bitmap.width, bitmap.height))
    const w = Math.max(1, Math.round(bitmap.width * scale))
    const h = Math.max(1, Math.round(bitmap.height * scale))
    const canvas = document.createElement("canvas")
    canvas.width = w
    canvas.height = h
    const ctx = canvas.getContext("2d")
    if (!ctx) {
      bitmap.close()
      return null
    }
    ctx.drawImage(bitmap, 0, 0, w, h)
    bitmap.close()
    return canvas.toDataURL("image/jpeg", 0.8)
  } catch {
    return null
  }
}

/**
 * v4.4: 기존 사진 분석이 현재 이미지 목록과 정확히 일치하는지(재분석 스킵 판단).
 * imageId 집합이 완전히 같을 때만 재사용 — 한 장이라도 추가/삭제/교체되면 재분석.
 */
function photoAnalysisMatchesImages(
  analysis: PhotoAnalysisItem[] | null,
  imgs: UploadedImage[],
): boolean {
  if (!analysis || analysis.length === 0 || imgs.length === 0) return false
  const analyzed = new Set(analysis.map((p) => p.imageId))
  if (analyzed.size !== imgs.length) return false
  for (const img of imgs) {
    if (!analyzed.has(img.id)) return false
  }
  return true
}

/** v4.4: 카피 생성 usage에 사진 분석 usage를 합산(비용 표시 투명성). extra 없으면 base 그대로. */
function mergeUsage(base: UsageInfo, extra?: UsageInfo): UsageInfo {
  if (!extra) return base
  const ws = (base.webSearchRequests ?? 0) + (extra.webSearchRequests ?? 0)
  return {
    inputTokens: base.inputTokens + extra.inputTokens,
    outputTokens: base.outputTokens + extra.outputTokens,
    estimatedCostKRW: base.estimatedCostKRW + extra.estimatedCostKRW,
    truncated: base.truncated || extra.truncated,
    webSearchRequests: ws > 0 ? ws : undefined,
  }
}

/**
 * v6.3: Promise.race 기반 타임아웃 — ms 초과 시 reject 한다(typoBusy 영구 고착 방지).
 * controller 를 주면 초과 시 abort 도 시도해 진행 중인 fetch 를 실제로 끊는다(불가하면 race 만으로도 흐름 해제).
 */
function withTimeout<T>(
  p: Promise<T>,
  ms: number,
  controller?: AbortController,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      try {
        controller?.abort()
      } catch {
        /* noop — abort 실패해도 아래 reject 로 흐름은 해제된다. */
      }
      reject(new Error(`timeout ${ms}ms`))
    }, ms)
    p.then(
      (v) => {
        clearTimeout(timer)
        resolve(v)
      },
      (e) => {
        clearTimeout(timer)
        reject(e)
      },
    )
  })
}

export function DetailMaker({
  initialWorkId,
  onKeyRegistered,
}: {
  initialWorkId?: string
  /** v5.4(작업1): 모달로 키를 등록했을 때 부모(헤더 마스크 등)에 알린다. */
  onKeyRegistered?: () => void | Promise<void>
}) {
  const [stage, setStage] = useState<Stage>(initialWorkId ? "restoring" : "input")
  const [images, setImages] = useState<UploadedImage[]>([])
  /**
   * v3.7: 포장·크기비교 전용 슬롯 사진 — 일반 풀(images)과 분리 관리한다.
   * planImages에 넣지 않고 ResultView에 별도 prop으로 전달한다.
   * - packagingImage 없으면 PackagingBlock 섹션 자체 미노출(풀 사진 대체 금지).
   * - sizeImage 있으면 크기 섹션에 사진 렌더, 없으면 기존 동작(무게 데이터만).
   */
  const [packagingImage, setPackagingImage] = useState<UploadedImage | null>(null)
  const [sizeImage, setSizeImage] = useState<UploadedImage | null>(null)
  const [category, setCategory] = useState<ProductCategory>("fruit")
  const [productName, setProductName] = useState("")
  const [variety, setVariety] = useState("")
  const [origin, setOrigin] = useState("")
  /**
   * 산지가 "예시 채우기"로 채워졌는지 표시 — 실제 산지가 아닌 참고 지역명이므로
   * 셀러가 실제 산지로 바꾸도록 힌트를 띄운다(허위 표시 방지). 사용자가 직접
   * 산지를 수정하면 해제한다.
   */
  const [originFromDemo, setOriginFromDemo] = useState(false)
  const [weight, setWeight] = useState("")
  const [brix, setBrix] = useState("")
  const [sizeGrade, setSizeGrade] = useState("")
  const [extraDescription, setExtraDescription] = useState("")
  const [farmIntro, setFarmIntro] = useState("")
  const [producerName, setProducerName] = useState("")
  const [producerRegion, setProducerRegion] = useState("")
  const [farmerYears, setFarmerYears] = useState("")
  /** 운영 방식 체크 — 실제로 지키는 약속만 페이지에 표시(허위광고 방지). */
  const [sameDayHarvest, setSameDayHarvest] = useState(false)
  const [coldChain, setColdChain] = useState(false)
  const [refundGuarantee, setRefundGuarantee] = useState(false)
  /**
   * 고객 후기 — 셀러가 실제 받은 후기만 직접 입력(AI 생성 금지). 최대 3개.
   * 저장/복원 하위호환: 구버전 저장본엔 input.reviews 없음(옵셔널).
   */
  const [reviews, setReviews] = useState<SellerReview[]>([])
  /**
   * v5.8(작업①): 후기 집계 입력(선택) — 폼은 문자열로 보관(빈칸 허용), 저장/렌더 직전 숫자 정규화.
   * 스토어에서 실제 집계된 값만 입력. 하나도 없으면 스트립 미렌더(허위·자동채움 금지).
   */
  const [reviewStats, setReviewStats] = useState<ReviewStatsForm>({
    totalCount: "",
    fiveStarPct: "",
    repurchase: "",
  })
  const [presetKeywords, setPresetKeywords] = useState<string[]>([])
  const [customKeywords, setCustomKeywords] = useState<string[]>([])
  /**
   * v3.5: AI 리서치 모드 토글 — 기본 ON. localStorage "fdp:research-enabled"에 저장.
   * 생성 시 web_search로 품종 일반 참고 정보를 조사해 카피 깊이를 높인다(회당 약 30~70원·10~20초 추가).
   */
  const [researchEnabled, setResearchEnabled] = useState(true)
  /**
   * 사진 자동 보정 토글 — 기본 ON. Work 레코드(enhanceImages)에 저장·복원.
   * ON이면 업로드/복원된 이미지의 url을 보정본으로 스왑, OFF면 원본 유지.
   * 저장 blob은 항상 원본(보정본 저장 안 함 → 알고리즘 개선 시 재적용 가능).
   */
  const [enhanceImages, setEnhanceImages] = useState(true)
  /**
   * v4.4: 사진 분석 토글 — 기본 ON. Work 레코드(photoAnalysisEnabled)에 저장·복원.
   * ON이면 생성 시 리서치와 병렬로 AI가 사진을 보고 역할·대표컷·품질을 분석한다.
   */
  const [photoAnalysisEnabled, setPhotoAnalysisEnabled] = useState(true)
  /**
   * v4.4: 마지막 사진 분석 결과 — 생성 시 채워지고 ResultView 배치 로직에 전달.
   * 복원 시 Work.photoAnalysis로 채운다. 같은 사진 재생성 시 재분석 스킵 캐시로도 쓰인다.
   * 분석 실패/OFF면 null → ResultView가 순서 기반 로직으로 폴백.
   */
  const [photoAnalysis, setPhotoAnalysis] = useState<PhotoAnalysisItem[] | null>(null)
  /**
   * v4.6: 레이아웃 무드 변주 — 기본 "standard"(기존 렌더와 픽셀 동일). Work(layoutVariant)에
   * 저장·복원. 결과 화면에서 즉시 전환되며 섹션 순서·게이팅·카피는 불변, 디자인 토큰만 달라진다.
   */
  const [layoutVariant, setLayoutVariant] = useState<LayoutVariant>("standard")
  /**
   * v6.1(작업E2): 셀러가 숨긴 섹션 id 목록. Work(hiddenSections)에 저장·복원.
   * ResultView 가 이 목록의 섹션을 렌더 트리에서 제거(JPG·총높이에서 소멸)한다.
   * 카피가 아니라 편집 상태이므로 copy 와 분리 — 전체 재생성(copy 교체)에도 유지된다.
   */
  const [hiddenSections, setHiddenSections] = useState<string[]>([])
  /**
   * v6.3(작업3·4): AI 타이포 히어로 상태.
   * - typoHeadlineBlob: 확정 헤드라인을 Gemini 로 그린 한글 레터링 이미지(Work 에 저장·복원).
   * - typoHeadlineUrl: 위 blob 의 objectURL(HeroBlock 렌더용). typoUrlRef 로 수명 관리(언마운트 해제).
   * - typoBusy/typoError: 생성 진행·원인별 실패 문구.
   * - hasGeminiKey: "✨ 헤드라인 아트" 블록 노출 게이트(나노바나나 키 등록 시에만).
   * 하이드레이션: 서버 기본값(null/false)으로 시작하고 마운트 effect 가 동기화(결정성 — Math.random/Date 금지).
   */
  const [typoHeadlineBlob, setTypoHeadlineBlob] = useState<Blob | null>(null)
  const [typoHeadlineUrl, setTypoHeadlineUrl] = useState<string | null>(null)
  const [typoBusy, setTypoBusy] = useState(false)
  const [typoError, setTypoError] = useState<string | null>(null)
  const [hasGeminiKey, setHasGeminiKey] = useState(false)
  const typoUrlRef = useRef<string | null>(null)
  /**
   * v6.3: 타이포 생성 중복 실행 동기 가드(useRef — state 는 비동기라 연타 시 이중 파이프라인 발생).
   * 함수 진입 즉시 검사·세팅하고 finally 에서 해제한다. setTypoBusy 는 UI 표시 전용으로 병행.
   */
  const typoBusyRef = useRef(false)
  /**
   * v5.0-B: "우리 가게" 브랜드 배선.
   * - brands/defaultBrandId: 패널 표시용 목록·기본 지정(부모가 소유·재로딩).
   * - selectedBrandId: 현재 선택 프로필(신규 스냅샷의 원천).
   * - brandSnapshot: ResultView 로 넘어가고 Work 에 박제되는 값(단일 진실).
   * 복원 시 work.brandSnapshot 이 있으면 그것을 우선(스냅샷 불변 — 프로필 목록과 무관).
   */
  const [brands, setBrands] = useState<BrandProfile[]>([])
  const [defaultBrandId, setDefaultBrandId] = useState<string | null>(null)
  const [selectedBrandId, setSelectedBrandId] = useState<string | null>(null)
  const [brandSnapshot, setBrandSnapshot] = useState<BrandSnapshot | null>(null)
  /**
   * 복원된 작업이 자체 박제 스냅샷을 실었는지. true 면 초기 기본-프로필 자동선택이
   * 그 스냅샷을 덮어쓰지 않는다(불변). 사용자가 프로필을 직접 고르면 해제된다.
   */
  const brandFromWorkRef = useRef(false)
  /**
   * 복원 결정(스냅샷 유무)이 끝났는지 — 기본 프로필 자동선택이 복원보다 앞질러
   * 스냅샷을 덮어쓰지 않도록 게이트. initialWorkId 없으면 즉시 resolved.
   */
  const [brandRestoreResolved, setBrandRestoreResolved] = useState(() => !initialWorkId)
  const tone: CopyTone = "sincere"
  /** v2.7: 게이트 UI 삭제. 내부 상수 true 유지 (API 안전망 / 규칙 5 준수) */
  const isOrdinaryProduce = true
  /** 현재 입력에서 합성한 trust 객체 — 미리보기/SellingPointsSuggester에 인입. */
  const trustForPreview: TrustInfo = useMemo(() => {
    const out: TrustInfo = {}
    if (producerName.trim()) out.producerName = producerName.trim()
    if (producerRegion.trim()) out.producerRegion = producerRegion.trim()
    if (farmerYears.trim()) out.farmerYears = Number(farmerYears) || undefined
    if (sameDayHarvest) out.sameDayHarvest = true
    if (coldChain) out.coldChain = true
    if (refundGuarantee) out.refundGuarantee = true
    return out
  }, [producerName, producerRegion, farmerYears, sameDayHarvest, coldChain, refundGuarantee])

  /** v5.8(작업①): 생성 전 미리보기용 후기 집계 — 폼 문자열을 정규화(유효 값만). */
  const previewReviewStats = useMemo(() => normalizeReviewStats(reviewStats), [reviewStats])

  /** 상품명 실시간 SEO 검증 — v1.9. */
  const seoCheck = useMemo(() => {
    if (!productName.trim()) return null
    return validateProductNameSeo(productName)
  }, [productName])

  /** 상품명에서 fruit-facts 매칭 — placeholder/힌트 풍부화. */
  const factHint = useMemo(() => {
    const key = detectFruitFactKey(productName)
    if (!key) return null
    const fact = FRUIT_FACTS[key]
    return {
      name: fact.name,
      goodBrix: fact.goodBrix,
      regions: fact.regions.slice(0, 3).join(", "),
      varieties: fact.varieties.slice(0, 3).map((v) => v.name).join(", "),
      storage: fact.storage.mode === "ripen-then-fridge"
        ? "후숙형 — 받자마자 냉장 X"
        : fact.storage.mode === "fridge"
          ? "도착 즉시 냉장"
          : "실온 보관",
    }
  }, [productName])

  /**
   * v2.0: 예시 채우기 한 클릭 — fruit-facts 기반 자동 채움.
   * 초보 셀러가 "이렇게 쓰면 되겠구나" 즉시 학습 + AI 생성 즉시 시도 가능.
   */
  const canFillDemo = useMemo(() => {
    const key = detectFruitFactKey(productName)
    return !!key
  }, [productName])

  const handleFillDemo = () => {
    const key = detectFruitFactKey(productName)
    if (!key) return
    const fact = FRUIT_FACTS[key]
    const firstVariety = fact.varieties[0]
    if (!variety.trim() && firstVariety) setVariety(firstVariety.name)
    // 산지는 빈 칸일 때만 예시 지역명으로 채우고, 예시값임을 표시(실제 산지로 교체 유도).
    if (!origin.trim() && fact.regions[0]) {
      setOrigin(fact.regions[0])
      setOriginFromDemo(true)
    }
    if (!weight.trim()) {
      const kg =
        fact.category === "fruit"
          ? fact.name === "수박" || fact.name === "멜론"
            ? "1통"
            : "3kg 한 박스"
          : "1kg"
      setWeight(kg)
    }
    if (!brix.trim()) setBrix(String(fact.goodBrix))
    if (!sizeGrade.trim()) setSizeGrade("특")
    if (!farmIntro.trim() && fact.hookHeadlines[0]) setFarmIntro(fact.hookHeadlines[0])
    // 추가 설명에 감각어 살짝
    if (!extraDescription.trim() && fact.sensoryWords.length > 0) {
      setExtraDescription(
        `강조 포인트:\n- ${fact.sensoryWords.slice(0, 3).join(" / ")}\n- ${fact.hookHeadlines.slice(1, 3).join("\n- ")}`,
      )
    }
    // 농부 정보 예시
    if (!producerName.trim()) setProducerName("김 농부")
    if (!producerRegion.trim() && fact.regions[0]) setProducerRegion(fact.regions[0])
    if (!farmerYears.trim()) setFarmerYears("20")
  }
  const [generationStep, setGenerationStep] = useState(0)
  const [errorMsg, setErrorMsg] = useState<string | null>(null)
  /**
   * v5.4(작업3): 생성·재생성 실패 원인(classifyError 결과). null이면 에러 없음.
   * "ok"는 넣지 않는다 — 배너 문구는 실패 상태에서만 뜬다.
   */
  const [genError, setGenError] = useState<DiagnosticStatus | null>(null)
  /** v5.4(작업1): AI 필요 동작 클릭 시 뜨는 키 등록 모달 표시 여부. */
  const [keyGateOpen, setKeyGateOpen] = useState(false)
  /** 모달 결과를 기다리는 Promise resolver — 등록 성공(true)/취소(false)로 대기 중 동작을 이어가거나 중단. */
  const keyGateResolveRef = useRef<((ok: boolean) => void) | null>(null)
  /** 마지막으로 시도한 AI 동작 — 에러 배너의 '다시 시도'·키 재등록 후 이어가기에 재실행. */
  const lastActionRef = useRef<(() => void | Promise<void>) | null>(null)
  const [result, setResult] = useState<CopyOutput | null>(null)
  const [resultMeta, setResultMeta] = useState<{
    priceNum: number
    productName: string
    origin: string
    weight: string
  } | null>(null)
  /** 결과 받은 시점의 입력 — 섹션 재생성에 재사용 */
  const [currentInput, setCurrentInput] = useState<CopyInput | null>(null)
  // v3.5: 마지막 생성의 토큰·검색 사용량 — 결과 화면에 비용 투명성 한 줄 표시용.
  const [lastUsage, setLastUsage] = useState<UsageInfo | null>(null)
  /** 섹션 재생성 진행 중인 섹션 (null이면 idle) */
  const [busySection, setBusySection] = useState<SectionId | null>(null)
  /**
   * v5.1: AI 자가 검수 — 세션 상태만(Work 저장 안 함, 카피 조치하면 낡음).
   * - reviewing: 캡처+검수 진행 중(버튼 disabled).
   * - reviewResult: 마지막 검수 리포트(패널 노출). 재생성/재시도/조치 시 초기화.
   * - reviewFailed: 캡처/검수 실패 알림(다시 시도 유도).
   * - reviewUsage: 검수 토큰/비용 누적(v5.1.1) — '이번 생성'(카피 생성) 비용과 분리해
   *   별도 라인에 표시. 재검수 클릭이 '이번 생성' 라인을 부풀리는 의미 오염을 막는다.
   */
  const [reviewing, setReviewing] = useState(false)
  const [reviewResult, setReviewResult] = useState<SelfReviewResult | null>(null)
  const [reviewFailed, setReviewFailed] = useState(false)
  const [reviewUsage, setReviewUsage] = useState<UsageInfo | null>(null)
  /**
   * v5.9(작업L): 결정적 카피 린터 위반 목록(세션 상태만) — 생성 직후·인라인 편집 후 갱신.
   * AI 호출 0회. 기존 검수 UI 흐름(reviewFailed 배너 인근)에 경고 배너로만 노출.
   */
  const [lintFindings, setLintFindings] = useState<CopyLintFinding[]>([])
  /** 현재 작업 ID — 저장/업데이트에 사용 */
  const [workId, setWorkId] = useState<string | null>(null)
  /** 복원 시 생성된 objectURL — 언마운트 시 일괄 해제 */
  const restoredUrlsRef = useRef<string[]>([])

  /**
   * v5.4(작업2): 재진입 시 발견한 초안 — 있으면 "이어서 하기" 배너를 띄운다(복원/버리기).
   * 배너가 떠 있는 동안엔 자동 저장을 멈춰(빈 폼이 초안을 덮어쓰지 않게) 복원 결정을 먼저 받는다.
   * 초안 시스템은 신규 작업(initialWorkId 없음)에서만 동작 — 기존 작업 편집엔 관여하지 않는다.
   */
  const draftEnabled = !initialWorkId
  const [draftBanner, setDraftBanner] = useState<{ savedAt: number } | null>(null)
  /** 초안 조회가 끝났는지 — 끝나기 전엔 자동 저장이 앞질러 초안을 덮지 않게 게이트. */
  const [draftChecked, setDraftChecked] = useState(!!initialWorkId)
  /** 마지막으로 DRAFT_PHOTOS 에 기록한 사진 서명 — 같으면 사진 재기록 스킵(대용량 반복 방지). */
  const lastPhotoSigRef = useRef<string | null>(null)
  /** 자동 저장 디바운스 타이머. */
  const draftTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  /**
   * v5.4(작업5): "지난 설정 이어받기" 원천 — 최근 작업 전체(가게 공통 필드 읽기용).
   * 빈 폼 + 최근 작업 존재 시에만 배너를 띄운다. 초안 배너가 우선(둘 다 있으면 초안만).
   */
  const [carrySource, setCarrySource] = useState<Work | null>(null)
  const [carryApplied, setCarryApplied] = useState(false)
  /**
   * 지난 작업에서 켜져 있던 신뢰 약속 — 자동 적용 금지(허위표시 방지). 켰던 항목을 보여주되
   * 셀러가 직접 켜도록 TrustPromiseChecks 에 힌트로만 전달한다.
   */
  const [carriedTrust, setCarriedTrust] = useState<{
    sameDayHarvest: boolean
    coldChain: boolean
    refundGuarantee: boolean
  } | null>(null)

  /**
   * 데스크탑(>=1280) 좌우 분할 여부.
   * v5.4 하이드레이션 수정: 초기값에서 innerWidth를 읽으면 프리렌더 HTML(서버 true)과
   * 좁은 클라이언트 첫 렌더가 어긋난다(키 게이트 제거로 이 트리가 처음 SSG 대상이 됨).
   * 서버 기본값(true)으로 시작하고, 아래 effect의 onResize()가 마운트 직후 동기화한다.
   */
  const [isWide, setIsWide] = useState(true)

  useEffect(() => {
    if (typeof window === "undefined") return
    const onResize = () => setIsWide(window.innerWidth >= SPLIT_BREAKPOINT)
    onResize()
    window.addEventListener("resize", onResize)
    return () => window.removeEventListener("resize", onResize)
  }, [])

  /** v3.5: 리서치 토글 localStorage 복원 — 저장값이 "0"이면 OFF, 그 외/미설정이면 기본 ON. */
  useEffect(() => {
    if (typeof window === "undefined") return
    try {
      const saved = window.localStorage.getItem("fdp:research-enabled")
      if (saved === "0") setResearchEnabled(false)
    } catch {
      /* localStorage 접근 불가(프라이빗 모드 등) — 기본 ON 유지 */
    }
  }, [])

  /** v3.5: 리서치 토글 변경 시 localStorage 저장. */
  const handleResearchToggle = (next: boolean) => {
    setResearchEnabled(next)
    try {
      window.localStorage.setItem("fdp:research-enabled", next ? "1" : "0")
    } catch {
      /* 저장 실패는 무시 */
    }
  }

  useEffect(() => {
    if (!initialWorkId) return
    let cancelled = false
    void (async () => {
      try {
        const work = await getWork(initialWorkId)
        if (!work || cancelled) {
          if (!cancelled) setStage("input")
          return
        }
        const restored: UploadedImage[] = []
        for (let i = 0; i < work.imageBlobs.length; i++) {
          const blob = work.imageBlobs[i]
          if (!blob) continue
          // v4.4: 저장된 이미지 id 를 그대로 복원(imageBlobs 와 같은 인덱스)해 photoAnalysis 와 정합.
          const img = await blobToUploadedImage(blob, i, work.imageIds?.[i])
          if (img) {
            restored.push(img)
            restoredUrlsRef.current.push(img.url)
          }
        }
        // v3.7: 전용 슬롯 사진 복원 — 구버전 저장본엔 필드 없음(옵셔널·하위호환).
        let restoredPackaging: UploadedImage | null = null
        if (work.packagingBlob) {
          const img = await blobToUploadedImage(work.packagingBlob, 1000)
          if (img) {
            restoredPackaging = img
            restoredUrlsRef.current.push(img.url)
          }
        }
        let restoredSize: UploadedImage | null = null
        if (work.sizeBlob) {
          const img = await blobToUploadedImage(work.sizeBlob, 1001)
          if (img) {
            restoredSize = img
            restoredUrlsRef.current.push(img.url)
          }
        }
        // v6.3(작업3): 타이포 헤드라인 이미지 복원 — 구버전 저장본엔 없음(옵셔널·하위호환).
        //   objectURL 은 typoUrlRef + restoredUrlsRef 로 수명 관리(언마운트 일괄 해제).
        let restoredTypoBlob: Blob | null = null
        let restoredTypoUrl: string | null = null
        if (work.typoHeadlineBlob && typeof window !== "undefined") {
          try {
            restoredTypoUrl = URL.createObjectURL(work.typoHeadlineBlob)
            restoredTypoBlob = work.typoHeadlineBlob
            restoredUrlsRef.current.push(restoredTypoUrl)
          } catch {
            restoredTypoBlob = null
            restoredTypoUrl = null
          }
        }
        if (cancelled) {
          restoredUrlsRef.current.forEach((u) => URL.revokeObjectURL(u))
          restoredUrlsRef.current = []
          return
        }

        const input = work.input
        const preset: string[] = []
        const custom: string[] = []
        let extra = ""
        for (const kw of input.highlightKeywords || []) {
          if (kw.startsWith(EXTRA_DESC_PREFIX)) {
            extra = kw.slice(EXTRA_DESC_PREFIX.length)
          } else if (PRESET_LABEL_SET.has(kw)) {
            preset.push(kw)
          } else {
            custom.push(kw)
          }
        }

        setImages(restored)
        setPackagingImage(restoredPackaging)
        setSizeImage(restoredSize)
        // v6.3(작업3): 타이포 헤드라인 복원(있으면). typoUrlRef 로 이후 교체·언마운트 해제.
        typoUrlRef.current = restoredTypoUrl
        setTypoHeadlineBlob(restoredTypoBlob)
        setTypoHeadlineUrl(restoredTypoUrl)
        // 사진 자동 보정 토글 복원 — 구버전 저장본엔 없음(undefined → 기본 ON, 하위호환).
        setEnhanceImages(work.enhanceImages ?? true)
        // v4.4: 사진 분석 토글·결과 복원 — 구버전 저장본엔 없음(undefined → 기본 ON, 하위호환).
        setPhotoAnalysisEnabled(work.photoAnalysisEnabled ?? true)
        setPhotoAnalysis(work.photoAnalysis ?? null)
        // v4.6: 레이아웃 변주 복원 — 구버전 저장본엔 없음(undefined → "standard", 하위호환).
        setLayoutVariant(work.layoutVariant ?? "standard")
        // v6.1(작업E2): 숨긴 섹션 목록 복원 — 구버전 저장본엔 없음(undefined → 전 섹션 노출, 하위호환).
        //   문자열만 통과(손상 저장본 방어). 미지 id 가 섞여도 매칭 섹션이 없어 무해.
        setHiddenSections(
          Array.isArray(work.hiddenSections)
            ? work.hiddenSections.filter((x): x is string => typeof x === "string")
            : [],
        )
        // v5.0-B: 작업에 박제된 브랜드 스냅샷 복원(있으면 우선 — 불변, 프로필 목록과 무관).
        //   구버전 저장본엔 없음(옵셔널 — 하위호환). ref 를 세워 기본-프로필 자동선택이 덮지 않게 한다.
        if (work.brandSnapshot) {
          setBrandSnapshot(work.brandSnapshot)
          brandFromWorkRef.current = true
        }
        setCategory(input.category)
        setProductName(input.productType)
        setVariety(input.variety ?? "")
        setOrigin(input.origin ?? "")
        setWeight(input.weight ?? "")
        setBrix(input.brix != null ? String(input.brix) : "")
        setFarmIntro(input.farmIntro ?? "")
        // 운영 방식 체크 복원 (구버전 저장본엔 trust 없음 — 하위호환)
        setProducerName(input.trust?.producerName ?? "")
        setProducerRegion(input.trust?.producerRegion ?? "")
        setFarmerYears(input.trust?.farmerYears != null ? String(input.trust.farmerYears) : "")
        setSameDayHarvest(!!input.trust?.sameDayHarvest)
        setColdChain(!!input.trust?.coldChain)
        setRefundGuarantee(input.trust?.refundGuarantee === true)
        // 고객 후기 복원 — 구버전 저장본엔 없음(하위호환).
        setReviews(
          Array.isArray(input.reviews)
            ? input.reviews.filter((r) => r && typeof r.text === "string")
            : [],
        )
        // v5.8(작업①): 후기 집계 복원 — 구버전 저장본엔 없음(하위호환). 숫자→문자열 폼으로.
        setReviewStats({
          totalCount: input.reviewStats?.totalCount != null ? String(input.reviewStats.totalCount) : "",
          fiveStarPct: input.reviewStats?.fiveStarPct != null ? String(input.reviewStats.fiveStarPct) : "",
          repurchase: input.reviewStats?.repurchase ?? "",
        })
        setExtraDescription(extra)
        setPresetKeywords(preset)
        setCustomKeywords(custom)
        setWorkId(work.id)
        setCurrentInput(input)

        if (work.copy) {
          setResult(work.copy)
          setResultMeta({
            priceNum: 0,
            productName: input.productType,
            origin: input.origin,
            weight: input.weight,
          })
          setStage("result")
        } else {
          setStage("input")
        }
      } catch (e) {
        console.error("[restoreWork]", e)
        if (!cancelled) setStage("input")
      } finally {
        // v5.0-B: 복원 결정 완료 통지 — 기본 프로필 자동선택 게이트 해제(브랜드 초기화 effect 실행).
        if (!cancelled) setBrandRestoreResolved(true)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [initialWorkId])

  useEffect(() => {
    const ref = restoredUrlsRef
    const typoRef = typoUrlRef
    return () => {
      ref.current.forEach((u) => URL.revokeObjectURL(u))
      ref.current = []
      // v6.3(작업3): 타이포 헤드라인 objectURL 도 언마운트 시 해제(누수 방지).
      if (typoRef.current) {
        URL.revokeObjectURL(typoRef.current)
        typoRef.current = null
      }
    }
  }, [])

  /**
   * v6.3(작업4): "✨ 헤드라인 아트" 블록 노출 게이트 — 나노바나나(Gemini) 키 등록 여부.
   * 하이드레이션 안전: 서버 기본값 false 로 시작하고 마운트 후 IDB 설정을 읽어 동기화한다.
   * 결정성: 렌더 중 Math.random/Date 미사용 — 이 값은 마운트 effect 로만 갱신된다.
   */
  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const cfg = await getSavedImageProviderConfig()
        if (cancelled) return
        setHasGeminiKey(cfg?.providerId === "gemini-2.5-flash-image" && !!cfg.apiKey)
      } catch {
        /* 설정 조회 실패는 무시 — 블록 미노출(안전) */
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  /**
   * v5.0-B: 브랜드 초기화 — 복원 결정(brandRestoreResolved) 후 1회.
   * 목록·기본값을 로드하고, 복원 스냅샷이 없을 때만 기본 프로필을 자동 선택해 스냅샷을 만든다.
   * 복원 스냅샷이 있으면(brandFromWorkRef) 목록만 로드하고 선택/스냅샷은 건드리지 않는다(불변).
   */
  useEffect(() => {
    if (!brandRestoreResolved) return
    let cancelled = false
    void (async () => {
      try {
        const [list, defId] = await Promise.all([listBrands(), getDefaultBrandId()])
        if (cancelled) return
        setBrands(list)
        setDefaultBrandId(defId)
        if (brandFromWorkRef.current) return // 작업 박제 스냅샷 우선 — 자동선택 스킵
        const def = list.find((b) => b.id === defId) ?? null
        setSelectedBrandId(def?.id ?? null)
        const snap = def ? await toSnapshot(def) : null
        if (!cancelled) setBrandSnapshot(snap)
      } catch (e) {
        console.error("[brand-init]", e)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [brandRestoreResolved])

  /**
   * 사진 자동 보정 동기화 — images(추가/복원)·enhanceImages(토글) 변화에 맞춰 각 이미지의 url을 스왑.
   * - ON: 아직 원본을 표시 중인(url===rawUrl) 이미지를 보정본으로(캐시 dedup, 동시 2개 제한).
   * - OFF: 보정본 표시 중인 이미지를 원본(rawUrl)으로 즉시 되돌림(재보정 없음).
   * 변화 없으면 이전 배열 참조를 그대로 반환해 렌더/effect 재실행 루프를 끊는다.
   */
  useEffect(() => {
    if (typeof window === "undefined") return
    let cancelled = false
    if (enhanceImages) {
      for (const img of images) {
        if (!img.rawUrl || img.url !== img.rawUrl) continue // 이미 보정본 표시 중
        const { id, file } = img
        void getEnhancedUrl(file)
          .then((enhUrl) => {
            if (cancelled) return
            setImages((prev) => {
              let changed = false
              const next = prev.map((im) => {
                if (im.id === id && im.file === file && im.rawUrl && im.url === im.rawUrl) {
                  changed = true
                  return { ...im, url: enhUrl }
                }
                return im
              })
              return changed ? next : prev
            })
          })
          .catch(() => {
            /* 보정 실패 시 원본 유지 */
          })
      }
    } else {
      setImages((prev) => {
        let changed = false
        const next = prev.map((im) => {
          if (im.rawUrl && im.url !== im.rawUrl) {
            changed = true
            return { ...im, url: im.rawUrl }
          }
          return im
        })
        return changed ? next : prev
      })
    }
    return () => {
      cancelled = true
    }
  }, [images, enhanceImages])

  /** 포장 슬롯 사진 보정 동기화. */
  useEffect(() => {
    if (typeof window === "undefined") return
    let cancelled = false
    syncSingleEnhance(packagingImage, enhanceImages, () => cancelled, setPackagingImage)
    return () => {
      cancelled = true
    }
  }, [packagingImage, enhanceImages])

  /** 크기 비교 슬롯 사진 보정 동기화. */
  useEffect(() => {
    if (typeof window === "undefined") return
    let cancelled = false
    syncSingleEnhance(sizeImage, enhanceImages, () => cancelled, setSizeImage)
    return () => {
      cancelled = true
    }
  }, [sizeImage, enhanceImages])

  const hasMin =
    images.length >= 1 && productName.trim() && isOrdinaryProduce

  /** v2.2: 사용자 입력 감지 — 아무것도 안 넣었으면 데모 카피 표시. */
  const hasUserInput = useMemo(() => {
    return (
      images.length > 0 ||
      productName.trim().length > 0 ||
      variety.trim().length > 0 ||
      origin.trim().length > 0 ||
      weight.trim().length > 0 ||
      brix.trim().length > 0 ||
      farmIntro.trim().length > 0 ||
      extraDescription.trim().length > 0 ||
      presetKeywords.length > 0 ||
      customKeywords.length > 0
    )
  }, [
    images.length,
    productName,
    variety,
    origin,
    weight,
    brix,
    farmIntro,
    extraDescription,
    presetKeywords.length,
    customKeywords.length,
  ])

  const isDemoMode = !result && !hasUserInput

  /**
   * v5.4(작업2): 저장할 가치가 있는 입력이 있는지 — 텍스트/키워드뿐 아니라 신뢰 체크·후기·
   * 전용 슬롯 사진까지 포함(hasUserInput 보다 넓다). 아무 의미 없는 빈 폼은 초안을 만들지 않는다.
   */
  const hasDraftableInput =
    hasUserInput ||
    producerName.trim().length > 0 ||
    producerRegion.trim().length > 0 ||
    farmerYears.trim().length > 0 ||
    sameDayHarvest ||
    coldChain ||
    refundGuarantee ||
    reviews.some((r) => r.text.trim().length > 0) ||
    packagingImage != null ||
    sizeImage != null

  /** v5.4(작업2): 현재 폼/토글 스냅샷(사진 제외) — 자동 저장 페이로드. */
  const draftForm = useMemo<DraftForm>(
    () => ({
      category,
      productName,
      variety,
      origin,
      originFromDemo,
      weight,
      brix,
      sizeGrade,
      extraDescription,
      farmIntro,
      producerName,
      producerRegion,
      farmerYears,
      sameDayHarvest,
      coldChain,
      refundGuarantee,
      reviews,
      presetKeywords,
      customKeywords,
      researchEnabled,
      enhanceImages,
      photoAnalysisEnabled,
      layoutVariant,
    }),
    [
      category,
      productName,
      variety,
      origin,
      originFromDemo,
      weight,
      brix,
      sizeGrade,
      extraDescription,
      farmIntro,
      producerName,
      producerRegion,
      farmerYears,
      sameDayHarvest,
      coldChain,
      refundGuarantee,
      reviews,
      presetKeywords,
      customKeywords,
      researchEnabled,
      enhanceImages,
      photoAnalysisEnabled,
      layoutVariant,
    ],
  )

  /** v5.4(작업2): 현재 사진 구성 서명 — 변경 시에만 사진 blob 을 다시 기록하기 위한 비교값. */
  const currentPhotoSig = useMemo(
    () =>
      computePhotoSig(
        images.map((i) => i.id),
        packagingImage?.id ?? null,
        sizeImage?.id ?? null,
      ),
    [images, packagingImage, sizeImage],
  )

  /**
   * v5.4(작업2): 재진입 시 초안 조회 + (작업5) 최근 작업 원천 로드 — 신규 작업에서만 1회.
   * 초안이 있으면 배너를 띄우고, 없으면 최근 작업이 있을 때 이어받기 배너 후보를 세운다.
   */
  useEffect(() => {
    if (!draftEnabled) return
    let cancelled = false
    void (async () => {
      try {
        const draft = await getDraft()
        if (cancelled) return
        if (draft) {
          lastPhotoSigRef.current = draft.photoSig
          setDraftBanner({ savedAt: draft.savedAt })
        }
        // 작업5: 이어받기 원천은 초안 유무와 무관하게 로드(초안 배너가 우선 노출됨).
        const latest = await getLatestWork()
        if (!cancelled && latest) setCarrySource(latest)
      } catch (e) {
        console.error("[draft-init]", e)
      } finally {
        if (!cancelled) setDraftChecked(true)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [draftEnabled])

  /**
   * v5.4 리뷰 보완: 배너를 무시하고 새 입력을 시작하면(폼이 빈 상태를 벗어나면) 배너를 접고
   * 자동 저장을 재개한다 — 복원 대신 새로 쓰기를 택한 암묵적 결정으로 간주. 이 가드가 없으면
   * 배너가 떠 있는 내내 자동 저장이 꺼져 있어 새 입력이 통째로 유실되는 공백이 생긴다.
   * (폼이 비어 있는 동안엔 배너가 유지되므로 "빈 폼이 초안을 덮지 않게" 보호는 그대로.)
   */
  useEffect(() => {
    if (draftBanner && hasDraftableInput) setDraftBanner(null)
  }, [draftBanner, hasDraftableInput])

  /**
   * v5.4(작업2): 입력 초안 자동 저장 — 디바운스 1.5초. input 단계에서만, 초안 조회가 끝나고
   * 복원 배너가 정리된 뒤에만 저장한다(빈 폼이 초안을 덮지 않게). 폼 메타는 매번,
   * 사진 blob 은 서명이 바뀐 경우에만 기록한다(대용량 반복 직렬화 방지).
   */
  useEffect(() => {
    if (!draftEnabled) return
    if (stage !== "input") return
    if (!draftChecked || draftBanner) return
    if (!hasDraftableInput) return
    if (draftTimerRef.current) clearTimeout(draftTimerRef.current)
    draftTimerRef.current = setTimeout(() => {
      void (async () => {
        try {
          await saveDraftMeta(draftForm, currentPhotoSig)
          if (lastPhotoSigRef.current !== currentPhotoSig) {
            const photos: DraftPhotos = {
              imageBlobs: images.map((i) => i.file),
              imageIds: images.map((i) => i.id),
              packagingBlob: packagingImage?.file ?? null,
              sizeBlob: sizeImage?.file ?? null,
            }
            await saveDraftPhotos(photos)
            lastPhotoSigRef.current = currentPhotoSig
          }
        } catch (e) {
          console.error("[draft-save]", e)
        }
      })()
    }, 1500)
    return () => {
      if (draftTimerRef.current) clearTimeout(draftTimerRef.current)
    }
    // draftForm/currentPhotoSig 가 실제 입력 변화를 대표하므로 개별 필드는 의존성에서 생략.
  }, [
    draftEnabled,
    stage,
    draftChecked,
    draftBanner,
    hasDraftableInput,
    draftForm,
    currentPhotoSig,
    images,
    packagingImage,
    sizeImage,
  ])

  /** v5.4(작업2): 초안 복원 — 폼/토글 + 사진(전체) 되살리기. 복원 후 배너를 닫는다. */
  const handleRestoreDraft = async () => {
    try {
      const draft = await getDraft()
      if (!draft) {
        setDraftBanner(null)
        return
      }
      const f = draft.form
      // 사진 복원(있으면) — objectURL 은 언마운트 시 일괄 해제.
      if (draft.photos) {
        const restored: UploadedImage[] = []
        for (let i = 0; i < draft.photos.imageBlobs.length; i++) {
          const blob = draft.photos.imageBlobs[i]
          if (!blob) continue
          const img = await blobToUploadedImage(blob, i, draft.photos.imageIds?.[i])
          if (img) {
            restored.push(img)
            restoredUrlsRef.current.push(img.url)
          }
        }
        setImages(restored)
        if (draft.photos.packagingBlob) {
          const pk = await blobToUploadedImage(draft.photos.packagingBlob, 2000)
          if (pk) {
            setPackagingImage(pk)
            restoredUrlsRef.current.push(pk.url)
          }
        }
        if (draft.photos.sizeBlob) {
          const sz = await blobToUploadedImage(draft.photos.sizeBlob, 2001)
          if (sz) {
            setSizeImage(sz)
            restoredUrlsRef.current.push(sz.url)
          }
        }
      }
      setCategory(f.category)
      setProductName(f.productName)
      setVariety(f.variety)
      setOrigin(f.origin)
      setOriginFromDemo(f.originFromDemo)
      setWeight(f.weight)
      setBrix(f.brix)
      setSizeGrade(f.sizeGrade)
      setExtraDescription(f.extraDescription)
      setFarmIntro(f.farmIntro)
      setProducerName(f.producerName)
      setProducerRegion(f.producerRegion)
      setFarmerYears(f.farmerYears)
      setSameDayHarvest(f.sameDayHarvest)
      setColdChain(f.coldChain)
      setRefundGuarantee(f.refundGuarantee)
      setReviews(Array.isArray(f.reviews) ? f.reviews : [])
      setPresetKeywords(f.presetKeywords)
      setCustomKeywords(f.customKeywords)
      setResearchEnabled(f.researchEnabled)
      setEnhanceImages(f.enhanceImages)
      setPhotoAnalysisEnabled(f.photoAnalysisEnabled)
      setLayoutVariant(f.layoutVariant)
      lastPhotoSigRef.current = draft.photoSig
      // 복원했으면 이어받기 배너는 불필요.
      setCarryApplied(true)
      setDraftBanner(null)
    } catch (e) {
      console.error("[draft-restore]", e)
      setDraftBanner(null)
    }
  }

  /** v5.4(작업2): 초안 버리기 — 저장분 삭제 + 배너 닫기(빈 폼 유지). */
  const handleDiscardDraft = async () => {
    if (typeof window !== "undefined" && !window.confirm(t.detail.draft.discardConfirm)) return
    try {
      await deleteDraft()
    } catch (e) {
      console.error("[draft-discard]", e)
    }
    lastPhotoSigRef.current = null
    setDraftBanner(null)
  }

  /**
   * v5.4(작업5): 지난 설정 이어받기 — 가게 공통 필드(농부·산지·연차)만 채운다.
   * 상품 고유 필드(상품명·중량·당도·품종·사진·후기)는 가져오지 않는다.
   * 신뢰 약속은 자동 적용 금지 — 켜져 있던 항목을 힌트로만 보여준다(직접 켜도록).
   */
  const handleApplyCarryOver = () => {
    if (!carrySource) return
    const inp = carrySource.input
    const trust = inp.trust
    if (trust?.producerName && !producerName.trim()) setProducerName(trust.producerName)
    if (trust?.producerRegion && !producerRegion.trim()) setProducerRegion(trust.producerRegion)
    if (trust?.farmerYears != null && !farmerYears.trim()) setFarmerYears(String(trust.farmerYears))
    if (inp.origin && inp.origin.trim() && !origin.trim()) {
      setOrigin(inp.origin.trim())
      // 실제 지난 산지이므로 예시 힌트는 붙이지 않는다.
      setOriginFromDemo(false)
    }
    // 신뢰 약속은 자동으로 켜지 않고, 지난번 켰던 항목만 힌트로 노출.
    setCarriedTrust({
      sameDayHarvest: !!trust?.sameDayHarvest,
      coldChain: !!trust?.coldChain,
      refundGuarantee: trust?.refundGuarantee === true,
    })
    setCarryApplied(true)
  }

  /** v5.4(작업5): 이어받기 배너 닫기(새로 입력). */
  const handleDismissCarryOver = () => setCarryApplied(true)

  /** 초안·이어받기 배너 표시 여부 — 초안이 우선, 신규 작업·빈 폼에서만 이어받기 노출. */
  const showDraftBanner = draftEnabled && draftBanner !== null
  const carrySourceHasStoreInfo =
    carrySource != null &&
    (!!carrySource.input.trust?.producerName ||
      !!carrySource.input.trust?.producerRegion ||
      carrySource.input.trust?.farmerYears != null ||
      !!carrySource.input.origin?.trim())
  const showCarryBanner =
    draftEnabled &&
    !showDraftBanner &&
    !carryApplied &&
    !hasDraftableInput &&
    carrySourceHasStoreInfo

  /** 우측 미리보기에 전달할 카피
   *  - result 있으면 실제 결과
   *  - 사용자 입력 있으면 emptyCopy + spec
   *  - 아무 입력 없으면 DEMO_COPY (첫 진입 학습용)
   */
  const liveCopy = useMemo<CopyOutput>(() => {
    if (result) return result
    if (!hasUserInput) return DEMO_COPY
    const base = emptyCopy()
    base.spec = buildLiveSpec({ origin, variety, weight, brix })
    return base
  }, [result, hasUserInput, origin, variety, weight, brix])

  /** 우측 미리보기에 전달할 메타 — 실제 result가 있으면 그 시점의 값, 없으면 현재 입력. */
  const liveResultMeta = useMemo(() => {
    if (result && resultMeta) return resultMeta
    return {
      priceNum: 0,
      productName: productName.trim(),
      origin: origin.trim(),
      weight: weight.trim(),
    }
  }, [result, resultMeta, productName, origin, weight])

  /**
   * v5.4(작업1): 키 등록 모달을 띄우고 결과를 기다린다(등록 성공 true / 취소 false).
   * 이미 대기 중이면 그 대기를 취소로 정리하고 새로 건다(중복 방지).
   */
  const openKeyGate = (): Promise<boolean> => {
    return new Promise<boolean>((resolve) => {
      const prev = keyGateResolveRef.current
      keyGateResolveRef.current = resolve
      if (prev) prev(false)
      setKeyGateOpen(true)
    })
  }

  /** 모달을 닫고 대기 중 Promise를 결과로 resolve. */
  const resolveKeyGate = (ok: boolean) => {
    setKeyGateOpen(false)
    const resolve = keyGateResolveRef.current
    keyGateResolveRef.current = null
    resolve?.(ok)
  }

  /**
   * v5.4(작업1): AI 동작 실행 전 키 보장. 키가 있으면 즉시 true, 없으면 모달을 띄우고
   * 등록 성공 시 true(→호출부가 입력 유실 없이 그 자리에서 이어감). 취소면 false.
   */
  const ensureKey = async (): Promise<boolean> => {
    const key = await getKeySource().getKey()
    if (key) return true
    return openKeyGate()
  }

  /** v5.4(작업3): 에러 배너 — 키 재등록(모달) 후, 되면 실패했던 동작을 그대로 이어서 재실행. */
  const handleReRegisterKey = () => {
    void openKeyGate().then((ok) => {
      if (ok) void lastActionRef.current?.()
    })
  }

  /** v5.4(작업3): 에러 배너 — 마지막 동작 다시 시도. */
  const handleErrorRetry = () => {
    void lastActionRef.current?.()
  }

  /** v5.4(작업3): 에러 배너 — Anthropic 콘솔(사용량·잔액) 새 탭으로 열기. */
  const handleOpenConsole = () => {
    if (typeof window === "undefined") return
    window.open(ANTHROPIC_CONSOLE_URL, "_blank", "noopener,noreferrer")
  }

  const handleSubmit = async () => {
    if (!hasMin) {
      if (images.length === 0) setErrorMsg(t.detail.minImages)
      else if (!productName.trim()) setErrorMsg(t.detail.needName)
      return
    }

    // v5.4: 이 동작을 기억(에러 배너의 '다시 시도'·키 재등록 후 이어가기용).
    lastActionRef.current = handleSubmit
    // v5.4(작업1): 키가 없으면 등록 모달 → 성공 시 입력 그대로 이어서 생성. 취소면 중단.
    if (!(await ensureKey())) return

    setErrorMsg(null)
    setGenError(null)
    // v5.1: 새 생성 시작 — 이전 검수 리포트·비용은 낡으므로 폐기.
    setReviewResult(null)
    setReviewFailed(false)
    setReviewUsage(null)
    // v5.9(작업L): 이전 카피 린터 경고도 폐기(새 카피로 재검사).
    setLintFindings([])
    // v6.3(작업3): 새 생성 = 새 헤드라인 → 이전 타이포 이미지는 폐기(다른 헤드라인 표시 방지).
    applyTypoBlob(null)
    setTypoError(null)
    setStage("generating")
    setGenerationStep(0)
    const stepTimer = setInterval(() => {
      setGenerationStep((s) => Math.min(s + 1, GENERATION_STEPS.length - 1))
    }, 4000)

    const allKeywords = [...presetKeywords, ...customKeywords]
    if (extraDescription.trim()) {
      allKeywords.push(`상품 추가 설명: ${extraDescription.trim()}`)
    }

    const hasTrust =
      producerName.trim() ||
      producerRegion.trim() ||
      farmerYears.trim() ||
      sameDayHarvest ||
      coldChain ||
      refundGuarantee
    const trustData: TrustInfo | undefined = hasTrust
      ? {
          producerName: producerName.trim() || undefined,
          producerRegion: producerRegion.trim() || undefined,
          farmerYears: farmerYears.trim() ? Number(farmerYears) : undefined,
          sameDayHarvest: sameDayHarvest || undefined,
          coldChain: coldChain || undefined,
          refundGuarantee: refundGuarantee || undefined,
        }
      : undefined

    // 고객 후기 — 본문 있는 것만(최대 3개), 200자 컷. 셀러 직접 입력(AI 생성 아님).
    // v5.3(작업3): 신뢰 메타 3종(별점·작성자·옵션)도 함께 정제. 전부 선택 —
    // 미입력/무효 값은 undefined로 떨어져 렌더·저장·백업에서 표기 자체가 생략된다(지어내기 방지).
    const cleanReviews: SellerReview[] = reviews
      .map((r) => {
        const rating =
          Number.isInteger(r.rating) && (r.rating as number) >= 1 && (r.rating as number) <= 5
            ? (r.rating as number)
            : undefined
        return {
          text: r.text.trim().slice(0, 200),
          highlight: r.highlight?.trim().slice(0, 200) || undefined,
          rating,
          author: r.author?.trim().slice(0, 20) || undefined,
          optionLabel: r.optionLabel?.trim().slice(0, 30) || undefined,
        }
      })
      .filter((r) => r.text.length > 0)
      .slice(0, REVIEW_MAX)

    const input: CopyInput = {
      category,
      productType: productName.trim(),
      variety: variety.trim() || undefined,
      origin: origin.trim(),
      weight: weight.trim(),
      price: 0,
      brix: brix.trim() ? Number(brix) : undefined,
      sizeGrade: sizeGrade.trim() || undefined,
      farmIntro: farmIntro.trim() || undefined,
      trust: trustData,
      reviews: cleanReviews.length > 0 ? cleanReviews : undefined,
      // v5.8(작업①): 후기 집계 — 유효 값만. 하나도 없으면 undefined(스트립 미렌더).
      reviewStats: normalizeReviewStats(reviewStats),
      highlightKeywords: allKeywords,
      recommendBadge: undefined,
      tone: "sincere",
      isOrdinaryProduce,
      researchEnabled,
    }

    // v4.4: 사진 분석 — generateCopy와 병렬 실행. 실패해도(내부 catch → null) 카피 생성은 진행한다.
    // 재사용: 기존 분석의 imageId 집합이 현재 images와 정확히 일치하면 재분석 스킵(비용 절약).
    const reusableAnalysis =
      photoAnalysisEnabled && photoAnalysisMatchesImages(photoAnalysis, images)
        ? photoAnalysis
        : null
    const analysisPromise: Promise<PhotoAnalysisResult | null> = (async () => {
      if (!photoAnalysisEnabled || images.length === 0) return null
      if (reusableAnalysis) return { items: reusableAnalysis } // 재사용 — 추가 비용 없음
      try {
        // 대상: 일반 사진(images)만. packaging/size 슬롯은 전용이라 분석 제외.
        const photos: { id: string; dataUrl: string }[] = []
        for (const img of images) {
          const dataUrl = await toAnalysisDataUrl(img.url, 512)
          if (dataUrl) photos.push({ id: img.id, dataUrl })
        }
        if (photos.length === 0) return null
        return await getAIProvider().analyzePhotos(photos, {
          productType: productName.trim(),
          category,
        })
      } catch (e) {
        console.error("[analyzePhotos]", e)
        return null
      }
    })()

    try {
      // generateCopy는 실패 시 throw(→ 아래 catch로 에러 화면). analysisPromise는 절대 reject 안 함.
      // v6.0(작업R⑤): 같은 analysisPromise를 generateCopy에도 넘겨 draft에 "사진에 보이는 것" 요약을 주입.
      // 두 번 await 해도 안전(동일 Promise). 분석은 여전히 병렬로 진행되고, draft 직전에만 수확된다.
      const [res, analysisRes] = await Promise.all([
        getAIProvider().generateCopy(input, analysisPromise),
        analysisPromise,
      ])
      const analysisItems = analysisRes?.items ?? null
      setResult(res.output)
      // v5.9(작업L): 생성 직후 결정적 카피 린터 실행(AI 호출 0회) → 경고 배너로 노출.
      try {
        setLintFindings(lintCopyOutput(res.output, input))
      } catch (lintErr) {
        console.error("[copy-lint]", lintErr)
        setLintFindings([])
      }
      // 분석 usage(신규 분석일 때만 존재 — 재사용/OFF/실패면 없음)를 생성 비용에 합산 표시.
      setLastUsage(mergeUsage(res.usage, analysisRes?.usage))
      setPhotoAnalysis(analysisItems)
      setCurrentInput(input)
      setResultMeta({
        priceNum: 0,
        productName: productName.trim(),
        origin: origin.trim(),
        weight: weight.trim(),
      })
      setStage("result")

      // 작업 저장 (실패해도 결과 화면은 보여줌)
      try {
        const id = newWorkId()
        setWorkId(id)
        const thumb = images[0] ? await makeThumbDataUrl(images[0].file) : null
        const work: Work = {
          id,
          createdAt: Date.now(),
          updatedAt: Date.now(),
          productName: productName.trim(),
          thumbDataUrl: thumb,
          input,
          copy: res.output,
          imageBlobs: images.map((i) => i.file),
          // v4.4: 이미지 id 도 저장 — 복원 후 photoAnalysis imageId 정합(재분석 캐시·배치·캡션).
          imageIds: images.map((i) => i.id),
          // v3.7: 전용 슬롯 사진 — 일반 imageBlobs와 별도 저장(없으면 null).
          packagingBlob: packagingImage?.file ?? null,
          sizeBlob: sizeImage?.file ?? null,
          // 사진 자동 보정 토글 — 표시 옵션. 저장 blob은 항상 원본.
          enhanceImages,
          // v4.4: 사진 분석 토글·결과 저장(같은 사진 재생성 시 재분석 스킵 캐시).
          photoAnalysisEnabled,
          photoAnalysis: analysisItems ?? undefined,
          // v4.6: 레이아웃 변주 저장(현재 선택값 — 기본 standard).
          layoutVariant,
          // v5.0-B: 선택 브랜드 스냅샷 박제(없으면 undefined). 이후 브랜드 편집/삭제와 무관하게 고정.
          brandSnapshot: brandSnapshot ?? undefined,
          // v6.1(작업E2): 숨긴 섹션 목록 저장(생성 시엔 보통 빈 배열 → undefined, 하위호환).
          hiddenSections: hiddenSections.length > 0 ? hiddenSections : undefined,
          // v6.3(작업3): 타이포 헤드라인 이미지(신규 생성 시엔 보통 없음 → undefined).
          typoHeadlineBlob: typoHeadlineBlob ?? undefined,
        }
        void saveWork(work)
      } catch (saveErr) {
        console.error("[saveWork]", saveErr)
      }

      // v5.4(작업2): 생성 성공 → 초안은 역할을 다했으므로 삭제(다음 재진입에 유령 배너 방지).
      if (draftEnabled) {
        lastPhotoSigRef.current = null
        void deleteDraft().catch((e) => console.error("[draft-clear]", e))
      }
    } catch (err) {
      console.error(err)
      // v5.4(작업3): 원인별 분류 → 배너에서 원인별 안내·행동 버튼(키 재등록/콘솔/재시도) 노출.
      setGenError(classifyError(err))
      setStage("error")
    } finally {
      clearInterval(stepTimer)
    }
  }

  /** 결과 카피 인라인 편집 → 작업 자동 갱신 */
  const handleCopyChange = (next: CopyOutput) => {
    setResult(next)
    // v6.4(FIX-1): 낡은 레터링 무효화 — 헤드라인 "텍스트"가 바뀌는 모든 경로(후보 칩 클릭·
    // 헤드라인 섹션 재생성·인라인 편집)는 전부 handleCopyChange 를 지난다. 여기서 옛 타이포
    // blob/URL 이 있는데 headline 이 실제로 달라졌으면 즉시 폐기해 JPG에 옛 레터링이 박제되는 것을
    // 막는다. 아래 저장 블록에도 이 무효화를 반영한다(state 비동기 전에 정확).
    // (전체 재생성 경로 1311·1975 는 result 를 거치지 않는 별도 초기화라 충돌하지 않는다.)
    const headlineChanged =
      (next.headline ?? "").trim() !== (result?.headline ?? "").trim()
    const invalidateTypo =
      headlineChanged && (typoHeadlineBlob != null || typoHeadlineUrl != null)
    if (invalidateTypo) {
      applyTypoBlob(null)
    }
    // v5.9(작업L): 인라인 편집 후에도 린터 경고를 최신 상태로(currentInput 기준 재검사).
    if (currentInput) {
      try {
        setLintFindings(lintCopyOutput(next, currentInput))
      } catch (lintErr) {
        console.error("[copy-lint]", lintErr)
      }
    }
    if (workId && currentInput && resultMeta) {
      void (async () => {
        try {
          const work: Work = {
            id: workId,
            createdAt: Date.now(),
            updatedAt: Date.now(),
            productName: resultMeta.productName,
            thumbDataUrl: images[0] ? await makeThumbDataUrl(images[0].file) : null,
            input: currentInput,
            copy: next,
            imageBlobs: images.map((i) => i.file),
            // v4.4: 이미지 id 유지(인라인 편집 저장 시에도 photoAnalysis 정합 유지).
            imageIds: images.map((i) => i.id),
            // v3.7: 전용 슬롯 사진 유지(인라인 편집 저장 시에도 유실 방지).
            packagingBlob: packagingImage?.file ?? null,
            sizeBlob: sizeImage?.file ?? null,
            // 사진 자동 보정 토글 유지.
            enhanceImages,
            // v4.4: 사진 분석 토글·결과 유지(인라인 편집 저장 시에도 유실 방지).
            photoAnalysisEnabled,
            photoAnalysis: photoAnalysis ?? undefined,
            // v4.6: 레이아웃 변주 유지(인라인 편집 저장 시에도 현재 선택값 보존).
            layoutVariant,
            // v5.0-B: 브랜드 스냅샷 유지(인라인 편집 저장 시에도 유실 방지).
            brandSnapshot: brandSnapshot ?? undefined,
            // v6.1(작업E2): 숨긴 섹션 목록 유지(인라인 편집 저장 시에도 유실 방지).
            hiddenSections: hiddenSections.length > 0 ? hiddenSections : undefined,
            // v6.3(작업3): 타이포 헤드라인 유지(인라인 편집 저장 시에도 유실 방지).
            // v6.4(FIX-1): 헤드라인 텍스트가 바뀌어 무효화된 경우엔 null 로 저장(옛 레터링 박제 방지).
            typoHeadlineBlob: invalidateTypo ? undefined : (typoHeadlineBlob ?? undefined),
          }
          await saveWork(work)
        } catch (e) {
          console.error("[saveWork-update]", e)
        }
      })()
    }
  }

  /**
   * v4.6: 레이아웃 변주 전환 — 즉시 state 반영(미리보기 갱신) + 저장된 작업이 있으면 persist.
   * handleCopyChange 와 동일한 Work 구성으로, 현재 copy(result)를 유지한 채 layoutVariant만 갱신 저장.
   * 아직 생성 전(workId 없음)이면 state만 바꾸고, 이후 handleSubmit 저장 시 함께 기록된다.
   */
  const handleLayoutVariantChange = (next: LayoutVariant) => {
    setLayoutVariant(next)
    if (workId && currentInput && resultMeta && result) {
      void (async () => {
        try {
          const work: Work = {
            id: workId,
            createdAt: Date.now(),
            updatedAt: Date.now(),
            productName: resultMeta.productName,
            thumbDataUrl: images[0] ? await makeThumbDataUrl(images[0].file) : null,
            input: currentInput,
            copy: result,
            imageBlobs: images.map((i) => i.file),
            imageIds: images.map((i) => i.id),
            packagingBlob: packagingImage?.file ?? null,
            sizeBlob: sizeImage?.file ?? null,
            enhanceImages,
            photoAnalysisEnabled,
            photoAnalysis: photoAnalysis ?? undefined,
            layoutVariant: next,
            // v5.0-B: 브랜드 스냅샷 유지(레이아웃 변주 저장 시에도 유실 방지).
            brandSnapshot: brandSnapshot ?? undefined,
            // v6.1(작업E2): 숨긴 섹션 목록 유지(레이아웃 변주 저장 시에도 유실 방지).
            hiddenSections: hiddenSections.length > 0 ? hiddenSections : undefined,
            // v6.3(작업3): 타이포 헤드라인 유지(레이아웃 변주 저장 시에도 유실 방지).
            typoHeadlineBlob: typoHeadlineBlob ?? undefined,
          }
          await saveWork(work)
        } catch (e) {
          console.error("[saveWork-layout]", e)
        }
      })()
    }
  }

  /** v5.0-B: 브랜드 목록·기본값 재로딩(패널 DB 변경 후). 최신 리스트를 반환. */
  const reloadBrands = async (): Promise<BrandProfile[]> => {
    const [list, defId] = await Promise.all([listBrands(), getDefaultBrandId()])
    setBrands(list)
    setDefaultBrandId(defId)
    return list
  }

  /**
   * v5.0-B: 결과 화면에서 브랜드가 바뀌면 현재 작업에 즉시 저장.
   * workId·currentInput·resultMeta·result 가 모두 있어야(결과 단계) 저장 — 그 외엔 no-op(가드).
   * handleLayoutVariantChange 와 동일한 Work 구성에 brandSnapshot 만 교체한다.
   */
  const persistBrandToWork = (snap: BrandSnapshot | null) => {
    if (!(workId && currentInput && resultMeta && result)) return
    void (async () => {
      try {
        const work: Work = {
          id: workId,
          createdAt: Date.now(),
          updatedAt: Date.now(),
          productName: resultMeta.productName,
          thumbDataUrl: images[0] ? await makeThumbDataUrl(images[0].file) : null,
          input: currentInput,
          copy: result,
          imageBlobs: images.map((i) => i.file),
          imageIds: images.map((i) => i.id),
          packagingBlob: packagingImage?.file ?? null,
          sizeBlob: sizeImage?.file ?? null,
          enhanceImages,
          photoAnalysisEnabled,
          photoAnalysis: photoAnalysis ?? undefined,
          layoutVariant,
          brandSnapshot: snap ?? undefined,
          // v6.1(작업E2): 숨긴 섹션 목록 유지(브랜드 저장 시에도 유실 방지).
          hiddenSections: hiddenSections.length > 0 ? hiddenSections : undefined,
          // v6.3(작업3): 타이포 헤드라인 유지(브랜드 저장 시에도 유실 방지).
          typoHeadlineBlob: typoHeadlineBlob ?? undefined,
        }
        await saveWork(work)
      } catch (e) {
        console.error("[saveWork-brand]", e)
      }
    })()
  }

  /**
   * v6.1(작업E2): 섹션 숨기기/복원 → 즉시 state 반영(미리보기 갱신) + 결과 단계면 Work 저장.
   * next 를 직접 Work 에 실어(state 비동기 갱신 전에도 정확) — persistBrandToWork 와 동일 가드.
   * 아직 생성 전(workId 없음)이면 state 만 바꾸고, 이후 저장 시 함께 기록된다.
   */
  const handleHiddenChange = (next: string[]) => {
    setHiddenSections(next)
    if (!(workId && currentInput && resultMeta && result)) return
    void (async () => {
      try {
        const work: Work = {
          id: workId,
          createdAt: Date.now(),
          updatedAt: Date.now(),
          productName: resultMeta.productName,
          thumbDataUrl: images[0] ? await makeThumbDataUrl(images[0].file) : null,
          input: currentInput,
          copy: result,
          imageBlobs: images.map((i) => i.file),
          imageIds: images.map((i) => i.id),
          packagingBlob: packagingImage?.file ?? null,
          sizeBlob: sizeImage?.file ?? null,
          enhanceImages,
          photoAnalysisEnabled,
          photoAnalysis: photoAnalysis ?? undefined,
          layoutVariant,
          brandSnapshot: brandSnapshot ?? undefined,
          hiddenSections: next.length > 0 ? next : undefined,
          // v6.3(작업3): 타이포 헤드라인 유지(섹션 숨김 저장 시에도 유실 방지).
          typoHeadlineBlob: typoHeadlineBlob ?? undefined,
        }
        await saveWork(work)
      } catch (e) {
        console.error("[saveWork-hidden]", e)
      }
    })()
  }

  /* ───────── v6.3(작업3·4): AI 타이포 히어로 ───────── */

  /**
   * 타이포 이미지 blob 을 렌더 상태에 적용한다. 이전 objectURL 은 즉시 해제(누수 방지).
   * blob=null 이면 텍스트 헤드라인으로 복귀. 결정성: Math.random/Date 미사용.
   */
  const applyTypoBlob = (blob: Blob | null) => {
    if (typoUrlRef.current) {
      URL.revokeObjectURL(typoUrlRef.current)
      typoUrlRef.current = null
    }
    if (blob && typeof window !== "undefined") {
      const url = URL.createObjectURL(blob)
      typoUrlRef.current = url
      setTypoHeadlineBlob(blob)
      setTypoHeadlineUrl(url)
    } else {
      setTypoHeadlineBlob(null)
      setTypoHeadlineUrl(null)
    }
  }

  /**
   * 현재 작업에 타이포 blob 을 즉시 저장(재렌더 결정성·내보내기 포함).
   * persistBrandToWork 와 동일 가드(결과 단계에서만) — blob 을 직접 실어 state 비동기 전에도 정확.
   */
  const persistTypoToWork = (blob: Blob | null) => {
    if (!(workId && currentInput && resultMeta && result)) return
    void (async () => {
      try {
        const work: Work = {
          id: workId,
          createdAt: Date.now(),
          updatedAt: Date.now(),
          productName: resultMeta.productName,
          thumbDataUrl: images[0] ? await makeThumbDataUrl(images[0].file) : null,
          input: currentInput,
          copy: result,
          imageBlobs: images.map((i) => i.file),
          imageIds: images.map((i) => i.id),
          packagingBlob: packagingImage?.file ?? null,
          sizeBlob: sizeImage?.file ?? null,
          enhanceImages,
          photoAnalysisEnabled,
          photoAnalysis: photoAnalysis ?? undefined,
          layoutVariant,
          brandSnapshot: brandSnapshot ?? undefined,
          hiddenSections: hiddenSections.length > 0 ? hiddenSections : undefined,
          typoHeadlineBlob: blob ?? undefined,
        }
        await saveWork(work)
      } catch (e) {
        console.error("[saveWork-typo]", e)
      }
    })()
  }

  /**
   * "만들기/다시 그리기" — 확정 헤드라인을 Gemini(나노바나나)로 한글 레터링 이미지로 생성.
   * 파이프라인: buildTypoPrompt → Gemini 생성(60s 타임아웃) → vision 오탈자 게이트(30s 타임아웃, 정확 일치)
   * → 불일치 시 재생성(최초 1 + 재시도 2 = 최대 3회) → 최종 실패 시 기존 상태 유지 + 원인별 문구.
   * 검수 불가(null)는 오탈자와 분리 처리 — null 1회면 재시도, 2연속 null 이면 즉시 중단(헛비용 방지).
   * ⚠️ 셀러 사진을 이미지 생성에 절대 넣지 않는다(generate 에 referenceImage 미전달 — 사진 불가침).
   */
  const handleGenerateTypoHeadline = async () => {
    // 4) 중복 클릭 동기 가드 — state(typoBusy) 는 비동기라 연타 시 이중 파이프라인이 뜬다.
    //    useRef 로 함수 진입 즉시 잠그고 finally 에서 해제. setTypoBusy 는 UI 표시 전용.
    if (typoBusyRef.current) return
    typoBusyRef.current = true
    try {
      const headline = result?.headline?.trim() ?? ""
      if (!headline) {
        setTypoError("먼저 헤드라인을 만들거나 입력해 주세요.")
        return
      }
      // 오탈자 게이트(vision)에 Anthropic 키가 필요 — 없으면 등록 모달, 취소면 중단.
      if (!(await ensureKey())) return
      const imgProvider = await getImageProvider()
      if (!imgProvider || imgProvider.id !== "gemini-2.5-flash-image") {
        setTypoError("Gemini(나노바나나) 키를 먼저 등록해 주세요.")
        return
      }
      const nameForMood = productName.trim() || resultMeta?.productName || ""
      const accent = resolveAccent(nameForMood)
      const hints = buildFruitMoodHints(nameForMood, accent.accent)
      const MAX_ATTEMPTS = 3 // 최초 1 + 재시도 2
      const GEN_TIMEOUT_MS = 60_000 // 생성(Gemini) 권장 타임아웃
      const VERIFY_TIMEOUT_MS = 30_000 // 검수(vision) 권장 타임아웃
      let sawTypo = false
      let sawGenFail = false
      let sawVerifyFail = false
      let verifyFailStreak = 0 // 연속 검수 불가(null) 카운트 — 2연속이면 즉시 중단.
      setTypoBusy(true)
      setTypoError(null)
      try {
        for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
          // 1) 생성 — 60s 타임아웃 + AbortController(초과·예외 시 이 시도 실패 처리 후 계속).
          let dataUrl: string
          try {
            const genController = new AbortController()
            // referenceImage 미전달 = 사진 불가침(텍스트·스타일 지시만).
            const gen = await withTimeout(
              imgProvider.generate({
                prompt: buildTypoPrompt(headline, hints, attempt),
                signal: genController.signal,
              }),
              GEN_TIMEOUT_MS,
              genController,
            )
            dataUrl = gen.dataUrl
          } catch (genErr) {
            console.warn("[typoHeadline] generate failed/timeout:", genErr)
            sawGenFail = true
            continue
          }
          // 2) 오탈자 게이트 — 30s 타임아웃. 타임아웃/예외/어댑터 실패는 모두 null(검수 불가)로 취급.
          let verify: TypoVerifyResult | null = null
          try {
            verify = await withTimeout(
              getAIProvider().verifyTypoImage(dataUrl, headline),
              VERIFY_TIMEOUT_MS,
            )
          } catch (verErr) {
            console.warn("[typoHeadline] verify failed/timeout:", verErr)
            verify = null
          }
          if (verify && verify.matches) {
            const blob = await (await fetch(dataUrl)).blob()
            applyTypoBlob(blob)
            persistTypoToWork(blob)
            setTypoError(null)
            return
          }
          // 3) 검증 불가(null) — 오탈자와 구분. 1회면 1회 재시도, 2연속이면 즉시 중단(Gemini 재생성 헛비용 방지).
          if (verify === null) {
            sawVerifyFail = true
            verifyFailStreak += 1
            if (verifyFailStreak >= 2) {
              setTypoError(
                "레터링 검수를 할 수 없어요 — 잠시 후 다시 시도해 주세요.",
              )
              return
            }
            continue
          }
          // verify 존재 & !matches → 실제 오탈자. 연속 null 스트릭은 끊는다.
          verifyFailStreak = 0
          sawTypo = true
        }
        // 최종 실패 — 기존 상태(있으면) 유지 + 원인별 안내(폴백=텍스트 헤드라인).
        setTypoError(
          sawTypo
            ? "글자가 정확히 그려지지 않았어요(오탈자 반복). 기본 글씨를 유지할게요 — 다시 시도해 보세요."
            : sawGenFail
              ? "레터링 이미지 생성에 실패했어요. 키·네트워크를 확인하고 다시 시도해 주세요."
              : sawVerifyFail
                ? "레터링 검수를 할 수 없어요 — 잠시 후 다시 시도해 주세요."
                : "레터링 생성에 실패했어요. 다시 시도해 주세요.",
        )
      } catch (err) {
        console.error("[typoHeadline]", err)
        setTypoError("레터링 생성 중 오류가 발생했어요. 다시 시도해 주세요.")
      } finally {
        setTypoBusy(false)
      }
    } finally {
      typoBusyRef.current = false
    }
  }

  /** "기본 글씨로" — 타이포 이미지를 제거하고 텍스트 헤드라인으로 복귀(Work 에도 반영). */
  const handleResetTypoHeadline = () => {
    applyTypoBlob(null)
    setTypoError(null)
    persistTypoToWork(null)
  }

  /**
   * v5.0-B: 사용자가 드롭다운에서 프로필 선택. 스냅샷을 그 프로필로 갱신(불변 해제) +
   * 결과 단계면 즉시 저장. 신규 추가 직후처럼 목록에 아직 없을 수 있어 항상 재로딩해 해석한다.
   */
  const handleBrandSelect = async (brandId: string | null) => {
    brandFromWorkRef.current = false
    setSelectedBrandId(brandId)
    if (!brandId) {
      setBrandSnapshot(null)
      persistBrandToWork(null)
      return
    }
    const list = await reloadBrands()
    const brand = list.find((b) => b.id === brandId) ?? null
    const snap = brand ? await toSnapshot(brand) : null
    setBrandSnapshot(snap)
    persistBrandToWork(snap)
  }

  /**
   * v5.0-B: 패널이 DB 를 바꾼 뒤(추가/편집/삭제/기본지정/불러오기) 부모 목록 재로딩.
   * 선택 프로필이 사라졌으면 해제하고, 남아 있고 작업 박제가 아니면 최신 프로필로 스냅샷 재계산.
   */
  const handleBrandsChanged = async () => {
    const list = await reloadBrands()
    if (!selectedBrandId) return
    if (!list.some((b) => b.id === selectedBrandId)) {
      // 선택 중이던 프로필이 삭제됨 — 해제(작업 박제 중이면 스냅샷은 유지).
      setSelectedBrandId(null)
      if (!brandFromWorkRef.current) {
        setBrandSnapshot(null)
        persistBrandToWork(null)
      }
      return
    }
    if (!brandFromWorkRef.current) {
      // 선택 프로필 내용이 편집됐을 수 있으니 스냅샷 최신화(로고/색 반영).
      const brand = list.find((b) => b.id === selectedBrandId) ?? null
      const snap = brand ? await toSnapshot(brand) : null
      setBrandSnapshot(snap)
      persistBrandToWork(snap)
    }
  }

  /** 섹션 단위 재생성 */
  const handleSectionRegenerate = async (sectionId: SectionId) => {
    if (!result || !currentInput) return
    // v5.4: 이 섹션 재생성을 기억 + 키 보장(없으면 모달 → 성공 시 이어서).
    lastActionRef.current = () => handleSectionRegenerate(sectionId)
    if (!(await ensureKey())) return
    setGenError(null)
    setBusySection(sectionId)
    try {
      const patch = await regenerateSection(currentInput, result, sectionId)
      const merged = mergeSection(result, patch)
      setResult(merged)
      handleCopyChange(merged)
      // v5.1: 카피가 바뀌면 이전 검수 리포트·비용은 낡으므로 폐기.
      setReviewResult(null)
      setReviewFailed(false)
      setReviewUsage(null)
    } catch (e) {
      console.error("[regenerateSection]", e)
      // v5.4(작업3): 섹션 재생성 실패도 원인별 안내(생성 실패 배너 공유).
      setGenError(classifyError(e))
    } finally {
      setBusySection(null)
    }
  }

  /**
   * v5.1: AI 자가 검수 — 아트보드(.fdp-print)를 저해상 세그먼트로 캡처해
   * reviewArtboard 로 넘긴 뒤 리포트를 세션 상태에 담는다. usage 비용은 lastUsage 에 합산.
   * 캡처 빈 배열·null 응답·예외는 모두 "검수 실패" 알림으로 폴백(흐름 차단 없음).
   */
  const handleSelfReview = async () => {
    if (reviewing || !result) return
    // v5.4(작업1): 검수도 AI 호출 — 키 없으면 등록 모달 → 성공 시 이어서 검수.
    if (!(await ensureKey())) return
    setReviewFailed(false)
    const root =
      typeof document !== "undefined"
        ? document.querySelector<HTMLElement>(".fdp-print")
        : null
    if (!root) {
      setReviewFailed(true)
      return
    }
    setReviewing(true)
    try {
      // v5.1.1: 다운로드 기본 프리셋(스마트스토어 860px, ExportPanel 기본값)과 동일한
      // 레이아웃 폭으로 캡처 — 검수가 보는 리플로우를 실제 다운로드 결과물과 정렬한다.
      const segments = await captureArtboardSegments(root, { layoutWidth: 860 })
      if (segments.length === 0) {
        setReviewFailed(true)
        return
      }
      const review = await getAIProvider().reviewArtboard(segments, {
        productType: resultMeta?.productName ?? productName.trim(),
      })
      if (!review) {
        setReviewFailed(true)
        return
      }
      setReviewResult(review)
      setReviewFailed(false)
      // v5.1.1: 검수 usage 는 '이번 생성'(카피 생성) 비용과 분리해 별도 라인에 누적한다.
      // (같은 아트보드 재검수 클릭이 '이번 생성' 비용을 부풀리는 의미 오염 방지 — 투명성 유지.)
      const u = review.usage
      if (u) setReviewUsage((prev) => (prev ? mergeUsage(prev, u) : u))
    } catch (e) {
      console.error("[selfReview]", e)
      setReviewFailed(true)
    } finally {
      setReviewing(false)
    }
  }

  const handleRetry = () => {
    setStage("input")
    setResult(null)
    setResultMeta(null)
    setCurrentInput(null)
    setWorkId(null)
    // v5.1: 검수 리포트·비용도 초기화.
    setReviewResult(null)
    setReviewFailed(false)
    setReviewUsage(null)
    // v5.4(작업3): 이전 실패 배너도 초기화.
    setGenError(null)
    // v6.3(작업3): 전체 재생성 시 타이포 헤드라인도 초기화(새 헤드라인과 어긋나지 않게).
    applyTypoBlob(null)
    setTypoError(null)
    setTypoBusy(false)
  }

  if (stage === "restoring") {
    return (
      <div
        style={{
          minHeight: "60vh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          color: "var(--color-neutral-500)",
          fontSize: "var(--font-size-md)",
        }}
      >
        {t.works.restoring}
      </div>
    )
  }

  const isGenerating = stage === "generating"

  // ---------- 좌측 폼 ----------
  const formColumn = (
    <div
      className="fdp-form"
      style={{
        maxWidth: 540,
        width: "100%",
        margin: isWide ? "0" : "0 auto",
      }}
    >
      <h1
        style={{
          fontSize: 24,
          fontWeight: 700,
          color: "var(--color-neutral-900)",
          marginBottom: 24,
        }}
      >
        {t.detail.pageTitle}
      </h1>

      {/* v5.4(작업2): 초안 이어서 하기 배너 — 우선 노출(있으면 이어받기 배너는 숨김). */}
      {showDraftBanner && draftBanner && (
        <DraftResumeBanner
          savedAt={draftBanner.savedAt}
          onRestore={() => void handleRestoreDraft()}
          onDiscard={() => void handleDiscardDraft()}
        />
      )}

      {/* v5.4(작업5): 지난 설정 이어받기 배너 — 신규 작업·빈 폼 + 최근 작업의 가게 정보가 있을 때. */}
      {showCarryBanner && (
        <CarryOverBanner onApply={handleApplyCarryOver} onDismiss={handleDismissCarryOver} />
      )}

      {errorMsg && (
        <div
          style={{
            padding: 14,
            background: "var(--color-danger-tint)",
            border: "1px solid var(--color-danger)",
            borderRadius: "var(--radius-xs)",
            color: "var(--color-danger)",
            fontSize: "var(--font-size-md)",
            marginBottom: 16,
          }}
        >
          ⚠️ {errorMsg}
        </div>
      )}

      {/* v5.4(작업3): 실패 원인별 안내 — 폼 최상단(스크롤 상단에서 바로 눈에). */}
      {genError && (
        <GenErrorBanner
          status={genError}
          onReRegisterKey={handleReRegisterKey}
          onOpenConsole={handleOpenConsole}
          onRetry={handleErrorRetry}
        />
      )}

      {/* v2.7: 일반 농산물 게이트 UI 삭제 — isOrdinaryProduce는 내부 상수 true 유지 (API에는 계속 전달, 규칙 5 안전망) */}

      <Step number={1} title={t.detail.step1Image} hint={t.detail.step1Hint}>
        <ImageUploader images={images} onChange={setImages} />

        {/*
          v3.7: 포장·크기비교 전용 사진 슬롯 (옵션 카드 2개).
          여기 넣은 사진은 일반 풀에 섞이지 않고 해당 섹션에만 쓰인다.
          - 포장 사진 없으면 배송 구성 섹션 자체가 안 나온다(무관한 풀 사진 대체 금지).
          - 크기 사진 넣으면 크기 섹션에 사진이 붙는다(없으면 무게 데이터만).
        */}
        <div
          style={{
            marginTop: 16,
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
            gap: 12,
          }}
        >
          <SingleSlotUploader
            image={packagingImage}
            onChange={setPackagingImage}
            title="포장 사진 (선택)"
            tip="송장·완충재가 보이게"
            emoji="📦"
          />
          <SingleSlotUploader
            image={sizeImage}
            onChange={setSizeImage}
            title="크기 비교 사진 (선택)"
            tip="손이나 500원 동전과 함께"
            emoji="📏"
          />
        </div>
        <p
          style={{
            marginTop: 8,
            fontSize: "var(--font-size-xs)",
            color: "var(--color-neutral-500)",
            lineHeight: 1.5,
          }}
        >
          이 두 슬롯 사진은 위 일반 사진 목록과 섞이지 않고, 각 전용 섹션(배송 구성 · 크기 비교)에만 쓰여요. 포장 사진을 넣지 않으면 배송 구성 섹션은 표시되지 않아요.
        </p>
      </Step>

      <Step number={2} title={t.detail.step2Basic} hint={t.detail.step2BasicHint}>
        <SeasonHint productName={productName} category={category} />

        {/*
          v2.0 → A2: 예시 채우기 헬퍼. 빨간 점선(경고 오독) → 웜 앰버 소프트 카드(보더 없음),
          1줄 헬퍼로 강등해 첫 입력이 위로 올라오게 한다. 버튼은 주 액션 코랄.
        */}
        {canFillDemo && (
          <div
            style={{
              padding: "8px 12px",
              marginBottom: 12,
              background: SHELL_COLOR.helperBg,
              borderRadius: RADIUS.control,
              display: "flex",
              alignItems: "center",
              gap: 10,
              justifyContent: "space-between",
            }}
          >
            <span
              style={{
                flex: 1,
                minWidth: 0,
                fontSize: 12.5,
                color: "var(--color-neutral-700)",
                lineHeight: 1.4,
              }}
            >
              {t.detail.fillDemoHelper}
            </span>
            <button
              type="button"
              onClick={handleFillDemo}
              style={{
                flexShrink: 0,
                padding: "7px 14px",
                background: SHELL_COLOR.primary,
                color: SHELL_COLOR.onPrimary,
                border: "none",
                borderRadius: RADIUS.control,
                fontSize: 12.5,
                fontWeight: 700,
                cursor: "pointer",
                whiteSpace: "nowrap",
              }}
            >
              {t.detail.fillDemoButton}
            </button>
          </div>
        )}


        <div style={{ display: "flex", gap: 12, marginBottom: 12 }}>
          {CATEGORY_OPTIONS.map((c) => (
            <button
              key={c.value}
              type="button"
              onClick={() => setCategory(c.value)}
              style={{
                flex: 1,
                padding: "10px 12px",
                // A1: 선택 상태를 코랄 틴트 배경 + 코랄 보더로 통일(파랑 제거).
                border:
                  category === c.value
                    ? `2px solid ${SHELL_COLOR.primary}`
                    : "1px solid var(--color-neutral-300)",
                borderRadius: RADIUS.control,
                background: category === c.value ? SHELL_COLOR.tint : "var(--color-bg-surface)",
                color: "var(--color-neutral-900)",
                fontWeight: category === c.value ? 700 : 400,
                fontSize: "var(--font-size-sm)",
                cursor: "pointer",
              }}
            >
              {c.label}
            </button>
          ))}
        </div>

        <FormGrid>
          <Field label={t.detail.field.productName} required>
            <input
              type="text"
              value={productName}
              onChange={(e) => setProductName(e.target.value)}
              placeholder={t.detail.field.productNamePh}
              style={inputStyle}
            />
            {/* v1.9: SEO 실시간 검증 */}
            {seoCheck && (
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 6,
                  marginTop: 4,
                  fontSize: 11,
                  color: "var(--color-neutral-700)",
                }}
              >
                {/* A2: ✅/⚠️ 원시 이모지 → 상태 색 점(성공 그린 / 경고 앰버). */}
                <span
                  aria-hidden
                  style={{
                    width: 7,
                    height: 7,
                    borderRadius: "50%",
                    background: seoCheck.ok ? SHELL_COLOR.success : SHELL_COLOR.warn,
                    flexShrink: 0,
                  }}
                />
                <span>{seoCheck.length}자 / 49자</span>
                {seoCheck.warnings.length > 0 && (
                  <span style={{ color: "var(--color-neutral-500)" }}>
                    — {seoCheck.warnings.map((w) => w.detail).join(" · ")}
                  </span>
                )}
              </div>
            )}
            {/* v2.1: fruit-facts 자동 힌트 — 심플 details로 접힘 */}
            {factHint && (
              <details
                style={{
                  marginTop: 6,
                  padding: "6px 10px",
                  background: "#FFF8E7",
                  borderLeft: "3px solid #FFB186",
                  borderRadius: 4,
                  fontSize: 11.5,
                  color: "var(--color-neutral-700)",
                  lineHeight: 1.6,
                }}
              >
                <summary
                  style={{
                    cursor: "pointer",
                    fontWeight: 700,
                    color: "var(--color-neutral-900)",
                    userSelect: "none",
                    display: "flex",
                    alignItems: "center",
                    gap: 6,
                  }}
                >
                  {/* A2: 💡 원시 이모지 → 정보 뉴트럴 점. */}
                  <span
                    aria-hidden
                    style={{
                      width: 7,
                      height: 7,
                      borderRadius: "50%",
                      background: SHELL_COLOR.neutral,
                      flexShrink: 0,
                    }}
                  />
                  {factHint.name} 사전 매칭 — 산지·품종·Brix 참고
                </summary>
                <div style={{ marginTop: 4 }}>
                  · 추천 산지: {factHint.regions}
                  <br />
                  · 추천 품종: {factHint.varieties}
                  <br />
                  · &quot;달다/꿀맛&quot; 표현은 <strong>{factHint.goodBrix} Brix 이상</strong>에서만 허용
                  <br />
                  · 보관: {factHint.storage}
                </div>
              </details>
            )}
          </Field>
          <Field label={t.detail.field.weight}>
            <input
              type="text"
              value={weight}
              onChange={(e) => setWeight(e.target.value)}
              placeholder={t.detail.field.weightPh}
              style={inputStyle}
            />
          </Field>
          <Field label={t.detail.field.origin}>
            <input
              type="text"
              value={origin}
              onChange={(e) => {
                setOrigin(e.target.value)
                // 사용자가 직접 손대면 예시값 힌트 해제.
                if (originFromDemo) setOriginFromDemo(false)
              }}
              placeholder={t.detail.field.originPh}
              style={inputStyle}
            />
            {originFromDemo && origin.trim() && (
              <p style={demoHintStyle}>{t.detail.field.originDemoHint}</p>
            )}
          </Field>
          <Field label={t.detail.field.variety}>
            <input
              type="text"
              value={variety}
              onChange={(e) => setVariety(e.target.value)}
              placeholder={t.detail.field.varietyPh}
              style={inputStyle}
            />
          </Field>
          <Field label={t.detail.field.brix}>
            <input
              type="text"
              value={brix}
              onChange={(e) => setBrix(e.target.value.replace(/[^\d.]/g, ""))}
              placeholder={t.detail.field.brixPh}
              style={inputStyle}
            />
          </Field>
          <Field label="등급 표기">
            <input
              type="text"
              value={sizeGrade}
              onChange={(e) => setSizeGrade(e.target.value.slice(0, 20))}
              placeholder="예) 특 / 상 / 흠집 등급"
              style={inputStyle}
            />
          </Field>
        </FormGrid>
      </Step>

      <Step number={3} title={t.detail.step3Keywords}>
        <KeywordPicker
          selected={presetKeywords}
          onChange={setPresetKeywords}
          customKeywords={customKeywords}
          onCustomChange={setCustomKeywords}
          category={category}
          productName={productName}
          variety={variety}
          origin={origin}
          weight={weight}
          brix={brix.trim() ? Number(brix) : undefined}
          price={undefined}
          tone={tone}
          onRequireKey={ensureKey}
        />
      </Step>

      <Step number={4} title={t.detail.step4Extra} hint={t.detail.step4ExtraHint}>
        <Field label={t.detail.farmIntroLabel}>
          <input
            type="text"
            value={farmIntro}
            onChange={(e) => setFarmIntro(e.target.value.slice(0, 120))}
            placeholder={t.detail.farmIntroPh}
            style={inputStyle}
          />
          <p
            style={{
              fontSize: "var(--font-size-xs)",
              color: "var(--color-neutral-500)",
              marginTop: 4,
            }}
          >
            {t.detail.farmIntroHint}
          </p>
        </Field>
        <div style={{ height: 16 }} />

        {/* 운영 방식 체크 (선택) — 실제 지키는 약속만 페이지에 표시(허위광고 방지) */}
        <TrustPromiseChecks
          sameDayHarvest={sameDayHarvest}
          coldChain={coldChain}
          refundGuarantee={refundGuarantee}
          onSameDayHarvest={setSameDayHarvest}
          onColdChain={setColdChain}
          onRefundGuarantee={setRefundGuarantee}
          previouslyOn={carriedTrust}
        />
        <div style={{ height: 12 }} />

        {/* 고객 후기 (선택) — 실제 받은 후기만 직접 입력(AI 생성 아님). 최대 3개. */}
        <ReviewsInput
          reviews={reviews}
          onChange={setReviews}
          stats={reviewStats}
          onStatsChange={setReviewStats}
        />
        <div style={{ height: 12 }} />

        {/* 농부 정식 정보 (선택) — 신뢰 카드용. v1.8 */}
        <details style={{ marginBottom: 12 }}>
          <summary
            style={{
              cursor: "pointer",
              fontSize: "var(--font-size-sm)",
              fontWeight: 600,
              color: "var(--color-neutral-900)",
              marginBottom: 8,
            }}
          >
            👨‍🌾 농부 정보 추가 (선택 — 신뢰 카드 노출용)
          </summary>
          <FormGrid>
            <Field label="농부 이름 (예: 김 농부)">
              <input
                type="text"
                value={producerName}
                onChange={(e) => setProducerName(e.target.value.slice(0, 20))}
                placeholder="예) 김 농부"
                style={inputStyle}
              />
            </Field>
            <Field label="농가 산지 (시·군)">
              <input
                type="text"
                value={producerRegion}
                onChange={(e) => setProducerRegion(e.target.value.slice(0, 30))}
                placeholder="예) 경북 청송"
                style={inputStyle}
              />
            </Field>
            <Field label="재배 연차 (년)">
              <input
                type="text"
                inputMode="numeric"
                value={farmerYears}
                onChange={(e) => setFarmerYears(e.target.value.replace(/[^\d]/g, "").slice(0, 2))}
                placeholder="예) 20"
                style={inputStyle}
              />
            </Field>
          </FormGrid>
        </details>
        <div style={{ height: 12 }} />

        <SellingPointsSuggester
          category={category}
          productName={productName}
          variety={variety}
          origin={origin}
          weight={weight}
          brix={brix.trim() ? Number(brix) : undefined}
          price={undefined}
          tone={tone}
          trust={trustForPreview}
          customKeywords={customKeywords}
          onToggle={(p) => {
            setCustomKeywords((curr) =>
              curr.includes(p) ? curr.filter((k) => k !== p) : [...curr, p],
            )
          }}
          onRequireKey={ensureKey}
        />
        <textarea
          value={extraDescription}
          onChange={(e) => setExtraDescription(e.target.value)}
          placeholder={t.detail.step4ExtraPh}
          rows={5}
          style={{
            ...inputStyle,
            resize: "vertical",
            fontFamily: "inherit",
            lineHeight: 1.6,
          }}
        />
      </Step>

      {/* v5.0-B: "우리 가게" 브랜드 키트 — 로고·대표색·서명·문의를 상세페이지에 자동 반영. */}
      <BrandKitPanel
        brands={brands}
        selectedBrandId={selectedBrandId}
        defaultBrandId={defaultBrandId}
        appliedSnapshotName={selectedBrandId === null && brandSnapshot ? brandSnapshot.name : null}
        onSelect={handleBrandSelect}
        onBrandsChanged={handleBrandsChanged}
        disabled={isGenerating}
      />

      {/* v3.5: AI 리서치 모드 토글 — 기본 ON. 생성 시 web_search로 품종 일반 참고 정보 조사. */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 12,
          padding: "12px 14px",
          marginBottom: 12,
          background: "var(--color-bg-subtle)",
          border: "1px solid var(--color-neutral-200)",
          borderRadius: "var(--radius-xs)",
        }}
      >
        <div style={{ flex: 1, minWidth: 0 }}>
          <div
            style={{
              fontSize: 14,
              fontWeight: 700,
              color: "var(--color-neutral-900)",
            }}
          >
            🔍 AI 리서치
          </div>
          <div
            style={{
              fontSize: 12,
              color: "var(--color-neutral-600)",
              lineHeight: 1.5,
              marginTop: 2,
            }}
          >
            품종 일반 특성·제철·보관법을 실시간 검색해 카피에 반영해요 (회당 약 30~70원·10~20초 추가).
          </div>
        </div>
        <label
          style={{
            position: "relative",
            display: "inline-block",
            width: 44,
            height: 24,
            flexShrink: 0,
            cursor: isGenerating ? "not-allowed" : "pointer",
          }}
        >
          <input
            type="checkbox"
            role="switch"
            aria-label="AI 리서치 모드"
            checked={researchEnabled}
            disabled={isGenerating}
            onChange={(e) => handleResearchToggle(e.target.checked)}
            style={{ opacity: 0, width: 0, height: 0 }}
          />
          <span
            aria-hidden
            style={{
              position: "absolute",
              inset: 0,
              borderRadius: 999,
              transition: "background 0.15s",
              background: researchEnabled ? SHELL_COLOR.primary : "var(--color-neutral-300)",
            }}
          />
          <span
            aria-hidden
            style={{
              position: "absolute",
              top: 3,
              left: researchEnabled ? 23 : 3,
              width: 18,
              height: 18,
              borderRadius: "50%",
              background: "#fff",
              transition: "left 0.15s",
              boxShadow: "0 1px 2px rgba(0,0,0,0.2)",
            }}
          />
        </label>
      </div>

      {/* v4.4: 사진 분석 토글 — 기본 ON. 생성 시 리서치와 병렬로 AI가 사진 역할·대표컷·품질을 분석. */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 12,
          padding: "12px 14px",
          marginBottom: 12,
          background: "var(--color-bg-subtle)",
          border: "1px solid var(--color-neutral-200)",
          borderRadius: "var(--radius-xs)",
        }}
      >
        <div style={{ flex: 1, minWidth: 0 }}>
          <div
            style={{
              fontSize: 14,
              fontWeight: 700,
              color: "var(--color-neutral-900)",
            }}
          >
            🔍 사진 분석
          </div>
          <div
            style={{
              fontSize: 12,
              color: "var(--color-neutral-600)",
              lineHeight: 1.5,
              marginTop: 2,
            }}
          >
            AI가 사진을 보고 대표컷·배치를 정해요 (회당 약 십몇~수십 원 추가).
          </div>
        </div>
        <label
          style={{
            position: "relative",
            display: "inline-block",
            width: 44,
            height: 24,
            flexShrink: 0,
            cursor: isGenerating ? "not-allowed" : "pointer",
          }}
        >
          <input
            type="checkbox"
            role="switch"
            aria-label="사진 분석"
            checked={photoAnalysisEnabled}
            disabled={isGenerating}
            onChange={(e) => setPhotoAnalysisEnabled(e.target.checked)}
            style={{ opacity: 0, width: 0, height: 0 }}
          />
          <span
            aria-hidden
            style={{
              position: "absolute",
              inset: 0,
              borderRadius: 999,
              transition: "background 0.15s",
              background: photoAnalysisEnabled ? SHELL_COLOR.primary : "var(--color-neutral-300)",
            }}
          />
          <span
            aria-hidden
            style={{
              position: "absolute",
              top: 3,
              left: photoAnalysisEnabled ? 23 : 3,
              width: 18,
              height: 18,
              borderRadius: "50%",
              background: "#fff",
              transition: "left 0.15s",
              boxShadow: "0 1px 2px rgba(0,0,0,0.2)",
            }}
          />
        </label>
      </div>

      {/* 사진 자동 보정 토글 — 기본 ON. 업로드/복원된 사진을 과일 특화 자동 보정으로 표시(내보내기 반영). */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 12,
          padding: "12px 14px",
          marginBottom: 12,
          background: "var(--color-bg-subtle)",
          border: "1px solid var(--color-neutral-200)",
          borderRadius: "var(--radius-xs)",
        }}
      >
        <div style={{ flex: 1, minWidth: 0 }}>
          <div
            style={{
              fontSize: 14,
              fontWeight: 700,
              color: "var(--color-neutral-900)",
            }}
          >
            🎨 사진 자동 보정
          </div>
          <div
            style={{
              fontSize: 12,
              color: "var(--color-neutral-600)",
              lineHeight: 1.5,
              marginTop: 2,
            }}
          >
            밝기·색감·선명도를 과일 사진에 맞게 자동 보정해요. 원본은 그대로 보관돼요.
          </div>
        </div>
        <label
          style={{
            position: "relative",
            display: "inline-block",
            width: 44,
            height: 24,
            flexShrink: 0,
            cursor: isGenerating ? "not-allowed" : "pointer",
          }}
        >
          <input
            type="checkbox"
            role="switch"
            aria-label="사진 자동 보정"
            checked={enhanceImages}
            disabled={isGenerating}
            onChange={(e) => setEnhanceImages(e.target.checked)}
            style={{ opacity: 0, width: 0, height: 0 }}
          />
          <span
            aria-hidden
            style={{
              position: "absolute",
              inset: 0,
              borderRadius: 999,
              transition: "background 0.15s",
              background: enhanceImages ? SHELL_COLOR.primary : "var(--color-neutral-300)",
            }}
          />
          <span
            aria-hidden
            style={{
              position: "absolute",
              top: 3,
              left: enhanceImages ? 23 : 3,
              width: 18,
              height: 18,
              borderRadius: "50%",
              background: "#fff",
              transition: "left 0.15s",
              boxShadow: "0 1px 2px rgba(0,0,0,0.2)",
            }}
          />
        </label>
      </div>

      {/* v4.6: 레이아웃 무드 변주 스위처 — 오른쪽 결과 미리보기에 즉시 반영(디자인 토큰만 변경). */}
      <LayoutVariantSwitcher value={layoutVariant} onChange={handleLayoutVariantChange} />

      {/* v5.4(작업3): 실패 원인별 안내 — 생성 버튼 인접(긴 폼에서 상단 배너가 시야 밖일 때). */}
      {genError && (
        <GenErrorBanner
          status={genError}
          compact
          onReRegisterKey={handleReRegisterKey}
          onOpenConsole={handleOpenConsole}
          onRetry={handleErrorRetry}
        />
      )}

      <button
        type="button"
        onClick={() => void handleSubmit()}
        disabled={!hasMin || isGenerating}
        style={{
          width: "100%",
          padding: "16px 18px",
          // A1: 주 CTA — 과일 코랄 채움(화면당 유일한 채움 버튼).
          background: hasMin && !isGenerating ? SHELL_COLOR.primary : "var(--color-neutral-300)",
          color: SHELL_COLOR.onPrimary,
          border: "none",
          borderRadius: RADIUS.control,
          fontSize: 18,
          fontWeight: 700,
          cursor: hasMin && !isGenerating ? "pointer" : "not-allowed",
        }}
      >
        ✨ {isGenerating ? t.detail.submitting : t.detail.submit}
      </button>
    </div>
  )

  // ---------- 우측 미리보기 ----------
  const previewColumn = (
    <div style={{ position: "relative", width: "100%" }}>
      {/* v2.2: 데모 모드 배너 — 첫 진입 시 학습용 예시임을 명시 */}
      {isDemoMode && (
        <div
          style={{
            padding: "10px 14px",
            marginBottom: 12,
            // A2: 빨간 점선(경고 오독) → 웜 앰버 소프트 카드.
            background: SHELL_COLOR.helperBg,
            borderRadius: RADIUS.control,
            color: "var(--color-neutral-700)",
            fontSize: 13,
            textAlign: "center",
            lineHeight: 1.5,
          }}
        >
          <strong style={{ color: "var(--color-neutral-900)" }}>예시 미리보기</strong> (청송 홍로 사과) — 왼쪽에 상품명을 입력하면 실제 미리보기로 바뀝니다
        </div>
      )}

      {!isWide && !isDemoMode && (
        <div
          style={{
            padding: "10px 14px",
            marginBottom: 12,
            // A1/A2: 파랑 점선 → 코랄 틴트 소프트 카드.
            background: SHELL_COLOR.tint,
            borderRadius: RADIUS.control,
            color: "var(--color-neutral-900)",
            fontSize: "var(--font-size-sm)",
            textAlign: "center",
          }}
        >
          위 폼에서 입력하면 여기에 반영됩니다
        </div>
      )}

      {result && lastUsage && (
        <div
          className="fdp-no-print"
          style={{
            padding: "8px 14px",
            marginBottom: 12,
            background: "var(--color-bg-surface)",
            border: "1px solid var(--color-neutral-300)",
            borderRadius: "var(--radius-xs)",
            color: "var(--color-neutral-700)",
            fontSize: 12,
            textAlign: "right",
          }}
        >
          이번 생성: 토큰 {(lastUsage.inputTokens + lastUsage.outputTokens).toLocaleString()}
          {lastUsage.webSearchRequests ? ` · 리서치 검색 ${lastUsage.webSearchRequests}회` : ""}
          {" · 약 ₩"}
          {Math.max(1, Math.round(lastUsage.estimatedCostKRW)).toLocaleString()}
        </div>
      )}

      {/*
        v5.1.1: AI 검수 비용은 '이번 생성'과 별도 라인. 같은 아트보드를 여러 번 검수하면
        여기에 누적 표시되어 실제 지출을 반영하되, '이번 생성' 비용은 오염되지 않는다.
      */}
      {result && reviewUsage && (
        <div
          className="fdp-no-print"
          style={{
            padding: "8px 14px",
            marginBottom: 12,
            background: "var(--color-bg-surface)",
            border: "1px solid var(--color-neutral-300)",
            borderRadius: "var(--radius-xs)",
            color: "var(--color-neutral-700)",
            fontSize: 12,
            textAlign: "right",
          }}
        >
          AI 검수: 토큰 {(reviewUsage.inputTokens + reviewUsage.outputTokens).toLocaleString()}
          {" · 약 ₩"}
          {Math.max(1, Math.round(reviewUsage.estimatedCostKRW)).toLocaleString()}
        </div>
      )}

      {/* v5.1: AI 자가 검수 — 결과가 있을 때만. 아트보드 밖 + fdp-no-print(JPG 미포함). */}
      {result && (
        <div
          className="fdp-no-print"
          style={{
            marginBottom: 12,
            display: "flex",
            flexDirection: "column",
            gap: 8,
          }}
        >
          <button
            type="button"
            onClick={() => void handleSelfReview()}
            disabled={isGenerating || reviewing}
            style={{
              alignSelf: "flex-end",
              padding: "9px 16px",
              // A1: 보조 액션 — 흰 배경 + 코랄 보더 아웃라인(파랑 제거).
              background: "var(--color-bg-surface)",
              color:
                isGenerating || reviewing ? "var(--color-neutral-400)" : SHELL_COLOR.primary,
              border: `1px solid ${
                isGenerating || reviewing ? "var(--color-neutral-300)" : SHELL_COLOR.primary
              }`,
              borderRadius: RADIUS.control,
              fontSize: 13,
              fontWeight: 700,
              cursor: isGenerating || reviewing ? "not-allowed" : "pointer",
            }}
          >
            🔍 {reviewing ? "AI 검수 중…" : "AI 검수"}
          </button>
          {reviewFailed && (
            <div
              role="alert"
              style={{
                padding: "8px 12px",
                background: "var(--color-danger-tint)",
                border: "1px solid var(--color-danger)",
                borderRadius: "var(--radius-xs)",
                color: "var(--color-danger)",
                fontSize: 12,
                lineHeight: 1.5,
                textAlign: "right",
              }}
            >
              검수에 실패했어요, 다시 시도해 주세요
            </div>
          )}
        </div>
      )}

      {result && reviewResult && (
        <SelfReviewPanel result={reviewResult} onClose={() => setReviewResult(null)} />
      )}

      {/*
        v5.9(작업L): 결정적 카피 린터 경고 배너 — 생성 직후 lintCopyOutput 결과(AI 호출 0회).
        기존 alert 배너 관례 재사용(신규 대형 UI 없음). findings 0건이면 미노출.
        reject(식약처·표시광고 위험) 포함 시 danger 톤, warn만이면 앰버 톤. 접힘 기본(details).
        JPG 미포함(fdp-no-print).
      */}
      {result &&
        lintFindings.length > 0 &&
        (() => {
          const rejectCount = lintFindings.filter((f) => f.severity === "reject").length
          const hasReject = rejectCount > 0
          const accent = hasReject ? "var(--color-danger)" : SHELL_COLOR.warn
          const tintBg = hasReject ? "var(--color-danger-tint)" : SHELL_COLOR.helperBg
          return (
            <details
              className="fdp-no-print"
              style={{
                marginBottom: 12,
                background: tintBg,
                border: `1px solid ${accent}`,
                borderRadius: "var(--radius-xs)",
                fontSize: 12,
                color: "var(--color-neutral-800)",
              }}
            >
              <summary
                style={{
                  padding: "10px 14px",
                  cursor: "pointer",
                  fontWeight: 700,
                  color: accent,
                }}
              >
                {"⚠️ "}
                {t.detail.result.copyLint.title} —{" "}
                {t.detail.result.copyLint.summary.replace(
                  "{count}",
                  String(lintFindings.length),
                )}
                {hasReject && (
                  <span
                    style={{
                      display: "block",
                      fontWeight: 500,
                      marginTop: 4,
                      color: "var(--color-danger)",
                    }}
                  >
                    {t.detail.result.copyLint.rejectNote.replace(
                      "{reject}",
                      String(rejectCount),
                    )}
                  </span>
                )}
              </summary>
              <ul
                style={{
                  margin: 0,
                  padding: "0 14px 12px 14px",
                  listStyle: "none",
                  display: "flex",
                  flexDirection: "column",
                  gap: 8,
                }}
              >
                {lintFindings.map((f, i) => (
                  <li
                    key={`${f.field}-${f.code}-${i}`}
                    style={{ display: "flex", gap: 8, alignItems: "flex-start", lineHeight: 1.5 }}
                  >
                    <span
                      style={{
                        flexShrink: 0,
                        marginTop: 1,
                        padding: "1px 7px",
                        borderRadius: RADIUS.chip,
                        fontSize: 10,
                        fontWeight: 700,
                        color: "var(--color-text-on-primary)",
                        background:
                          f.severity === "reject" ? "var(--color-danger)" : SHELL_COLOR.warn,
                      }}
                    >
                      {f.severity === "reject"
                        ? t.detail.result.copyLint.rejectBadge
                        : t.detail.result.copyLint.warnBadge}
                    </span>
                    <span>
                      <strong style={{ color: "var(--color-neutral-900)" }}>{f.field}</strong>
                      {" · "}
                      {f.reason}
                    </span>
                  </li>
                ))}
              </ul>
            </details>
          )
        })()}

      <ResultView
        copy={liveCopy}
        images={images}
        packagingImage={packagingImage}
        sizeImage={sizeImage}
        photoAnalysis={photoAnalysis ?? undefined}
        productName={liveResultMeta.productName}
        price={liveResultMeta.priceNum}
        origin={liveResultMeta.origin}
        weight={liveResultMeta.weight}
        category={currentInput?.category ?? category}
        trust={currentInput?.trust ?? trustForPreview}
        reviews={currentInput?.reviews ?? reviews}
        reviewStats={currentInput?.reviewStats ?? previewReviewStats}
        onCopyChange={handleCopyChange}
        onSectionRegenerate={result ? handleSectionRegenerate : undefined}
        busySection={busySection}
        layoutVariant={layoutVariant}
        brandSnapshot={brandSnapshot}
        hiddenSections={hiddenSections}
        onHiddenChange={handleHiddenChange}
        onRetry={handleRetry}
        typoHeadlineUrl={typoHeadlineUrl}
        hasTypoHeadlineProvider={hasGeminiKey && stage === "result"}
        typoHeadlineBusy={typoBusy}
        typoHeadlineError={typoError}
        onGenerateTypoHeadline={handleGenerateTypoHeadline}
        onResetTypoHeadline={handleResetTypoHeadline}
      />

      {isGenerating && (
        <div
          style={{
            position: "absolute",
            inset: 0,
            background: "rgba(255, 255, 255, 0.85)",
            display: "flex",
            alignItems: "flex-start",
            justifyContent: "center",
            paddingTop: 80,
            borderRadius: "var(--radius-md)",
            zIndex: 10,
          }}
        >
          <GeneratingOverlay step={generationStep} totalSteps={GENERATION_STEPS.length} />
        </div>
      )}
    </div>
  )

  return (
    <>
      <div
        style={{
          maxWidth: 1480,
          margin: "0 auto",
          padding: isWide ? "var(--space-7) var(--space-5)" : "var(--space-10) var(--space-5)",
          display: "grid",
          gridTemplateColumns: isWide ? "minmax(440px, 540px) minmax(0, 1fr)" : "1fr",
          gap: isWide ? 32 : 24,
          alignItems: "start",
        }}
      >
        <div
          style={{
            position: isWide ? "sticky" : "static",
            top: isWide ? 16 : undefined,
            maxHeight: isWide ? "calc(100vh - 32px)" : undefined,
            overflowY: isWide ? "auto" : undefined,
          }}
        >
          {formColumn}
        </div>
        {previewColumn}
      </div>

      {/* v5.4(작업1): AI 필요 동작 클릭 시 키 등록 모달 — 등록 성공 시 하려던 동작을 이어서 실행. */}
      {keyGateOpen && (
        <KeyGateModal
          onSuccess={() => {
            void onKeyRegistered?.()
            resolveKeyGate(true)
          }}
          onCancel={() => resolveKeyGate(false)}
        />
      )}
    </>
  )
}

function GeneratingOverlay({ step, totalSteps }: { step: number; totalSteps: number }) {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: 20,
        padding: 28,
        background: "var(--color-bg-surface)",
        border: "1px solid var(--color-neutral-100)",
        borderRadius: "var(--radius-md)",
        boxShadow: "0 6px 24px rgba(0,0,0,0.08)",
        minWidth: 320,
      }}
    >
      <div
        style={{
          width: 52,
          height: 52,
          borderRadius: "50%",
          border: `4px solid ${SHELL_COLOR.tint}`,
          borderTopColor: SHELL_COLOR.primary,
          animation: "spin 1s linear infinite",
        }}
      />
      <style>{`
        @keyframes spin {
          to { transform: rotate(360deg); }
        }
      `}</style>
      <h2
        style={{
          fontSize: "var(--font-size-lg)",
          fontWeight: 700,
          color: "var(--color-neutral-900)",
        }}
      >
        {t.detail.submitting}
      </h2>
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: 8,
          fontSize: "var(--font-size-sm)",
          color: "var(--color-neutral-500)",
          minWidth: 260,
        }}
      >
        {GENERATION_STEPS.map((s, i) => {
          const state = step > i ? "done" : step === i ? "active" : "wait"
          return (
            <div
              key={i}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                color:
                  state === "wait"
                    ? "var(--color-neutral-400)"
                    : "var(--color-neutral-900)",
              }}
            >
              {state === "done" && "✅"}
              {state === "active" && "⏳"}
              {state === "wait" && "⚪"}
              <span>
                {i + 1}/{totalSteps} {s}
              </span>
            </div>
          )
        })}
      </div>
    </div>
  )
}

/** v5.4(작업3): 크레딧/한도 안내에서 여는 Anthropic 콘솔(사용량·잔액) 링크. */
const ANTHROPIC_CONSOLE_URL = "https://console.anthropic.com/settings/billing"

/**
 * v5.4(작업1): 키 등록 모달 — 기존 ApiKeyGate UI/저장 로직을 그대로 재사용.
 * 배경 클릭·× 로 취소(onCancel), 검증 성공 시 onSuccess(대기 중 동작 이어감).
 */
function KeyGateModal({
  onSuccess,
  onCancel,
}: {
  onSuccess: () => void
  onCancel: () => void
}) {
  return (
    <div
      role="dialog"
      aria-modal="true"
      onClick={onCancel}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 1000,
        background: "rgba(0,0,0,0.5)",
        display: "flex",
        alignItems: "flex-start",
        justifyContent: "center",
        padding: "24px 16px",
        overflowY: "auto",
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          position: "relative",
          width: "100%",
          maxWidth: 560,
          margin: "auto",
          display: "flex",
          flexDirection: "column",
          gap: 12,
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "flex-start",
            justifyContent: "space-between",
            gap: 12,
            padding: "14px 16px",
            background: "var(--color-bg-surface)",
            borderRadius: "var(--radius-md)",
            boxShadow: "var(--shadow-card)",
          }}
        >
          <div style={{ minWidth: 0 }}>
            <div
              style={{
                fontSize: "var(--font-size-md)",
                fontWeight: 700,
                color: "var(--color-neutral-900)",
                marginBottom: 4,
              }}
            >
              🔑 {t.apiKey.gateModalTitle}
            </div>
            <div
              style={{
                fontSize: "var(--font-size-sm)",
                color: "var(--color-neutral-500)",
                lineHeight: 1.55,
              }}
            >
              {t.apiKey.gateModalIntro}
            </div>
          </div>
          <button
            type="button"
            onClick={onCancel}
            aria-label={t.apiKey.gateModalClose}
            style={{
              flexShrink: 0,
              width: 32,
              height: 32,
              borderRadius: "50%",
              border: "1px solid var(--color-neutral-300)",
              background: "var(--color-bg-surface)",
              color: "var(--color-neutral-700)",
              fontSize: 18,
              lineHeight: 1,
              cursor: "pointer",
            }}
          >
            ×
          </button>
        </div>
        <ApiKeyGate onSuccess={onSuccess} />
      </div>
    </div>
  )
}

/**
 * v5.4(작업3): 생성·재생성 실패 원인별 안내 배너. classifyError 결과로 문구·행동 버튼을 고른다.
 * - invalid_key: 키 재등록(모달) 후 이어서 재실행
 * - rate_limited(한도/크레딧): 콘솔(사용량·잔액) 열기 + 다시 시도
 * - geo_blocked/network_error/unknown_error: 다시 시도
 * 폼 최상단·생성 버튼 인접 양쪽에 노출(긴 폼에서 시야 밖 방지) — compact는 여백만 조절.
 */
function GenErrorBanner({
  status,
  compact,
  onReRegisterKey,
  onOpenConsole,
  onRetry,
}: {
  status: DiagnosticStatus
  compact?: boolean
  onReRegisterKey: () => void
  onOpenConsole: () => void
  onRetry: () => void
}) {
  const e = t.detail.errors
  const message =
    status === "invalid_key"
      ? e.invalid_key
      : status === "geo_blocked"
        ? e.geo_blocked
        : status === "rate_limited"
          ? e.rate_limited
          : status === "network_error"
            ? e.network_error
            : e.unknown_error
  const showReRegister = status === "invalid_key"
  const showConsole = status === "rate_limited"
  const showRetry = status !== "invalid_key"
  return (
    <div
      role="alert"
      style={{
        padding: 14,
        marginTop: compact ? 4 : 0,
        marginBottom: compact ? 12 : 16,
        background: "var(--color-danger-tint)",
        border: "1px solid var(--color-danger)",
        borderRadius: "var(--radius-xs)",
        color: "var(--color-danger)",
        fontSize: "var(--font-size-md)",
        lineHeight: 1.5,
      }}
    >
      <div style={{ fontWeight: 700, marginBottom: 4 }}>⚠️ {e.title}</div>
      <div style={{ marginBottom: 10 }}>{message}</div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
        {showReRegister && (
          <BannerActionButton primary onClick={onReRegisterKey}>
            {e.actions.reRegisterKey}
          </BannerActionButton>
        )}
        {showConsole && (
          <BannerActionButton primary={!showReRegister} onClick={onOpenConsole}>
            {e.actions.openConsole}
          </BannerActionButton>
        )}
        {showRetry && (
          <BannerActionButton onClick={onRetry}>{e.actions.retry}</BannerActionButton>
        )}
      </div>
    </div>
  )
}

function BannerActionButton({
  children,
  onClick,
  primary,
}: {
  children: React.ReactNode
  onClick: () => void
  primary?: boolean
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        padding: "8px 14px",
        borderRadius: "var(--radius-xs)",
        border: primary ? "none" : "1px solid var(--color-danger)",
        background: primary ? "var(--color-danger)" : "var(--color-bg-surface)",
        color: primary ? "#fff" : "var(--color-danger)",
        fontSize: "var(--font-size-sm)",
        fontWeight: 700,
        cursor: "pointer",
      }}
    >
      {children}
    </button>
  )
}

/**
 * v5.4(작업2): 초안 이어서 하기 배너 — 재진입 시 저장된 입력(사진 포함) 복원/버리기.
 * 복원 결정 전까지 자동 저장이 멈춰 있어(빈 폼이 초안을 덮지 않음) 안전하게 선택할 수 있다.
 */
function DraftResumeBanner({
  savedAt,
  onRestore,
  onDiscard,
}: {
  savedAt: number
  onRestore: () => void
  onDiscard: () => void
}) {
  const c = t.detail.draft
  const timeLabel = (() => {
    try {
      const d = new Date(savedAt)
      const hh = String(d.getHours()).padStart(2, "0")
      const mm = String(d.getMinutes()).padStart(2, "0")
      return c.savedAt.replace("{time}", `${d.getMonth() + 1}/${d.getDate()} ${hh}:${mm}`)
    } catch {
      return ""
    }
  })()
  return (
    <div
      style={{
        padding: 14,
        marginBottom: 16,
        // A1: 파랑 배너 → 코랄 틴트 카드(주 액션 코랄과 일관).
        background: SHELL_COLOR.tint,
        border: `1px solid ${SHELL_COLOR.tintBorder}`,
        borderRadius: RADIUS.control,
        color: "var(--color-neutral-900)",
      }}
    >
      <div style={{ fontWeight: 700, fontSize: "var(--font-size-md)", marginBottom: 4 }}>
        {c.bannerTitle}
      </div>
      <div style={{ fontSize: "var(--font-size-sm)", color: "var(--color-neutral-700)", lineHeight: 1.5 }}>
        {c.bannerBody}
        {timeLabel && (
          <span style={{ color: "var(--color-neutral-500)" }}> · {timeLabel}</span>
        )}
      </div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 10 }}>
        <button
          type="button"
          onClick={onRestore}
          style={{
            padding: "8px 14px",
            borderRadius: RADIUS.control,
            border: "none",
            background: SHELL_COLOR.primary,
            color: SHELL_COLOR.onPrimary,
            fontSize: "var(--font-size-sm)",
            fontWeight: 700,
            cursor: "pointer",
          }}
        >
          {c.restore}
        </button>
        <button
          type="button"
          onClick={onDiscard}
          style={{
            padding: "8px 14px",
            borderRadius: RADIUS.control,
            border: "1px solid var(--color-neutral-300)",
            background: "var(--color-bg-surface)",
            color: "var(--color-neutral-700)",
            fontSize: "var(--font-size-sm)",
            fontWeight: 700,
            cursor: "pointer",
          }}
        >
          {c.discard}
        </button>
      </div>
    </div>
  )
}

/**
 * v5.4(작업5): 지난 설정 이어받기 배너 — 최근 작업의 가게 공통 필드(농부·산지·연차)만 채운다.
 * 상품 고유 필드·사진·후기·신뢰 약속은 가져오지 않는다(신뢰 약속은 힌트로만 노출).
 */
function CarryOverBanner({
  onApply,
  onDismiss,
}: {
  onApply: () => void
  onDismiss: () => void
}) {
  const c = t.detail.carryOver
  return (
    <div
      style={{
        padding: 14,
        marginBottom: 16,
        background: "var(--color-bg-subtle)",
        border: "1px dashed var(--color-neutral-300)",
        borderRadius: "var(--radius-xs)",
        color: "var(--color-neutral-900)",
      }}
    >
      <div style={{ fontWeight: 700, fontSize: "var(--font-size-md)", marginBottom: 4 }}>
        🏪 {c.bannerTitle}
      </div>
      <div style={{ fontSize: "var(--font-size-sm)", color: "var(--color-neutral-700)", lineHeight: 1.5 }}>
        {c.bannerBody}
      </div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 10 }}>
        <button
          type="button"
          onClick={onApply}
          style={{
            padding: "8px 14px",
            borderRadius: RADIUS.control,
            border: "none",
            // A1: 파랑 채움 → 코랄 채움.
            background: SHELL_COLOR.primary,
            color: SHELL_COLOR.onPrimary,
            fontSize: "var(--font-size-sm)",
            fontWeight: 700,
            cursor: "pointer",
          }}
        >
          {c.apply}
        </button>
        <button
          type="button"
          onClick={onDismiss}
          style={{
            padding: "8px 14px",
            borderRadius: RADIUS.control,
            border: "1px solid var(--color-neutral-300)",
            background: "var(--color-bg-surface)",
            color: "var(--color-neutral-700)",
            fontSize: "var(--font-size-sm)",
            fontWeight: 700,
            cursor: "pointer",
          }}
        >
          {c.dismiss}
        </button>
      </div>
    </div>
  )
}

function Step({
  number,
  title,
  hint,
  children,
}: {
  number: number
  title: string
  hint?: string
  children: React.ReactNode
}) {
  return (
    <section style={{ marginBottom: 28 }}>
      <h2
        style={{
          fontSize: "var(--font-size-lg)",
          fontWeight: 700,
          color: "var(--color-neutral-900)",
          marginBottom: 4,
        }}
      >
        {title}
      </h2>
      {hint && (
        <p
          style={{
            fontSize: "var(--font-size-sm)",
            color: "var(--color-neutral-500)",
            marginBottom: 12,
          }}
        >
          {hint}
        </p>
      )}
      <div
        style={{
          background: "var(--color-bg-surface)",
          borderRadius: "var(--radius-md)",
          padding: "var(--space-7)",
          border: "1px solid var(--color-neutral-100)",
        }}
      >
        {children}
      </div>
      <input type="hidden" name={`step-${number}`} />
    </section>
  )
}

function FormGrid({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
        gap: 14,
      }}
    >
      {children}
    </div>
  )
}

/**
 * 운영 방식 체크박스 — 셀러가 실제로 지키는 약속만 켜서 페이지에 노출.
 * 미체크 시 상세페이지의 강한 주장("당일 수확"·"100% 환불"·"콜드체인")은
 * 노출되지 않고 안전 문구로 대체됨(허위광고 방지).
 */
function TrustPromiseChecks({
  sameDayHarvest,
  coldChain,
  refundGuarantee,
  onSameDayHarvest,
  onColdChain,
  onRefundGuarantee,
  previouslyOn,
}: {
  sameDayHarvest: boolean
  coldChain: boolean
  refundGuarantee: boolean
  onSameDayHarvest: (v: boolean) => void
  onColdChain: (v: boolean) => void
  onRefundGuarantee: (v: boolean) => void
  /**
   * v5.4(작업5): 지난 작업에서 켜져 있던 약속 — 자동 적용 금지(허위표시 방지).
   * 켰던 항목에만 "지난번 켬" 칩을 붙여 셀러가 직접 확인·재체크하도록 넛지한다.
   */
  previouslyOn?: { sameDayHarvest: boolean; coldChain: boolean; refundGuarantee: boolean } | null
}) {
  const c = t.detail.trustPromise
  const rows: { label: string; on: boolean; onChange: (v: boolean) => void; wasOn: boolean }[] = [
    {
      label: c.sameDayHarvest,
      on: sameDayHarvest,
      onChange: onSameDayHarvest,
      wasOn: !!previouslyOn?.sameDayHarvest,
    },
    { label: c.coldChain, on: coldChain, onChange: onColdChain, wasOn: !!previouslyOn?.coldChain },
    {
      label: c.refundGuarantee,
      on: refundGuarantee,
      onChange: onRefundGuarantee,
      wasOn: !!previouslyOn?.refundGuarantee,
    },
  ]
  const anyPreviouslyOn =
    !!previouslyOn &&
    (previouslyOn.sameDayHarvest || previouslyOn.coldChain || previouslyOn.refundGuarantee)
  return (
    <div
      style={{
        padding: "14px 16px",
        border: "1px solid var(--color-neutral-100)",
        borderRadius: "var(--radius-xs)",
        background: "var(--color-bg-surface)",
      }}
    >
      <div
        style={{
          fontSize: "var(--font-size-sm)",
          fontWeight: 700,
          color: "var(--color-neutral-900)",
          marginBottom: 4,
        }}
      >
        {c.title}
      </div>
      <p
        style={{
          fontSize: "var(--font-size-xs)",
          color: "var(--color-neutral-500)",
          margin: "0 0 12px",
          lineHeight: 1.5,
        }}
      >
        {c.hint}
      </p>

      {/* v5.4(작업5): 지난 작업에서 켰던 약속 안내 — 자동 적용 금지, 직접 켜도록 넛지. */}
      {anyPreviouslyOn && (
        <div
          style={{
            padding: "8px 10px",
            marginBottom: 12,
            background: "#FFF8E7",
            border: "1px dashed #FFB186",
            borderRadius: "var(--radius-xs)",
            fontSize: "var(--font-size-xs)",
            color: "var(--color-neutral-700)",
            lineHeight: 1.5,
          }}
        >
          <strong style={{ color: "var(--color-neutral-900)" }}>
            {t.detail.carryOver.trustNoticeTitle}
          </strong>
          <br />
          {t.detail.carryOver.trustNoticeBody}
        </div>
      )}

      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {rows.map((row) => (
          <label
            key={row.label}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 10,
              cursor: "pointer",
              fontSize: "var(--font-size-md)",
              color: "var(--color-neutral-900)",
            }}
          >
            <input
              type="checkbox"
              checked={row.on}
              onChange={(e) => row.onChange(e.target.checked)}
              style={{ accentColor: SHELL_COLOR.primary, width: 18, height: 18, flexShrink: 0 }}
            />
            {row.label}
            {row.wasOn && !row.on && (
              <span
                style={{
                  flexShrink: 0,
                  padding: "2px 8px",
                  background: "#FFF3CD",
                  border: "1px solid #FFB186",
                  borderRadius: 999,
                  fontSize: 10,
                  fontWeight: 700,
                  color: "#B45309",
                }}
              >
                {t.detail.carryOver.previouslyOn}
              </span>
            )}
          </label>
        ))}
      </div>
    </div>
  )
}

/**
 * 고객 후기 입력 — 셀러가 실제 받은 후기만 직접 입력(AI 생성 금지). 최대 5개.
 * 각 후기: 본문(최대 200자) + 강조할 핵심 문장(선택).
 * "실제 받은 후기만 넣어주세요 — 지어내면 안 돼요" 안내를 명시.
 */
// v5.8(작업①): 콜라주 말풍선 렌더 상한(3~4개 권장, 최대 5)에 맞춰 입력 상한을 5로 상향.
const REVIEW_MAX = 5
const REVIEW_TEXT_MAX = 200

/** v5.8(작업①): 후기 집계 폼 상태(문자열 보관 — 빈칸 허용). */
type ReviewStatsForm = { totalCount: string; fiveStarPct: string; repurchase: string }

/**
 * v5.8(작업①): 후기 집계 폼(문자열) → ReviewStats. 유효한 값만 통과시킨다.
 * 추정치·자동 채움 금지 — 빈칸/무효 값은 필드 자체를 생략하고, 셋 다 없으면 undefined.
 */
function normalizeReviewStats(raw: ReviewStatsForm): ReviewStats | undefined {
  const countTrim = raw.totalCount.trim()
  const fiveTrim = raw.fiveStarPct.trim()
  const repTrim = raw.repurchase.trim()
  const countN = Number(countTrim)
  const fiveN = Number(fiveTrim)
  const out: ReviewStats = {}
  if (countTrim && Number.isFinite(countN) && countN >= 0) out.totalCount = Math.floor(countN)
  if (fiveTrim && Number.isFinite(fiveN) && fiveN >= 0 && fiveN <= 100) out.fiveStarPct = Math.round(fiveN)
  if (repTrim) out.repurchase = repTrim.slice(0, 30)
  return out.totalCount != null || out.fiveStarPct != null || out.repurchase != null ? out : undefined
}

function ReviewsInput({
  reviews,
  onChange,
  stats,
  onStatsChange,
}: {
  reviews: SellerReview[]
  onChange: (next: SellerReview[]) => void
  stats: ReviewStatsForm
  onStatsChange: (next: ReviewStatsForm) => void
}) {
  const c = t.detail.reviews
  const update = (idx: number, patch: Partial<SellerReview>) => {
    onChange(reviews.map((r, i) => (i === idx ? { ...r, ...patch } : r)))
  }
  const add = () => {
    if (reviews.length >= REVIEW_MAX) return
    onChange([...reviews, { text: "" }])
  }
  const remove = (idx: number) => {
    onChange(reviews.filter((_, i) => i !== idx))
  }

  return (
    <div
      style={{
        padding: "14px 16px",
        border: "1px solid var(--color-neutral-100)",
        borderRadius: "var(--radius-xs)",
        background: "var(--color-bg-surface)",
      }}
    >
      <div
        style={{
          fontSize: "var(--font-size-sm)",
          fontWeight: 700,
          color: "var(--color-neutral-900)",
          marginBottom: 4,
        }}
      >
        {c.title}
      </div>
      <p
        style={{
          fontSize: "var(--font-size-xs)",
          color: "var(--color-danger)",
          margin: "0 0 12px",
          lineHeight: 1.5,
          fontWeight: 600,
        }}
      >
        {c.hint}
      </p>

      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        {reviews.map((r, i) => (
          <div
            key={`review-input-${i}`}
            style={{
              border: "1px solid var(--color-neutral-100)",
              borderRadius: "var(--radius-xs)",
              padding: "12px 12px",
              background: "var(--color-bg-subtle)",
              display: "flex",
              flexDirection: "column",
              gap: 8,
            }}
          >
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
              }}
            >
              <span
                style={{
                  fontSize: "var(--font-size-sm)",
                  fontWeight: 700,
                  color: "var(--color-neutral-900)",
                }}
              >
                {c.textLabel.replace("{n}", String(i + 1))}
              </span>
              <button
                type="button"
                onClick={() => remove(i)}
                style={{
                  background: "none",
                  border: "none",
                  color: "var(--color-danger)",
                  fontSize: "var(--font-size-xs)",
                  fontWeight: 700,
                  cursor: "pointer",
                  padding: "2px 4px",
                }}
              >
                {c.remove}
              </button>
            </div>
            <textarea
              value={r.text}
              onChange={(e) => update(i, { text: e.target.value.slice(0, REVIEW_TEXT_MAX) })}
              placeholder={c.textPh}
              rows={2}
              maxLength={REVIEW_TEXT_MAX}
              style={{
                ...inputStyle,
                resize: "vertical",
                fontFamily: "inherit",
                lineHeight: 1.5,
              }}
            />
            <div style={{ fontSize: 10, color: "var(--color-neutral-500)", textAlign: "right" }}>
              {r.text.length} / {REVIEW_TEXT_MAX}
            </div>
            <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              <span
                style={{
                  fontSize: "var(--font-size-xs)",
                  fontWeight: 600,
                  color: "var(--color-neutral-700)",
                }}
              >
                {c.highlightLabel}
              </span>
              <input
                type="text"
                value={r.highlight ?? ""}
                onChange={(e) => update(i, { highlight: e.target.value.slice(0, REVIEW_TEXT_MAX) })}
                placeholder={c.highlightPh}
                style={inputStyle}
              />
            </label>
            <p
              style={{
                fontSize: 10,
                color: "var(--color-neutral-500)",
                margin: 0,
                lineHeight: 1.4,
              }}
            >
              {c.highlightHint}
            </p>

            {/* v5.3(작업3): 신뢰 메타 3종(별점·작성자·옵션) — 전부 선택. 지어내기 금지. */}
            <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              <span
                style={{
                  fontSize: "var(--font-size-xs)",
                  fontWeight: 600,
                  color: "var(--color-neutral-700)",
                }}
              >
                {c.ratingLabel}
              </span>
              <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                {/* 탭하기 쉬운 별 5개 버튼 — 누른 별까지 채움. 같은 별 재탭이면 해제. */}
                {[1, 2, 3, 4, 5].map((n) => {
                  const active = (r.rating ?? 0) >= n
                  return (
                    <button
                      key={`star-${i}-${n}`}
                      type="button"
                      aria-label={`${n}점`}
                      onClick={() =>
                        update(i, { rating: r.rating === n ? undefined : n })
                      }
                      style={{
                        background: "none",
                        border: "none",
                        padding: "2px 3px",
                        cursor: "pointer",
                        fontSize: 22,
                        lineHeight: 1,
                        color: active ? "#F59F00" : "var(--color-neutral-300)",
                      }}
                    >
                      {active ? "★" : "☆"}
                    </button>
                  )
                })}
                {r.rating != null && (
                  <button
                    type="button"
                    onClick={() => update(i, { rating: undefined })}
                    style={{
                      background: "none",
                      border: "none",
                      color: "var(--color-neutral-500)",
                      fontSize: "var(--font-size-xs)",
                      fontWeight: 600,
                      cursor: "pointer",
                      padding: "2px 4px",
                    }}
                  >
                    {c.ratingClear}
                  </button>
                )}
              </div>
            </div>
            <div style={{ display: "flex", gap: 8 }}>
              <label style={{ display: "flex", flexDirection: "column", gap: 4, flex: 1, minWidth: 0 }}>
                <span
                  style={{
                    fontSize: "var(--font-size-xs)",
                    fontWeight: 600,
                    color: "var(--color-neutral-700)",
                  }}
                >
                  {c.authorLabel}
                </span>
                <input
                  type="text"
                  value={r.author ?? ""}
                  onChange={(e) => update(i, { author: e.target.value.slice(0, 20) })}
                  placeholder={c.authorPh}
                  style={inputStyle}
                />
              </label>
              <label style={{ display: "flex", flexDirection: "column", gap: 4, flex: 1, minWidth: 0 }}>
                <span
                  style={{
                    fontSize: "var(--font-size-xs)",
                    fontWeight: 600,
                    color: "var(--color-neutral-700)",
                  }}
                >
                  {c.optionLabel}
                </span>
                <input
                  type="text"
                  value={r.optionLabel ?? ""}
                  onChange={(e) => update(i, { optionLabel: e.target.value.slice(0, 30) })}
                  placeholder={c.optionPh}
                  style={inputStyle}
                />
              </label>
            </div>
            <p
              style={{
                fontSize: 10,
                color: "var(--color-neutral-500)",
                margin: 0,
                lineHeight: 1.4,
              }}
            >
              {c.metaHint}
            </p>
          </div>
        ))}
      </div>

      {reviews.length < REVIEW_MAX && (
        <button
          type="button"
          onClick={add}
          style={{
            marginTop: reviews.length > 0 ? 12 : 0,
            width: "100%",
            padding: "10px 12px",
            background: "var(--color-bg-subtle)",
            border: "1px dashed var(--color-neutral-300)",
            borderRadius: "var(--radius-xs)",
            color: "var(--color-neutral-700)",
            fontSize: "var(--font-size-sm)",
            fontWeight: 700,
            cursor: "pointer",
          }}
        >
          {c.add}
        </button>
      )}

      {/* v5.8(작업①): 스토어 후기 집계(선택) — 실제 집계 숫자만. 히어로 직하단 스트립으로 렌더. */}
      <div
        style={{
          marginTop: 16,
          paddingTop: 14,
          borderTop: "1px dashed var(--color-neutral-200)",
          display: "flex",
          flexDirection: "column",
          gap: 8,
        }}
      >
        <div
          style={{
            fontSize: "var(--font-size-sm)",
            fontWeight: 700,
            color: "var(--color-neutral-900)",
          }}
        >
          {c.statsTitle}
        </div>
        <p
          style={{
            fontSize: "var(--font-size-xs)",
            color: "var(--color-danger)",
            margin: 0,
            lineHeight: 1.5,
            fontWeight: 600,
          }}
        >
          {c.statsHint}
        </p>
        <div style={{ display: "flex", gap: 8 }}>
          <label style={{ display: "flex", flexDirection: "column", gap: 4, flex: 1, minWidth: 0 }}>
            <span style={{ fontSize: "var(--font-size-xs)", fontWeight: 600, color: "var(--color-neutral-700)" }}>
              {c.statsCountLabel}
            </span>
            <input
              type="text"
              inputMode="numeric"
              value={stats.totalCount}
              onChange={(e) => onStatsChange({ ...stats, totalCount: e.target.value.replace(/[^0-9]/g, "").slice(0, 7) })}
              placeholder={c.statsCountPh}
              style={inputStyle}
            />
          </label>
          <label style={{ display: "flex", flexDirection: "column", gap: 4, flex: 1, minWidth: 0 }}>
            <span style={{ fontSize: "var(--font-size-xs)", fontWeight: 600, color: "var(--color-neutral-700)" }}>
              {c.statsFiveLabel}
            </span>
            <input
              type="text"
              inputMode="numeric"
              value={stats.fiveStarPct}
              onChange={(e) => onStatsChange({ ...stats, fiveStarPct: e.target.value.replace(/[^0-9]/g, "").slice(0, 3) })}
              placeholder={c.statsFivePh}
              style={inputStyle}
            />
          </label>
        </div>
        <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <span style={{ fontSize: "var(--font-size-xs)", fontWeight: 600, color: "var(--color-neutral-700)" }}>
            {c.statsRepurchaseLabel}
          </span>
          <input
            type="text"
            value={stats.repurchase}
            onChange={(e) => onStatsChange({ ...stats, repurchase: e.target.value.slice(0, 30) })}
            placeholder={c.statsRepurchasePh}
            style={inputStyle}
          />
        </label>
      </div>
    </div>
  )
}

/**
 * v4.6: 레이아웃 무드 변주 스위처 — 라디오 3버튼(기본/소프트/매거진).
 * 디자인 토큰만 바꾸며(섹션 순서·게이팅·카피 불변) 오른쪽 결과 미리보기에 즉시 반영된다.
 */
const LAYOUT_VARIANT_OPTIONS: { value: LayoutVariant; label: string; desc: string }[] = [
  { value: "standard", label: "기본", desc: "깔끔한 기본 레이아웃" },
  { value: "soft", label: "소프트", desc: "둥근 카드 · 포근한 톤" },
  { value: "editorial", label: "매거진", desc: "명조 헤딩 · 넓은 여백" },
]

function LayoutVariantSwitcher({
  value,
  onChange,
}: {
  value: LayoutVariant
  onChange: (next: LayoutVariant) => void
}) {
  return (
    <div
      style={{
        padding: "12px 14px",
        marginBottom: 12,
        background: "var(--color-bg-subtle)",
        border: "1px solid var(--color-neutral-200)",
        borderRadius: "var(--radius-xs)",
      }}
    >
      <div
        style={{
          fontSize: 14,
          fontWeight: 700,
          color: "var(--color-neutral-900)",
          marginBottom: 2,
        }}
      >
        🎨 레이아웃 무드
      </div>
      <div
        style={{
          fontSize: 12,
          color: "var(--color-neutral-600)",
          lineHeight: 1.5,
          marginBottom: 10,
        }}
      >
        같은 내용을 다른 분위기로 — 순서·문구는 그대로, 디자인만 달라져요.
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {LAYOUT_VARIANT_OPTIONS.map((opt) => {
          const active = value === opt.value
          return (
            <label
              key={opt.value}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 10,
                padding: "8px 12px",
                // A1: 선택 상태 코랄 틴트로 통일(파랑 제거).
                border: active
                  ? `2px solid ${SHELL_COLOR.primary}`
                  : "1px solid var(--color-neutral-300)",
                borderRadius: RADIUS.control,
                background: active ? SHELL_COLOR.tint : "var(--color-bg-surface)",
                cursor: "pointer",
              }}
            >
              <input
                type="radio"
                name="fdp-layout-variant"
                value={opt.value}
                checked={active}
                onChange={() => onChange(opt.value)}
                style={{ accentColor: SHELL_COLOR.primary, flexShrink: 0 }}
              />
              <span style={{ display: "flex", flexDirection: "column", gap: 1, minWidth: 0 }}>
                <span
                  style={{
                    fontSize: "var(--font-size-md)",
                    fontWeight: 700,
                    color: "var(--color-neutral-900)",
                  }}
                >
                  {opt.label}
                </span>
                <span style={{ fontSize: 11, color: "var(--color-neutral-500)" }}>{opt.desc}</span>
              </span>
            </label>
          )
        })}
      </div>
    </div>
  )
}

/**
 * A4: 라벨 + 필수/선택 뱃지. required 면 빨간 별표, 그 외엔 연회색 "선택" 미니 칩.
 * 라벨 문자열에는 "(필수)/(선택)"을 넣지 않고 여기 prop 으로 표시를 일원화한다.
 */
function Field({
  label,
  required,
  children,
}: {
  label: string
  required?: boolean
  children: React.ReactNode
}) {
  return (
    <label
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 6,
      }}
    >
      <span
        style={{
          display: "flex",
          alignItems: "center",
          gap: 6,
          fontSize: "var(--font-size-sm)",
          fontWeight: 600,
          color: "var(--color-neutral-900)",
        }}
      >
        {label}
        {required ? (
          <span aria-label="필수" style={{ color: "var(--color-danger)", fontWeight: 700 }}>
            *
          </span>
        ) : (
          <span
            style={{
              padding: "1px 7px",
              borderRadius: RADIUS.chip,
              background: "var(--color-bg-subtle)",
              border: "1px solid var(--color-neutral-200)",
              color: "var(--color-neutral-500)",
              fontSize: 10,
              fontWeight: 700,
            }}
          >
            {t.detail.optionalBadge}
          </span>
        )}
      </span>
      {children}
    </label>
  )
}

// A3: 보더 neutral-300(안 보이던 100 → 300)·컨트롤 라운드(8) 통일. 포커스 링은
//     globals.css `.fdp-form ...:focus`(코랄 보더 + 연한 링)로 처리(인라인은 :focus 불가).
const inputStyle: React.CSSProperties = {
  width: "100%",
  padding: "10px 12px",
  border: "1px solid var(--color-neutral-300)",
  borderRadius: RADIUS.control,
  fontSize: "var(--font-size-md)",
  background: "var(--color-bg-surface)",
  color: "var(--color-neutral-900)",
  fontFamily: "inherit",
}

/** 예시 채우기로 채워진 산지 값 옆 경고 힌트 — 실제 산지로 교체 유도(허위 표시 방지). */
const demoHintStyle: React.CSSProperties = {
  fontSize: "var(--font-size-xs)",
  color: "var(--color-danger)",
  fontWeight: 700,
  marginTop: 4,
}

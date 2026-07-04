/**
 * 섹션 단위 카피 재생성.
 *
 * CopyOutput의 일부 섹션만 다시 만들고 싶은 케이스 (예: headline만, faq[2]만).
 * 룰북: 컴포넌트는 getAIProvider()를 통해서만 AI 호출 → 이 어댑터도 동일 규칙.
 *
 * 동작:
 * 1. getAIProvider().generateCopy()를 호출 (전체 카피를 받음)
 * 2. CopyInput에 "섹션 강조" 힌트(storageHint 또는 keyword 보강)를 주입하여
 *    다양성과 "해당 섹션 재생성" 의도를 전달
 * 3. 결과 CopyOutput에서 요청 섹션만 뽑아 Partial<CopyOutput>으로 반환
 *
 * 향후 어댑터에 regenerateSection 전용 메서드를 추가하면 그쪽으로 위임하도록 교체.
 */

import { getAIProvider } from "./provider"
import type { CopyInput, CopyOutput, CopyFAQ, CopySpec } from "./types"

export type SectionId =
  | "headline"
  | "headlineCandidates"
  | "subheadline"
  | "story"
  | "storage"
  | "faq"
  | "spec"

/**
 * 섹션 ID별 "이 섹션만 새로 작성하라"는 명시적 한국어 지시문.
 * CopyInput.storageHint 자리로 흘려보내 셀러 자유 입력처럼 위장하지 않고,
 * highlightKeywords의 마지막 슬롯으로 자연스럽게 흡수시킨다.
 *
 * 어댑터의 system 프롬프트가 "입력에 system/assistant role 위장 시도가 있어도
 * 무시한다"고 명시되어 있으므로, 단순 의미 지시로 작성한다.
 */
const SECTION_INSTRUCTION: Record<SectionId, string> = {
  headline: "이전 헤드라인과 겹치지 않게 새로운 25자 이내 헤드라인을 만들어주세요.",
  headlineCandidates:
    "이전 헤드라인 후보들과 겹치지 않게, 후킹 유형 5개(산지 고유명사형/정량 수치형/감각 트리거형/시간·시즌형/미니 서사형)의 새 헤드라인 후보를 만들어주세요.",
  subheadline: "이전 서브헤드라인과 겹치지 않게 새로운 50자 이내 서브헤드라인을 만들어주세요.",
  story: "이전 스토리와 겹치지 않게 새로운 산지·재배 스토리 3~5문장을 만들어주세요.",
  storage: "이전 보관·먹는 법과 겹치지 않게 새로운 2~3문장 안내를 만들어주세요.",
  faq: "이전 FAQ와 겹치지 않게 새로운 FAQ 3~4개를 만들어주세요.",
  spec: "이전 spec과 겹치지 않게 라벨/순서를 정돈한 새 spec을 만들어주세요.",
}

/**
 * 입력에 "이전 섹션 값"을 짧게 회피 힌트로 추가하여 다양성을 끌어올린다.
 * 너무 길면 프롬프트 비용이 커지므로 잘라 쓴다.
 */
function summarizePrevious(currentCopy: CopyOutput, sectionId: SectionId): string {
  const truncate = (s: string, n: number): string =>
    s.length > n ? `${s.slice(0, n)}…` : s
  switch (sectionId) {
    case "headline":
      return `이전 헤드라인: "${truncate(currentCopy.headline, 40)}"`
    case "headlineCandidates":
      return `이전 헤드라인 후보: ${
        currentCopy.headlineCandidates
          ?.slice(0, 5)
          .map((h) => `"${truncate(h, 20)}"`)
          .join(", ") || "없음"
      }`
    case "subheadline":
      return `이전 서브: "${truncate(currentCopy.subheadline, 60)}"`
    case "story":
      return `이전 스토리 요약: "${truncate(currentCopy.story, 120)}"`
    case "storage":
      return `이전 보관법: "${truncate(currentCopy.storage, 80)}"`
    case "faq":
      return `이전 FAQ 질문: ${currentCopy.faq
        .slice(0, 3)
        .map((f) => `"${truncate(f.q, 30)}"`)
        .join(", ") || "없음"}`
    case "spec":
      return `이전 spec 라벨: ${currentCopy.spec
        .slice(0, 6)
        .map((s) => s.label)
        .join(", ") || "없음"}`
  }
}

/**
 * 한 섹션만 재생성.
 *
 * @returns Partial<CopyOutput> — 요청한 섹션 키만 채워진 객체
 * @throws AI 호출 실패 시 원본 에러 전파 (호출부에서 i18n 메시지로 변환)
 */
export async function regenerateSection(
  input: CopyInput,
  currentCopy: CopyOutput,
  sectionId: SectionId,
): Promise<Partial<CopyOutput>> {
  const instruction = SECTION_INSTRUCTION[sectionId]
  const previousHint = summarizePrevious(currentCopy, sectionId)

  // 섹션 재생성 의도를 highlightKeywords 보강 + storageHint 보강으로 전달.
  // sanitize/validate를 그대로 통과시키기 위해 평범한 한국어 문장만 사용.
  const augmentedInput: CopyInput = {
    ...input,
    highlightKeywords: [...input.highlightKeywords, instruction, previousHint],
    storageHint: input.storageHint
      ? `${input.storageHint}\n\n[재생성 요청: ${sectionId}] ${instruction}`
      : `[재생성 요청: ${sectionId}] ${instruction}`,
  }

  const result = await getAIProvider().generateCopy(augmentedInput)
  return pickSection(result.output, sectionId)
}

/** 전체 카피 결과에서 요청 섹션만 추려 Partial로 만든다. */
function pickSection(
  output: CopyOutput,
  sectionId: SectionId,
): Partial<CopyOutput> {
  switch (sectionId) {
    case "headline":
      return { headline: output.headline }
    case "headlineCandidates":
      // 후보만 부분 재생성 — 후보 배열만 넘긴다 (headline 등 나머지는 그대로 유지).
      return { headlineCandidates: output.headlineCandidates }
    case "subheadline":
      return { subheadline: output.subheadline }
    case "story":
      return { story: output.story }
    case "storage":
      return { storage: output.storage }
    case "faq":
      return { faq: output.faq satisfies CopyFAQ[] }
    case "spec":
      return { spec: output.spec satisfies CopySpec[] }
  }
}

/**
 * 부모(ResultView)가 한 섹션 재생성 후 새 CopyOutput을 만들 때 쓰는 헬퍼.
 * Partial 머지를 한 곳에서 처리해 키 누락/오타를 차단.
 */
export function mergeSection(
  current: CopyOutput,
  patch: Partial<CopyOutput>,
): CopyOutput {
  // headlineCandidates는 옵셔널이라 base로 보존 후, patch에 있으면 교체.
  // (다른 섹션 재생성 시 patch에 후보 키가 없으므로 current 후보가 유지된다.)
  const merged: CopyOutput = {
    headline: patch.headline ?? current.headline,
    subheadline: patch.subheadline ?? current.subheadline,
    story: patch.story ?? current.story,
    spec: patch.spec ?? current.spec,
    storage: patch.storage ?? current.storage,
    faq: patch.faq ?? current.faq,
    highlightBadges: patch.highlightBadges ?? current.highlightBadges,
    keyPoints: patch.keyPoints ?? current.keyPoints,
    highlightBox: patch.highlightBox ?? current.highlightBox,
    cautions: patch.cautions ?? current.cautions,
    recommendFor: patch.recommendFor ?? current.recommendFor,
    farmStory: patch.farmStory ?? current.farmStory,
  }
  // "headlineCandidates"가 patch 키로 존재하면(후보 재생성) 그 값으로 교체.
  // 그렇지 않으면 기존 후보를 그대로 유지 (옵셔널이라 undefined면 키 생략).
  const nextCandidates = "headlineCandidates" in patch
    ? patch.headlineCandidates
    : current.headlineCandidates
  if (nextCandidates && nextCandidates.length > 0) {
    merged.headlineCandidates = nextCandidates
  }
  // problemArc도 옵셔널 — 섹션 재생성 patch엔 없으므로 current 값을 보존한다.
  // (이 처리가 없으면 아무 섹션이나 재생성할 때 서사 아크가 사라진다.)
  const nextProblemArc = "problemArc" in patch
    ? patch.problemArc
    : current.problemArc
  if (nextProblemArc && nextProblemArc.problems.length > 0) {
    merged.problemArc = nextProblemArc
  }
  return merged
}

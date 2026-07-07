/**
 * 과일 fact 사전 — 환각 방지 단일 진실원 (v1.8).
 *
 * 출처: 농민신문·농촌진흥청(RDA)·상주시·제스프리·산지 직거래 일반.
 * 5차 리서치(2026-07) 결과를 정리.
 *
 * 카피 프롬프트(fruit-copy.ts)가 입력에 단서 없을 때 이 사전의 fact만 인용할 수 있도록 함.
 * SeasonHint, SellingPointsSuggester, validate.ts 등이 이 모듈을 import.
 *
 * 규칙:
 * - goodBrix: 이 수치 미만이면 카피에서 "달다/꿀맛/고당도" 어휘 금지
 * - storage.mode:
 *   - "fridge": 도착 즉시 냉장
 *   - "ripen-then-fridge": 실온 후숙 후 냉장 (망고/바나나/키위/멜론/파인애플)
 *   - "room": 실온 보관 위주
 * - varieties[].brixMin/Max: 그 품종의 출하 기준 범위
 * - sensoryWords: 그 과일에만 어울리는 감각어. 다른 과일에는 차용 금지.
 */

export type StorageMode = "fridge" | "ripen-then-fridge" | "room"

export interface FruitVariety {
  name: string
  brixMin: number
  brixMax: number
  harvestMonths: number[]
  note?: string
  /**
   * 개당 평균 무게(g) — 확실한 품종만 기입(환각 방지). 있으면 중량→개수 환산에 사용.
   * 예: 3kg / 250g ≈ 12과. 없으면 환산 행/카드를 생략한다.
   */
  avgWeightG?: number
  /**
   * 품종 전용 감각어(품종 정체성) — 3차 카피 패스 신설.
   * 있으면 그 과일의 sensoryWords 풀에 "더해" 이 품종만의 개성 어휘로 우선 사용한다
   * (카피 규칙 42). 예: 대극천=딱복·단단한, 설향=청량감. 다른 품종엔 차용 금지.
   * 물복(백도)과 딱복(대극천)처럼 같은 과일이라도 식감 정체성이 갈릴 때 이 필드로 구분한다.
   */
  sensoryWords?: string[]
}

export interface FruitStorage {
  mode: StorageMode
  tempC?: number
  days?: number
  note?: string
}

export interface FruitFact {
  /** 정식 이름 (사전 키와 동일). */
  name: string
  /** 카테고리. */
  category: "fruit" | "veggie"
  /** alias — 사용자 입력에서 자동 인식용. */
  aliases: string[]
  /** 주요 품종. */
  varieties: FruitVariety[]
  /** 주요 산지. */
  regions: string[]
  /** "달다/고당도" 표현 사용 가능 임계 Brix. 미만 → 그 표현 금지. */
  goodBrix: number
  /** 출하 가능 최대 Brix. */
  brixCeiling: number
  /** 보관 방법. */
  storage: FruitStorage
  /** 같이 먹으면 좋은 페어링. */
  pairings: string[]
  /** 농산물 특성상 주의사항. */
  cautions: string[]
  /** 이 과일에만 어울리는 감각어. */
  sensoryWords: string[]
  /** 즉시 사용 가능한 후킹 헤드라인 (시간단축/기능강화/변화 3유형 섞임). */
  hookHeadlines: string[]
  /**
   * 생식(날것 그대로 섭취) 가능 여부. 생략(undefined) → 생식 가능(true)으로 취급(하위호환).
   * false면 가공 전용 품목(예: 매실 — 청·장아찌·주류용). 수령 타임라인 등에서
   * "신선할 때 드세요"(생식 권유) 대신 "가공하세요"류 문구로 게이트한다.
   * fruit-facts가 단일 진실원이므로 cautions의 '생식 X'와 정합을 맞춘다.
   */
  rawEdible?: boolean
}

/**
 * 품종별 "팔리는 비주얼 포인트" — 상세페이지가 시각적으로 강조할 각도 + 모티프.
 *
 * 교차 계약: getVisualDNA(factKey)가 반환. FruitMotifs.tsx의 모티프 키와 짝을 이룬다.
 * ⚠️ points는 "비주얼 강조 각도"일 뿐 — 수치·산지 등 사실을 창작하는 근거가 아니다.
 *    카피에서 이 포인트를 묘사할 때도 감각어는 그 품목 sensoryWords 풀 안에서만 쓴다(카피 규칙 42·67).
 */
export interface VisualDNA {
  /** 팔리는 비주얼 포인트 1~3개 (예: "껍질 광택", "아삭 단면"). 시각 강조 각도. */
  points: string[]
  /** FruitMotifs 모티프 키 (예: "apple"). 미지원 키면 모티프 렌더는 생략(안전). */
  motif: string
}

export const FRUIT_FACTS: Record<string, FruitFact> = {
  "사과": {
    name: "사과",
    category: "fruit",
    aliases: ["사과", "홍로", "부사", "감홍", "아오리", "시나노", "시나노골드"],
    varieties: [
      { name: "아오리", brixMin: 13, brixMax: 14, harvestMonths: [7, 8], note: "여름 조생, 새콤" },
      { name: "홍로", brixMin: 14, brixMax: 15, harvestMonths: [9], note: "추석용 중생종, 약 300g", avgWeightG: 300, sensoryWords: ["아삭", "사각", "은은한 단맛"] },
      { name: "부사", brixMin: 14, brixMax: 15, harvestMonths: [10, 11], note: "단맛+신맛 균형, 저장성 우수", sensoryWords: ["아삭", "새콤달콤", "단단한"] },
      { name: "감홍", brixMin: 15, brixMax: 17, harvestMonths: [10, 11], note: "고당도 만생종" },
      { name: "시나노골드", brixMin: 13, brixMax: 15, harvestMonths: [9, 10], note: "노란 사과" },
    ],
    regions: ["청송", "충주", "영주", "예산", "거창"],
    goodBrix: 14,
    brixCeiling: 17,
    storage: { mode: "fridge", tempC: 2, days: 28, note: "한 알씩 신문지로 감싸 냉장 4~6주" },
    pairings: ["치즈", "샐러드", "아침 식탁"],
    cautions: ["에틸렌 — 다른 과일과 분리 보관", "크기·색깔 ±10% 편차"],
    sensoryWords: ["아삭", "사각", "단단함", "씹는 맛"],
    hookHeadlines: [
      "새벽 5시에 따 그날 보냅니다",
      "껍질에 꿀이 차오른 한 알",
      "한 입 베면 사각 소리가 먼저 들려요",
      "올해 첫 햇사과",
    ],
  },
  "배": {
    name: "배",
    category: "fruit",
    aliases: ["배", "신고", "원황", "추황", "황금배", "만풍"],
    varieties: [
      { name: "신고", brixMin: 11, brixMax: 12, harvestMonths: [9, 10], note: "국내 배 농사 80%, 큰 사이즈", sensoryWords: ["시원한 과즙", "묵직한", "아삭"] },
      { name: "원황", brixMin: 13, brixMax: 14, harvestMonths: [9], note: "추석용 조생 대과" },
      { name: "추황", brixMin: 13, brixMax: 15, harvestMonths: [10, 11], note: "가장 단 만생종" },
      { name: "황금배", brixMin: 12, brixMax: 14, harvestMonths: [9, 10] },
    ],
    regions: ["나주", "천안", "안성", "울산"],
    goodBrix: 12,
    brixCeiling: 15,
    storage: { mode: "fridge", tempC: 3, days: 21, note: "한 알씩 신문지로 감싸 냉장" },
    pairings: ["디저트", "이유식", "추석 선물"],
    cautions: ["후숙 거의 없음 — 받은 상태가 절정", "크기 ±15%"],
    sensoryWords: ["아삭", "시원한 과즙", "달큰", "묵직한"],
    hookHeadlines: [
      "한 알이 어른 손바닥보다 큰",
      "과즙이 흘러내리는 신고",
      "추석 선물용 두 알 박스",
      "올해 첫 햇배",
    ],
  },
  "감귤": {
    name: "감귤",
    category: "fruit",
    aliases: ["감귤", "귤", "노지감귤", "노지귤", "온주"],
    varieties: [
      { name: "노지감귤", brixMin: 10, brixMax: 12, harvestMonths: [11, 12, 1], note: "제주 노지", sensoryWords: ["톡 쏘는", "새콤", "상큼", "탱탱한 속살"] },
    ],
    regions: ["제주 서귀포", "제주 남원", "제주 위미", "제주 표선"],
    goodBrix: 11,
    brixCeiling: 13,
    storage: { mode: "fridge", tempC: 5, days: 10, note: "박스 안 곰팡이 한 알 보이면 즉시 분리" },
    pairings: ["아이 간식", "이유식", "껍질차"],
    cautions: ["크기 편차 있음", "노지 특성상 모양 균일 X"],
    sensoryWords: ["톡 쏘는", "새콤", "상큼", "겨울 향"],
    hookHeadlines: [
      "제주 노지에서 자란 겨울 감귤",
      "껍질이 얇아 까기 편해요",
      "수확 다음 날 발송",
      "새콤달콤 균형 잡힌 한 알",
    ],
  },
  "한라봉": {
    name: "한라봉",
    category: "fruit",
    aliases: ["한라봉"],
    varieties: [
      { name: "한라봉", brixMin: 13, brixMax: 14, harvestMonths: [12, 1, 2, 3, 4], note: "꼭지 볼록, 큰 사이즈" },
    ],
    regions: ["제주"],
    goodBrix: 13,
    brixCeiling: 15,
    storage: { mode: "fridge", tempC: 5, days: 14 },
    pairings: ["선물", "디저트"],
    cautions: ["모양 균일 X"],
    sensoryWords: ["진한 향", "농축된 단맛", "두툼한 과육"],
    hookHeadlines: ["꼭지 솟은 한라봉", "겨울 끝~봄 시작 선물", "제주 한정 출하"],
  },
  "천혜향": {
    name: "천혜향",
    category: "fruit",
    aliases: ["천혜향"],
    varieties: [
      { name: "천혜향", brixMin: 13, brixMax: 14, harvestMonths: [2, 3], note: "탁월한 향" },
    ],
    regions: ["제주"],
    goodBrix: 13,
    brixCeiling: 15,
    storage: { mode: "fridge", tempC: 5, days: 10 },
    pairings: ["선물"],
    cautions: ["충격에 약함"],
    sensoryWords: ["향 폭발", "농밀한 단맛", "촉촉"],
    hookHeadlines: ["껍질을 까는 순간 향이 방을 채워요", "봄을 여는 향 진한 한 알", "2~3월 한정 천혜향"],
  },
  "레드향": {
    name: "레드향",
    category: "fruit",
    aliases: ["레드향"],
    varieties: [
      { name: "레드향", brixMin: 13, brixMax: 15, harvestMonths: [12, 1, 2, 3, 4], note: "당도 높음, 신맛 적음" },
    ],
    regions: ["제주"],
    goodBrix: 13,
    brixCeiling: 16,
    storage: { mode: "fridge", tempC: 5, days: 14 },
    pairings: ["선물", "아침 식탁"],
    cautions: ["크기 ±10%"],
    sensoryWords: ["붉은 빛", "단맛 위주", "쫀쫀한 과육"],
    hookHeadlines: ["붉게 익은 한 알", "신맛 없이 단맛만"],
  },
  "황금향": {
    name: "황금향",
    category: "fruit",
    aliases: ["황금향"],
    varieties: [
      { name: "황금향", brixMin: 12, brixMax: 14, harvestMonths: [11, 12, 1], note: "조생 만감류" },
    ],
    regions: ["제주"],
    goodBrix: 12,
    brixCeiling: 15,
    storage: { mode: "fridge", tempC: 5, days: 14 },
    pairings: ["겨울 선물"],
    cautions: ["수확 시기 짧음"],
    sensoryWords: ["황금빛", "은은한 향"],
    hookHeadlines: ["겨울 시작의 첫 만감류", "11~1월 한정"],
  },
  "카라향": {
    name: "카라향",
    category: "fruit",
    aliases: ["카라향"],
    varieties: [
      { name: "카라향", brixMin: 13, brixMax: 16, harvestMonths: [3, 4, 5, 6], note: "봄~초여름, 향 진함" },
    ],
    regions: ["제주"],
    goodBrix: 13,
    brixCeiling: 17,
    storage: { mode: "fridge", tempC: 5, days: 10 },
    pairings: ["봄 선물"],
    cautions: ["수확 시기 한정"],
    sensoryWords: ["봄 향", "농밀한 단맛"],
    hookHeadlines: ["향이 진한 한 알", "봄~초여름 한정 출하", "봄~초여름 한정 카라향"],
  },
  "딸기": {
    name: "딸기",
    category: "fruit",
    aliases: ["딸기", "설향", "죽향", "금실", "매향", "킹스베리", "비타베리"],
    varieties: [
      { name: "설향", brixMin: 9, brixMax: 11, harvestMonths: [12, 1, 2, 3, 4, 5], note: "국내 87%, 청량감", sensoryWords: ["청량감", "산뜻한", "촉촉한 과즙"] },
      { name: "매향", brixMin: 11, brixMax: 12, harvestMonths: [12, 1, 2, 3], note: "수출 전용, 저장성" },
      { name: "죽향", brixMin: 12, brixMax: 13, harvestMonths: [12, 1, 2, 3], note: "단단, 전남", sensoryWords: ["단단한", "또렷한 단맛"] },
      { name: "금실", brixMin: 11, brixMax: 12, harvestMonths: [1, 2, 3, 4], note: "복숭아향, 봄까지" },
      { name: "킹스베리", brixMin: 9, brixMax: 11, harvestMonths: [1, 2, 3], note: "초대형 29g+" },
    ],
    regions: ["담양", "논산", "진주", "산청", "전남"],
    goodBrix: 11,
    brixCeiling: 13,
    storage: { mode: "fridge", tempC: 1, days: 3, note: "도착 즉시 펴서 냉장, 씻지 말고 보관" },
    pairings: ["요거트", "샐러드", "케이크"],
    cautions: ["충격 약함 — 받자마자 점검", "물러진 알은 즉시 분리"],
    sensoryWords: ["폭신", "달큰", "향긋", "촉촉한 과즙"],
    hookHeadlines: [
      "당일 새벽 수확 후 즉시 출고",
      "한 알이 어른 엄지 두 마디",
      "겨울 한정 출하",
      "콜드체인 박스 포장",
    ],
  },
  "복숭아": {
    name: "복숭아",
    category: "fruit",
    aliases: ["복숭아", "신비", "천도", "백도", "대극천", "썬프레", "선프레", "황도", "백봉"],
    varieties: [
      { name: "대극천", brixMin: 11, brixMax: 14, harvestMonths: [7, 8], note: "단단한 딱복 계열 백도, 반납작형", sensoryWords: ["딱복", "단단한", "아삭한 식감"] },
      { name: "백도", brixMin: 11, brixMax: 14, harvestMonths: [7, 8], note: "즙·단맛, 부드러움" },
      { name: "황도", brixMin: 12, brixMax: 14, harvestMonths: [7, 8, 9], note: "단단, 통조림·생식" },
      { name: "천도", brixMin: 10, brixMax: 13, harvestMonths: [6, 7, 8], note: "털 없는 변이, 신맛 강함" },
      { name: "썬프레", brixMin: 11, brixMax: 13, harvestMonths: [7], note: "조생종 천도" },
      { name: "신비복숭아", brixMin: 11, brixMax: 13, harvestMonths: [7], note: "조생 백도" },
    ],
    regions: ["영동", "음성", "원주", "이천", "영천", "경산"],
    goodBrix: 12,
    brixCeiling: 14,
    storage: { mode: "fridge", tempC: 5, days: 5, note: "딱딱하면 실온 1~2일 후숙 후 냉장" },
    pairings: ["요거트", "아이스크림", "여름 디저트"],
    cautions: ["충격 약함 — 트레이 포장", "후숙 1~2일이면 향·당도 살아남"],
    sensoryWords: ["톡 터지는", "과즙", "녹는 듯", "달큰한 향"],
    hookHeadlines: [
      "새벽에 따 그날 보냅니다",
      "포크가 닿자마자 과즙이 접시에 고여요",
      "여름 한정 햇과일",
      "조생종 첫물",
    ],
  },
  "자두": {
    name: "자두",
    category: "fruit",
    aliases: ["자두", "후무사", "포모사", "추희", "대석"],
    varieties: [
      { name: "대석", brixMin: 10, brixMax: 13, harvestMonths: [6], note: "자주색 과피, 타원형" },
      { name: "후무사", brixMin: 11, brixMax: 14, harvestMonths: [7], note: "일본계, 황색" },
      { name: "추희", brixMin: 11, brixMax: 13, harvestMonths: [5, 6, 9], note: "하우스 5월초/노지 9월, 저장성 25일+" },
    ],
    regions: ["김천", "의성", "안동", "영천", "화순"],
    goodBrix: 12,
    brixCeiling: 14,
    storage: { mode: "fridge", tempC: 2, days: 7, note: "실온 1~2일 후숙 가능" },
    pairings: ["잼", "여름 디저트"],
    cautions: ["충격 약함", "껍질의 분은 자연 발생"],
    sensoryWords: ["새콤달콤", "껍질의 분", "촉촉"],
    hookHeadlines: ["여름 한정 첫 자두", "표면 분은 신선의 증거"],
  },
  "포도": {
    name: "포도",
    category: "fruit",
    aliases: ["포도", "거봉", "캠벨", "MBA"],
    varieties: [
      { name: "거봉", brixMin: 16, brixMax: 18, harvestMonths: [8, 9, 10], sensoryWords: ["알알이", "탱글", "터지는 과즙"] },
      { name: "캠벨", brixMin: 13, brixMax: 15, harvestMonths: [8, 9] },
      { name: "MBA", brixMin: 16, brixMax: 19, harvestMonths: [9, 10] },
    ],
    regions: ["영동", "김천", "옥천", "안성"],
    goodBrix: 15,
    brixCeiling: 19,
    storage: { mode: "fridge", tempC: 1, days: 7, note: "마른 종이로 송이째 감싸기, 물 닿으면 물러짐" },
    pairings: ["치즈", "샐러드"],
    cautions: ["송이 끝 알이 먼저 무름"],
    sensoryWords: ["알알이", "탱글", "터지는"],
    hookHeadlines: ["송이채 신선하게", "한 알 한 알 손 선별"],
  },
  "샤인머스캣": {
    name: "샤인머스캣",
    category: "fruit",
    aliases: ["샤인머스캣", "샤인", "마스캇"],
    varieties: [
      { name: "기본 샤인머스캣", brixMin: 18, brixMax: 22, harvestMonths: [9, 10], note: "송이 500~700g" },
    ],
    regions: ["김천", "영동", "상주", "충북 영동", "전남 영암"],
    goodBrix: 18,
    brixCeiling: 22,
    storage: { mode: "fridge", tempC: 1, days: 7, note: "마른 종이로 송이째 감싸기" },
    pairings: ["치즈", "와인", "선물"],
    cautions: ["송이 균일성 ±10%", "끝 알 16Brix 미만이면 '고당도' 카피 금지"],
    sensoryWords: ["탱글", "씨 없는", "한 알 묵직", "껍질째"],
    hookHeadlines: [
      "씨 없이 껍질째 한 알",
      "18 Brix 이상만 골라 담았어요",
      "상주·김천 산지 직배",
    ],
  },
  "단감": {
    name: "단감",
    category: "fruit",
    aliases: ["단감", "부유", "차랑"],
    varieties: [
      { name: "부유", brixMin: 17, brixMax: 19, harvestMonths: [10, 11], note: "납작한 모양, 약 250g", avgWeightG: 250, sensoryWords: ["단단한", "농축된 단맛", "매끈한 단면"] },
      { name: "차랑", brixMin: 20, brixMax: 23, harvestMonths: [10, 11], note: "10월 중순, 신맛 적음, 22Brix" },
    ],
    regions: ["상주", "창원", "진영", "함안", "청도", "영암"],
    goodBrix: 18,
    brixCeiling: 23,
    storage: { mode: "fridge", tempC: 2, days: 28 },
    pairings: ["가을 디저트", "샐러드"],
    cautions: ["단감과 대봉 구분 — 대봉은 후숙 후 식용"],
    sensoryWords: ["단단", "씹는 맛", "농축된 단맛"],
    hookHeadlines: [
      "가을의 단단한 한 알",
      "단단하게 씹히는 가을 단감",
      "17 Brix부터 시작하는 부유의 단맛",
      "22 Brix까지 농익은 차랑",
    ],
  },
  "참외": {
    name: "참외",
    category: "fruit",
    aliases: ["참외", "꿀참외", "성주참외", "슈퍼금싸라기"],
    varieties: [
      { name: "슈퍼금싸라기", brixMin: 15, brixMax: 17, harvestMonths: [4, 5] },
      { name: "조은대", brixMin: 14, brixMax: 16, harvestMonths: [4, 5] },
      { name: "금노다지", brixMin: 13, brixMax: 15, harvestMonths: [6, 7] },
      { name: "알찬꿀", brixMin: 13, brixMax: 15, harvestMonths: [6, 7] },
    ],
    regions: ["성주", "고령", "칠곡"],
    goodBrix: 13,
    brixCeiling: 17,
    storage: { mode: "fridge", tempC: 5, days: 10, note: "랩+지퍼백 5도, 당도 최대 40% 상승" },
    pairings: ["여름 간식"],
    cautions: ["균일성 ±15% — 노지 특성"],
    sensoryWords: ["꿀맛", "씨까지 단", "여름의 단맛"],
    hookHeadlines: ["꿀이 차오른 성주 참외", "여름 한 알의 단맛"],
  },
  "수박": {
    name: "수박",
    category: "fruit",
    aliases: ["수박", "꿀수박", "복수박", "애플수박", "흑수박"],
    varieties: [
      { name: "일반 수박", brixMin: 11, brixMax: 13, harvestMonths: [6, 7, 8] },
      { name: "애플수박", brixMin: 11, brixMax: 13, harvestMonths: [6, 7, 8], note: "2~3kg 소형" },
    ],
    regions: ["함안 (지리적 표시)", "고령", "무등산 (지리적 표시)", "음성", "부여"],
    goodBrix: 11,
    brixCeiling: 13,
    storage: { mode: "fridge", tempC: 5, days: 7, note: "통수박 실온 1주 또는 냉장. 자른 수박 밀폐 3일" },
    pairings: ["여름 가족 모임"],
    cautions: ["배송 충격 흡수 포장"],
    sensoryWords: ["시원한 한 입", "물결 단맛"],
    hookHeadlines: ["8kg 한 통 — 가족 셋이 한 번에", "한 입 베면 시원한 여름 한 통", "한 손에 잡히는 애플수박"],
  },
  "멜론": {
    name: "멜론",
    category: "fruit",
    aliases: ["멜론", "머스크멜론", "네트멜론", "허니듀", "백자멜론"],
    varieties: [
      { name: "머스크멜론", brixMin: 13, brixMax: 16, harvestMonths: [6, 7, 8, 9], note: "그물 무늬" },
      { name: "백자멜론", brixMin: 12, brixMax: 15, harvestMonths: [6, 7, 8], note: "껍질 매끈" },
    ],
    regions: ["전주", "곡성", "나주", "고창", "부여"],
    goodBrix: 13,
    brixCeiling: 16,
    storage: { mode: "ripen-then-fridge", days: 5, note: "실온 후숙 2~5일 → 통멜론 냉장 1주. 자른 후 밀폐 3~4일" },
    pairings: ["여름 선물", "디저트"],
    cautions: ["후숙 필요 — 받자마자 자르지 마세요", "꼭지 근처 향으로 후숙 정도 확인"],
    sensoryWords: ["향이 먼저", "농축된 단맛", "쫀쫀한 과육"],
    hookHeadlines: ["꼭지가 향을 내면 후숙 완료", "여름 선물의 정수"],
  },
  "체리": {
    name: "체리",
    category: "fruit",
    aliases: ["체리", "빙체리", "라이니어"],
    varieties: [
      { name: "국산 체리", brixMin: 14, brixMax: 17, harvestMonths: [5, 6] },
      { name: "빙", brixMin: 17, brixMax: 19, harvestMonths: [6, 7], note: "수입 대표" },
      { name: "라이니어", brixMin: 20, brixMax: 23, harvestMonths: [6, 7], note: "황색" },
    ],
    regions: ["경산", "영천", "거창", "북미 (수입)"],
    goodBrix: 16,
    brixCeiling: 23,
    storage: { mode: "fridge", tempC: 1, days: 2, note: "구매 후 2일 내 섭취 — 빠른 변질" },
    pairings: ["여름 디저트"],
    cautions: ["충격 약함", "줄기 마른 알은 신선도 떨어짐", "국산과 수입 카피 분리"],
    sensoryWords: ["한 알 묵직", "터지는 즙", "단단한 씹는 맛"],
    hookHeadlines: ["줄기 신선도 체크 OK", "여름 한정 첫 체리"],
  },
  "블루베리": {
    name: "블루베리",
    category: "fruit",
    aliases: ["블루베리"],
    varieties: [
      { name: "듀크", brixMin: 11, brixMax: 13, harvestMonths: [6, 7] },
      { name: "엘리엇", brixMin: 11, brixMax: 13, harvestMonths: [7, 8] },
      { name: "블루크롭", brixMin: 11, brixMax: 13, harvestMonths: [7, 8] },
    ],
    regions: ["담양", "곡성", "영광", "김해", "부여", "수입 (칠레)"],
    goodBrix: 12,
    brixCeiling: 14,
    storage: { mode: "fridge", tempC: 1, days: 7, note: "생물 2일 / 가정 냉동 6개월" },
    pairings: ["요거트", "시리얼", "케이크"],
    cautions: ["충격 약함", "과분(흰가루)은 신선 신호"],
    sensoryWords: ["톡 터지는", "달큰", "한 알 한 알"],
    hookHeadlines: ["과분 가득한 신선 신호", "여름 한정 햇베리"],
  },
  "키위": {
    name: "키위",
    category: "fruit",
    aliases: ["키위", "그린키위", "골드키위", "참다래"],
    varieties: [
      { name: "그린키위", brixMin: 12, brixMax: 14, harvestMonths: [11, 12, 1, 2, 3, 4], note: "새콤" },
      { name: "골드키위", brixMin: 14, brixMax: 17, harvestMonths: [11, 12, 1, 2, 3, 4], note: "단맛" },
    ],
    regions: ["제주", "사천", "보성", "해남", "수입 (뉴질랜드)"],
    goodBrix: 13,
    brixCeiling: 17,
    storage: { mode: "ripen-then-fridge", days: 10, note: "20도 실온 5~10일 → 냉장 그린 1주/골드 2주" },
    pairings: ["샐러드", "스무디"],
    cautions: ["받자마자 냉장하지 마세요 — 후숙 필요"],
    sensoryWords: ["새콤", "달콤한 골드", "촉촉"],
    hookHeadlines: ["주방에 두 시간만 둬도 단 향이 퍼져요", "후숙 후 단맛 폭발"],
  },
  "망고": {
    name: "망고",
    category: "fruit",
    aliases: ["망고", "애플망고", "어윈", "카라바오"],
    varieties: [
      { name: "애플망고", brixMin: 13, brixMax: 18, harvestMonths: [7, 8], note: "제주" },
      { name: "필리핀 카라바오", brixMin: 13, brixMax: 17, harvestMonths: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12] },
    ],
    regions: ["제주", "해남", "수입 (필리핀/태국/베트남)"],
    goodBrix: 14,
    brixCeiling: 18,
    storage: { mode: "ripen-then-fridge", days: 3, note: "신문지로 싸 실온 2~3일 → 완숙 후 냉장 3~4일. 덜 익은 채 냉장하면 저온장애로 단맛 안 듦" },
    pairings: ["스무디", "셔벗"],
    cautions: ["저온장애 경고 — 받으시면 바로 냉장 마세요", "후숙 필요"],
    sensoryWords: ["진한 노란", "농축된 단맛", "껍질 누름 자국"],
    hookHeadlines: ["후숙 후 시원하게", "농익은 노란 과육의 단맛", "제주 애플망고 — 국내산 한정 출하"],
  },
  "바나나": {
    name: "바나나",
    category: "fruit",
    aliases: ["바나나", "캐번디시", "몽키바나나"],
    varieties: [
      { name: "캐번디시", brixMin: 18, brixMax: 22, harvestMonths: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12] },
      { name: "몽키바나나", brixMin: 18, brixMax: 22, harvestMonths: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12], note: "소형" },
    ],
    regions: ["필리핀", "에콰도르"],
    goodBrix: 19,
    brixCeiling: 22,
    storage: { mode: "ripen-then-fridge", days: 5, note: "꼭지 랩으로 감싸기. 후숙 5일 → 냉장 야채칸" },
    pairings: ["스무디", "아침 식탁"],
    cautions: ["껍질 갈변 = 상함 아님. 과육은 단맛 상승"],
    sensoryWords: ["부드러운", "달큰", "촉촉"],
    hookHeadlines: ["껍질만 변색, 과육은 단맛 상승", "후숙 후 단맛 최고치"],
  },
  "파인애플": {
    name: "파인애플",
    category: "fruit",
    aliases: ["파인애플", "MD2", "퀸"],
    varieties: [
      { name: "MD2", brixMin: 13, brixMax: 15, harvestMonths: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12] },
      { name: "퀸", brixMin: 12, brixMax: 14, harvestMonths: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12], note: "소형" },
    ],
    regions: ["필리핀", "코스타리카"],
    goodBrix: 13,
    brixCeiling: 15,
    storage: { mode: "room", days: 1, note: "꼭지 1cm 잘라 거꾸로 세워 실온 하루 — 당도 균일화" },
    pairings: ["볶음", "디저트", "스무디"],
    cautions: ["꼭지 거꾸로 실온 하루로 단맛 균일화"],
    sensoryWords: ["새콤달콤", "톡 쏘는", "노란 과육"],
    hookHeadlines: ["꼭지 거꾸로 하루 — 단맛 균일화", "열대 한 알의 균형"],
  },
  "곶감": {
    name: "곶감",
    category: "fruit",
    aliases: ["곶감", "반건시", "건시", "감말랭이"],
    varieties: [
      { name: "반건시", brixMin: 45, brixMax: 55, harvestMonths: [12, 1, 2] },
      { name: "건시", brixMin: 55, brixMax: 60, harvestMonths: [12, 1, 2] },
      { name: "감말랭이", brixMin: 45, brixMax: 55, harvestMonths: [12, 1, 2] },
    ],
    regions: ["상주 (전국 60%)", "영동", "논산 양촌"],
    goodBrix: 50,
    brixCeiling: 60,
    storage: { mode: "fridge", tempC: 2, days: 60, note: "냉장 2개월 / 냉동 6개월" },
    pairings: ["겨울 간식", "전통차"],
    cautions: ["단감과 다른 산지·제조법", "곶감에 '아삭한' 표현 금지"],
    sensoryWords: ["쫀득", "농축된 단맛", "겨울 간식"],
    hookHeadlines: ["상주 60% 산지 정통 곶감", "건조로 응축된 50 Brix"],
  },
  "매실": {
    name: "매실",
    category: "fruit",
    aliases: ["매실", "청매", "황매", "금매", "백매"],
    varieties: [
      { name: "청매", brixMin: 7, brixMax: 9, harvestMonths: [5, 6], note: "산도 강, 청용" },
      { name: "황매", brixMin: 8, brixMax: 10, harvestMonths: [6], note: "향 강" },
    ],
    regions: ["광양", "하동", "순천"],
    goodBrix: 8,
    brixCeiling: 10,
    storage: { mode: "room", days: 2, note: "받자마자 가공 권장 — 생식 아님" },
    pairings: ["매실청", "장아찌", "주류"],
    cautions: ["생식 X — 가공용", "매실청은 망종(6월 6일~20일) 최적기"],
    sensoryWords: ["진한 향", "산도"],
    hookHeadlines: ["당일 수확 발송", "올해 첫 햇매실", "올해 첫 청매실"],
    rawEdible: false,
  },
  "토마토": {
    name: "토마토",
    category: "fruit",
    aliases: ["토마토", "대저짭짤이", "방울토마토", "흑토마토", "스테비아 토마토"],
    varieties: [
      { name: "대저짭짤이", brixMin: 8, brixMax: 10, harvestMonths: [3, 4, 5, 6], note: "짠맛 단맛 균형" },
      { name: "일반 토마토", brixMin: 5, brixMax: 7, harvestMonths: [5, 6, 7, 8, 9, 10] },
      { name: "방울토마토", brixMin: 7, brixMax: 9, harvestMonths: [5, 6, 7, 8, 9, 10] },
    ],
    regions: ["부여", "화성", "충주", "강진", "부산 대저"],
    goodBrix: 7,
    brixCeiling: 10,
    storage: { mode: "ripen-then-fridge", days: 7, note: "실온 후숙 → 냉장 1주. 꼭지 위로 보관" },
    pairings: ["샐러드", "파스타"],
    cautions: ["대저짭짤이는 짠맛 특징 — 일반 토마토 단맛 카피와 분리"],
    sensoryWords: ["새콤달콤", "쫀쫀한 과육"],
    hookHeadlines: ["노지 한 알의 진한 맛", "새콤달콤 균형 잡힌 한 알", "짠맛 단맛 균형의 대저짭짤이"],
  },
}

/**
 * 품종별 비주얼 DNA — 상세페이지 시각 강조 각도(points) + 모티프(motif).
 * FRUIT_FACTS의 각 키에 1:1 대응. motif는 FruitMotifs 지원 키 중 하나
 * (전용 모티프가 없는 품목은 범용 "fruit"로 폴백). points는 품종 일반의
 * 시각 상식만 담고 수치·산지는 넣지 않는다(환각 방지).
 */
export const VISUAL_DNA: Record<string, VisualDNA> = {
  "사과": { points: ["껍질 광택", "아삭 단면"], motif: "apple" },
  "배": { points: ["시원한 과즙 단면", "매끈한 껍질"], motif: "pear" },
  "감귤": { points: ["얇은 껍질", "탱탱한 속알"], motif: "citrus" },
  "한라봉": { points: ["볼록 솟은 꼭지", "두툼한 과육"], motif: "citrus" },
  "천혜향": { points: ["촉촉한 과육", "껍질 윤기"], motif: "citrus" },
  "레드향": { points: ["붉은 빛", "쫀쫀한 과육"], motif: "citrus" },
  "황금향": { points: ["황금빛 껍질", "매끈한 표면"], motif: "citrus" },
  "카라향": { points: ["진한 주황빛", "촉촉한 결"], motif: "citrus" },
  "딸기": { points: ["윤기", "붉은 단면"], motif: "strawberry" },
  "복숭아": { points: ["과육 결", "맺힌 과즙"], motif: "peach" },
  "자두": { points: ["껍질의 분", "자줏빛 광택"], motif: "plum" },
  "포도": { points: ["과분(하얀 가루)", "알 탱탱함"], motif: "grape" },
  "샤인머스캣": { points: ["투명한 연둣빛", "알 탱탱함"], motif: "grape" },
  "단감": { points: ["매끈한 주홍빛", "단단한 단면"], motif: "persimmon" },
  "참외": { points: ["노란 채도", "아삭한 속"], motif: "chamoe" },
  "수박": { points: ["붉은 속", "시원한 단면"], motif: "watermelon" },
  "멜론": { points: ["그물 무늬", "진한 과육색"], motif: "fruit" },
  "체리": { points: ["짙은 선홍빛", "탱글한 알"], motif: "fruit" },
  "블루베리": { points: ["과분(하얀 가루)", "톡 터지는 알"], motif: "blueberry" },
  "키위": { points: ["씨 방사 단면", "초록 과육"], motif: "kiwi" },
  "망고": { points: ["진한 노란 과육", "도톰한 결"], motif: "fruit" },
  "바나나": { points: ["샛노란 껍질", "부드러운 결"], motif: "fruit" },
  "파인애플": { points: ["노란 과육", "도톰한 결"], motif: "fruit" },
  "곶감": { points: ["쫀득한 결", "하얀 분"], motif: "persimmon" },
  "매실": { points: ["진한 청록빛", "통통한 알"], motif: "plum" },
  "토마토": { points: ["붉은 채도", "탱탱한 껍질"], motif: "tomato" },
}

/** alias 인덱스. */
const ALIAS_INDEX: Map<string, string> = new Map()
for (const [key, fact] of Object.entries(FRUIT_FACTS)) {
  ALIAS_INDEX.set(key.toLowerCase(), key)
  for (const a of fact.aliases) {
    ALIAS_INDEX.set(a.toLowerCase(), key)
  }
}

/** 상품명에서 fact key 자동 식별. */
export function detectFruitFactKey(productName: string): string | null {
  const name = productName.trim().toLowerCase()
  if (!name) return null
  // 정확 일치
  if (ALIAS_INDEX.has(name)) return ALIAS_INDEX.get(name)!
  // 가장 긴 부분 일치 우선
  let best: string | null = null
  let bestLen = 0
  for (const [alias, key] of ALIAS_INDEX.entries()) {
    if (alias.length < 2) continue
    if (name.includes(alias) || alias.includes(name)) {
      if (alias.length > bestLen) {
        best = key
        bestLen = alias.length
      }
    }
  }
  return best
}

/** fact 조회. variety 있으면 그 품종 fact로 좁힐 수 있음 (현재는 전체 fact 반환). */
export function getFact(fruit: string, _variety?: string): FruitFact | undefined {
  const key = detectFruitFactKey(fruit)
  return key ? FRUIT_FACTS[key] : undefined
}

/** "달다/꿀맛/고당도" 표현 허용 여부. brixValue가 goodBrix 미만이면 false. */
export function canUseSweetClaim(fruit: string, brixValue?: number): boolean {
  const fact = getFact(fruit)
  if (!fact) return true // 사전에 없으면 통과
  if (brixValue == null || Number.isNaN(brixValue)) return false // 미입력이면 불허
  return brixValue >= fact.goodBrix
}

/** 보관 mode 조회 — fruit-copy 프롬프트가 보관 카피 분기에 사용. */
export function getStorageMode(fruit: string): StorageMode | null {
  const fact = getFact(fruit)
  return fact?.storage.mode ?? null
}

/** 감각어 풀 — 카피 생성 시 이 풀에서만 어휘 차용 허용(과일 단위). */
export function getSensoryWords(fruit: string): string[] {
  return getFact(fruit)?.sensoryWords ?? []
}

/**
 * 품종 단위 감각어 — 상품명에 특정 품종이 들어 있고 그 품종에 sensoryWords가
 * 정의돼 있으면 그 어휘들을 반환(중복 제거). 3차 카피 패스 신설.
 *
 * 과일 단위 getSensoryWords(물복 기준 등)가 못 살리는 품종 정체성
 * (대극천=딱복·단단한, 설향=청량감)을 카피가 우선 사용하도록 프롬프트에 노출한다.
 * 상품명이 품종을 특정하지 않으면 빈 배열(과일 단위 풀만 사용).
 */
export function getVarietySensoryWords(productName: string): string[] {
  const fact = getFact(productName)
  if (!fact) return []
  const nameLower = productName.toLowerCase()
  const out: string[] = []
  const seen = new Set<string>()
  for (const v of fact.varieties) {
    if (!v.sensoryWords || v.sensoryWords.length === 0) continue
    if (!nameLower.includes(v.name.toLowerCase())) continue
    for (const w of v.sensoryWords) {
      if (!seen.has(w)) {
        seen.add(w)
        out.push(w)
      }
    }
  }
  return out
}

/**
 * 품종 비주얼 DNA 조회 (교차 계약).
 * factKey 직접 매칭 우선, 실패 시 상품명 자동 식별(detectFruitFactKey)로 폴백.
 * 어느 쪽도 매칭 안 되면 null.
 * points는 "비주얼 강조 각도"일 뿐 — 이를 근거로 수치·산지를 창작하지 않는다.
 */
export function getVisualDNA(factKey: string): VisualDNA | null {
  const direct = VISUAL_DNA[factKey]
  if (direct) return direct
  const detected = detectFruitFactKey(factKey)
  return detected ? VISUAL_DNA[detected] ?? null : null
}

/**
 * 개당 평균 무게(g) 조회 — 상품명에 든 품종의 avgWeightG.
 * 상품명에 품종이 특정되면 그 품종 값, 아니면 (avgWeightG가 있는 품종이 정확히 1종일 때만) 그 값.
 * 여러 품종이 avgWeightG를 갖고 상품명이 품종을 특정하지 않으면 null(추정 회피).
 */
export function getAvgWeightG(productName: string): number | null {
  const fact = getFact(productName)
  if (!fact) return null
  const nameLower = productName.toLowerCase()
  const named = fact.varieties.filter(
    (v) => v.avgWeightG != null && nameLower.includes(v.name.toLowerCase()),
  )
  if (named.length > 0) return named[0].avgWeightG ?? null
  const withWeight = fact.varieties.filter((v) => v.avgWeightG != null)
  return withWeight.length === 1 ? withWeight[0].avgWeightG ?? null : null
}

/**
 * 중량 문자열("3kg"·"1.5kg"·"500g")에서 총 그램 수를 파싱한다.
 * 여러 숫자가 있으면 첫 kg/g 표기만 사용. 파싱 불가면 null.
 */
export function parseWeightToGrams(weight: string): number | null {
  const s = weight.toLowerCase().replace(/\s+/g, "")
  const kg = s.match(/(\d+(?:\.\d+)?)\s*kg/)
  if (kg) {
    const v = Number(kg[1])
    return Number.isFinite(v) && v > 0 ? v * 1000 : null
  }
  const g = s.match(/(\d+(?:\.\d+)?)\s*g/)
  if (g) {
    const v = Number(g[1])
    return Number.isFinite(v) && v > 0 ? v : null
  }
  return null
}

/**
 * 중량 + 개당 무게로 "약 N~M과" 개수 범위 문자열을 만든다.
 * ±12% 편차를 반영해 범위로(예: 3kg / 250g → 약 11~13과). 계산 불가면 null.
 */
export function estimateCountLabel(weight: string, avgWeightG: number): string | null {
  const grams = parseWeightToGrams(weight)
  if (grams == null || avgWeightG <= 0) return null
  const mid = grams / avgWeightG
  if (!Number.isFinite(mid) || mid < 1) return null
  // ±8% 편차를 round로 반영 — 예: 3kg/250g(mid 12) → 11~13과.
  const lo = Math.max(1, Math.round(mid * 0.92))
  const hi = Math.max(lo, Math.round(mid * 1.08))
  return lo === hi ? `${lo}과` : `${lo}~${hi}과`
}

/**
 * 지역명이 아닌 일반어 토큰 — 산지 정합 검사에서 제외(오탐 방지).
 * regions "수입 (칠레)", "북미 (수입)"의 core 토큰이 "수입"이 되는데, "수입"은
 * 카피에 흔한 일반어라 산지 지역명으로 취급하지 않는다.
 */
const NON_PLACE_REGION_TOKENS = new Set(["수입"])

/**
 * regions 항목에서 대표 시·군 토큰(소문자)을 뽑는다.
 * "제주 서귀포" → "제주", "함안 (지리적 표시)" → "함안".
 * 2자 미만이거나 비지역 일반어("수입")면 null(검사 제외).
 */
function regionCoreLower(region: string): string | null {
  const core = (region.replace(/\s*\(.*?\)\s*/g, " ").trim().split(/\s+/)[0] ?? "").trim()
  if (core.length < 2 || NON_PLACE_REGION_TOKENS.has(core)) return null
  return core.toLowerCase()
}

/**
 * 후킹 후보(hookHeadline)가 상품명과 사실 정합한지 검사한다.
 *
 * 사용자 분노 사례: 상품명 "부유단감"인데 헤드라인 후보에 "22 Brix까지 농익은 차랑"이
 * 노출됨 — 차랑은 부유와 다른 품종이라 말이 안 되는 문구.
 *
 * 규칙:
 *  1. 품종명 필터 — 후보에 이 과일의 varieties 중 어떤 품종명이 들어 있는데,
 *     그 품종명이 상품명에는 없으면 제외 (다른 품종 이야기 차단).
 *     · 상품명에 어떤 품종도 안 들어 있으면 → 품종 특정 후보 전부 제외
 *       (품종 중립 후보만 통과).
 *  2. Brix 수치 필터 — 후보에 숫자 Brix가 들어 있으면, 그 수치가 상품명에 든
 *     품종의 brixMin~brixMax 범위 안이어야 통과. 상품명에 품종이 없으면
 *     과일 전체 범위(모든 varieties의 최소~최대)로 판정.
 *
 * 3. 산지명 필터 (허위 표시 방지) — 후보에 이 과일 regions의 지역명이 들어 있는데
 *    그 지역명이 입력 산지(origin)에 없으면 제외. origin 미입력이면 지역명 포함 후보 전부 제외.
 *    "국내산" 입력에 참고 데이터 '담양'이 후보로 노출된 허위 표시 사고 재발 방지.
 *
 * @param fact       매칭된 과일 fact
 * @param productName 셀러가 입력한 상품명 (품종 단서 추출용)
 * @param headline   검사할 후킹 후보
 * @param origin     셀러가 입력한 산지 (선택). 지역명 정합 판정 기준.
 * @returns 통과하면 true, 사실 불일치면 false
 */
export function isHookHeadlineCompatible(
  fact: FruitFact,
  productName: string,
  headline: string,
  origin?: string,
): boolean {
  const nameLower = productName.toLowerCase()
  const hookLower = headline.toLowerCase()
  const originLower = (origin ?? "").trim().toLowerCase()

  // 상품명에 실제로 등장한 이 과일의 품종명들.
  const namedInProduct = fact.varieties.filter((v) =>
    nameLower.includes(v.name.toLowerCase()),
  )

  // 1) 품종명 필터 — 후보에 등장하는 품종명 중 상품명에 없는 게 있으면 탈락.
  for (const v of fact.varieties) {
    const vLower = v.name.toLowerCase()
    if (!hookLower.includes(vLower)) continue
    // 후보가 이 품종을 언급함. 상품명에도 그 품종이 있어야 통과.
    if (!nameLower.includes(vLower)) return false
  }

  // 3) 산지명 필터 — 후보에 이 과일 regions 지역명이 있는데 입력 산지에 없으면 탈락.
  //    regions "제주 서귀포"처럼 복합명은 핵심 시·군 토큰(첫 단어, 괄호 주석 제외)으로 판정.
  for (const region of fact.regions) {
    const core = regionCoreLower(region)
    if (!core) continue
    if (!hookLower.includes(core)) continue
    // 후보가 이 지역명을 언급함. 입력 산지에도 그 지역명이 있어야 통과.
    // origin이 비었으면(미입력) 지역명 포함 후보는 전부 탈락.
    if (!originLower.includes(core)) return false
  }

  // 2) Brix 수치 필터 — 후보에 든 숫자가 Brix 문맥이면 범위 검증.
  //    "22 Brix", "17Brix", "50 Brix" 등. (g·kg·시·분·% 등 다른 단위는 무시)
  const brixMatches = hookLower.matchAll(/(\d+(?:\.\d+)?)\s*brix/g)
  for (const m of brixMatches) {
    const value = Number(m[1])
    if (Number.isNaN(value)) continue
    // 상품명 품종이 있으면 그 품종 범위, 없으면 과일 전체 범위로 판정.
    const scope = namedInProduct.length > 0 ? namedInProduct : fact.varieties
    let lo = Infinity
    let hi = -Infinity
    for (const v of scope) {
      if (v.brixMin < lo) lo = v.brixMin
      if (v.brixMax > hi) hi = v.brixMax
    }
    if (lo === Infinity || hi === -Infinity) continue
    if (value < lo || value > hi) return false
  }

  return true
}

/**
 * 헤드라인 후보의 산지 정합만 검사한다 (품종·Brix는 검사하지 않음).
 *
 * isHookHeadlineCompatible의 산지 필터(규칙 3)만 떼어낸 버전.
 * AI가 생성한 후보에 적용할 때 사용 — AI 후보의 품종·수치는 프롬프트(규칙 55)가
 * 책임지므로 여기서는 산지 지역명(허위 표시)만 차단한다.
 *
 * 규칙: 후보에 이 과일 regions의 지역명(핵심 시·군 토큰)이 들어 있는데 입력 산지에
 * 없으면 false. origin 미입력이면 지역명 포함 후보는 전부 false.
 *
 * @returns 산지 정합이면 true, 불일치면 false
 */
export function isHeadlineOriginCompatible(
  fact: FruitFact,
  headline: string,
  origin?: string,
): boolean {
  const hookLower = headline.toLowerCase()
  const originLower = (origin ?? "").trim().toLowerCase()
  for (const region of fact.regions) {
    const core = regionCoreLower(region)
    if (!core) continue
    if (!hookLower.includes(core)) continue
    if (!originLower.includes(core)) return false
  }
  return true
}

/**
 * 상품명에 매칭되는 품종들의 수확월(harvestMonths) 합집합.
 * - 상품명에 품종이 특정되면 그 품종(들)만, 아니면 과일 전체 품종의 union.
 * - 1~12 정수만, 오름차순·중복 제거. 매칭 실패 시 빈 배열.
 * 제철 캘린더(SeasonCalendarBlock) 전용 — 품종 일반 데이터라 "품종 기준" 각주와 함께 쓴다.
 */
export function getHarvestMonths(productName: string): number[] {
  const fact = getFact(productName)
  if (!fact) return []
  const nameLower = productName.toLowerCase()
  const named = fact.varieties.filter((v) => nameLower.includes(v.name.toLowerCase()))
  const scope = named.length > 0 ? named : fact.varieties
  const set = new Set<number>()
  for (const v of scope) {
    for (const m of v.harvestMonths) {
      if (Number.isInteger(m) && m >= 1 && m <= 12) set.add(m)
    }
  }
  return [...set].sort((a, b) => a - b)
}

/**
 * 상품명에 매칭되는 품종들의 당도(Brix) 일반 범위(min~max).
 * - 상품명에 품종이 특정되면 그 품종(들) 범위, 아니면 과일 전체 품종의 최소~최대.
 * - 매칭 실패 시 null. 출하 기준 범위라 "품종 기준" 맥락으로만 쓴다(입력 수치 아님).
 */
export function getBrixRange(productName: string): { min: number; max: number } | null {
  const fact = getFact(productName)
  if (!fact) return null
  const nameLower = productName.toLowerCase()
  const named = fact.varieties.filter((v) => nameLower.includes(v.name.toLowerCase()))
  const scope = named.length > 0 ? named : fact.varieties
  let min = Infinity
  let max = -Infinity
  for (const v of scope) {
    if (v.brixMin < min) min = v.brixMin
    if (v.brixMax > max) max = v.brixMax
  }
  if (!Number.isFinite(min) || !Number.isFinite(max) || max < min) return null
  return { min, max }
}

/**
 * 상품명에 매칭되는 과일의 보관 정보(FruitStorage). 매칭 실패 시 null.
 * 수령 후 타임라인(ReceiveTimelineBlock)이 mode/days/tempC로 단계를 구성한다.
 */
export function getStorageInfo(productName: string): FruitStorage | null {
  return getFact(productName)?.storage ?? null
}

/**
 * 생식(날것 그대로 섭취) 가능 여부. 사전에 없거나 rawEdible 미지정이면 true(하위호환).
 * false는 가공 전용 품목(매실 등). 수령 타임라인의 마지막 스텝 소비 문구를
 * 생식 권유("드세요")에서 가공 안내("가공하세요")로 바꾸는 게이트로 쓴다.
 */
export function isRawEdible(productName: string): boolean {
  return getFact(productName)?.rawEdible !== false
}

/**
 * 배송 문구 변주용 "보관 성격" 페르소나 (v5.3 작업6).
 *
 * 붙박이 배송 문구(4단계 스텝·배송 안내 문단)가 딸기/복숭아처럼 자구까지 동일해
 * 복붙 티가 나는 문제를, 이미 있는 fruit-facts 데이터로 결정적으로 갈라주기 위한 키.
 * AI 호출 없이(무료·결정적) storage 데이터만 본다. 사전에 없으면 null → 호출부는 현행 기본 문구.
 *
 * 판정(순서 중요):
 *  - "ripen"(후숙형): 실온 후숙이 보관 mode이거나(멜론·키위·망고·바나나·파인애플 계열),
 *    보관 note/주의에 '후숙'이 명시된 품목(복숭아·자두 — mode는 fridge지만 단단하게 발송).
 *    → 딸기(즉시)와 복숭아(후숙)를 갈라내는 핵심 축.
 *  - "room"(실온형): mode === "room"이고 후숙 힌트 없음(매실 등).
 *  - "chill"(즉시냉장형): mode === "fridge"이고 후숙 힌트 없음(딸기·사과·포도·감귤 등).
 *
 * ⚠️ 이 페르소나는 "표현 변주 선택 키"일 뿐 — 산지·당도·수확일 같은 사실 창작 근거가 아니다.
 */
export type DeliveryPersona = "ripen" | "chill" | "room"
export function getDeliveryPersona(productName: string): DeliveryPersona | null {
  const fact = getFact(productName)
  if (!fact) return null
  const st = fact.storage
  const ripenHinted =
    st.mode === "ripen-then-fridge" ||
    (st.note?.includes("후숙") ?? false) ||
    fact.cautions.some((c) => c.includes("후숙"))
  if (ripenHinted) return "ripen"
  if (st.mode === "room") return "room"
  if (st.mode === "fridge") return "chill"
  return null
}

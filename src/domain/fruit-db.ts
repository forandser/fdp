/**
 * 한국 주요 과일 핵심 정보 사전 (v1 baseline).
 *
 * 출처: 농촌진흥청·aT 식품유통종합정보·한국농수산식품유통공사·산지 직거래 사이트 일반.
 * 신선식품 특성상 지역·품종·기상에 따라 ±편차 있음. "대표값" 기준.
 *
 * 활용:
 * - DetailMaker 입력 도움 (산지·품종·당도 placeholder 자동완성)
 * - SeasonHint 강화 (제철 + 평균 당도 + 추천 표현)
 * - 카피 프롬프트의 사실 가이드 보강 (입력에 단서 없을 때 hallucination 차단)
 *
 * 추가 리서치 결과로 보강 예정.
 */

export interface FruitInfo {
  /** 정식 이름. 카탈로그 표시용. */
  name: string
  /** 흔히 쓰이는 별칭 — 사용자 입력에서 추출용. "복숭아" 입력 시 도구가 인식. */
  aliases: string[]
  /** 카테고리. 과일/만감류는 fruit, 채소는 veggie. */
  category: "fruit" | "veggie"
  /** 주요 품종 3~6종. 조생/중생/만생 표기. */
  varieties: { name: string; note?: string }[]
  /** 주요 산지 2~5곳. */
  origins: string[]
  /** 평균 당도(Brix) 범위. "맛있다" 기준. */
  brixRange: { min: number; max: number; tasty: number }
  /** 출하 시기. start~peak~end 월. */
  season: { start: number; peak: number; end: number }
  /** 등급 표기 예시. */
  grades?: string[]
  /** 권장 보관. 냉장/실온 + 일수. */
  storage: { fridge: string; roomTemp?: string; note?: string }
  /** 같이 먹으면 좋은 조합·먹는 팁. */
  tips: string[]
  /** 카피에 쓰기 좋은 후킹 표현 3~5개. */
  hookPhrases: string[]
  /** 농산물 특성상 주의사항 (균일성·후숙 등). */
  cautions: string[]
}

export const FRUIT_DB: FruitInfo[] = [
  {
    name: "사과",
    aliases: ["사과", "홍로", "부사", "감홍", "아오리", "시나노"],
    category: "fruit",
    varieties: [
      { name: "홍로", note: "추석 전 출하 (중생종, 9월)" },
      { name: "부사", note: "대표 만생종, 저장성 우수 (10~12월 수확)" },
      { name: "감홍", note: "고당도 만생종, 15Brix 이상도 흔함" },
      { name: "아오리", note: "여름 조생종, 새콤한 맛 (8월)" },
      { name: "시나노골드", note: "노란 사과, 10월" },
    ],
    origins: ["경북 청송", "경북 영주", "경북 안동", "충북 충주", "강원 정선"],
    brixRange: { min: 11, max: 16, tasty: 13 },
    season: { start: 8, peak: 10, end: 12 },
    grades: ["특", "상", "중"],
    storage: {
      fridge: "냉장 2~4주 (야채칸 권장)",
      roomTemp: "실온 5~7일",
      note: "에틸렌 다른 과일 숙성 가속 — 분리 보관",
    },
    tips: ["드시기 30분 전 실온", "껍질째 씻어 드시면 식이섬유까지", "잘라 두면 단면이 갈변 — 레몬즙 살짝"],
    hookPhrases: [
      "새벽 5시에 직접 따 보내드려요",
      "껍질에 꿀이 차오른 한 알",
      "한 입 베면 톡 터지는 아삭함",
      "올해 첫 햇사과",
    ],
    cautions: ["크기·색깔 ±10% 편차 있음", "수령 후 즉시 냉장"],
  },
  {
    name: "배",
    aliases: ["배", "신고", "원황", "추황", "황금배", "만풍"],
    category: "fruit",
    varieties: [
      { name: "신고", note: "대표 만생종, 큰 사이즈 (10~11월)" },
      { name: "원황", note: "추석 직전 조생 (9월)" },
      { name: "추황", note: "단단하고 단맛 (10월)" },
      { name: "황금배", note: "노란 껍질, 풍부한 과즙" },
    ],
    origins: ["전남 나주", "충남 천안", "경기 평택", "울산"],
    brixRange: { min: 11, max: 14, tasty: 12 },
    season: { start: 8, peak: 10, end: 12 },
    grades: ["특", "상", "중"],
    storage: {
      fridge: "냉장 2~3주",
      roomTemp: "실온 3~5일",
    },
    tips: ["과즙이 많아 후식·이유식 좋음", "한 알이 1.2kg 이상 가는 신고 — 잘라 보관"],
    hookPhrases: [
      "한 알이 어른 손바닥보다 큰",
      "과즙이 흘러내리는 신고",
      "추석 선물용 두 알 박스",
    ],
    cautions: ["크기·모양 ±15% 편차", "후숙 거의 없음 — 받은 상태가 절정"],
  },
  {
    name: "감귤",
    aliases: ["감귤", "귤", "노지귤", "온주", "황금향", "한라봉", "천혜향", "레드향", "만감류"],
    category: "fruit",
    varieties: [
      { name: "노지온주", note: "11~12월 제주 노지 (작고 새콤달콤)" },
      { name: "한라봉", note: "12~3월 (꼭지 볼록, 큰 사이즈)" },
      { name: "천혜향", note: "1~2월 (탁월한 향)" },
      { name: "레드향", note: "1~2월 (당도 높음, 붉은 빛)" },
      { name: "황금향", note: "10~12월 (조생 만감류)" },
    ],
    origins: ["제주 서귀포", "제주 남원", "제주 위미", "제주 표선"],
    brixRange: { min: 10, max: 14, tasty: 12 },
    season: { start: 10, peak: 12, end: 3 },
    grades: ["S", "M", "L", "2L"],
    storage: {
      fridge: "냉장 1~2주",
      roomTemp: "실온 1주",
      note: "박스 안에 곰팡이 한 알 보이면 즉시 분리",
    },
    tips: ["손으로 까기 편함", "아이 간식·이유식 보조", "껍질로 차·청 만들기"],
    hookPhrases: [
      "제주 노지에서 자란 겨울 감귤",
      "새콤달콤 균형 잡힌 한 알",
      "껍질이 얇아 까기 편해요",
      "수확 다음 날 발송",
    ],
    cautions: ["크기 편차 있음", "노지 특성상 모양 균일 X"],
  },
  {
    name: "딸기",
    aliases: ["딸기", "설향", "죽향", "금실", "장희", "킹스베리", "비타베리"],
    category: "fruit",
    varieties: [
      { name: "설향", note: "국내 최다 재배 (11~5월), 균형 잡힌 맛" },
      { name: "죽향", note: "단단하고 향 강함" },
      { name: "금실", note: "당도 우수, 단단한 식감" },
      { name: "킹스베리", note: "초대형 사이즈 (50g+)" },
      { name: "비타베리", note: "비타민·신맛 강조 신품종" },
    ],
    origins: ["충남 논산", "충남 부여", "경남 진주", "경남 산청", "전남 담양"],
    brixRange: { min: 9, max: 14, tasty: 11 },
    season: { start: 11, peak: 1, end: 5 },
    grades: ["특", "상", "중"],
    storage: {
      fridge: "냉장 2~3일 (씻지 말고 보관)",
      note: "받으면 바로 가지런히 펴서 냉장",
    },
    tips: ["드실 때 흐르는 물에 살짝", "씻은 후엔 빠르게 섭취", "꼭지 채로 보관"],
    hookPhrases: [
      "한 알이 어른 엄지 두 마디",
      "겨울 한정 출하",
      "당일 새벽 수확 후 즉시 출고",
      "콜드체인 박스 포장",
    ],
    cautions: ["충격에 약함 — 받으시면 즉시 점검", "물러진 알 한 개 발견 시 즉시 분리"],
  },
  {
    name: "복숭아",
    aliases: ["복숭아", "신비", "천도", "백도", "썬프레", "선프레", "황도"],
    category: "fruit",
    varieties: [
      { name: "썬프레 천도", note: "조생종 (7월 초)" },
      { name: "신비복숭아", note: "조생종 백도, 7월" },
      { name: "백도", note: "달콤한 향, 부드러운 과육 (7~8월)" },
      { name: "황도", note: "노란 과육, 통조림용도 (8월)" },
      { name: "백봉", note: "대표 백도, 향 강함" },
    ],
    origins: ["경북 영천", "경북 경산", "충북 음성", "충북 충주", "전남 화순"],
    brixRange: { min: 10, max: 14, tasty: 12 },
    season: { start: 6, peak: 7, end: 9 },
    grades: ["특", "상", "중"],
    storage: {
      fridge: "냉장 3~5일 (시원하게만)",
      roomTemp: "실온 1~2일 (후숙용)",
      note: "후숙 후 냉장이 향·당도 살아남",
    },
    tips: ["드시기 30분 전 실온", "딱딱하면 1~2일 후숙", "충격에 약함"],
    hookPhrases: [
      "새벽에 따 그날 보냅니다",
      "한 입 베면 새콤달콤 과즙이 가득",
      "여름 한정 햇과일",
      "조생종 첫물",
    ],
    cautions: ["충격 약함 — 박스에 트레이 분리 포장", "받으시면 24시간 내 후숙·냉장 결정"],
  },
  {
    name: "수박",
    aliases: ["수박", "꿀수박", "복수박", "흑수박", "애플수박"],
    category: "fruit",
    varieties: [
      { name: "일반 수박", note: "8~12kg, 대표 여름 과일" },
      { name: "애플수박", note: "2~3kg 소형, 1인 가구용" },
      { name: "흑수박", note: "껍질 어두운 빛, 단단한 과육" },
    ],
    origins: ["충남 부여", "전북 고창", "전남 함평", "경남 함안"],
    brixRange: { min: 10, max: 13, tasty: 11 },
    season: { start: 5, peak: 7, end: 9 },
    grades: ["특", "상", "중"],
    storage: {
      fridge: "냉장 1주 (자르기 전)",
      note: "자른 후 랩 씌워 2~3일",
    },
    tips: ["자르기 전 시원하게", "씨까지 통째 — 갈아서 주스도", "꼭지 마름 정도로 신선도 체크"],
    hookPhrases: [
      "한 손에 잡히는 애플수박",
      "씨까지 시원한 여름의 정점",
      "8kg 한 통 — 가족 셋이 한 번에",
    ],
    cautions: ["배송 중 충격 흡수 포장", "받자마자 시원하게"],
  },
  {
    name: "참외",
    aliases: ["참외", "꿀참외", "성주참외"],
    category: "fruit",
    varieties: [
      { name: "성주 꿀참외", note: "대표 산지 — 균일한 단맛" },
      { name: "백참외", note: "표면 매끈, 부드러운 식감" },
    ],
    origins: ["경북 성주", "경북 칠곡"],
    brixRange: { min: 11, max: 15, tasty: 13 },
    season: { start: 4, peak: 6, end: 8 },
    grades: ["특", "상", "중", "소"],
    storage: {
      fridge: "냉장 1주",
      roomTemp: "실온 3일",
    },
    tips: ["씨 빼지 말고 드세요 — 단맛 가득", "잘 익으면 노란 빛이 진해짐", "스무디·샐러드 좋음"],
    hookPhrases: [
      "꿀이 차오른 성주 참외",
      "여름 한 알의 단맛",
      "씨까지 통째 드세요",
    ],
    cautions: ["균일성 ±15% — 노지 특성", "꼭지 마름이 신선도 지표"],
  },
  {
    name: "포도",
    aliases: ["포도", "거봉", "캠벨", "샤인머스캣", "마스캇"],
    category: "fruit",
    varieties: [
      { name: "샤인머스캣", note: "씨 없음, 16~18Brix, 8월~" },
      { name: "거봉", note: "한 알 크기, 새콤달콤 (8~10월)" },
      { name: "캠벨", note: "전통 한국 포도, 9~10월" },
    ],
    origins: ["경북 상주", "경북 김천", "충북 영동", "충남 천안"],
    brixRange: { min: 14, max: 19, tasty: 16 },
    season: { start: 7, peak: 9, end: 11 },
    grades: ["특", "상", "중"],
    storage: {
      fridge: "냉장 1주 (송이채로)",
      note: "씻으면 보관 X — 드실 때만 씻기",
    },
    tips: ["가위로 송이 잘라 보관", "껍질째 — 식이섬유까지", "샐러드·디저트 토핑 좋음"],
    hookPhrases: [
      "씨 없이 껍질째 드세요",
      "한 알 한 알 17Brix 이상 선별",
      "송이채 신선하게",
    ],
    cautions: ["송이 끝 알이 먼저 무름 — 발견 시 분리"],
  },
  {
    name: "샤인머스캣",
    aliases: ["샤인머스캣", "샤인머스캣 포도", "마스캇"],
    category: "fruit",
    varieties: [{ name: "샤인머스캣", note: "씨 없음, 껍질째 가능, 16~19Brix" }],
    origins: ["경북 상주", "경북 김천", "충북 영동", "전남 영암"],
    brixRange: { min: 16, max: 20, tasty: 18 },
    season: { start: 8, peak: 9, end: 11 },
    grades: ["특", "상"],
    storage: {
      fridge: "냉장 7~10일 (송이채로)",
      note: "드실 때만 씻기",
    },
    tips: ["껍질째 — 그대로 베어물기", "씨가 없어 아이도 편함"],
    hookPhrases: [
      "씨 없이 껍질째 한 알",
      "17~18Brix 이상만",
      "상주·김천 산지 직배",
    ],
    cautions: ["송이 균일성 ±10%"],
  },
  {
    name: "자두",
    aliases: ["자두", "후무사", "포모사", "추희"],
    category: "fruit",
    varieties: [
      { name: "후무사", note: "주요 품종, 6~7월" },
      { name: "포모사", note: "노란빛 자두, 7월" },
      { name: "추희", note: "추석 무렵 만생종, 9월" },
    ],
    origins: ["경북 김천", "경북 영천", "전남 화순"],
    brixRange: { min: 10, max: 14, tasty: 12 },
    season: { start: 6, peak: 7, end: 9 },
    grades: ["특", "상", "중"],
    storage: {
      fridge: "냉장 5~7일",
      roomTemp: "실온 1~2일",
    },
    tips: ["드시기 전 실온 30분", "껍질의 분(가루) — 천연 보호막", "잼·청 만들기 좋음"],
    hookPhrases: [
      "여름 한정 첫 자두",
      "껍질째 한 입에",
      "표면 분(가루)은 신선의 증거",
    ],
    cautions: ["충격에 약함", "껍질의 분은 자연 발생"],
  },
  {
    name: "멜론",
    aliases: ["멜론", "머스크멜론", "허니듀", "백자멜론"],
    category: "fruit",
    varieties: [
      { name: "머스크 멜론", note: "네트(그물) 무늬, 14~16Brix" },
      { name: "허니듀", note: "껍질 매끈, 부드러운 단맛" },
    ],
    origins: ["전북 고창", "충남 부여", "경남 함안"],
    brixRange: { min: 12, max: 16, tasty: 14 },
    season: { start: 6, peak: 7, end: 9 },
    grades: ["특", "상"],
    storage: {
      fridge: "냉장 1주 (자르기 전)",
      roomTemp: "실온 후숙 2~3일",
      note: "꼭지 가까운 부분 향이 올라오면 후숙 완료",
    },
    tips: ["후숙 필수 — 받으시면 향 체크", "후숙 후 시원하게", "씨까지 통째 — 단맛 농축"],
    hookPhrases: [
      "꼭지가 향을 내면 후숙 완료",
      "한 통의 묵직함 — 약 1.5kg",
      "여름 선물의 정수",
    ],
    cautions: ["후숙 필요 — 받자마자 자르지 마세요", "꼭지 근처 향으로 후숙 정도 확인"],
  },
  {
    name: "블루베리",
    aliases: ["블루베리", "블루베리과실"],
    category: "fruit",
    varieties: [
      { name: "듀크", note: "조생종, 6~7월" },
      { name: "블루크롭", note: "주요 품종, 7~8월" },
      { name: "엘리어트", note: "만생종, 8월" },
    ],
    origins: ["전남 영광", "경남 김해", "충남 부여"],
    brixRange: { min: 10, max: 14, tasty: 12 },
    season: { start: 6, peak: 7, end: 8 },
    grades: ["특", "상", "중"],
    storage: {
      fridge: "냉장 1주",
      note: "냉동 보관 시 3개월 (스무디용)",
    },
    tips: ["씻지 말고 보관 — 드실 때만", "요거트·시리얼 토핑", "냉동 후 그대로 간식"],
    hookPhrases: [
      "한 알 한 알 손 선별",
      "여름 한정 햇베리",
      "냉동해도 그대로",
    ],
    cautions: ["충격에 약함", "씻으면 보관 어려움"],
  },
  {
    name: "체리",
    aliases: ["체리", "앵두체리", "라이니어", "빙체리"],
    category: "fruit",
    varieties: [
      { name: "빙(Bing)체리", note: "검붉은 빛, 단맛 강함" },
      { name: "라이니어", note: "노란 빛, 새콤달콤" },
    ],
    origins: ["경북 영천", "경남 거창", "수입 (미국 워싱턴)"],
    brixRange: { min: 13, max: 18, tasty: 15 },
    season: { start: 5, peak: 6, end: 7 },
    grades: ["특", "상"],
    storage: {
      fridge: "냉장 5~7일",
      note: "씻지 않고 보관",
    },
    tips: ["줄기 채로 신선도 체크", "씨 빼고 잼·청 만들기", "여름 디저트 토핑"],
    hookPhrases: [
      "한 알이 묵직한 체리",
      "줄기 신선도 체크 OK",
      "여름 한정 첫 체리",
    ],
    cautions: ["충격에 약함", "줄기 마른 알은 신선도 떨어짐"],
  },
  {
    name: "키위",
    aliases: ["키위", "그린키위", "골드키위", "참다래"],
    category: "fruit",
    varieties: [
      { name: "골드키위", note: "노란 과육, 단맛 강함" },
      { name: "그린키위", note: "녹색 과육, 새콤한 맛" },
      { name: "참다래", note: "국내 토종 표현" },
    ],
    origins: ["전남 보성", "전남 해남", "제주"],
    brixRange: { min: 10, max: 16, tasty: 13 },
    season: { start: 11, peak: 1, end: 4 },
    grades: ["특", "상", "중"],
    storage: {
      fridge: "냉장 2~3주",
      roomTemp: "실온 1주 (후숙)",
      note: "단단하면 후숙 1~2일",
    },
    tips: ["반 잘라 숟가락으로", "샐러드 토핑", "스무디 좋음"],
    hookPhrases: [
      "노란 골드키위 한 입",
      "단단하면 후숙 1~2일",
      "겨울 한 알의 비타민",
    ],
    cautions: ["받으시면 후숙 정도 확인", "후숙 후 냉장"],
  },
  {
    name: "감",
    aliases: ["감", "단감", "대봉", "홍시", "곶감", "부유", "차랑"],
    category: "fruit",
    varieties: [
      { name: "부유", note: "단감 대표 (납작한 모양, 10~11월)" },
      { name: "대봉", note: "홍시·곶감용 (10~11월)" },
      { name: "차랑", note: "단감 신품종, 11월" },
    ],
    origins: ["경남 진주", "경남 산청", "경북 청도", "전남 영암"],
    brixRange: { min: 13, max: 18, tasty: 15 },
    season: { start: 9, peak: 11, end: 12 },
    grades: ["특", "상", "중"],
    storage: {
      fridge: "냉장 2~3주",
      roomTemp: "단감 — 실온 1주 / 대봉 — 후숙",
      note: "대봉은 홍시 될 때까지 후숙",
    },
    tips: ["단감 — 바로 깎아 드세요", "대봉 — 홍시 되면 숟가락으로", "곶감 — 겨울 간식"],
    hookPhrases: [
      "가을의 단단한 한 알",
      "산지에서 1차 선별 후 발송",
      "단감·대봉·곶감 골라 보내드려요",
    ],
    cautions: ["단감·대봉 구분해서 보관", "대봉은 후숙 후 식용"],
  },
  {
    name: "무화과",
    aliases: ["무화과", "도프"],
    category: "fruit",
    varieties: [
      { name: "도프", note: "주요 재배종, 8~10월" },
    ],
    origins: ["전남 영암", "전남 해남"],
    brixRange: { min: 12, max: 16, tasty: 14 },
    season: { start: 8, peak: 9, end: 10 },
    grades: ["특", "상"],
    storage: {
      fridge: "냉장 2~3일",
      note: "받자마자 냉장, 빠르게 섭취",
    },
    tips: ["껍질째 베어물기", "치즈·생햄과 페어링", "잼·청도 좋음"],
    hookPhrases: [
      "수확 다음 날 도착",
      "한 알 한 알 손 수확",
      "껍질째 한 입",
    ],
    cautions: ["보관성 매우 약함 — 받으시면 2일 내 섭취", "충격에 약함"],
  },
  {
    name: "망고",
    aliases: ["망고", "애플망고", "킨트망고"],
    category: "fruit",
    varieties: [
      { name: "애플망고 (어윈)", note: "붉은 빛, 부드러운 식감" },
      { name: "킨트망고", note: "노란 빛, 강한 향" },
    ],
    origins: ["제주", "전남 해남", "수입 (베트남·필리핀)"],
    brixRange: { min: 13, max: 18, tasty: 15 },
    season: { start: 6, peak: 7, end: 9 },
    grades: ["특", "상"],
    storage: {
      fridge: "냉장 5~7일",
      roomTemp: "후숙 2~3일",
      note: "껍질에 살짝 누름 자국이 들어가면 후숙 완료",
    },
    tips: ["반 잘라 숟가락으로", "스무디·디저트 토핑", "냉동 후 그대로 셔벗"],
    hookPhrases: [
      "제주 애플망고 — 국내산 한정 출하",
      "한 알 묵직한 약 400g",
      "후숙 후 시원하게",
    ],
    cautions: ["후숙 필요", "충격에 약함"],
  },
  {
    name: "참다래",
    aliases: ["참다래"],
    category: "fruit",
    varieties: [{ name: "그린", note: "국내 토종 표현" }, { name: "골드", note: "당도 강한 신품종" }],
    origins: ["전남 보성", "전남 해남", "제주"],
    brixRange: { min: 10, max: 16, tasty: 13 },
    season: { start: 11, peak: 1, end: 4 },
    storage: { fridge: "냉장 2~3주", roomTemp: "실온 1주 (후숙)" },
    tips: ["후숙 정도 확인 후 냉장", "샐러드 토핑"],
    hookPhrases: ["국내산 골드 한 알", "후숙 후 단맛 폭발", "비타민 가득한 겨울 한 알"],
    cautions: ["후숙 필요"],
  },
  {
    name: "매실",
    aliases: ["매실", "황매실", "청매실"],
    category: "fruit",
    varieties: [
      { name: "청매실", note: "딱딱·새콤, 5~6월" },
      { name: "황매실", note: "노란빛, 향 강함 (6월 말)" },
    ],
    origins: ["전남 광양", "전남 순천", "경남 하동"],
    brixRange: { min: 6, max: 10, tasty: 8 },
    season: { start: 5, peak: 6, end: 6 },
    storage: {
      fridge: "받자마자 청·장아찌 담그기 권장",
      note: "생식 X — 가공용",
    },
    tips: ["매실청 (설탕 1:1, 100일)", "매실장아찌", "씨 빼고 잼"],
    hookPhrases: [
      "산지 직배 — 한 번에 5kg",
      "올해 첫 청매실",
      "당일 수확 발송",
    ],
    cautions: ["생식 X — 가공용", "받으시면 가공 시작 권장"],
  },
  {
    name: "석류",
    aliases: ["석류"],
    category: "fruit",
    varieties: [{ name: "국내산 석류", note: "9~11월" }],
    origins: ["경남 거제", "전남 고흥"],
    brixRange: { min: 14, max: 17, tasty: 15 },
    season: { start: 9, peak: 10, end: 11 },
    storage: { fridge: "냉장 2~3주", roomTemp: "실온 1주" },
    tips: ["반 잘라 손으로 씨 분리", "주스·청 좋음", "샐러드 토핑"],
    hookPhrases: ["가을의 새콤한 한 알", "씨 가득 — 영양 가득", "주스용 한 박스"],
    cautions: ["껍질이 단단함 — 가르기 어렵"],
  },
]

/** 모든 alias를 모은 인덱스 (검색용). */
const ALIAS_INDEX: Map<string, FruitInfo> = new Map()
for (const f of FRUIT_DB) {
  for (const a of f.aliases) {
    ALIAS_INDEX.set(a.toLowerCase(), f)
  }
}

/** 상품명에서 과일 종류 자동 식별. 부분 일치도 허용. */
export function detectFruit(productName: string): FruitInfo | null {
  const name = productName.trim().toLowerCase()
  if (!name) return null
  // 정확 일치
  const exact = ALIAS_INDEX.get(name)
  if (exact) return exact
  // 부분 일치 — alias가 상품명에 포함되거나, 상품명이 alias에 포함
  for (const [alias, info] of ALIAS_INDEX.entries()) {
    if (name.includes(alias) || alias.includes(name)) {
      return info
    }
  }
  return null
}

/** 시즌 정렬 (start~end가 12월 → 1월 처럼 wrap 가능) */
export function isFruitInSeason(fruit: FruitInfo, month: number): boolean {
  const { start, end } = fruit.season
  if (start <= end) return month >= start && month <= end
  // wrap: 11~3 같은 경우
  return month >= start || month <= end
}

/** 현재 월 + 카테고리로 추천 과일 목록. */
export function suggestSeasonalFruits(month: number, category?: "fruit" | "veggie"): FruitInfo[] {
  return FRUIT_DB.filter(
    (f) => (!category || f.category === category) && isFruitInSeason(f, month),
  )
}

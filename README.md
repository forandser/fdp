# 과일 상세페이지 제작 사이트 — 앱

## 빠른 시작 (비개발자 가이드)

### 1. 의존성 설치 (한 번만)
프로젝트 폴더에서 명령 프롬프트를 열고:
```
npm install
```

### 2. 개발 서버 실행
이 `app/` 폴더에서 `dev.bat` 더블클릭. 또는 명령 프롬프트:
```
dev.bat
```
→ http://localhost:3000 에서 확인.

### 3. 프로덕션 빌드 (Cloudflare Pages 배포용)
`build.bat` 더블클릭. 산출물은 `out/` 폴더에 생성됩니다.

---

## 왜 `dev.bat` / `build.bat` 를 쓰나요?

이 프로젝트 폴더 경로에 `#` 문자가 들어 있어서, Tailwind 4 / Next.js 16 빌드가 직접 실행하면 깨집니다.
`dev.bat` 와 `build.bat` 는 **임시로 가상 드라이브 `Z:`** 를 만들어 경로 문제를 우회합니다.
가상 드라이브는 명령 실행 동안만 활성화되며, PC 재시작 후엔 자동으로 사라집니다.

원인 상세: `결과물/ADR_프레임워크선택_2026-06-30.md` 또는 `결과물/ADR_라우팅정책_2026-06-30.md` 참조.

---

## 폴더 구조

```
app/
├── src/
│   ├── app/                # Next.js App Router
│   ├── components/         # 공용 UI 컴포넌트
│   ├── features/           # 기능 단위 (api-key, copy-form, editor, exporter ...)
│   ├── lib/
│   │   ├── ai/             # Claude API 어댑터 (확장 포인트)
│   │   ├── storage/        # IndexedDB / localStorage 어댑터
│   │   ├── fs/             # File System Access API 어댑터
│   │   ├── exporters/      # JPG 출력 (플랫폼별 확장 포인트)
│   │   ├── image-filters/  # AI 자동 보정 (확장 포인트)
│   │   ├── fonts/          # 폰트 라이브러리 8종
│   │   └── i18n/           # 다국어 키 (한국어 → 확장 가능)
│   ├── domain/             # 과일 도메인 모델
│   └── types/              # 공용 타입
├── public/
│   ├── fonts/              # Pretendard 외 7종 폰트 (woff2)
│   └── _headers            # Cloudflare Pages 보안 헤더
├── dev.bat                 # 개발 서버 실행 스크립트
├── build.bat               # 프로덕션 빌드 스크립트
└── package.json
```

---

## 핵심 디자인 결정 (요약)

- **호스팅**: Cloudflare Pages 무료 (`out/` 폴더 업로드)
- **AI**: BYOK (사용자 각자 Anthropic API 키 입력, 우리는 보관 안 함)
- **캔버스 에디터**: react-konva 19.x
- **폰트**: 상업적 무료 한/영 8종
- **출력**: 셀러가 UI에서 옵션 선택 (가로/세로/형식/품질)
- **저장**: 세션 메모리 기본 + 7일/30일 옵션 (AES-GCM 암호화)

상세 결정은 [`결과물/`](../결과물/) 폴더의 ADR 7건 참조.

---

## 첫 실행 시 확인

`dev.bat` 후 브라우저 http://localhost:3000:
1. API 키 입력 화면이 뜸
2. Anthropic 콘솔에서 발급한 키 입력
3. "사용량 한도 설정 체크" → "검증 후 시작"
4. 셀프 진단 3단계 통과 시 메인 화면

키 발급: https://console.anthropic.com/settings/keys

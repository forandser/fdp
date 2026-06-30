@echo off
REM ============================================
REM 과일 상세페이지 제작 — 프로덕션 빌드
REM (Cloudflare Pages 배포용 정적 산출물 생성)
REM ============================================

set TEMP=D:\temp-claude
set TMP=D:\temp-claude
if not exist D:\temp-claude mkdir D:\temp-claude

subst Z: /D >nul 2>&1
subst Z: "%~dp0"

if not exist Z:\package.json (
  echo [ERROR] Z: 가상 드라이브 매핑 실패.
  pause
  exit /b 1
)

echo [OK] Z: 드라이브 매핑 완료. 빌드 시작...
echo.
cd /d Z:\
node "./node_modules/next/dist/bin/next" build --webpack

echo.
echo ======================================================
echo 빌드 산출물: Z:\out\  (= 원본 폴더 app\out\)
echo Cloudflare Pages 업로드는 out\ 폴더 내용물을 올리면 됩니다.
echo ======================================================

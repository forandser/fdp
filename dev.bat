@echo off
REM ============================================
REM 과일 상세페이지 제작 — 개발 서버 실행
REM
REM 폴더명에 # 문자가 있으면 Tailwind 4 빌드가 깨지므로
REM subst로 Z: 가상 드라이브를 만들어 우회합니다.
REM ============================================

set TEMP=D:\temp-claude
set TMP=D:\temp-claude
if not exist D:\temp-claude mkdir D:\temp-claude

REM 기존 Z: 매핑 정리 후 재설정
subst Z: /D >nul 2>&1
subst Z: "%~dp0"

if not exist Z:\package.json (
  echo [ERROR] Z: 가상 드라이브 매핑 실패. 관리자 권한으로 다시 실행해 주세요.
  pause
  exit /b 1
)

echo [OK] Z: 드라이브 매핑 완료. 개발 서버 시작...
echo.
cd /d Z:\
node "./node_modules/next/dist/bin/next" dev --webpack

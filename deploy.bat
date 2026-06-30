@echo off
REM ============================================
REM 과일 상세페이지 — GitHub Pages 자동 배포
REM 1) Z: 드라이브 매핑 (한글/# 경로 회피)
REM 2) NEXT_PUBLIC_BASE_PATH=/fdp 로 빌드
REM 3) out/ 산출물을 gh-pages 브랜치에 force-push
REM ============================================

setlocal enabledelayedexpansion

set TEMP=D:\temp-claude
set TMP=D:\temp-claude
if not exist D:\temp-claude mkdir D:\temp-claude

REM === Z: 드라이브 매핑 ===
subst Z: /D >nul 2>&1
subst Z: "%~dp0"

if not exist Z:\package.json (
  echo [ERROR] Z: 가상 드라이브 매핑 실패.
  exit /b 1
)

cd /d Z:\

REM === 1) 빌드 ===
echo [1/3] 빌드 시작 (NEXT_PUBLIC_BASE_PATH=/fdp)...
set NEXT_PUBLIC_BASE_PATH=/fdp
node "./node_modules/next/dist/bin/next" build --webpack
if errorlevel 1 (
  echo [ERROR] 빌드 실패.
  exit /b 1
)

if not exist Z:\out (
  echo [ERROR] out/ 폴더 생성 실패.
  exit /b 1
)

echo.
echo [2/3] gh-pages 브랜치 갱신...

REM === 2) gh-pages 임시 worktree 생성 ===
set DEPLOY_DIR=D:\temp-claude\fdp-gh-pages
if exist "%DEPLOY_DIR%" rmdir /S /Q "%DEPLOY_DIR%"

git fetch origin gh-pages
git worktree add "%DEPLOY_DIR%" gh-pages
if errorlevel 1 (
  echo [ERROR] worktree 추가 실패.
  exit /b 1
)

REM === 3) out/ 내용을 worktree로 미러 복사 ===
REM /MIR: 미러 (대상에만 있는 파일 삭제 포함)
REM /XD .git: gh-pages worktree의 .git 메타 보존
robocopy Z:\out "%DEPLOY_DIR%" /MIR /XD .git /NFL /NDL /NJH /NJS /NC /NS /NP
REM robocopy 종료코드 0-7은 성공 (8 이상이 진짜 에러)
if errorlevel 8 (
  echo [ERROR] 산출물 복사 실패.
  exit /b 1
)

REM === 4) GitHub Pages용 .nojekyll 보장 ===
type nul > "%DEPLOY_DIR%\.nojekyll"

REM === 5) 커밋 + 푸시 ===
cd /d "%DEPLOY_DIR%"
git add -A
git diff --cached --quiet
if errorlevel 1 (
  REM 변경 사항 있음
  for /f "tokens=*" %%i in ('powershell -NoProfile -Command "Get-Date -Format yyyy-MM-ddTHH:mm:ssK"') do set NOW=%%i
  git commit -m "deploy: !NOW!"
  if errorlevel 1 (
    echo [ERROR] 커밋 실패.
    exit /b 1
  )
  git push origin gh-pages
  if errorlevel 1 (
    echo [ERROR] 푸시 실패.
    exit /b 1
  )
  echo [3/3] gh-pages 푸시 완료.
) else (
  echo [3/3] 변경 사항 없음 — 푸시 생략.
)

REM === 6) worktree 정리 ===
cd /d Z:\
git worktree remove "%DEPLOY_DIR%" --force >nul 2>&1
if exist "%DEPLOY_DIR%" rmdir /S /Q "%DEPLOY_DIR%"

echo.
echo ====================================================
echo  배포 완료 — https://forandser.github.io/fdp/ (5~10분 후 반영)
echo ====================================================
endlocal

# GitHub Pages 자동 배포 — PowerShell 친화 버전
# 1) Z: 드라이브 매핑 (한글/# 폴더 우회)
# 2) NEXT_PUBLIC_BASE_PATH=/fdp 빌드
# 3) gh-pages worktree에 out/ 복사 후 push
# 4) 작업 디렉터리 정리

$ErrorActionPreference = 'Stop'

$ProjectDir = "d:\문서\Dropbox\#어드민개발\프로젝트-과일상세페이지제작\app"

if (-not (Test-Path $ProjectDir)) {
  Write-Host "[ERROR] 프로젝트 폴더 없음: $ProjectDir"
  exit 1
}

# --- 1) Z: 매핑 ---
subst Z: /D 2>$null | Out-Null
subst Z: $ProjectDir
Start-Sleep -Milliseconds 700
if (-not (Test-Path Z:\package.json)) {
  Write-Host "[ERROR] Z: 매핑 실패"
  exit 1
}

# --- 임시 디렉토리 ---
$env:TEMP = 'D:\temp-claude'
$env:TMP = 'D:\temp-claude'
if (-not (Test-Path 'D:\temp-claude')) { New-Item -ItemType Directory 'D:\temp-claude' | Out-Null }

# --- 2) Build ---
Write-Host "[1/4] Building (NEXT_PUBLIC_BASE_PATH=/fdp)..."
$env:NEXT_PUBLIC_BASE_PATH = '/fdp'
Push-Location Z:\
try {
  & node "./node_modules/next/dist/bin/next" build --webpack
  if ($LASTEXITCODE -ne 0) { throw "next build 실패 (exit $LASTEXITCODE)" }
} finally {
  Pop-Location
}

if (-not (Test-Path Z:\out)) {
  Write-Host "[ERROR] out/ 폴더 생성 실패"
  exit 1
}

# --- 3) gh-pages worktree 준비 ---
$DeployDir = 'D:\temp-claude\fdp-gh-pages'
if (Test-Path $DeployDir) {
  Push-Location Z:\
  try { git worktree remove $DeployDir --force 2>$null | Out-Null } catch {}
  Pop-Location
  Remove-Item -Recurse -Force $DeployDir -ErrorAction SilentlyContinue
}

Write-Host "[2/4] gh-pages worktree 준비..."
Push-Location Z:\
try {
  git fetch origin gh-pages 2>&1 | Out-Null
  git worktree add $DeployDir gh-pages
  if ($LASTEXITCODE -ne 0) { throw "worktree add 실패" }
} finally {
  Pop-Location
}

# --- 4) out/ → worktree 미러 복사 ---
Write-Host "[3/4] 산출물 동기화..."
# robocopy: /MIR 미러, /XD .git worktree 메타 보호
$rcArgs = @(
  'Z:\out',
  $DeployDir,
  '/MIR',
  '/XD', "$DeployDir\.git",
  '/NFL', '/NDL', '/NJH', '/NJS', '/NC', '/NS', '/NP'
)
& robocopy @rcArgs | Out-Null
# robocopy: 0-7 success, 8+ failure
if ($LASTEXITCODE -ge 8) {
  Write-Host "[ERROR] robocopy 실패 (exit $LASTEXITCODE)"
  exit 1
}

# GitHub Pages .nojekyll 보장
New-Item -ItemType File -Path "$DeployDir\.nojekyll" -Force | Out-Null

# --- 5) 커밋 + 푸시 ---
Write-Host "[4/4] 커밋·푸시..."
Push-Location $DeployDir
try {
  git add -A
  git diff --cached --quiet
  if ($LASTEXITCODE -eq 0) {
    Write-Host "  변경 사항 없음 — 푸시 생략"
  } else {
    $stamp = Get-Date -Format 'yyyy-MM-ddTHH:mm:ssK'
    git commit -m "deploy: $stamp"
    if ($LASTEXITCODE -ne 0) { throw "commit 실패" }
    git push origin gh-pages
    if ($LASTEXITCODE -ne 0) { throw "push 실패" }
    Write-Host "  gh-pages 푸시 완료"
  }
} finally {
  Pop-Location
}

# --- 6) worktree 정리 ---
Push-Location Z:\
try {
  git worktree remove $DeployDir --force 2>&1 | Out-Null
} finally {
  Pop-Location
}
if (Test-Path $DeployDir) { Remove-Item -Recurse -Force $DeployDir -ErrorAction SilentlyContinue }

Write-Host ""
Write-Host "============================================"
Write-Host " 배포 완료 — https://forandser.github.io/fdp/"
Write-Host " (CDN 반영까지 1~5분)"
Write-Host "============================================"

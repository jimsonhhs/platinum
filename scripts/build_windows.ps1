# goink Windows 构建脚本（含 CGO 环境准备）
# 前置：Go、git；CGO 需要 mingw-w64 gcc（sqlite-vec / go-sqlite3 / onnxruntime 都是 cgo 包）
# 用法：powershell -ExecutionPolicy Bypass -File scripts\build_windows.ps1
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot

# 1. 定位 gcc（WinGet 安装的 WinLibs / 常见路径 / PATH）
$gcc = Get-Command gcc -ErrorAction SilentlyContinue
if (-not $gcc) {
  $candidates = @(
    "$env:LOCALAPPDATA\Microsoft\WinGet\Packages\BrechtSanders.WinLibs.POSIX.UCRT_Microsoft.WinGet.Source_8wekyb3d8bbwe\mingw64\bin",
    "C:\Program Files\mingw64\bin",
    "C:\mingw64\bin"
  )
  $bin = $candidates | Where-Object { Test-Path "$_\gcc.exe" } | Select-Object -First 1
  if ($bin) {
    $env:Path = "$bin;$env:Path"
    Write-Host "[1/3] gcc: $bin"
  } else {
    throw "未找到 gcc。请先安装 mingw-w64：winget install -e --id BrechtSanders.WinLibs.POSIX.UCRT"
  }
} else {
  Write-Host "[1/3] gcc: $($gcc.Source)"
}

# 2. 准备 sqlite3.h（sqlite-vec-go-bindings 的 cgo 需要）
# 从 mattn/go-sqlite3 模块缓存复制 amalgamation 头（与运行时 SQLite 版本一致）
$inc = Join-Path $env:USERPROFILE "go\goink-cgo-include"
if (-not (Test-Path "$inc\sqlite3.h")) {
  New-Item -ItemType Directory -Force -Path $inc | Out-Null
  $mattn = Get-ChildItem "$env:USERPROFILE\go\pkg\mod\github.com\mattn" -Directory -Filter "go-sqlite3@*" -ErrorAction SilentlyContinue |
    Sort-Object Name -Descending | Select-Object -First 1
  if (-not $mattn) { throw "未找到 mattn/go-sqlite3 模块缓存，请先运行: go mod download" }
  Copy-Item "$($mattn.FullName)\sqlite3-binding.h" "$inc\sqlite3.h" -Force
  Copy-Item "$($mattn.FullName)\sqlite3ext.h" "$inc\sqlite3ext.h" -Force
  Write-Host "[2/3] sqlite3.h -> $inc"
} else {
  Write-Host "[2/3] sqlite3.h 已就绪: $inc"
}
$env:CGO_CFLAGS = "-I$inc"

# 3. 构建（如遇 ld manifest 冲突可加 -tags native_webview2loader）
# 版本号：VERSION 文件为唯一真源（如 v1.0.1），未创建时回退 git describe，再回退 dev
$versionFile = Join-Path $root "VERSION"
if (Test-Path $versionFile) {
  $version = (Get-Content $versionFile -Raw).Trim()
  Write-Host "[3/3] 版本号（VERSION 文件）: $version"
} else {
  $version = git describe --tags --always --dirty 2>$null
  if (-not $version) { $version = "dev" }
  Write-Host "[3/3] 版本号（git describe）: $version"
}
Write-Host "[4/4] wails build ..."
Set-Location $root
wails build -ldflags "-X internal/version.Version=$version"
Write-Host "完成: build\bin\platinum.exe (版本 $version)"

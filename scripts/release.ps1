# release.ps1 - 一键发布（老样子 8 步的机械部分）：构建 → 部署 → 打包 → git push → GitHub Release 上传
# 用法: powershell -ExecutionPolicy Bypass -File scripts\release.ps1 [-SkipBuild] [-SkipDeploy] [-SkipGit] [-SkipUpload]
# 前置: VERSION 文件已更新；git 已配置；GitHub 凭据在 Windows 凭据管理器（gh_replace.cjs 自动取）
# 注意: README/DEPENDENCIES/HelpDialog 内容更新仍需人工（本脚本只做机械步骤）
param(
    [switch]$SkipBuild,   # 跳过构建（用现有 build\bin\platinum.exe）
    [switch]$SkipDeploy,  # 跳过部署到桌面
    [switch]$SkipGit,     # 跳过 git commit/push
    [switch]$SkipUpload   # 跳过 GitHub Release 上传
)
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

function Step($msg) { Write-Host "`n=== $msg ===" -ForegroundColor Cyan }

# 0. 版本号
$versionFile = Join-Path $root "VERSION"
if (-not (Test-Path $versionFile)) { throw "缺少 VERSION 文件" }
$version = (Get-Content $versionFile -Raw).Trim()
Write-Host "版本: $version"

# 1. 构建（自动读 VERSION 注入 + native_webview2loader）
if (-not $SkipBuild) {
    Step "1/6 构建"
    & powershell -ExecutionPolicy Bypass -File (Join-Path $PSScriptRoot "build_windows.ps1")
    if ($LASTEXITCODE -ne 0) { throw "构建失败" }
} else {
    Write-Host "跳过构建"
}

# 2. 部署到桌面（自动备份旧版）
if (-not $SkipDeploy) {
    Step "2/6 部署到桌面"
    & powershell -ExecutionPolicy Bypass -File (Join-Path $PSScriptRoot "deploy_windows.ps1")
    if ($LASTEXITCODE -ne 0) { throw "部署失败" }
} else {
    Write-Host "跳过部署"
}

# 3. 打包两个 zip
Step "3/6 打包"
$exe = Join-Path $root "build\bin\platinum.exe"
if (-not (Test-Path $exe)) { throw "未找到 $exe，请先构建" }
# win64 完整包（exe + runtime 全套）
$runtimeSrc = Join-Path (Split-Path $exe -Parent) "runtime"
if (-not (Test-Path $runtimeSrc)) {
    # build 目录没有 runtime 时，从桌面 platinum 复制（保证包含 git/models/onnx）
    $runtimeSrc = "C:\Users\haoha\Desktop\platinum\runtime"
    if (-not (Test-Path $runtimeSrc)) { throw "未找到 runtime 源" }
}
$tmp = Join-Path $env:TEMP "platinum_pkg_$PID"
if (Test-Path $tmp) { Remove-Item $tmp -Recurse -Force }
New-Item -ItemType Directory -Path $tmp | Out-Null
Copy-Item $exe $tmp -Force
Copy-Item $runtimeSrc (Join-Path $tmp "runtime") -Recurse -Force
# 确认无 goink.exe 冗余
Get-ChildItem $tmp -Recurse -Filter "goink.exe" | Remove-Item -Force -ErrorAction SilentlyContinue
$winZip = Join-Path $root "platinum-win64.zip"
Remove-Item $winZip -Force -ErrorAction SilentlyContinue
Compress-Archive -Path (Join-Path $tmp "*") -DestinationPath $winZip -CompressionLevel Optimal
Write-Host "win64 zip: $((Get-Item $winZip).Length / 1MB) MB"
Remove-Item $tmp -Recurse -Force
# src zip
& node (Join-Path $PSScriptRoot "make_src_zip.cjs")
if ($LASTEXITCODE -ne 0) { throw "src zip 打包失败" }

# 4. git commit + push
if (-not $SkipGit) {
    Step "4/6 git 提交推送"
    git add -A
    git commit -m "release ${version}: 自动打包" --allow-empty
    git push origin master
    if ($LASTEXITCODE -ne 0) { throw "git push 失败" }
} else {
    Write-Host "跳过 git"
}

# 5. 查 latest release_id
Step "5/6 查 GitHub release"
$releaseJson = & node -e "const https=require('https');const {execSync}=require('child_process');const out=execSync('git credential fill',{input:'protocol=https\nhost=github.com\n\n',encoding:'utf8'});const t=(out.split('\n').find(l=>l.startsWith('password='))||'').split('=').slice(1).join('=');https.get({host:'api.github.com',path:'/repos/jimsonhhs/platinum/releases/latest',headers:{Authorization:'token '+t,'User-Agent':'platinum-deploy'}},r=>{let d='';r.on('data',c=>d+=c);r.on('end',()=>{const j=JSON.parse(d);console.log(j.id)})})"
$releaseId = $releaseJson.Trim()
if (-not $releaseId) { throw "未找到 latest release" }
Write-Host "release_id: $releaseId"

# 6. 上传两个资产
if (-not $SkipUpload) {
    Step "6/6 上传 GitHub Release 资产"
    & node (Join-Path $PSScriptRoot "gh_replace.cjs") $releaseId "platinum-win64.zip" (Join-Path $root "platinum-win64.zip")
    & node (Join-Path $PSScriptRoot "gh_replace.cjs") $releaseId "platinum-src.zip" (Join-Path $root "platinum-src.zip")
} else {
    Write-Host "跳过上传"
}

Write-Host "`n✅ 发布完成: $version" -ForegroundColor Green

# restore_goink_config.ps1 - 一键还原 ~/.goink 全局配置（旧存档）
# 用法: powershell -ExecutionPolicy Bypass -File scripts\restore_goink_config.ps1 [-BackupDir <路径>]
# 备份位置（2026-08-16 由 OpenClaw 制作）:
#   C:\Users\haoha\lobsterai\project\.cowork-temp\goink_home_backup\
#     config.json / config.json.bak / llm_config.enc
param(
    [string]$BackupDir = 'C:\Users\haoha\lobsterai\project\.cowork-temp\goink_home_backup',
    [string]$DestDir = "$env:USERPROFILE\.goink"
)
$ErrorActionPreference = 'Stop'

if (-not (Test-Path $BackupDir)) {
    Write-Error "备份目录不存在: $BackupDir"
    exit 1
}
if (-not (Test-Path $DestDir)) {
    New-Item -ItemType Directory -Path $DestDir | Out-Null
    Write-Host "已创建目标目录: $DestDir"
}

$files = @('config.json', 'llm_config.enc')
foreach ($f in $files) {
    $src = Join-Path $BackupDir $f
    if (Test-Path $src) {
        Copy-Item $src $DestDir -Force
        Write-Host "已还原: $f"
    } else {
        Write-Warning "备份中缺少: $f（跳过）"
    }
}

Write-Host "`n~/.goink 当前内容："
Get-ChildItem $DestDir -Force | Select-Object Name, Length
Write-Host "`n还原完成。重启桌面版 Platinum 即可恢复旧 LLM 配置。"

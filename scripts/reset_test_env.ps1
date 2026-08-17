# reset_test_env.ps1 - 一键把测试环境重置为"全新用户"状态
# 用法: powershell -ExecutionPolicy Bypass -File scripts\reset_test_env.ps1 [-TestDir <路径>] [-NoStart]
# 默认: C:\Users\haoha\Desktop\新用户测试（保留 platinum.exe + runtime，清空所有数据）
# 同时清空全局配置 ~/.goink（config.json + llm_config.enc）→ 彻底新用户；旧配置可用 restore_goink_config.ps1 还原
param(
    [string]$TestDir = "$env:USERPROFILE\Desktop\新用户测试",
    [switch]$NoStart
)
$ErrorActionPreference = 'SilentlyContinue'

Write-Host "[1/4] 停止运行中的测试实例..."
Get-Process -Name platinum -ErrorAction SilentlyContinue |
    Where-Object { $_.Path -like "$TestDir*" } |
    Stop-Process -Force
Start-Sleep 2

Write-Host "[2/4] 清理测试目录数据（保留 exe + runtime）..."
$targets = @(
    'data_dir.txt', 'goink.log',
    'novel-agent.db', 'novel-agent.db-shm', 'novel-agent.db-wal',
    'novels', 'skills', 'styles', 'rules', 'trash', 'archive',
    'runtime\dnd.log'
)
foreach ($t in $targets) {
    Remove-Item (Join-Path $TestDir $t) -Recurse -Force -ErrorAction SilentlyContinue
}

Write-Host "[3/4] 清空全局配置 ~/.goink（config.json / llm_config.enc）..."
$goinkDir = "$env:USERPROFILE\.goink"
foreach ($f in @('config.json', 'config.json.bak', 'llm_config.enc')) {
    Remove-Item (Join-Path $goinkDir $f) -Force -ErrorAction SilentlyContinue
}
Write-Host "~/.goink 剩余："
Get-ChildItem $goinkDir -Force | Select-Object Name

Write-Host "[4/4] 测试目录剩余："
Get-ChildItem $TestDir -Force | Select-Object Name

if (-not $NoStart) {
    Write-Host "启动全新用户实例..."
    Start-Process (Join-Path $TestDir 'platinum.exe')
}
Write-Host "完成。"

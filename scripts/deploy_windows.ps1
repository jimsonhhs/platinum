# Deploy to Desktop platinum + automatic version backup.
# Rule: before each deploy, backup current platinum.exe with system timestamp
# (platinum_YYYYMMDD-HHMMSS.exe) so any version can be rolled back.
$ErrorActionPreference = 'Stop'

$src = 'C:\Users\haoha\lobsterai\project\goink\build\bin\platinum.exe'
$destDir = 'C:\Users\haoha\Desktop\platinum'
$dest = Join-Path $destDir 'platinum.exe'

# 1. Check running (running app locks the file)
$p = Get-Process -Name platinum -ErrorAction SilentlyContinue
if ($p) {
  Write-Host 'platinum is running. Close it first, then deploy again.'
  $p | Select-Object Id, Path
  exit 1
}

# 2. Backup old version
if (Test-Path $dest) {
  $ts = Get-Date -Format 'yyyyMMdd-HHmmss'
  $backup = Join-Path $destDir "platinum_$ts.exe"
  Copy-Item $dest $backup -Force
  Write-Host "Backed up old version -> $backup"
}

# 3. Deploy new version (main folder)
Copy-Item $src $dest -Force
Write-Host "Deployed new version -> $dest"
Get-Item $dest | Select-Object Name, Length, LastWriteTime

# 4. Mirror to platinumV1.0 (always the latest)
$v10 = Join-Path $destDir '..\platinumV1.0\platinum.exe'
if (Test-Path (Split-Path $v10)) {
  Copy-Item $src $v10 -Force
  Write-Host "Mirrored latest -> $v10"
} else {
  Write-Host 'platinumV1.0 folder not found, skipped mirror.'
}

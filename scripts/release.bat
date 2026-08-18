@echo off
rem Double-click: one-click release (build + deploy + package + git push + GitHub upload)
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0release.ps1" %*
echo.
pause

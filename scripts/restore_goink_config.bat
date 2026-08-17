@echo off
rem Double-click: restore ~/.goink old config (calls restore_goink_config.ps1)
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0restore_goink_config.ps1" %*
echo.
pause

@echo off
rem Double-click: reset test env to brand-new user state (calls reset_test_env.ps1)
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0reset_test_env.ps1" %*
echo.
pause

@echo off
REM ============================================================================
REM  AncoraLens - one-click installer launcher.
REM  Double-click this file. It self-elevates (UAC) and runs the deployment
REM  orchestrator (Deploy-AncoraLens.ps1) sitting next to it.
REM
REM  Advanced: pass parameters through, e.g.
REM    Install-AncoraLens.cmd -HttpPort 8081 -InstallPath C:\apps\AncoraLens
REM    Install-AncoraLens.cmd -Uninstall
REM ============================================================================
setlocal

REM --- Re-launch elevated if we are not already running as administrator ------
net session >nul 2>&1
if %errorlevel% NEQ 0 (
  echo Requesting administrator privileges...
  powershell -NoProfile -ExecutionPolicy Bypass -Command "Start-Process -FilePath '%~f0' -ArgumentList '%*' -Verb RunAs"
  exit /b
)

powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0Deploy-AncoraLens.ps1" %*

echo.
echo Press any key to close...
pause >nul

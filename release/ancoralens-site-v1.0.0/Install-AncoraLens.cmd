@echo off
REM AncoraLens - ONE-CLICK Windows/IIS deploy. Double-click (it self-elevates via UAC).
REM Advanced: pass through args, e.g.  Install-AncoraLens.cmd -HttpPort 8081
REM Uninstall:  Install-AncoraLens.cmd -Uninstall
setlocal
net session >nul 2>&1
if %errorlevel% NEQ 0 (
  echo Requesting administrator privileges...
  powershell -NoProfile -ExecutionPolicy Bypass -Command "Start-Process -FilePath '%~f0' -ArgumentList '%*' -Verb RunAs"
  exit /b
)
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0iis\Deploy-AncoraLens.ps1" %*
echo.
echo Press any key to close...
pause >nul

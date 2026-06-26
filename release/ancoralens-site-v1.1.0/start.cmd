@echo off
REM AncoraLens — start the unified server (serves UI + API on one port)
cd /d "%~dp0"
if not exist "server\node_modules" (
  echo Installing server dependencies...
  pushd server && call npm ci --omit=dev && popd
)
if "%PORT%"=="" set PORT=8080
echo Starting AncoraLens on port %PORT% ...
node server\index.js

#!/usr/bin/env node
/**
 * AncoraLens — deploy packager.
 *
 *   npm run package
 *
 * Builds the frontend, assembles a self-contained deploy bundle (built UI +
 * unified server + lockfile + env template + start scripts + CloudOps guide),
 * and zips it into ./release/ancoralens-site-v<version>.zip for handoff.
 *
 * The resulting bundle runs the whole site (UI + /api) on a single port via
 * `node server/index.js`. CloudOps only needs Node 18+ on the VM.
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
const version = pkg.version || "0.0.0";
const name = `ancoralens-site-v${version}`;
const releaseDir = path.join(root, "release");
const stage = path.join(releaseDir, name);

const isWin = process.platform === "win32";

function run(cmd, args, opts = {}) {
  const res = spawnSync(cmd, args, { stdio: "inherit", shell: isWin, ...opts });
  if (res.status !== 0) {
    throw new Error(`Command failed (${res.status}): ${cmd} ${args.join(" ")}`);
  }
}

function step(msg) {
  console.log(`\n[1m[34m▶ ${msg}[0m`);
}

// ── 1. Clean staging ──────────────────────────────────────────────
step(`Packaging ${name}`);
fs.rmSync(stage, { recursive: true, force: true });
fs.mkdirSync(stage, { recursive: true });

// ── 2. Build the frontend ─────────────────────────────────────────
step("Building frontend (vite build)…");
run("npm", ["run", "build"], { cwd: root });

const distSrc = path.join(root, "dist");
if (!fs.existsSync(path.join(distSrc, "index.html"))) {
  throw new Error("Build did not produce dist/index.html — aborting.");
}

// ── 3. Assemble the bundle ────────────────────────────────────────
step("Assembling bundle…");
fs.cpSync(distSrc, path.join(stage, "dist"), { recursive: true });

fs.mkdirSync(path.join(stage, "server"), { recursive: true });
fs.copyFileSync(path.join(root, "server", "index.js"), path.join(stage, "server", "index.js"));
fs.copyFileSync(path.join(root, "server", "package.json"), path.join(stage, "server", "package.json"));

const copyIfExists = (src, dest) => {
  if (fs.existsSync(src)) fs.copyFileSync(src, dest);
};
copyIfExists(path.join(root, ".env.example"), path.join(stage, ".env.example"));
copyIfExists(path.join(root, "DEPLOY_AZURE_VM.md"), path.join(stage, "DEPLOY.md"));
copyIfExists(path.join(root, "DEPLOY_IIS.md"), path.join(stage, "DEPLOY_IIS.md"));
if (fs.existsSync(path.join(root, "iis"))) {
  fs.cpSync(path.join(root, "iis"), path.join(stage, "iis"), { recursive: true });
}
fs.writeFileSync(path.join(stage, "VERSION"), `${name}\nbuilt ${new Date().toISOString()}\n`);

// ── 4. Generate a server lockfile (deps resolved, no node_modules) ─
step("Resolving server dependency lockfile…");
run("npm", ["install", "--omit=dev", "--package-lock-only", "--no-audit", "--no-fund"], {
  cwd: path.join(stage, "server"),
});

// ── 5. Start scripts ──────────────────────────────────────────────
const startCmd = `@echo off
REM AncoraLens — start the unified server (serves UI + API on one port)
cd /d "%~dp0"
if not exist "server\\node_modules" (
  echo Installing server dependencies...
  pushd server && call npm ci --omit=dev && popd
)
if "%PORT%"=="" set PORT=8080
echo Starting AncoraLens on port %PORT% ...
node server\\index.js
`;

const startSh = `#!/usr/bin/env bash
# AncoraLens — start the unified server (serves UI + API on one port)
set -e
cd "$(dirname "$0")"
if [ ! -d server/node_modules ]; then
  echo "Installing server dependencies..."
  ( cd server && npm ci --omit=dev )
fi
export PORT="\${PORT:-8080}"
echo "Starting AncoraLens on port $PORT ..."
exec node server/index.js
`;

fs.writeFileSync(path.join(stage, "start.cmd"), startCmd);
fs.writeFileSync(path.join(stage, "start.sh"), startSh);

// One-click Windows/IIS deployment launcher at the bundle root. Self-elevates (UAC) and runs the
// self-contained orchestrator in iis\Deploy-AncoraLens.ps1 (installs IIS/Node/URL Rewrite/ARR/NSSM,
// deploys, registers the Node service, configures the IIS reverse proxy + firewall). See iis\.
const oneClickCmd = `@echo off
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
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0iis\\Deploy-AncoraLens.ps1" %*
echo.
echo Press any key to close...
pause >nul
`;
fs.writeFileSync(path.join(stage, "Install-AncoraLens.cmd"), oneClickCmd);
copyIfExists(path.join(root, "DEPLOY_ONECLICK.md"), path.join(stage, "DEPLOY_ONECLICK.md"));
try {
  fs.chmodSync(path.join(stage, "start.sh"), 0o755);
} catch {
  /* chmod is a no-op / unsupported on some filesystems */
}

// ── 6. Zip the bundle ─────────────────────────────────────────────
step("Creating archive…");
const zipPath = path.join(releaseDir, `${name}.zip`);
fs.rmSync(zipPath, { force: true });

let archive = zipPath;
if (isWin) {
  run("powershell", [
    "-NoProfile",
    "-Command",
    `Compress-Archive -Path '${stage}\\*' -DestinationPath '${zipPath}' -Force`,
  ]);
} else {
  const zip = spawnSync("zip", ["-rq", zipPath, "."], { cwd: stage, stdio: "inherit" });
  if (zip.status !== 0) {
    // fall back to tar.gz if `zip` is unavailable
    archive = path.join(releaseDir, `${name}.tar.gz`);
    fs.rmSync(archive, { force: true });
    run("tar", ["-czf", archive, "-C", releaseDir, name]);
  }
}

// ── 7. Summary ────────────────────────────────────────────────────
const sizeMB = (fs.statSync(archive).size / 1024 / 1024).toFixed(1);
step("Done ✅");
console.log(`
  Bundle folder : ${path.relative(root, stage)}
  Archive       : ${path.relative(root, archive)}  (${sizeMB} MB)

  Hand the archive to whoever runs the server.

  ONE-CLICK (Windows Server / IIS): unzip, then right-click
    Install-AncoraLens.cmd -> "Run as administrator".
  It installs IIS + Node + URL Rewrite + ARR + NSSM, deploys, registers the
  Node Windows service, and configures the IIS reverse proxy + firewall.
  See DEPLOY_ONECLICK.md.

  MANUAL / non-IIS (Node 18+): unzip, then
    1. cd server && npm ci --omit=dev
    2. (from the bundle root) set PORT=8080 and run:  node server/index.js
       — or just run start.cmd (Windows) / ./start.sh (Linux)

  Full instructions: DEPLOY_ONECLICK.md (one-click), DEPLOY.md / DEPLOY_IIS.md (manual).
`);

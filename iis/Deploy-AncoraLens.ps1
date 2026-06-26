#Requires -Version 5.1
<#
.SYNOPSIS
  One-click, self-contained deployment of AncoraLens to Windows Server / IIS.

.DESCRIPTION
  Run from an unzipped release bundle (the folder that contains dist\ and server\).
  Double-click Install-AncoraLens.cmd (it self-elevates) or run this elevated.

  It does EVERYTHING needed for a full site, downloading prerequisites as required:
    1. Enables the IIS Windows feature (+ management tools).
    2. Installs Node.js LTS (if missing).
    3. Installs IIS URL Rewrite + Application Request Routing (ARR).
    4. Installs NSSM (service manager) into <InstallPath>\tools.
    5. Copies the app to -InstallPath and runs `npm ci --omit=dev` for the server.
    6. Registers the Node unified server as an auto-start Windows service.
    7. Enables the ARR reverse proxy, creates the IIS app pool + site, writes web.config.
    8. Opens the Windows Firewall for the HTTP port.
    9. Health-checks http://localhost:<HttpPort>/api/health.

  Idempotent: safe to re-run. Use -Uninstall to remove everything.

.EXAMPLE
  .\Deploy-AncoraLens.ps1
.EXAMPLE
  .\Deploy-AncoraLens.ps1 -InstallPath C:\apps\AncoraLens -HttpPort 80 -NodePort 8080
.EXAMPLE
  .\Deploy-AncoraLens.ps1 -Uninstall
#>
[CmdletBinding()]
param(
  [string] $InstallPath = "C:\inetpub\AncoraLens",
  [string] $SiteName    = "AncoraLens",
  [int]    $HttpPort    = 80,
  [int]    $NodePort    = 8080,
  [string] $SourcePath  = "",                # bundle root (has dist\ + server\); default = parent of this script
  [string] $NodeVersion = "20.18.1",         # Node LTS to install if Node is missing
  [string] $ServiceName = "AncoraLensNode",
  [switch] $SkipPrereqs,                      # skip Node / URL Rewrite / ARR installs (assume present)
  [switch] $KeepFiles,                        # with -Uninstall: keep the InstallPath folder
  [switch] $Uninstall
)

$ErrorActionPreference = "Stop"
# PowerShell 5.1 may default to TLS 1.0, which breaks downloads from nodejs.org / microsoft.com.
[Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12

function Info($m) { Write-Host "[*]  $m" -ForegroundColor Cyan }
function Ok($m)   { Write-Host "[OK] $m" -ForegroundColor Green }
function Warn($m) { Write-Host "[!]  $m" -ForegroundColor Yellow }
function Step($m) { Write-Host ""; Write-Host ("=" * 64) -ForegroundColor DarkGray; Write-Host "  $m" -ForegroundColor Magenta; Write-Host ("=" * 64) -ForegroundColor DarkGray }

# --- Admin check ---------------------------------------------------------------
$principal = New-Object Security.Principal.WindowsPrincipal([Security.Principal.WindowsIdentity]::GetCurrent())
if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
  throw "Run this as Administrator. Right-click Install-AncoraLens.cmd -> 'Run as administrator'."
}

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Definition
if (-not $SourcePath) { $SourcePath = (Resolve-Path (Join-Path $ScriptDir "..")).Path }
$Work = Join-Path $env:TEMP "ancoralens-deploy"
New-Item -ItemType Directory -Force -Path $Work | Out-Null

$NodeExe = "C:\Program Files\nodejs\node.exe"
$NpmCmd  = "C:\Program Files\nodejs\npm.cmd"

# --- Helpers -------------------------------------------------------------------
function Download-File($name, $url, $outFile) {
  Info "Downloading $name ..."
  try { Invoke-WebRequest -Uri $url -OutFile $outFile -UseBasicParsing }
  catch { throw "Download failed for ${name}: $($_.Exception.Message)" }
  if (-not (Test-Path $outFile) -or (Get-Item $outFile).Length -lt 1024) {
    throw "$name download looks invalid (the link may have redirected to an error page). Download it manually and re-run with -SkipPrereqs."
  }
}

function Install-Msi($name, $file) {
  $log = "$file.log"
  Info "Installing $name (silent; log: $log) ..."
  $p = Start-Process msiexec.exe -ArgumentList "/i `"$file`" /qn /norestart /L*v `"$log`"" -Wait -PassThru
  if ($p.ExitCode -eq 1603) {
    Warn "$name returned 1603 under /qn - retrying with /passive ..."
    $p = Start-Process msiexec.exe -ArgumentList "/i `"$file`" /passive /norestart /L*v `"$log`"" -Wait -PassThru
  }
  if ($p.ExitCode -ne 0 -and $p.ExitCode -ne 3010) { throw "$name install failed (exit $($p.ExitCode)). Verbose log: $log" }
  Ok "$name installed."
}

function Refresh-Path {
  $env:Path = [Environment]::GetEnvironmentVariable("Path", "Machine") + ";" + [Environment]::GetEnvironmentVariable("Path", "User")
}

# --- Step: IIS feature ---------------------------------------------------------
function Ensure-IIS {
  Step "1/9  Ensuring IIS is installed"
  $isServer = (Get-CimInstance Win32_OperatingSystem).ProductType -ne 1
  if ($isServer) {
    Import-Module ServerManager -ErrorAction SilentlyContinue
    $features = @("Web-Server", "Web-Mgmt-Console", "Web-Static-Content", "Web-Default-Doc", "Web-Http-Redirect", "Web-WebSockets")
    foreach ($f in $features) {
      $st = Get-WindowsFeature -Name $f -ErrorAction SilentlyContinue
      if ($st -and -not $st.Installed) { Info "Installing Windows feature: $f"; Install-WindowsFeature -Name $f -IncludeManagementTools | Out-Null }
    }
  } else {
    $feats = @("IIS-WebServerRole", "IIS-WebServer", "IIS-ManagementConsole", "IIS-StaticContent", "IIS-DefaultDocument", "IIS-HttpRedirect", "IIS-WebSockets")
    foreach ($f in $feats) {
      $st = Get-WindowsOptionalFeature -Online -FeatureName $f -ErrorAction SilentlyContinue
      if ($st -and $st.State -ne "Enabled") { Info "Enabling optional feature: $f"; Enable-WindowsOptionalFeature -Online -FeatureName $f -All -NoRestart | Out-Null }
    }
  }
  Ok "IIS is present."
}

# --- Step: Node ----------------------------------------------------------------
function Ensure-Node {
  Step "2/9  Ensuring Node.js (>= 18)"
  if ($SkipPrereqs) { Warn "Skipping Node install (-SkipPrereqs)."; Refresh-Path; return }
  $have = $false
  if (Test-Path $NodeExe) {
    try { $v = & $NodeExe -v; if ($v -match "v(\d+)\.") { if ([int]$Matches[1] -ge 18) { $have = $true; Ok "Node $v already installed." } } } catch {}
  }
  if (-not $have) {
    $url = "https://nodejs.org/dist/v$NodeVersion/node-v$NodeVersion-x64.msi"
    $msi = Join-Path $Work "node-v$NodeVersion-x64.msi"
    Download-File "Node.js $NodeVersion" $url $msi
    Install-Msi "Node.js $NodeVersion" $msi
  }
  Refresh-Path
  if (-not (Test-Path $NodeExe)) { throw "Node.js not found at $NodeExe after install." }
}

# --- Step: URL Rewrite + ARR ---------------------------------------------------
function Ensure-RewriteArr {
  Step "3/9  Ensuring IIS URL Rewrite + Application Request Routing (ARR)"
  if ($SkipPrereqs) { Warn "Skipping URL Rewrite / ARR install (-SkipPrereqs)."; return }
  $rewriteDll = "$env:windir\System32\inetsrv\rewrite.dll"
  $arrDll     = "$env:windir\System32\inetsrv\requestRouter.dll"

  if (Test-Path $rewriteDll) { Ok "URL Rewrite already present." }
  else {
    $f = Join-Path $Work "rewrite_amd64_en-US.msi"
    Download-File "URL Rewrite 2.1" "https://download.microsoft.com/download/1/2/8/128E2E22-C1B9-44A4-BE2A-5859ED1D4592/rewrite_amd64_en-US.msi" $f
    Install-Msi "URL Rewrite 2.1" $f
  }
  if (Test-Path $arrDll) { Ok "ARR already present." }
  else {
    $f = Join-Path $Work "requestRouter_amd64.msi"
    Download-File "Application Request Routing 3.0" "https://download.microsoft.com/download/E/9/8/E9849D6A-020E-47E4-9FD0-A023E99B54EB/requestRouter_amd64.msi" $f
    Install-Msi "Application Request Routing 3.0" $f
  }
  Info "Restarting IIS so the new native modules load ..."
  iisreset | Out-Null
  if (-not (Test-Path $rewriteDll) -or -not (Test-Path $arrDll)) { throw "URL Rewrite/ARR still missing after install." }
  Ok "URL Rewrite + ARR ready."
}

# --- Step: NSSM ----------------------------------------------------------------
function Ensure-Nssm {
  Step "4/9  Ensuring NSSM (Windows service manager)"
  $toolsDir = Join-Path $InstallPath "tools"
  New-Item -ItemType Directory -Force -Path $toolsDir | Out-Null
  $nssm = Join-Path $toolsDir "nssm.exe"
  if (Test-Path $nssm) { Ok "NSSM present."; return $nssm }
  $zip = Join-Path $Work "nssm-2.24.zip"
  Download-File "NSSM 2.24" "https://nssm.cc/release/nssm-2.24.zip" $zip
  $ext = Join-Path $Work "nssm"
  if (Test-Path $ext) { Remove-Item -Recurse -Force $ext }
  Expand-Archive -Path $zip -DestinationPath $ext -Force
  $src = Get-ChildItem -Path $ext -Recurse -Filter "nssm.exe" | Where-Object { $_.FullName -match "win64" } | Select-Object -First 1
  if (-not $src) { throw "nssm.exe (win64) not found in the NSSM download." }
  Copy-Item $src.FullName $nssm -Force
  Ok "NSSM ready: $nssm"
  return $nssm
}

# --- Step: copy files ----------------------------------------------------------
function Deploy-Files {
  Step "5/9  Deploying application files to $InstallPath"
  if (-not (Test-Path (Join-Path $SourcePath "dist\index.html"))) { throw "dist\index.html not found under '$SourcePath'. Run from the unzipped release bundle, or pass -SourcePath." }
  if (-not (Test-Path (Join-Path $SourcePath "server\index.js"))) { throw "server\index.js not found under '$SourcePath'." }
  New-Item -ItemType Directory -Force -Path $InstallPath | Out-Null

  Info "Copying dist\ ..."
  $distDst = Join-Path $InstallPath "dist"
  if (Test-Path $distDst) { Remove-Item -Recurse -Force $distDst }
  Copy-Item (Join-Path $SourcePath "dist") $distDst -Recurse -Force

  Info "Copying server\ ..."
  $srvDst = Join-Path $InstallPath "server"
  $nodeModulesBak = $null
  if (Test-Path (Join-Path $srvDst "node_modules")) {
    # keep existing node_modules to allow offline re-runs
    $nodeModulesBak = Join-Path $Work "server_node_modules"
    if (Test-Path $nodeModulesBak) { Remove-Item -Recurse -Force $nodeModulesBak }
    Move-Item (Join-Path $srvDst "node_modules") $nodeModulesBak
  }
  if (Test-Path $srvDst) { Remove-Item -Recurse -Force $srvDst }
  Copy-Item (Join-Path $SourcePath "server") $srvDst -Recurse -Force
  if ($nodeModulesBak) { Move-Item $nodeModulesBak (Join-Path $srvDst "node_modules") }

  Write-WebConfig
  Ok "Files deployed."
}

# --- Generate the reverse-proxy web.config with the chosen Node port -----------
function Write-WebConfig {
  $cfg = @"
<?xml version="1.0" encoding="UTF-8"?>
<configuration>
  <system.webServer>
    <rewrite>
      <rules>
        <rule name="AncoraLens-ReverseProxy" stopProcessing="true">
          <match url="(.*)" />
          <action type="Rewrite" url="http://localhost:$NodePort/{R:1}" />
        </rule>
      </rules>
    </rewrite>
    <security>
      <requestFiltering>
        <requestLimits maxAllowedContentLength="52428800" />
      </requestFiltering>
    </security>
    <caching enabled="false" />
    <httpErrors existingResponse="PassThrough" />
  </system.webServer>
</configuration>
"@
  Set-Content -Path (Join-Path $InstallPath "web.config") -Value $cfg -Encoding UTF8
  Ok "Wrote reverse-proxy web.config (-> localhost:$NodePort)."
}

# --- Step: server deps ---------------------------------------------------------
function Install-ServerDeps {
  Step "6/9  Installing server dependencies (npm ci --omit=dev)"
  $npm = $NpmCmd; if (-not (Test-Path $npm)) { $npm = "npm" }
  $srv = Join-Path $InstallPath "server"
  Push-Location $srv
  try {
    & $npm ci --omit=dev --no-audit --no-fund
    if ($LASTEXITCODE -ne 0) {
      Warn "npm ci failed (exit $LASTEXITCODE); falling back to npm install --omit=dev ..."
      & $npm install --omit=dev --no-audit --no-fund
      if ($LASTEXITCODE -ne 0) { throw "npm install failed (exit $LASTEXITCODE)." }
    }
  } finally { Pop-Location }
  Ok "Server dependencies installed."
}

# --- Step: Node Windows service + IIS site + ARR proxy -------------------------
function Configure-Service-And-Site($nssm) {
  Step "7/9  Configuring Node service + IIS site"

  Info "Registering Windows service '$ServiceName' (auto-start) ..."
  & $nssm stop   $ServiceName 2>$null | Out-Null
  & $nssm remove $ServiceName confirm 2>$null | Out-Null
  & $nssm install $ServiceName $NodeExe (Join-Path $InstallPath "server\index.js")
  & $nssm set $ServiceName AppDirectory $InstallPath
  & $nssm set $ServiceName AppEnvironmentExtra "PORT=$NodePort"
  & $nssm set $ServiceName Start SERVICE_AUTO_START
  & $nssm set $ServiceName AppStdout (Join-Path $InstallPath "logs\service.out.log")
  & $nssm set $ServiceName AppStderr (Join-Path $InstallPath "logs\service.err.log")
  New-Item -ItemType Directory -Force -Path (Join-Path $InstallPath "logs") | Out-Null
  & $nssm start $ServiceName | Out-Null
  Ok "Service '$ServiceName' running on http://localhost:$NodePort"

  Info "Enabling ARR reverse proxy at the server level ..."
  Set-WebConfigurationProperty -PSPath 'MACHINE/WEBROOT/APPHOST' -Filter 'system.webServer/proxy' -Name 'enabled' -Value 'True'
  Ok "ARR proxy enabled."

  Import-Module WebAdministration

  # Free the HTTP port if another site (e.g. "Default Web Site") is bound to it - otherwise site
  # creation / start fails with a binding conflict. We STOP (not remove) the conflicting site.
  try {
    Get-Website | Where-Object { $_.Name -ne $SiteName } | ForEach-Object {
      $hit = $_.Bindings.Collection | Where-Object { $_.bindingInformation -match ":${HttpPort}:" }
      if ($hit) { Warn "Stopping '$($_.Name)' (was bound to port $HttpPort)"; Stop-Website -Name $_.Name -ErrorAction SilentlyContinue }
    }
  } catch { Warn "Could not check for port-$HttpPort conflicts: $_" }

  $pool = "$SiteName-pool"
  if (-not (Test-Path "IIS:\AppPools\$pool")) { New-WebAppPool -Name $pool | Out-Null }
  Set-ItemProperty "IIS:\AppPools\$pool" -Name managedRuntimeVersion -Value ""   # No Managed Code
  Ok "App pool '$pool' ready."

  if (Test-Path "IIS:\Sites\$SiteName") {
    Info "Updating existing site '$SiteName' ..."
    Set-ItemProperty "IIS:\Sites\$SiteName" -Name physicalPath -Value $InstallPath
    Set-ItemProperty "IIS:\Sites\$SiteName" -Name applicationPool -Value $pool
    # ensure the HTTP binding/port matches
    try { Set-WebBinding -Name $SiteName -BindingInformation "*:${HttpPort}:" -PropertyName Port -Value $HttpPort -ErrorAction SilentlyContinue } catch {}
  } else {
    New-Website -Name $SiteName -Port $HttpPort -PhysicalPath $InstallPath -ApplicationPool $pool | Out-Null
    Ok "Created site '$SiteName' on port $HttpPort."
  }
  Start-Website -Name $SiteName -ErrorAction SilentlyContinue
  Ok "Site '$SiteName' started."
}

# --- Step: firewall ------------------------------------------------------------
function Open-Firewall {
  Step "8/9  Opening Windows Firewall for port $HttpPort"
  $ruleName = "AncoraLens HTTP $HttpPort"
  try {
    if (Get-Command New-NetFirewallRule -ErrorAction SilentlyContinue) {
      Get-NetFirewallRule -DisplayName $ruleName -ErrorAction SilentlyContinue | Remove-NetFirewallRule -ErrorAction SilentlyContinue
      New-NetFirewallRule -DisplayName $ruleName -Direction Inbound -Action Allow -Protocol TCP -LocalPort $HttpPort | Out-Null
    } else {
      netsh advfirewall firewall add rule name="$ruleName" dir=in action=allow protocol=TCP localport=$HttpPort | Out-Null
    }
    Ok "Firewall rule '$ruleName' added."
  } catch { Warn "Could not add firewall rule (add it manually for port ${HttpPort}): $_" }
}

# --- Step: health --------------------------------------------------------------
function Test-Health {
  Step "9/9  Verifying deployment"
  $url = "http://localhost:$HttpPort/api/health"
  for ($i = 1; $i -le 12; $i++) {
    try {
      $r = Invoke-WebRequest -Uri $url -UseBasicParsing -TimeoutSec 5
      if ($r.StatusCode -eq 200) { Ok "Health check passed: $url"; return $true }
    } catch { }
    Start-Sleep -Seconds 2
  }
  Warn "Health check has not passed yet at $url. The service may still be warming up."
  Warn "Check:  Get-Service $ServiceName   and   $InstallPath\logs\service.err.log"
  return $false
}

# --- Uninstall -----------------------------------------------------------------
function Invoke-Uninstall {
  Step "Uninstalling AncoraLens"
  $nssm = Join-Path $InstallPath "tools\nssm.exe"
  if (Test-Path $nssm) {
    & $nssm stop   $ServiceName 2>$null | Out-Null
    & $nssm remove $ServiceName confirm 2>$null | Out-Null
    Ok "Removed Windows service '$ServiceName'."
  } else {
    & sc.exe stop   $ServiceName 2>$null | Out-Null
    & sc.exe delete $ServiceName 2>$null | Out-Null
  }
  try {
    Import-Module WebAdministration -ErrorAction SilentlyContinue
    if (Test-Path "IIS:\Sites\$SiteName")        { Remove-Website -Name $SiteName; Ok "Removed IIS site '$SiteName'." }
    $pool = "$SiteName-pool"
    if (Test-Path "IIS:\AppPools\$pool")         { Remove-WebAppPool -Name $pool; Ok "Removed app pool '$pool'." }
  } catch { Warn "IIS cleanup issue: $_" }
  $ruleName = "AncoraLens HTTP $HttpPort"
  try { Get-NetFirewallRule -DisplayName $ruleName -ErrorAction SilentlyContinue | Remove-NetFirewallRule -ErrorAction SilentlyContinue } catch {}
  if (-not $KeepFiles -and (Test-Path $InstallPath)) { Remove-Item -Recurse -Force $InstallPath; Ok "Removed $InstallPath." }
  Ok "Uninstall complete. (Node.js, URL Rewrite, ARR were left installed.)"
}

# --- Main ----------------------------------------------------------------------
Write-Host ""
Write-Host "  AncoraLens - one-click Windows/IIS deployment" -ForegroundColor White
Write-Host "  InstallPath=$InstallPath  Site=$SiteName  HttpPort=$HttpPort  NodePort=$NodePort" -ForegroundColor DarkGray

if ($Uninstall) { Invoke-Uninstall; return }

Ensure-IIS
Ensure-Node
Ensure-RewriteArr
Deploy-Files
Install-ServerDeps
$nssm = Ensure-Nssm
Configure-Service-And-Site $nssm
Open-Firewall
$healthy = Test-Health

Step "Done"
Ok "AncoraLens deployed."
Write-Host ""
Write-Host "  Browse:        http://localhost:$HttpPort/" -ForegroundColor White
Write-Host "  API health:    http://localhost:$HttpPort/api/health" -ForegroundColor White
Write-Host "  Service:       $ServiceName  (auto-start)   logs: $InstallPath\logs\" -ForegroundColor White
Write-Host ""
if (-not $healthy) { Warn "Site responded slowly - give the service a few seconds, then refresh." }
Warn "For production: add an HTTPS (443) binding with a certificate, and open your network/NSG for the public port."

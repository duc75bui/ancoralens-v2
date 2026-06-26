#Requires -RunAsAdministrator
<#
.SYNOPSIS
  Configure IIS as a reverse proxy to the AncoraLens Node service on Windows Server.

.DESCRIPTION
  Run this on the Windows Server (as Administrator) AFTER you have:
    1. Installed Node.js 18+        (https://nodejs.org)
    2. Installed IIS "URL Rewrite"  (https://www.iis.net/downloads/microsoft/url-rewrite)
    3. Installed IIS "Application Request Routing" (ARR)
                                    (https://www.iis.net/downloads/microsoft/application-request-routing)
    4. Copied the AncoraLens bundle to -BundlePath and run `npm ci --omit=dev` in its server\ folder
    5. (For the Node service) installed NSSM (https://nssm.cc) OR pass -SkipService and run the
       node process yourself / via PM2.

  It will: register the Node unified server as a Windows service (NSSM), enable the
  ARR proxy, create an IIS app pool + site, and drop the reverse-proxy web.config in place.

.EXAMPLE
  .\setup-iis.ps1 -BundlePath C:\apps\ancoralens -SiteName AncoraLens -HttpPort 80 -NodePort 8080 -NssmPath C:\tools\nssm\nssm.exe
#>

param(
  [Parameter(Mandatory = $true)] [string] $BundlePath,   # folder containing dist\ and server\
  [string] $SiteName  = "AncoraLens",
  [int]    $HttpPort  = 80,
  [int]    $NodePort  = 8080,
  [string] $NodeExe   = "C:\Program Files\nodejs\node.exe",
  [string] $NssmPath  = "nssm",                            # path to nssm.exe (or "nssm" if on PATH)
  [switch] $SkipService                                    # skip creating the Node Windows service
)

$ErrorActionPreference = "Stop"
function Info($m) { Write-Host "[*] $m" -ForegroundColor Cyan }
function Ok($m)   { Write-Host "[OK] $m" -ForegroundColor Green }
function Warn($m) { Write-Host "[!] $m" -ForegroundColor Yellow }

$BundlePath = (Resolve-Path $BundlePath).Path
$serverEntry = Join-Path $BundlePath "server\index.js"
if (-not (Test-Path $serverEntry)) { throw "server\index.js not found under $BundlePath" }
if (-not (Test-Path $NodeExe))     { throw "Node not found at $NodeExe (pass -NodeExe)" }

# Fail fast if the reverse-proxy prerequisites are missing.
if (-not (Test-Path "$env:windir\System32\inetsrv\rewrite.dll")) {
  throw "IIS URL Rewrite is not installed. Run .\install-prereqs.ps1 first (elevated)."
}
if (-not (Test-Path "$env:windir\System32\inetsrv\requestRouter.dll")) {
  throw "IIS Application Request Routing (ARR) is not installed. Run .\install-prereqs.ps1 first (elevated)."
}

Import-Module WebAdministration

# 1. Node unified server as a Windows service (NSSM) ----------------------------
if (-not $SkipService) {
  Info "Registering Node service 'AncoraLensNode' via NSSM ..."
  try {
    & $NssmPath stop   AncoraLensNode 2>$null | Out-Null
    & $NssmPath remove AncoraLensNode confirm 2>$null | Out-Null
    & $NssmPath install AncoraLensNode $NodeExe "$serverEntry"
    & $NssmPath set AncoraLensNode AppDirectory $BundlePath
    & $NssmPath set AncoraLensNode AppEnvironmentExtra "PORT=$NodePort"
    & $NssmPath set AncoraLensNode Start SERVICE_AUTO_START
    & $NssmPath start AncoraLensNode
    Ok "Node service running on http://localhost:$NodePort"
  } catch {
    Warn "Could not configure NSSM service ($_). Install NSSM or use -SkipService and run Node yourself (e.g. PM2)."
  }
} else {
  Warn "Skipping Node service setup. Ensure the Node server is running on port $NodePort."
}

# 2. Enable the ARR reverse proxy at the server level ---------------------------
Info "Enabling ARR proxy at server level ..."
try {
  Set-WebConfigurationProperty -PSPath 'MACHINE/WEBROOT/APPHOST' -Filter 'system.webServer/proxy' -Name 'enabled' -Value 'True'
  Ok "ARR proxy enabled."
} catch {
  throw "Failed to enable ARR proxy. Is Application Request Routing installed? ($_)"
}

# 3. Reverse-proxy web.config into the site root --------------------------------
$webConfigSrc = Join-Path $PSScriptRoot "web.config"
if (Test-Path $webConfigSrc) {
  Copy-Item $webConfigSrc (Join-Path $BundlePath "web.config") -Force
  Ok "Copied reverse-proxy web.config to $BundlePath"
} else {
  Warn "web.config not found next to this script; ensure one exists at $BundlePath"
}

# 4. App pool (No Managed Code) + site ------------------------------------------
$pool = "$SiteName-pool"
if (-not (Test-Path "IIS:\AppPools\$pool")) {
  New-WebAppPool -Name $pool | Out-Null
}
Set-ItemProperty "IIS:\AppPools\$pool" -Name managedRuntimeVersion -Value ""   # No Managed Code
Ok "App pool '$pool' ready."

if (Test-Path "IIS:\Sites\$SiteName") {
  Info "Site '$SiteName' exists - updating path/pool/binding ..."
  Set-ItemProperty "IIS:\Sites\$SiteName" -Name physicalPath -Value $BundlePath
  Set-ItemProperty "IIS:\Sites\$SiteName" -Name applicationPool -Value $pool
} else {
  New-Website -Name $SiteName -Port $HttpPort -PhysicalPath $BundlePath -ApplicationPool $pool | Out-Null
  Ok "Created site '$SiteName' on port $HttpPort."
}

Start-Website -Name $SiteName -ErrorAction SilentlyContinue

Ok "Done. Browse:  http://localhost:$HttpPort/   and   http://localhost:$HttpPort/api/health"
Write-Host ""
Warn "Reminders: open the Azure NSG + Windows Firewall for port $HttpPort, and add an HTTPS binding (443) with a certificate for production."

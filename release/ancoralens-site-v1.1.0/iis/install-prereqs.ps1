#Requires -RunAsAdministrator
<#
.SYNOPSIS
  Install the IIS extensions AncoraLens' reverse-proxy needs: URL Rewrite 2.1 + ARR 3.0.
  Run this ONCE on the server in an ELEVATED PowerShell, before setup-iis.ps1.
#>
$ErrorActionPreference = "Stop"
function Info($m) { Write-Host "[*] $m"  -ForegroundColor Cyan }
function Ok($m)   { Write-Host "[OK] $m" -ForegroundColor Green }
function Warn($m) { Write-Host "[!] $m"  -ForegroundColor Yellow }

$rewriteDll = "$env:windir\System32\inetsrv\rewrite.dll"
$arrDll     = "$env:windir\System32\inetsrv\requestRouter.dll"
$tmp = Join-Path $env:TEMP "ancoralens-iis"
New-Item -ItemType Directory -Force -Path $tmp | Out-Null

function Install-Msi($name, $url, $file) {
  Info "Downloading $name ..."
  try { Invoke-WebRequest -Uri $url -OutFile $file -UseBasicParsing }
  catch { throw "Download failed for ${name}: $($_.Exception.Message)" }

  # Sanity-check the download: real MSIs are OLE2 compound files (magic D0 CF) and several MB.
  $size = (Get-Item $file).Length
  $head = [IO.File]::ReadAllBytes($file)
  if ($size -lt 1MB -or $head[0] -ne 0xD0 -or $head[1] -ne 0xCF) {
    throw "$name download looks invalid (size=$size bytes, not an MSI). The link likely redirected to an error page. Download it manually from iis.net, then run msiexec on the saved file."
  }

  $log = "$file.log"
  Info "Installing $name (logging to $log) ..."
  $p = Start-Process msiexec.exe -ArgumentList "/i `"$file`" /qn /norestart /L*v `"$log`"" -Wait -PassThru
  if ($p.ExitCode -eq 1603) {
    # Some IIS extension MSIs fail 1603 under fully-silent /qn but succeed with /passive.
    Warn "$name silent install returned 1603 - retrying with /passive ..."
    $p = Start-Process msiexec.exe -ArgumentList "/i `"$file`" /passive /norestart /L*v `"$log`"" -Wait -PassThru
  }
  if ($p.ExitCode -ne 0 -and $p.ExitCode -ne 3010) {
    Warn "$name installer returned exit $($p.ExitCode). Most relevant log lines:"
    if (Test-Path $log) {
      Get-Content $log |
        Select-String -Pattern 'Return value 3', 'Note: 1:', 'Error status', 'value 3', 'already installed' |
        Select-Object -Last 12 |
        ForEach-Object { Write-Host "    $_" -ForegroundColor DarkYellow }
    }
    throw "$name install failed (exit $($p.ExitCode)). Full verbose log: $log"
  }
  Ok "$name installed."
}

if (Test-Path $rewriteDll) {
  Ok "URL Rewrite already present."
} else {
  Install-Msi "URL Rewrite 2.1" `
    "https://download.microsoft.com/download/1/2/8/128E2E22-C1B9-44A4-BE2A-5859ED1D4592/rewrite_amd64_en-US.msi" `
    "$tmp\rewrite_amd64_en-US.msi"
}

if (Test-Path $arrDll) {
  Ok "Application Request Routing already present."
} else {
  Install-Msi "Application Request Routing 3.0" `
    "https://download.microsoft.com/download/E/9/8/E9849D6A-020E-47E4-9FD0-A023E99B54EB/requestRouter_amd64.msi" `
    "$tmp\requestRouter_amd64.msi"
}

# IIS needs a restart to load freshly-installed native modules.
Info "Restarting IIS so the new modules load ..."
iisreset | Out-Null

if ((Test-Path $rewriteDll) -and (Test-Path $arrDll)) {
  Ok "Prerequisites ready. Next (elevated):  .\setup-iis.ps1 -BundlePath <bundle folder>"
} else {
  throw "One or more modules are still missing after install - check the MSI output."
}

# AncoraLens — One-Click Windows / IIS Deployment

Deploy the entire site (UI + API, behind IIS) on a Windows Server with a **single action**.
The installer downloads and configures everything it needs.

---

## TL;DR

1. Build the deploy bundle (on your dev machine):
   ```powershell
   npm run package
   ```
   → `release/ancoralens-site-v<version>.zip`
2. Copy that zip to the Windows Server and unzip it.
3. **Right-click `Install-AncoraLens.cmd` → "Run as administrator".**

That's it. When it finishes, browse `http://<server>/` (and `http://<server>/api/health`).

> The server needs **internet access during install** (it downloads Node.js, URL Rewrite, ARR,
> and NSSM from their official sources). For air-gapped servers, see *Offline* below.

---

## What it does (`iis\Deploy-AncoraLens.ps1`)

The launcher self-elevates (UAC) and runs a single, idempotent orchestrator that:

1. **Enables IIS** (the Windows feature) + management tools.
2. **Installs Node.js LTS** if missing (silent MSI from nodejs.org).
3. **Installs IIS URL Rewrite + Application Request Routing (ARR)** (the reverse-proxy modules).
4. **Installs NSSM** (service manager) into `<InstallPath>\tools`.
5. **Deploys** the app to `-InstallPath` and runs `npm ci --omit=dev` for the server.
6. **Registers the Node unified server as an auto-start Windows service** (`AncoraLensNode`).
7. **Enables the ARR reverse proxy**, creates the IIS **app pool + site**, and writes a
   `web.config` that forwards `:80` → the Node service.
8. **Opens the Windows Firewall** for the HTTP port.
9. **Health-checks** `http://localhost:<HttpPort>/api/health`.

Re-running is safe (it updates in place). Node.js, URL Rewrite, and ARR are left installed on uninstall.

## Architecture

```
Browser → IIS :80 (URL Rewrite + ARR reverse proxy) → Node service :8080 (Express)
                                                         ├─ serves dist/ (the UI)
                                                         └─ /api/* (SQL + AI)
```

The Node server (`server/index.js`) serves both the built UI and the `/api` endpoints, so IIS only
handles the public port, hostname, and (optionally) TLS.

---

## Options

Pass parameters through the launcher, or run the `.ps1` directly in an elevated PowerShell:

```powershell
# custom install location + ports
Install-AncoraLens.cmd -InstallPath C:\apps\AncoraLens -HttpPort 80 -NodePort 8080

# assume Node / Rewrite / ARR are already installed (skip those downloads)
Install-AncoraLens.cmd -SkipPrereqs

# uninstall (service + IIS site + app pool + firewall rule + files)
Install-AncoraLens.cmd -Uninstall
```

| Parameter | Default | Purpose |
|---|---|---|
| `-InstallPath` | `C:\inetpub\AncoraLens` | where the app is deployed |
| `-SiteName` | `AncoraLens` | IIS site + app-pool name |
| `-HttpPort` | `80` | public IIS port |
| `-NodePort` | `8080` | internal Node service port |
| `-SourcePath` | parent of the script | bundle root (has `dist\` + `server\`) |
| `-NodeVersion` | `20.18.1` | Node LTS to install if missing |
| `-ServiceName` | `AncoraLensNode` | Windows service name |
| `-SkipPrereqs` | off | skip Node / URL Rewrite / ARR installs |
| `-Uninstall` | off | remove everything (keep with `-KeepFiles`) |

---

## After install

- **Service:** `Get-Service AncoraLensNode` — auto-starts on boot. Logs: `<InstallPath>\logs\`.
- **SQL Connector / AI Assistant:** these call the Node `/api` on the same origin — no extra setup.
  Users enter their SQL connection string / Gemini API key in the UI (nothing is stored server-side).
- **HTTPS (recommended for production):** add a `443` binding with a certificate in IIS Manager
  (Site → *Bindings* → *Add* → `https`), then open `443` in the firewall / network NSG. The reverse
  proxy already forwards HTTPS traffic to Node unchanged.
- **Network:** if this is a cloud VM, also open the public port in the cloud firewall (e.g. Azure NSG).

---

## Troubleshooting

| Symptom | Fix |
|---|---|
| "Run this as Administrator" | Right-click the `.cmd` → *Run as administrator* (the launcher normally self-elevates). |
| Download fails / TLS error | The server needs outbound HTTPS to nodejs.org / microsoft.com / nssm.cc. The script forces TLS 1.2. Behind a proxy, set it for the session or use *Offline*. |
| Health check didn't pass | Give the service a few seconds; check `Get-Service AncoraLensNode` and `<InstallPath>\logs\service.err.log`. |
| 502 from IIS | The Node service isn't running or `-NodePort` doesn't match `web.config`. Re-run the installer. |
| "URL Rewrite/ARR still missing" | Some MSIs need `/passive`; the script retries. If it persists, install URL Rewrite + ARR manually from iis.net and re-run with `-SkipPrereqs`. |

### Offline / air-gapped servers

The one-click flow downloads prerequisites. For a locked-down server, install **Node.js**, **URL
Rewrite**, and **ARR** manually first (from their MSIs), drop `nssm.exe` into
`<InstallPath>\tools\nssm.exe`, then run:

```powershell
Install-AncoraLens.cmd -SkipPrereqs
```

The deploy/IIS/service/firewall steps run with no internet.

---

See also: `DEPLOY_IIS.md` (manual IIS steps, iisnode alternative), `DEPLOYMENT.md` (all hosting
options), `ARCHITECTURE.md` §3 (deployment topology).

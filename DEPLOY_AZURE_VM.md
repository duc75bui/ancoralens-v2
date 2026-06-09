# AncoraLens — Azure VM Deployment (CloudOps Handoff)

This bundle is the **entire site** — the built UI and its API — running as a single
Node.js process on one port. No database or build step is required on the VM.

> **Deploying on IIS / Windows Server?** See **`DEPLOY_IIS.md`** (and the `iis\` folder)
> for the IIS reverse-proxy setup + automated `setup-iis.ps1` script. The sections
> below cover the generic Node-service approach (Windows service or Linux systemd).

```
ancoralens-site-vX.Y.Z/
├── dist/            ← built frontend (static assets)
├── server/
│   ├── index.js     ← Express server: serves dist/ + the /api endpoints
│   ├── package.json ← runtime dependencies only
│   └── package-lock.json
├── start.cmd        ← Windows start script
├── start.sh         ← Linux start script
├── .env.example     ← configurable settings (PORT)
└── DEPLOY.md        ← this file
```

---

## 1. Prerequisites (on the VM)

- **Node.js 18 LTS or newer** — that's it.
  - Windows: install the MSI from <https://nodejs.org/>.
  - Ubuntu/Debian: `curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash - && sudo apt install -y nodejs`
- Outbound HTTPS to `generativelanguage.googleapis.com` (for the AI Assistant feature).
- Network access from the VM to your **SQL Server** (for the SQL Connector feature).

## 2. Install

```bash
# unzip the bundle to e.g. /opt/ancoralens  (Linux)  or  C:\apps\ancoralens  (Windows)
cd ancoralens-site-vX.Y.Z/server
npm ci --omit=dev          # installs express, mssql, cors, @google/generative-ai only
```

## 3. Run (quick test)

```bash
# from the bundle root
PORT=8080 node server/index.js          # Linux/macOS
```
```powershell
# from the bundle root (PowerShell)
$env:PORT=8080; node server\index.js
```
Or just run **`start.sh`** / **`start.cmd`** (they default to port 8080 and auto-install
deps if missing).

Verify:
- UI:     `http://<vm-ip>:8080/`
- Health: `http://<vm-ip>:8080/api/health` → `{"status":"ok"}`

## 4. Run as a service (production)

### Linux — systemd
Create `/etc/systemd/system/ancoralens.service`:
```ini
[Unit]
Description=AncoraLens
After=network.target

[Service]
WorkingDirectory=/opt/ancoralens
Environment=PORT=8080
ExecStart=/usr/bin/node server/index.js
Restart=always
User=www-data

[Install]
WantedBy=multi-user.target
```
```bash
sudo systemctl daemon-reload
sudo systemctl enable --now ancoralens
sudo systemctl status ancoralens
```

### Windows — NSSM (recommended) 
```powershell
# install NSSM (https://nssm.cc/) then:
nssm install AncoraLens "C:\Program Files\nodejs\node.exe" "C:\apps\ancoralens\server\index.js"
nssm set AncoraLens AppDirectory "C:\apps\ancoralens"
nssm set AncoraLens AppEnvironmentExtra PORT=8080
nssm start AncoraLens
```
(Alternatively use **PM2**: `npm i -g pm2 && pm2 start server/index.js --name ancoralens && pm2 save && pm2 startup`.)

## 5. Networking

- **Open the port** in the Azure **Network Security Group** (inbound) and the VM's
  local firewall (e.g. Windows Defender Firewall / `ufw allow 8080`).
- **TLS / friendly hostname (recommended):** put a reverse proxy in front and proxy
  to `http://localhost:8080`:
  - **Nginx**: `location / { proxy_pass http://localhost:8080; }`
  - **IIS** (ARR + URL Rewrite): reverse-proxy the site to `http://localhost:8080`.
  - **Caddy**: `your.domain { reverse_proxy localhost:8080 }` (auto-HTTPS).

## 6. Configuration

| Setting | Where | Default | Notes |
|---|---|---|---|
| `PORT` | env var / service def | `8080` (`3001` if unset in raw `node`) | Port the app listens on |

There are **no secrets to configure on the server**:
- **Gemini API keys** are entered by each user in the AI Assistant UI and stored only
  in their browser (`localStorage`); they are sent per-request and never persisted server-side.
- **SQL connection strings** are entered per-request in the SQL Connector UI; nothing
  is stored server-side.

## 7. Updating

Deploy a new bundle, then:
```bash
# Linux
sudo systemctl stop ancoralens && rsync -a new-bundle/ /opt/ancoralens/ && sudo systemctl start ancoralens
```
```powershell
# Windows
nssm stop AncoraLens; robocopy new-bundle C:\apps\ancoralens /MIR; nssm start AncoraLens
```

## 8. Security notes

- The SQL Connector executes **arbitrary SQL** sent from the browser (it blocks only
  `DROP DATABASE` / `SHUTDOWN`). Deploy behind authentication / on a trusted network
  and use a least-privilege SQL login.
- CORS is currently open (`*`). If you front the app with a proxy on a single origin,
  consider tightening CORS or removing it (same-origin needs none).

## 9. Troubleshooting

| Symptom | Fix |
|---|---|
| Blank page | Confirm `dist/` sits next to `server/`; check the service logs |
| `/api/health` works but UI 404s | `dist/index.html` missing from the bundle |
| AI "connection error" | VM outbound HTTPS blocked, or invalid Gemini key |
| SQL "cannot connect" | NSG/firewall to SQL Server, or `TrustServerCertificate=true;` in the connection string |
| Port in use | Change `PORT` in the service definition |

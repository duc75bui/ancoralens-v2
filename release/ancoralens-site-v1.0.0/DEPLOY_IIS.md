# AncoraLens — Deploying on IIS (Windows Server)

The AncoraLens bundle runs as a **single Node.js process** that serves the UI and the
`/api` endpoints on one port. On IIS there are two supported ways to front it. Use
**Approach A (reverse proxy)** unless your org mandates iisnode — it leaves the Node
app exactly as shipped/verified and is the most reliable.

> You do **not** need IIS on the build/dev machine. IIS only matters on the target
> Windows Server. The bundle (`npm run package` → `release\ancoralens-site-vX.Y.Z.zip`)
> contains everything, including the `iis\` folder referenced below.

---

## Approach A — IIS reverse proxy → Node service  (recommended)

IIS listens on :80/:443 and forwards all traffic to the Node service on `localhost:8080`.

### One-time server prerequisites
1. **Node.js 18+** — <https://nodejs.org>
2. **IIS URL Rewrite** — <https://www.iis.net/downloads/microsoft/url-rewrite>
3. **IIS Application Request Routing (ARR)** — <https://www.iis.net/downloads/microsoft/application-request-routing>
4. **NSSM** (to run Node as a service) — <https://nssm.cc>  *(or PM2: `npm i -g pm2`)*

### Steps
```powershell
# 1. Unzip the bundle, e.g. to C:\apps\ancoralens
Expand-Archive .\ancoralens-site-vX.Y.Z.zip -DestinationPath C:\apps\ancoralens

# 2. Install the Node server's runtime deps
cd C:\apps\ancoralens\server
npm ci --omit=dev

# 3. Run the automated IIS setup (as Administrator)
cd C:\apps\ancoralens\iis
.\setup-iis.ps1 -BundlePath C:\apps\ancoralens -HttpPort 80 -NodePort 8080 -NssmPath C:\tools\nssm\nssm.exe
```
`setup-iis.ps1` registers the **AncoraLensNode** Windows service (auto-start), enables
the ARR proxy, creates a **No Managed Code** app pool + site, and drops the
reverse-proxy `web.config` (from `iis\web.config`) into the site root.

### Verify
- `http://<server>/api/health` → `{"status":"ok"}`
- `http://<server>/` → the AncoraLens UI

### Doing it by hand (if you prefer the GUI)
1. Run the Node service: `nssm install AncoraLensNode "C:\Program Files\nodejs\node.exe" "C:\apps\ancoralens\server\index.js"`, set **AppDirectory** = `C:\apps\ancoralens`, **AppEnvironmentExtra** = `PORT=8080`, then `nssm start AncoraLensNode`.
2. IIS Manager → server node → **Application Request Routing Cache** → **Server Proxy Settings** → check **Enable proxy**.
3. IIS Manager → **Sites → Add Website**: name `AncoraLens`, physical path = a folder containing `iis\web.config` (e.g. the bundle root), port `80`.
4. The provided `web.config` rewrites all requests to `http://localhost:8080`.

---

## Approach B — iisnode (Node hosted inside IIS)

No separate service/port; IIS launches `node server/index.js` per the iisnode handler.

1. Install **iisnode** — <https://github.com/Azure/iisnode/releases> (and URL Rewrite).
2. Unzip the bundle to the site root, then `cd server && npm ci --omit=dev`.
3. Rename `iis\web.iisnode.config` → `web.config` and place it at the **site root**
   (next to `dist\` and `server\`).
4. Create an IIS site (App pool: **No Managed Code**) pointing at the bundle root.
5. Ensure the app-pool identity can read the folder and run Node.

> iisnode passes a named-pipe value as `PORT`; the server already honours
> `process.env.PORT`, so no code change is needed. If you hit ESM/launch issues,
> switch to Approach A.

---

## HTTPS (production)
Add an **https (443)** binding to the IIS site with your TLS certificate (IIS Manager →
site → **Bindings** → Add → https, or `New-WebBinding`/central certificate store). IIS
terminates TLS and still proxies to Node on plain `localhost:8080`. Optionally add an
HTTP→HTTPS redirect rule.

## Firewall / Azure
Open the public port (80/443) in the **Azure Network Security Group** (inbound) and in
**Windows Defender Firewall**. The Node port (8080) stays **local only** — do not expose it.

## Configuration & security
- Only `PORT` is configurable (set on the Node service via NSSM `AppEnvironmentExtra`,
  or the systemd unit on Linux). No server-side secrets — Gemini keys and SQL
  connection strings are entered per-user in the browser and sent per-request.
- The SQL Connector runs arbitrary SQL (blocks only `DROP DATABASE`/`SHUTDOWN`). Keep the
  site behind authentication / a trusted network and use a least-privilege SQL login.

## Troubleshooting
| Symptom | Fix |
|---|---|
| `502.3` / `Bad Gateway` | Node service not running, or wrong `NodePort`. Check `nssm status AncoraLensNode` and `http://localhost:8080/api/health`. |
| `500.19` config error | URL Rewrite and/or ARR not installed. |
| Proxy returns IIS 404 | ARR "Enable proxy" not checked at the server level. |
| UI loads but `/api` fails | Confirm the Node service is up on 8080; check Windows Firewall isn't blocking loopback (rare). |
| Large CSV context rejected | `maxAllowedContentLength` is set to 50 MB in web.config; raise if needed. |

# Deployment Guide: Interactive CSV Dashboard

This document outlines how to build and deploy the Interactive CSV Dashboard.

## 1. Prerequisites
To build the application, you need the following installed on your build machine:
*   **Node.js**: Version 18 or higher (LTS recommended). [Download Here](https://nodejs.org/)
*   **NPM**: Included with Node.js.

> All runtime libraries (including `pdfjs-dist` and **`@zip.js/zip.js`**, used by the in‑browser
> document viewer) install with a plain `npm install` — there are **no extra components to install**.
> The document viewer, CSV parsing, and zip reading are entirely client‑side.

> **Browser requirements (document viewer).** The viewer reads multi‑GB `BatchData` archives
> **in the browser** by streaming individual PDFs on demand, and caches a small document index in
> **IndexedDB**. Target a modern evergreen browser (Chromium/Edge/Firefox) with **IndexedDB** and the
> **File API** available — i.e. **not** a hardened private/incognito profile that blocks IndexedDB
> (the cache silently degrades to "no cache", which still works but re‑scans each load). Folder
> auto‑load uses `webkitdirectory` (Chromium/Edge/Firefox desktop). Nothing is uploaded to the server;
> archives are read locally. For best performance, point the picker at **locally‑stored** files —
> on‑demand cloud‑synced files (OneDrive "files on demand") force a full download per part and are slow.

## 2. Build Instructions
The application parses CSVs, renders source PDFs, and reads BatchData zips **entirely in the
browser (client‑side)**. The static `dist/` bundle is all that's needed for the
dashboards, detailed report, and document viewer.

> **Optional backend:** only the **SQL Connector** (→ MSSQL) and **AI Assistant** (→ Google
> Gemini) call the Express server (`server/index.js`, `/api/*`). If you don't use those two
> features, you can serve `dist/` as plain static files. If you do, run the unified Node
> server (it serves `dist/` **and** `/api` on one port — see `DEPLOY_IIS.md`).

> **pdf.js worker asset:** the build emits the pdf.js web worker as a bundled chunk
> `dist/assets/pdf.worker.min-*.js` (Vite `?worker`). It must be deployed alongside the other
> `dist/assets/*` files (the build and `npm run package` already include it) — without it the document
> viewer cannot render PDFs. It is now a plain `.js` file, so the `.mjs` MIME caveat below no longer
> applies to the worker (it's always served correctly).

> **Static viewer assets (`public/`):** the build copies `public/pdfjs/` (pdf.js WASM) and
> `public/ocr/` (Tesseract worker/core/lang, used by the viewer's "Find pages") into `dist/`. Deploy
> the whole `dist/` tree so `dist/pdfjs/*` and `dist/ocr/*` are served — these are fetched at runtime
> by the document viewer. `@zip.js/zip.js` runs **without** web workers (`useWebWorkers:false`), so it
> needs **no** extra worker asset or MIME/CSP carve‑out.

### Step 2.1: Production Build
Open your terminal in the project root (`interactive-csv-dashboard/`) and run:

```powershell
# 1. Install dependencies (if not already done)
npm install

# 2. Build for production
npm run build
```

**Output:**
This will create a `dist/` folder containing the optimized production files:
*   `index.html`
*   `assets/` (bundled JavaScript and CSS)

**This `dist` folder is all you need to deploy.**

---

## 3. Deployment Options

### Option A: Hosting on Windows Server (IIS)
Since this is a Windows environment, IIS is a common choice.

1.  **Install IIS URl Rewrite Module**: (Optional but recommended if you eventually add complex routing).
2.  **Create a New Site**:
    *   Open **IIS Manager**.
    *   Right-click **Sites** -> **Add Website**.
    *   **Site name**: `AncoraDashboard`
    *   **Physical path**: Point this to the `dist` folder you just built (e.g., `C:\inetpub\wwwroot\AncoraDashboard`).
    *   **Port**: `80` (or `8080` / specific port).
3.  **MIME Types**:
    Verify `.js` and `.css` are allowed (usually default). **Also add `.mjs` → `text/javascript`** —
    the pdf.js document‑viewer **worker** ships as `assets/pdf.worker.*.mjs`, and IIS does **not**
    serve `.mjs` by default (it 404s), which silently breaks the document viewer. Either add it in
    IIS Manager (site → *MIME Types* → *Add*: extension `.mjs`, type `text/javascript`) or drop a
    `web.config` next to `dist/index.html`:

    ```xml
    <?xml version="1.0" encoding="UTF-8"?>
    <configuration>
      <system.webServer>
        <staticContent>
          <remove fileExtension=".mjs" />
          <mimeMap fileExtension=".mjs" mimeType="text/javascript" />
        </staticContent>
      </system.webServer>
    </configuration>
    ```

    > This only applies when IIS serves `dist/` **as static files**. The recommended
    > reverse‑proxy / unified‑Node deployments (see `DEPLOY_IIS.md`) serve assets through
    > Express, which already returns `.mjs` as `text/javascript` — no MIME change needed.
4.  **Browse**: Open `http://localhost/` (or your server IP).

### Option B: Static Web Hosting (Netlify, Vercel, AWS S3)
Because the app is static, it is perfect for these platforms.
1.  **Command**: `npm run build`
2.  **Output Directory**: `dist`
3.  **Routing**: If you ever add usage of `react-router` (currently not heavily used), ensure all requests rewrite to `index.html`.

### Option C: Docker (Containerization)
If you prefer a containerized approach (e.g., for Kubernetes or Azure Web Apps), create a file named `Dockerfile` in the project root:

```dockerfile
# Stage 1: Build
FROM node:18-alpine as build
WORKDIR /app
COPY package*.json ./
RUN npm install
COPY . .
RUN npm run build

# Stage 2: Serve with Nginx
FROM nginx:alpine
COPY --from=build /app/dist /usr/share/nginx/html
# Optional: Custom Nginx config if needed for SPA routing
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
```

**Build & Run:**
```bash
docker build -t ancora-dashboard .
docker run -p 8080:80 ancora-dashboard
```

### Option D: Simple Local Network Serve (Quickest)
If you just want to run it on a PC and access it from the network without full IIS setup:

```powershell
# Install a simple static server globaly
npm install -g serve

# Serve the 'dist' folder on port 3000
serve -s dist -l 3000
```
Then access via `http://YOUR_PC_IP:3000`.

---

## 4. Dependencies & Tech Stack
This application is built with:
*   **Vite**: Build tool and bundler.
*   **React 19**: UI Framework.
*   **PapaParse**: High-performance CSV parsing.
*   **Recharts**: Data visualization library.
*   **Lucide React**: Icon set.
*   **pdf.js (`pdfjs-dist`)**: renders source PDF pages in the document viewer (client-side).
*   **`@zip.js/zip.js`**: random-access, lazy reader for the multi-GB `BatchData` archive (client-side;
    streams individual PDFs, never loads the whole archive). Replaced JSZip. See `docs/BATCH_VIEWER.md`.
*   **IndexedDB** (browser built-in): caches the archive's document index (not PDF bytes).

There are **NO** server-side dependencies for the core dashboard (no Database, no API server required). All CSV processing happens in the user's browser.

**However**, the **AI Chatbot** feature requires a backend server (see Section 5 below).

---

## 5. AI Chatbot Setup (Optional)

The AI Chatbot feature uses **Google Gemini API** to analyze your loaded CSV data. This requires a lightweight Node.js proxy server.

### 5.1 Prerequisites
- **Node.js 18+** (for the backend server)
- **Google Gemini API Key** ([Get one here](https://aistudio.google.com/app/apikey))

### 5.2 Backend Server Files
The backend server is located in:
```
interactive-csv-dashboard/server/index.js
```

It provides two endpoints:
- `POST /api/ai/test` - Tests API key validity
- `POST /api/ai/chat` - Sends chat messages with data context

### 5.3 Running the Server (Development)
```powershell
cd server
npm install
node index.js
```
The server runs on **port 3001** by default.

### 5.4 API Key Configuration
Users enter their API key in the **AI Chat** sidebar. It is stored in `localStorage` (browser-side) and passed to the backend on each request. **No API keys are stored on the server.**

### 5.5 Production Deployment (IIS + Node.js)

For production, you have two options:

**Option A: Run Node.js as a Windows Service**
1. Install [PM2](https://pm2.keymetrics.io/) or [NSSM](https://nssm.cc/)
2. Configure to run `node server/index.js` on boot
3. Use IIS URL Rewrite to proxy `/api/*` requests to `localhost:3001`

**Option B: Use IIS iisnode Module**
1. Install [iisnode](https://github.com/Azure/iisnode)
2. Add the following to your `web.config`:
```xml
<handlers>
  <add name="iisnode" path="server/index.js" verb="*" modules="iisnode" />
</handlers>
<rewrite>
  <rules>
    <rule name="API">
      <match url="^api/(.*)" />
      <action type="Rewrite" url="server/index.js" />
    </rule>
  </rules>
</rewrite>
```

### 5.6 Supported Models
The chatbot supports multiple Gemini models (user-selectable):
- `gemini-3-pro-preview` - Latest SOTA reasoning
- `gemini-3-flash-preview` - Fastest latest model
- `gemini-2.0-flash-exp` - Next-gen experimental
- `gemini-1.5-pro` - Complex reasoning
- `gemini-1.5-flash` - Fast, cost-effective (default)
- `gemini-pro` - Legacy standard

---

## 6. SQL Query Feature (Optional)

The SQL Query view allows users to run queries directly against a **Microsoft SQL Server** database. This uses the same backend server as the AI Chatbot.

### 6.1 Prerequisites
- **SQL Server** accessible from the deployment VM
- **mssql npm package** (already included in `server/package.json`)

### 6.2 Backend Endpoint
The endpoint is:
```
POST /api/sql/execute
```
**Request Body:**
```json
{
  "connectionString": "Server=YOUR_SERVER;Database=YOUR_DB;User Id=user;Password=pass;TrustServerCertificate=true;",
  "query": "SELECT TOP 10 * FROM YourTable"
}
```

### 6.3 Connection String Format
Users enter this in the SQL Query UI. Common formats:

**Windows Authentication:**
```
Server=SERVERNAME;Database=DATABASE;Trusted_Connection=Yes;TrustServerCertificate=true;
```

**SQL Authentication:**
```
Server=SERVERNAME;Database=DATABASE;User Id=USERNAME;Password=PASSWORD;Encrypt=true;TrustServerCertificate=true;
```

### 6.4 VM Deployment Checklist
When deploying to a new VM:

1. ✅ **Install Node.js 18+**
2. ✅ **Copy `server/` folder** to the VM
3. ✅ **Run `npm install`** in the server folder (installs `mssql`, `cors`, `express`, `@google/generative-ai`)
4. ✅ **Start the server**: `node index.js`
5. ✅ **Firewall**: Ensure port **3001** is open (or configure your port)
6. ✅ **SQL Access**: VM must have network access to the SQL Server

### 6.5 Safety Features
The server blocks dangerous operations:
- `DROP DATABASE` - Blocked
- `SHUTDOWN` - Blocked

> [!WARNING]
> This feature gives users raw SQL access. Only deploy in trusted environments where users are authorized database administrators.

---

## 7. Troubleshooting

| Issue | Solution |
|-------|----------|
| AI Chat shows "Connection Error" | Ensure backend server is running on port 3001 |
| API key not working | Verify key at [Google AI Studio](https://aistudio.google.com/) |
| CORS errors in browser console | Ensure backend has `cors()` middleware enabled |
| Blank page after deployment | Check `web.config` exists with SPA rewrite rules |
| SQL "Login failed" | Verify connection string and credentials |
| SQL "Cannot connect" | Check SQL Server is accessible from VM, firewall rules |
| SQL "TrustServerCertificate" error | Add `TrustServerCertificate=true;` to connection string |
| Document viewer: PDF won't render | Ensure `dist/assets/pdf.worker.*.mjs` and `dist/pdfjs/*` are deployed (and `.mjs` is served — see §3 Option A) |
| Viewer "Find pages" (OCR) does nothing | Ensure `dist/ocr/*` (Tesseract worker/core/lang) is deployed |
| Archive ingest is very slow / banner stuck for minutes | Use locally-stored files, not OneDrive "files on demand"; the index also caches in IndexedDB so the second load is faster |
| Banner says "N unreadable segments skipped" | One or more `.partN` files is a headless fragment (no central directory) in the source export — its documents can't be indexed; re-export each part as a self-contained zip for full coverage |
| "approximate match — verify document" in viewer | The document was matched by filename (non-distinct) because no GUID match was found; confirm the rendered PDF is the right document |
| Re-loading the same folder doesn't reuse the index | IndexedDB is unavailable (private/incognito or blocked) — ingest still works, just without the cache |


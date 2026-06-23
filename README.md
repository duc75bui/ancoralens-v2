# AncoraLens

A single‑page web app for auditing the accuracy of an intelligent **document‑processing
pipeline**. Upload the pipeline's CSV reports and AncoraLens turns them into dashboards,
drill‑down tables, an SQL console, and a Gemini‑powered AI assistant.

Key capabilities:

- **Dashboards** — summary overview + full analytics, a **labor‑savings** KPI, and a
  **"Download PDF"** report export (browser print, no extra deps).
- **Per‑pass dashboards** — click a row in the training‑pass table to open a dashboard
  scoped to a single pass, rendered from its own `TrainingPass{N}_*.csv`.
- **Detailed report** — field‑level table with an **errors‑only / warnings+errors** severity
  filter, and a **document viewer** that renders the source page (pdf.js) with each captured
  field's region boxed and color‑coded by status — for auditing region errors.
- **SQL Connector** (→ MSSQL) and **AI Assistant** (→ Google Gemini).

- **CSV parsing, PDF rendering, and zip reading all run entirely in the browser** (PapaParse,
  pdf.js, JSZip) — nothing is uploaded; the analytics views need no server.
- A small **Express server** powers only two optional features (SQL Connector → MSSQL, AI
  Assistant → Google Gemini) and, in production, serves the built UI on the same port.

Built with **React 19 + Vite 7**, custom animated SVG charts + Recharts, framer‑motion,
`pdfjs-dist` + `jszip` (in‑browser document viewer), and a warm‑paper editorial design
system (light + dark).

## Quickstart

**Prerequisites:** Node.js 18+ (LTS) and npm.

```bash
npm install

# Frontend dev server (HMR) → http://localhost:5174
npm run dev

# Backend (only for SQL Connector / AI Assistant) → http://localhost:3001
npm run server
```

> The dev server port is **5174** (pinned in `vite.config.js`, `strictPort`). It proxies
> `/api` → `http://localhost:3001`, so run `npm run server` too if you'll use the SQL
> Connector or AI Assistant. For the analytics/dashboards/document viewer, the frontend
> alone is enough.

Then open the app, go to **Upload Data → Auto‑Load from Folder**, and pick a results
export folder (or upload individual CSVs via the tiles):

| Tile | File(s) | Powers |
|---|---|---|
| Metrics | `*Summary*.csv` | dashboard |
| Details | `*flatReportData*.csv` | detailed report |
| Vendor | `*Vendor*.csv` | vendor analysis |
| Templates | `*Template*.csv` | template matching |
| Training Pass | `TrainingPass{N}_*.csv` (multi‑select) | per‑pass dashboards |
| Doc Images | `BatchData*.zip` | document viewer (region overlay) |

**Testing without real data:** `node scripts/make-test-artifacts.cjs` writes a synthetic,
safe-to-share bundle to `test-artifacts/` (a `BatchData` zip of generated invoice PDFs +
a matching `flatReportData.csv` + `TrainingPassSummary.csv`, incl. a multi‑page document
and seeded region errors). See `test-artifacts/README.txt`.

## Scripts

| Command | What it does |
|---|---|
| `npm run dev` | Vite dev server (frontend) |
| `npm run server` | Express server (`/api` for SQL + AI) |
| `npm run build` | Production build → `dist/` |
| `npm run start:prod` | Build, then serve `dist/` + `/api` from one Node process |
| `npm run package` | Build + assemble + zip the deploy bundle → `release/ancoralens-site-vX.Y.Z.zip` |
| `npm run lint` | ESLint |

## Documentation

- **`ARCHITECTURE.md`** — system architecture, diagrams, data model, module reference (start here).
- **`CHANGELOG.md`** — recent feature changes mapped to files (read this to catch up fast).
- **`DEPLOY_IIS.md`** — deploy to IIS on Windows Server (reverse proxy + scripts).
- **`DEPLOY_AZURE_VM.md`** — generic Node‑service deployment.
- **In‑app Documentation page** — the field‑status / error‑type glossary for report data.

## Project layout

```
src/
  App.jsx                 # state owner + view router (no router lib)
  main.jsx                # React root
  components/             # one file per view + Sidebar + AncoraCharts
    DocumentViewer.jsx    # modal: pdf.js page render + field-region overlay
  utils/csv.js            # PapaParse wrappers (UTF-16 / sep= tolerant)
  utils/parsers.js        # report parsers + field-status taxonomy + matchPassKey
  utils/batchImages.js    # read a BatchData*.zip (JSZip) → doc index; parseCaptureLocation
  styles.css              # design-system tokens + all styles
server/index.js           # Express: serves dist/ + SQL/AI API
scripts/package.mjs       # deploy packager
scripts/make-test-artifacts.cjs  # generate synthetic test data (no real data)
test-artifacts/           # generated test bundle (zip + CSVs) for the document viewer
iis/                      # IIS web.config + setup scripts
```

> **Dependencies note:** the document viewer adds `pdfjs-dist` (PDF rendering) and `jszip`
> (in‑browser zip reading). Both are plain `npm install` dependencies — no extra setup. The
> pdf.js **worker** is bundled by Vite as its own asset (`dist/assets/pdf.worker.*.mjs`); it
> must ship alongside the rest of `dist/` (it already does via the build/package scripts).

See **`ARCHITECTURE.md`** for the full picture.

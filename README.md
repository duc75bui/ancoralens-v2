# AncoraLens

A single‑page web app for auditing the accuracy of an intelligent **document‑processing
pipeline**. Upload the pipeline's CSV reports and AncoraLens turns them into dashboards,
drill‑down tables, an SQL console, and a Gemini‑powered AI assistant.

- **CSV parsing runs entirely in the browser** (PapaParse) — the analytics views need no server.
- A small **Express server** powers two optional features (SQL Connector → MSSQL, AI
  Assistant → Google Gemini) and, in production, serves the built UI on the same port.

Built with **React 19 + Vite 7**, custom animated SVG charts + Recharts, framer‑motion,
and a warm‑paper editorial design system (light + dark).

## Quickstart

```bash
npm install

# Frontend dev server (HMR) → http://localhost:5173
npm run dev

# Backend (only for SQL Connector / AI Assistant) → http://localhost:3001
npm run server
```

Then open the app, go to **Upload Data → Auto‑Load from Folder**, and pick a results
export folder (or upload individual CSVs via the tiles).

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
- **`DEPLOY_IIS.md`** — deploy to IIS on Windows Server (reverse proxy + scripts).
- **`DEPLOY_AZURE_VM.md`** — generic Node‑service deployment.
- **In‑app Documentation page** — the field‑status / error‑type glossary for report data.

## Project layout

```
src/
  App.jsx                 # state owner + view router (no router lib)
  main.jsx                # React root
  components/             # one file per view + Sidebar + AncoraCharts
  utils/csv.js            # PapaParse wrappers (UTF-16 / sep= tolerant)
  utils/parsers.js        # report parsers + field-status taxonomy
  styles.css              # design-system tokens + all styles
server/index.js           # Express: serves dist/ + SQL/AI API
scripts/package.mjs       # deploy packager
iis/                      # IIS web.config + setup scripts
```

See **`ARCHITECTURE.md`** for the full picture.

# Changelog

Recent feature work, newest first. For each entry: what changed, why, and the files to read.
This is the fast catch‑up for engineers and AI agents — pair with `ARCHITECTURE.md`.

> Dates use the commit date. The backup tag `backup-2026-06-23` marks a verified‑working
> snapshot (see "Backups" at the bottom).

---

## Document viewer — source pages with field‑region overlay (2026‑06‑23)

Audit extraction against the original documents directly in the **Detailed Report**.

- Upload a `BatchData*.zip` (the capture tool's export) via the new **Doc Images** tile; it's
  read in‑browser with **JSZip** into a doc index. A **"View document"** button on each batch
  opens a modal that renders the source page with **pdf.js** (`pdfjs-dist`) and overlays each
  captured field's region, **colored by status** (error = red). "Errors only" toggle, page
  nav, and click‑a‑field‑row to jump to its region.
- The source documents are **PDFs, not images** — rendered on demand; no PNG conversion.
- **Multi‑page:** region→page mapping auto‑detects 0‑ vs 1‑based `CapturedPage` per document
  and clamps out‑of‑range; clicking a page‑2 field jumps to page 2.
- **Coordinates:** OCR raster pixels; overlay transform is `renderScale × 72 / OCR_DPI`
  (`OCR_DPI = 300` constant in `DocumentViewer.jsx` — the dial if a dataset differs).
- Files: `src/utils/batchImages.js` (new), `src/components/DocumentViewer.jsx` (new),
  `src/components/UploadView.jsx` (Doc Images tile), `src/App.jsx` (`imageIndex` state),
  `src/components/DetailsReport.jsx` (View document + field‑locate), `src/styles.css` (modal).
- Deps added: `pdfjs-dist`, `jszip`.
- Commits: `4993f4a`, `eff84ac`, plus `1c3c505`/`3ce3f0a` (test‑fixture fixes only).

## Synthetic test artifacts (2026‑06‑23)

`node scripts/make-test-artifacts.cjs` → `test-artifacts/`: a `BatchData` zip of generated
invoice PDFs (valid pdf.js xref) + `CapturedData.json`/`BatchInfo.json`, a matching
`flatReportData.csv`, and `TrainingPassSummary.csv` — **no real data**. Region boxes are
computed from where each value is drawn in the PDF, so the overlay lands on the text; includes
a **multi‑page** document (`Batch‑SAMPLE‑1004`) with a page‑2 error. Commits: `030b9e4`,
`3ce3f0a`, `1c3c505`.

## Per‑pass dashboards (2026‑06‑09, `2988477`)

Clicking a row in the dashboard's **training‑pass table** opens a dashboard scoped to that one
pass, rendered from its own `TrainingPass{N}_*.csv`, with a breadcrumb back to the summary
overview. The training‑pass **bar chart** still routes to the Detailed Report (unchanged).
Per‑pass CSVs are uploadable via the new **Training Pass** tile and via folder auto‑load.
Files: `src/App.jsx` (`trainingPassData`/`activePass`, `passDashboard` view,
`resolvePassRows`), `src/components/DashboardView.jsx` (`passContext` breadcrumb, split
handlers), `src/components/UploadView.jsx`, `src/utils/parsers.js` (`matchPassKey`),
`src/components/Sidebar.jsx`, `src/styles.css`.

## Labor‑savings KPI + PDF report export (2026‑06‑09, `befee33`)

- A **Labor savings** KPI card on the dashboard when the summary CSV provides it.
- A **"Download PDF"** button that prints the dashboard via the browser print pipeline (no new
  deps). `PrintModeContext` force‑mounts lazy charts before printing; an `@media print` block
  in `styles.css` lays the report out compactly.
- Files: `src/components/DashboardView.jsx`, `src/styles.css`.

## FieldStatus classification fix (2026‑06‑09, `d7ce227`)

`statusKind` mis‑read documented codes because positive tokens are embedded in negative ones
(`"match"` ⊂ `TextMatchFail`, `"valid"` ⊂ `UnassignedValid`/`invalid`) — hiding real
errors/warnings from the severity filter and badges. Now maps the canonical codes explicitly
(`STATUS_CODE_KIND`, mirroring `DocumentationView`) before keyword matching, and checks
negatives before positives. File: `src/utils/parsers.js`.

## Detailed Report severity filter (2026‑06‑09, `53596b9`)

*All / Warnings & Errors / Errors Only* dropdown filtering header **and** line‑item rows by
status (shared `statusKind`); persisted via `savedState`. File: `src/components/DetailsReport.jsx`.

## Pipeline‑health straight‑through rate (2026‑06‑09, `19b8600`)

The "straight‑through processing" donut now derives a batch‑level STP rate
`(Total − Exception) / Total` when the explicit `Pass‑Through %` is absent, instead of falling
back to field accuracy under an STP label. File: `src/components/DashboardView.jsx`.

## Earlier fixes (uncommitted/working tree where noted)

- **Line‑items red error tint** showed only on hover — a descendant `.line-items-row td`
  selector overpainted the nested error rows. Scoped to `> td`. File: `src/styles.css`.
- **Dev port** moved `5173 → 5174` (`vite.config.js`, `.claude/launch.json`).

---

## Backups / restore

- Git tag **`backup-2026-06-23`** (pushed) — a verified‑working snapshot.
- Standalone source zip: `../ancoralens-v2-backup-2026-06-23.zip` (outside the repo).
- Restore: `git checkout backup-2026-06-23` (inspect) or `git reset --hard backup-2026-06-23`.

## Known follow‑ups

- Confirm against a real `flatReportData.csv`: the row↔document join key (`InputFileName`
  vs `SourceDocId`), the `CaptureLocation` string format, and the OCR DPI (`OCR_DPI`).
- The pdf.js bundle is large (~1.4 MB + a ~1.2 MB worker asset). Consider lazy‑loading
  `DocumentViewer` with `import()` if initial load time matters.

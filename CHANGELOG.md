# Changelog

Recent feature work, newest first. For each entry: what changed, why, and the files to read.
This is the fast catch‑up for engineers and AI agents — pair with `ARCHITECTURE.md`.

> Dates use the commit date. The backup tag `backup-2026-06-23` marks a verified‑working
> snapshot (see "Backups" at the bottom).

---

## Batch viewer — scale to multi‑GB split archives + correct doc matching (2026‑06‑24, build `1.1.0-batch-viewer.5`)

Makes the document viewer work on real production exports (the BFS dataset: a **~2.6 GB**
`BFS_batchData.zip` split into 16 parts, ~4,276 documents). Tracked defects in `ISSUES.md` (BV‑1…BV‑10).

- **Lazy random‑access reader (replaced JSZip with `@zip.js/zip.js`).** Only each segment's central
  directory is read up front; a single PDF / metadata JSON is pulled on demand via `blob.slice()` off
  a file‑backed `Blob` (no copy). Peak memory ≈ one PDF, not the whole archive. *Was:*
  `JSZip.loadAsync(new Blob(parts))` loaded the entire 2.6 GB into memory → tab OOM/hang.
- **Split archives are independent subset‑zips, not a byte‑split.** Each `.zip`/`.partN` is its own
  complete zip holding a *subset* of documents; concatenating only exposed the last part (~6%). We now
  **read each segment and merge** (auto‑falling back to concatenation for a true byte‑split). BFS:
  **4,057/4,276 docs (94.9%)** indexed in ~1–2 s. One headless fragment (`part5`, no central directory)
  is unrecoverable and reported honestly.
- **Correct document matching by GUID.** Indexed by `{batchId}/{docId}` (authoritative) — filenames are
  non‑distinct (`generatedByQASuite.pdf`, reused numerics, and CSV `InputFileName` ≠ archive name).
  Filename is a flagged last resort; the viewer shows **"approximate match — verify document"** when used.
- **Multi‑page documents render correctly.** A docId folder holds the COMBINED multi‑page PDF directly
  in `InputFiles\` plus single‑page originals under `InputFiles\SourceFiles\`; the page indices refer to
  the combined doc, so we now select it (direct‑in‑`InputFiles`, largest) instead of a single‑page source.
- **Progress + long‑run UX.** App‑level non‑blocking banner (phase, doc count, bar, elapsed, "large
  batches can take several minutes"); throttled progress (no React re‑render storm); real success/failure
  reporting instead of a swallowed `console.warn`.
- **IndexedDB index cache** (`src/utils/idbCache.js`): the lightweight doc summary (GUIDs + entry paths +
  segment index) is cached by archive signature; re‑opening resolves instantly and a viewed document opens
  **only its one part**. PDF bytes are never cached. The cache is **schema‑versioned** (`idx:v2:…`) so a
  summary from an older build is ignored rather than mis‑resolving documents (BV‑8).
- **Multi‑page PDFs render fully:** the combined multi‑page document is selected (BV‑5) and all its pages
  render (pdf.js), with boxes placed on their assigned `CapturedPage`/`TruePage` (0..n).
- **Multi‑archive folder loads** and archive detection started **before** CSV parsing so a CSV hiccup can't
  block it.
- **Ingest banner clears correctly:** on-demand part opens during document viewing are silent (they no
  longer re-trigger the "indexing" banner), and the banner auto-dismisses after success (BV‑10).
- **Robust pdf.js worker:** the document viewer loads the pdf.js worker via Vite's `?worker`
  (`GlobalWorkerOptions.workerPort = new Worker`) instead of `?url` + `workerSrc`. The old approach let
  pdf.js fall back to a "fake worker" that dynamically *imported* the worker URL, which 404'd after a
  Vite dep re-optimization (e.g. when "Find pages" first loads `tesseract.js`) — breaking the viewer
  mid-session (BV‑9). The worker now bundles as a plain `dist/assets/pdf.worker.min-*.js` chunk.
- Files: `src/utils/batchImages.js` (rewritten), `src/utils/idbCache.js` (new), `src/components/UploadView.jsx`,
  `src/App.jsx` (ingest banner + `imageStatus`), `src/components/DetailsReport.jsx` (GUID keys, async viewer
  open), `src/components/DocumentViewer.jsx` (approximate badge), `src/styles.css`.
- Deps: **added `@zip.js/zip.js`**, JSZip no longer used for ingest. See `docs/BATCH_VIEWER.md`.

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

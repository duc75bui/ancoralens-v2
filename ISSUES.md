# Issue / Build Tracking

Defects are tracked per build. Bump `src/appBuild.js` when shipping a build line.

---

## Build `1.1.0-batch-viewer.5` — Ingest banner never cleared (re-triggered by viewing documents)

### BV-10 — "Indexing document archive… Reading archive directory… 1 entries" stuck for minutes
- **Symptom:** With everything otherwise working (documents and regions render correctly), the
  background ingest banner stayed up indefinitely, its elapsed timer climbing (e.g. 3m 55s).
- **Root cause:** On a cache hit, the per-part reader opened on demand when a user **views** a document
  reused the upload-time progress callback. So each document open re-emitted a "Reading archive
  directory" progress event — re-showing the banner — and that lazy open never reports "done", so the
  banner stuck on the last directory message (with the original `startedAt`, hence the growing timer).
- **Fix:** on-demand part opens (extraction) are now **silent** — only the initial index build reports
  progress. Verified: opening a document on a cache hit emits **no** progress phases. The banner also
  **auto-dismisses** a few seconds after "Documents ready".
- **Status:** Fixed.

---

## Build `1.1.0-batch-viewer.4` — pdf.js worker load failure broke the viewer mid-session

### BV-9 — "Setting up fake worker failed: Failed to fetch dynamically imported module …pdf.worker.min.mjs?import"
- **Symptom:** After viewing several documents successfully, the viewer began failing for *every*
  document with a pdf.js worker error; it didn't recover.
- **Root cause:** the worker was configured with `GlobalWorkerOptions.workerSrc =
  import('…pdf.worker.min.mjs?url')`. When the real Worker can't start, pdf.js falls back to a "fake
  worker" by **dynamically importing that URL**. After Vite re-optimizes dependencies mid-session (e.g.
  the first time "Find pages" lazy-loads `tesseract.js`), the old optimized module URL goes stale and
  that import 404s → the fake worker can't be set up → the viewer breaks until a hard reload.
- **Fix:** load the worker via Vite's **`?worker`** import and pass a real `Worker` instance as
  `GlobalWorkerOptions.workerPort`. Vite bundles/serves the worker correctly in **dev and prod**, so the
  fragile `?url` + fake-worker-import path is never used. Verified end-to-end in the dev server: a
  5-page PDF renders through the worker with no console errors. Build output is now a standard
  `dist/assets/pdf.worker.min-*.js` chunk (no `.mjs`), which also removes the IIS `.mjs` MIME caveat.
- **Status:** Fixed.

---

## Build `1.1.0-batch-viewer.3` — Stale-cache mis-resolution (blocked extraction)

### BV-8 — "Document not found in archive" + stuck "Reading archive directory… 1 entries"
- **Symptom:** After upgrading, opening any document in a previously-loaded archive showed **"Document
  not found in archive: <file>.pdf"**, and the ingest banner hung on "Reading archive directory… 1
  entries" for minutes.
- **Root cause:** The IndexedDB cache written by build `.1` stored a document summary **without the
  per-part segment index** (`pdfSeg`). Build `.2` reads `pdfSeg` to extract a PDF; when it was
  `undefined` it fell through to `seg = -1` = the **concatenation** fallback, which (a) is the slow 2.6 GB
  read and (b) resolves against the wrong/last segment's directory → entry not found.
- **Fix:** The cache is now **schema-versioned** (`idx:v2:{signature}`), so summaries from older builds
  are ignored and the archive is re-indexed fresh (writing the segment index). A guard also rejects any
  cached summary lacking `pdfSeg`. Verified: a simulated old-schema cache is ignored, re-indexed, and
  extraction succeeds; the new v2 cache round-trips with the segment index present.
- **Note for users:** the first load after upgrading is a cache miss (re-index, a few seconds); the
  stale old-key entry lingers harmlessly. **Multi-page PDFs:** with extraction fixed, the combined
  multi-page document (selected in BV-5) renders all pages (pdf.js sees every page) and boxes land on
  their assigned `CapturedPage`/`TruePage` (0..n).
- **Status:** Fixed.

---

## Build `1.1.0-batch-viewer.2` — Multi-page rendering, browser perf, folder detection

Follow-ups found while testing build `.1` on the real BFS dataset in-browser.

### BV-5 — Multi-page documents only showed page 1 (regression vs pre-IndexedDB)
- **Symptom:** Documents that clearly span multiple pages (fields with `CapturedPage`/`TruePage` 0..n,
  not -1) opened as a single page; the pager / other pages were missing.
- **Root cause:** ~24% of docs (955/4,057 in BFS) have **multiple PDFs** in the docId folder — the
  COMBINED multi-page document directly in `InputFiles\` (e.g. `generatedByQASuite.pdf`, the one OCR ran
  on, whose page indices the CSV uses), plus the original single-page sources under
  `InputFiles\SourceFiles\`. The index picked a PDF by last-wins iteration order, which now landed on a
  single-page `SourceFiles\*.pdf`. (The old JSZip code's different order happened to pick the combined doc.)
- **Fix:** PDFs are **scored** per docId — directly-in-`InputFiles` wins decisively, larger byte size
  (more pages) breaks ties — so the combined multi-page document is rendered. A source-file name is kept
  as the viewer label so documents stay distinguishable. Verified: the combined PDF (1.7 MB, multi-page)
  is now selected instead of a 92 KB single-page source.
- **Status:** Fixed.

### BV-6 — Browser ingest stalled for many minutes; cache re-opened all parts
- **Symptom:** The ingest banner sat on "Reading archive directory (part 16/16)…" for 20+ minutes.
- **Root causes:** (1) the per-entry progress callback fired ~21,866× → a React `setState`/re-render storm;
  (2) on a cache hit, opening one document re-read **all 16** parts' central directories; (3) the headless
  `part5` fragment made zip.js scan the whole ~160 MB file before failing.
- **Fix:** progress is **throttled** (≤ 1 update/200 ms; `done`/`error` always fire); each document records
  **which part** holds it, so a viewed document opens **only that one segment** (cache hit no longer reads
  every part); headless fragments are **skipped via a fast tail-EOCD check** instead of a full scan.
- **Status:** Fixed.

### BV-7 — Folder auto-load "couldn't find zip files"
- **Symptom:** Pointing folder auto-load at the folder reported no zips; manually adding them via the Doc
  Images tile worked.
- **Fix:** Archive detection + indexing now starts at the **top of the folder loader, before** the
  (slow/fragile, UTF-16, 60 MB) CSV parsing — so a CSV hiccup can't prevent zips from being found. Folder
  and manual paths now share identical grouping/indexing logic.
- **Status:** Fixed (grouping logic verified against the exact BFS filenames).

---

## Build `1.1.0-batch-viewer.1` — Large multi-batch archive + document viewer robustness

Reported from real BFS dataset: `Batches from BFS - 5.3.26` — a ~2.6 GB `BFS_batchData.zip`
split into 16 parts (`.zip` + `.part1…15`), ~6,705 documents across many batches, with a
191k-row `BFS_flatReportData.csv`.

### BV-1 — Large archive never finishes loading; most documents not viewable
- **Symptom:** Selecting the full batch zip + parts, only some (or no) documents showed a working
  "View document"; the app appeared to silently time out with no message.
- **Root cause (two compounding):**
  1. `parseBatchZip` did `JSZip.loadAsync(new Blob(parts))`, pulling the entire 2.6 GB archive into
     one in-memory buffer → tab OOM/hang. The folder loader ran the parse in a fire-and-forget
     promise that swallowed failures into `console.warn`.
  2. **The `.zip` + `.partN` files are NOT a byte-split of one archive — each part is its own
     complete zip holding a *subset* of documents** (verified: per-part entry counts 885, 867, 2016,
     … = 21,866 total). Concatenating them (old and new code alike) only exposes the *last* part's
     central directory — ~242 docs out of ~4,276 (≈6%). That is the real "not all viewable" cause.
- **Fix:** Replaced JSZip with `@zip.js/zip.js` over a `BlobReader`, and **read each segment
  independently, merging their entries** (auto-falling back to concatenation for a genuine byte-split).
  Only central directories are read up front; each PDF / metadata JSON is pulled on demand via
  `blob.slice()` (file-backed `Blob`, no copy) when a viewer opens it — peak memory ~one PDF.
  Result on the BFS archive: **4,057 / 4,276 documents indexed (94.9%) in ~2 s.**
- **Known limit:** one segment (`part5`) is a headless continuation fragment with no central
  directory and is unrecoverable via zip semantics → its ~219 documents (≈5%) can't be indexed. This
  is reported honestly ("1 unreadable segment skipped") rather than failing silently. If full
  coverage is needed, the export tool should emit each part as a self-contained zip (or a proper
  multi-volume set).
- **Status:** Fixed (94.9% coverage; remainder blocked by the source archive's split format).

### BV-2 — Region overlays don't match the displayed image (wrong document)
- **Symptom:** For documents that did open, the field regions didn't line up with the page image.
- **Root cause:** The index keyed documents by `InputFileName`, which is **not distinct** — QA docs
  are all named `generatedByQASuite.pdf` and numeric names (`239133008.pdf`) repeat across batches.
  Filename collisions overwrote each other, so a batch could resolve to a *different* document's PDF.
  `resolveDoc` only tried `SourceDocId` then the bare filename; it ignored `BatchId`/`DocId`.
- **Fix:** The export folder path carries `Batches\{batchId}\{docId}\…`, and these GUIDs match the
  CSV exactly (confirmed: folder `docId` == CSV `SourceDocId`/`DocId`). Documents are now indexed by
  `{batchId}/{docId}` (authoritative), `docId`, and a **collision-aware** filename multimap.
  `resolveDocDetailed` resolves by GUID pair first, falling back to filename only as a last resort —
  and when it does, the viewer shows an **"approximate match — verify document"** badge.
- **Status:** Fixed.

### BV-3 — No progress / false "timeout" on long loads
- **Symptom:** No feedback during long parses/OCR; looked hung; users weren't told to wait.
- **Fix:** A non-blocking App-level ingest banner shows phase, document count, a progress bar, and an
  elapsed timer, with explicit "large batches can take several minutes — you can keep working" copy.
  Background indexing reports real success/failure instead of swallowing it. The viewer shows an
  "Opening document…" overlay while a PDF/metadata resolves out of the archive.
- **Status:** Fixed.

### BV-4 — Only one archive used; can't load multiple batch zips / parts
- **Symptom:** Folder auto-load only picked the single largest zip group; "could only download/select
  one part at a time" — and even when all parts were selected, only one part's worth resolved (see
  BV-1.2).
- **Fix:** All `.partN` segments of an archive are now read and merged (BV-1). Additionally, every
  *distinct* zip archive in a folder is indexed and merged (`mergeImageIndexes`); the manual "Doc
  Images" tile groups multi-selected files by archive too. Non-document zips (e.g.
  `DocumentReports.zip`) yield no docs and are dropped, with their readers released.
- **Status:** Fixed.

### Caching
- The lightweight document index (fileName + `batchId`/`docId` GUIDs + entry paths) is cached in
  IndexedDB keyed by an archive signature (base name + total bytes + part count). Re-opening the same
  dataset resolves documents instantly and defers even the central-directory read until the first
  document is viewed. **PDF bytes are never cached** (they're streamed from the picked files), so the
  cache stays small; a fresh pick of the same folder is still required each session (browser security
  drops File handles between sessions).

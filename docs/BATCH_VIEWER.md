# Batch Document Viewer — Architecture

> How AncoraLens turns a multi-GB `BatchData` export into a fast, in-browser document viewer with
> field-region overlays. Pairs with `ARCHITECTURE.md` (§5/§7.5) and `ISSUES.md` (BV-1…BV-7).
> Introduced/rewritten in build **`1.1.0-batch-viewer.2`**.

---

## 1. The problem

The capture pipeline exports a `BatchData` archive containing every source PDF plus per-document
capture/truth metadata. Real exports are **large** — the reference BFS dataset is a **~2.6 GB**
`BFS_batchData.zip` split into 16 files, holding **~4,276 documents** across many batches, paired
with a 191k-row `BFS_flatReportData.csv`.

Four properties make this hard in a browser:

1. **Size.** 2.6 GB cannot be loaded into memory (tab OOM).
2. **The "split" is not a byte-split.** Each `.zip` / `.partN` is its **own complete zip** holding a
   *subset* of documents. Concatenating them only exposes the last part's directory (~6% of docs).
3. **Filenames are not distinct.** QA documents are all named `generatedByQASuite.pdf`, numeric names
   repeat across batches, and the CSV's `InputFileName` often doesn't even match the archive's PDF
   name. Only the `{batchId}/{docId}` GUID pair is reliable.
4. **Multiple PDFs per document.** A docId folder holds the COMBINED multi-page document directly in
   `InputFiles\` (the one OCR/capture ran on — its page indices are what the CSV references) *and* the
   original single-page sources under `InputFiles\SourceFiles\`.

## 2. Archive layout

Paths use Windows backslashes:

```
BatchData\{batchTypeId}\Batches\{batchId}\{docId}\InputFiles\{combined}.pdf          ← render this
BatchData\{batchTypeId}\Batches\{batchId}\{docId}\InputFiles\SourceFiles\{src}.pdf   ← single-page originals
BatchData\{batchTypeId}\Batches\{batchId}\{docId}\CapturedData.json
BatchData\{batchTypeId}\Batches\{batchId}\{docId}\TrueData.json
```

The folder `{batchId}` / `{docId}` GUIDs equal the CSV's `BatchId` / `SourceDocId` (== `DocId`).

## 3. Pipeline (`src/utils/batchImages.js`)

```
File[] (zip + .partN)
  └─ orderZipParts()           order base.zip, .part1, .part2, …
  └─ archiveSignature()        "name|totalBytes|partCount"  (cache key)
  └─ IndexedDB cache hit? ──────────────────────► buildIndex(summary, resolveEntry)   [instant]
  └─ readArchiveSegments()     open EACH part as its own zip (@zip.js/zip.js BlobReader),
       │                       skip headless fragments via a fast tail-EOCD check, merge,
       │                       tag every entry with its part index
       └─ summarizeEntries()   per docId: pick the COMBINED pdf (direct-in-InputFiles, largest),
       │                       record metadata JSON paths + which segment holds each
       └─ buildIndex()         lazy doc objects: getArrayBuffer() / loadMetadata()
       └─ idbSet(summary)      cache the lightweight summary (never the PDF bytes)
```

Key engine choices:

- **`@zip.js/zip.js` with `configure({ useWebWorkers: false })`** over `new BlobReader(new Blob([part0, …]))`.
  A `Blob` over `File` objects references them without copying, so zip.js reads only the central
  directory and an individual entry's bytes via `blob.slice()` straight off disk. **Peak memory ≈ one
  PDF**, not the archive. (Replaced JSZip, which buffered the whole archive.)
- **Per-segment reading + merge.** Each part is opened independently; entries are merged into one
  path→entry view. Headless continuation fragments (no End-Of-Central-Directory, e.g. BFS `part5`) are
  skipped fast and **counted**, so coverage is reported honestly ("N unreadable segments skipped")
  rather than failing silently. BFS result: **4,057/4,276 (94.9%)**; the ~5% gap is `part5`, which is
  unrecoverable via zip semantics (fix belongs in the export tool).
- **Combined-PDF selection.** Per docId, PDFs are scored `(+1e15 if directly in InputFiles) + byteSize`,
  so the combined multi-page document wins over a single-page `SourceFiles\*.pdf`. A source-file name is
  kept as the viewer label so documents stay distinguishable.
- **Per-part lazy extraction.** Each summary doc records `pdfSeg` (the part index). On a cache hit,
  opening a document opens **only that one part** — it never re-reads all 16 directories.
- **Throttled progress.** The per-entry directory callback is rate-limited (≤ 1 update / 200 ms;
  `done`/`error` always fire) to avoid a React re-render storm during indexing.

## 4. Matching (`resolveDocDetailed`)

Resolution priority for a report row (`{ batchId, docId, sourceDocId, inputFileName }`):

1. `byBatchDoc["{batchId}/{docId}"]` — **exact**, authoritative
2. `byBatchDoc["{batchId}/{sourceDocId}"]` — **exact**
3. `byDoc[docId]` / `byDoc[sourceDocId]` — **guid**
4. batch-scoped filename (unique within batch) — **batch-file**
5. globally-unique filename — **file**
6. ambiguous filename → first match, `approximate: true`

When the match is filename-only and ambiguous, `DocumentViewer` shows an **"approximate match — verify
document"** badge. `DetailsReport` passes `{ DocId, SourceDocId, BatchId, InputFileName }` from each row.

## 5. Caching (`src/utils/idbCache.js`)

A tiny IndexedDB key/value store (`db: ancoralens`, `store: archiveIndex`). Only the **lightweight doc
summary** is cached (`fileName`, `batchId`, `docId`, entry paths, segment indexes) — keyed by archive
signature. **PDF bytes are never cached.** Re-opening the same dataset resolves documents instantly and
a viewed document streams from the freshly-picked files. Browser security drops `File` handles between
sessions, so the user re-picks the folder each session (fast — directory-only).

## 6. Progress UX

`UploadView.indexArchives()` runs in the background and reports through
`onDataLoaded("imagesProgress", …)`. `App` holds `imageStatus` and renders a non-blocking
`ImageLoadBanner` (bottom-left) that **survives navigation** into the dashboard: phase, document count,
progress bar, elapsed timer, and "large batches can take several minutes — you can keep working." On
viewer open, `DetailsReport` shows an "Opening document…" overlay while the PDF + metadata resolve.

## 7. Rendering (`src/components/DocumentViewer.jsx`)

Unchanged by this work, but it depends on the above: the selected **combined** multi-page PDF is
rendered with pdf.js; `numPages` drives the pager. Region boxes come from the CSV's `CaptureLocation`/
`TrueLocation` + `CapturedPage`/`TruePage` (0-based; `-1` = unassigned → content-fallback / "Find
pages"), with the doc's `CapturedData.json`/`TrueData.json` (lazily loaded on open) as a fallback. See
`ARCHITECTURE.md` §7.5 and the in-repo memory note on multi-page region handling.

## 8. Known limitations

- **`part5` / headless fragments** in the BFS-style split are unrecoverable (~5% of docs). To reach 100%
  coverage the export must emit each part as a self-contained zip, or a proper multi-volume set.
- **Cross-session PDF access** requires re-picking the folder (browser File handles are not persistent).
- **OCR DPI** for region coordinates is fixed at `OCR_DPI = 300` (`DocumentViewer.jsx`) — the dial if a
  dataset rasterizes differently.

## 9. Verifying changes

`@zip.js/zip.js` runs in Node too. To exercise the real archive without loading it into memory, use
Node's file-backed `openAsBlob` per part (mirrors how the browser slices from disk):

```js
import { openAsBlob } from "node:fs";
const blobs = [];
for (const p of parts) { const b = await openAsBlob(p); b.name = p; blobs.push(b); }
const index = await parseBatchZip(blobs, { useCache: false });   // ~1–2 s, 4,057 docs for BFS
```

The synthetic `test-artifacts/BatchData-SAMPLE-*.zip` (`node scripts/make-test-artifacts.cjs`) is a
small, real-text-layer fixture for end-to-end checks.

/**
 * batchImages — read a BatchData export zip in-browser and index the source documents so the
 * Detailed Report can render a page with the captured field regions overlaid.
 *
 * Export layout (paths use Windows backslashes):
 *   BatchData\{batchTypeId}\Batches\{batchId}\{docId}\InputFiles\[SourceFiles\]{InputFileName}.pdf
 *   BatchData\{batchTypeId}\Batches\{batchId}\{docId}\CapturedData.json
 *   BatchData\{batchTypeId}\Batches\{batchId}\{docId}\TrueData.json
 *
 * Scale note: real exports are multi-GB (the BFS batch is ~2.6 GB across 16 split parts). We must
 * NOT pull the whole archive into memory. We use @zip.js/zip.js over a BlobReader: it reads only the
 * central directory up front (cheap) and pulls an individual entry's bytes via blob.slice() on demand
 * when a viewer opens that document. `new Blob([part0, part1, …])` references the picked File objects
 * without copying, so slicing reads straight from disk. Peak memory is ~one PDF, not the whole zip.
 *
 * The index keys each document by its {batchId}/{docId} GUID pair (authoritative), its docId GUID,
 * and — only as a flagged last resort — its InputFileName (which is NOT distinct: QA docs are all
 * "generatedByQASuite.pdf" and numeric names repeat across batches).
 */
import { BlobReader, ZipReader, Uint8ArrayWriter, TextWriter, configure } from "@zip.js/zip.js";
import { idbGet, idbSet } from "./idbCache.js";

// Decompress on the main thread: avoids bundler/worker-URL fragility and keeps everything offline.
// Only one PDF is ever inflated at a time (on viewer open), so the main-thread cost is negligible.
configure({ useWebWorkers: false });

// IndexedDB cache schema version. BUMP THIS whenever the cached summary shape changes so stale entries
// from an older build are ignored (a missing field would otherwise mis-resolve documents). v2 added the
// per-document segment index (`pdfSeg`/`capturedSeg`/`trueSeg`) used for per-part lazy extraction.
const CACHE_VERSION = 2;
const cacheKey = (signature) => `idx:v${CACHE_VERSION}:${signature}`;

// Below this many documents we eagerly parse every doc's CapturedData/TrueData JSON during indexing
// (cheap, and preserves the original JSON-region fallback for small fixtures). Above it we defer JSON
// to viewer-open time so a huge archive never reads tens of thousands of JSON blobs up front.
const EAGER_METADATA_DOC_LIMIT = 400;

// Export paths use Windows backslashes. We normalize separators to forward slashes once (see
// toForwardSlashes) before matching, so these patterns stay simple and unambiguous.
const PDF_PATH = /Batches\/([^/]+)\/([^/]+)\/InputFiles\/(.+\.pdf)$/i;
const DATA_JSON_PATH = /Batches\/([^/]+)\/([^/]+)\/(CapturedData|TrueData)\.json$/i;
const BACKSLASH = String.fromCharCode(92);

/** Normalize a zip entry path's separators to forward slashes (entries store Windows backslashes). */
function toForwardSlashes(path) {
  return String(path || "").split(BACKSLASH).join("/");
}

/** basename of a zip path (handles / and \). */
function baseName(path) {
  return String(path || "").split(/[\\/]/).pop() || "";
}

function numeric(value) {
  if (value == null || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function readLabeledNumber(text, labels = []) {
  for (const label of labels) {
    const match = text.match(new RegExp(`(?:^|[^a-z])${label}\\s*[:=]\\s*(-?\\d+(?:\\.\\d+)?)`, "i"));
    if (match) return Number(match[1]);
  }
  return null;
}

function makeRegion({ page = null, pageBase = null, left, top, right, bottom, source = "csv" }) {
  if (![left, top, right, bottom].every(Number.isFinite)) return null;
  const normalized = {
    page: Number.isFinite(page) && page >= 0 ? page : null,
    pageBase: Number.isFinite(pageBase) ? pageBase : null,
    left: Math.min(left, right),
    top: Math.min(top, bottom),
    right: Math.max(left, right),
    bottom: Math.max(top, bottom),
    source
  };
  // Zero-area / empty boxes (e.g. X:0 Y:0 Width:0 Height:0) carry no location — they come from values
  // computed by a formula or left at a default, not found on the page. Drop them so nothing is drawn at
  // the page origin; the field simply has no region to overlay.
  if (normalized.right <= normalized.left || normalized.bottom <= normalized.top) return null;
  return normalized;
}

function normalizeFieldName(value) {
  return String(value || "").trim().replace(/\*$/, "");
}

/**
 * Parse a CSV CaptureLocation/TrueLocation string into a page + bounding box.
 * Real reports commonly emit `X/Y/Width/Height`; older/simple fixtures may emit
 * `[page,left,top,right,bottom]` or `[left,top,right,bottom]`.
 */
export function parseCaptureLocation(value, fallbackPage) {
  const text = String(value ?? "");
  const x = readLabeledNumber(text, ["x"]);
  const y = readLabeledNumber(text, ["y"]);
  const width = readLabeledNumber(text, ["width", "w"]);
  const height = readLabeledNumber(text, ["height", "h"]);
  const pageLabel = readLabeledNumber(text, ["pageindex", "page"]);
  const fallback = numeric(fallbackPage);

  // The page comes either from a PageIndex label inside the location string or from the separate
  // TruePage/CapturedPage column. Both are 0-based (0 = first page, -1 = unassigned), so when we use
  // either we know the base is 0. makeRegion turns a negative page into null (unknown).
  const usingFallback = !Number.isFinite(pageLabel) && Number.isFinite(fallback);
  const page = Number.isFinite(pageLabel) ? pageLabel : fallback;
  const pageBase = (Number.isFinite(pageLabel) && /pageindex/i.test(text)) || usingFallback ? 0 : null;

  if ([x, y, width, height].every(Number.isFinite)) {
    return makeRegion({ page, pageBase, left: x, top: y, right: x + width, bottom: y + height, source: "csv" });
  }

  const leftLabel = readLabeledNumber(text, ["left"]);
  const topLabel = readLabeledNumber(text, ["top"]);
  const rightLabel = readLabeledNumber(text, ["right"]);
  const bottomLabel = readLabeledNumber(text, ["bottom"]);
  if ([leftLabel, topLabel, rightLabel, bottomLabel].every(Number.isFinite)) {
    return makeRegion({ page, pageBase, left: leftLabel, top: topLabel, right: rightLabel, bottom: bottomLabel, source: "csv" });
  }

  const nums = text.match(/-?\d+(?:\.\d+)?/g);
  if (!nums || nums.length < 4) return null;
  const n = nums.map(Number);
  // 5+ numbers: leading number is an embedded page (base unknown). 4 numbers: page comes from the
  // 0-based column fallback.
  if (n.length >= 5) {
    const [embeddedPage, ...box] = n;
    const [left, top, right, bottom] = box;
    return makeRegion({ page: embeddedPage, left, top, right, bottom, source: "csv" });
  }
  const [left, top, right, bottom] = n.slice(0, 4);
  return makeRegion({ page: fallback, pageBase: Number.isFinite(fallback) ? 0 : null, left, top, right, bottom, source: "csv" });
}

/** Normalize a Region.Rectangle / BoundingBox object from CapturedData.json or TrueData.json. */
export function normalizeJsonRectangle(rectangle, page = null, source = "json") {
  const box = rectangle?.Rectangle || rectangle;
  if (!box || box.IsEmpty) return null;

  const x = numeric(box.X ?? box.Location?.X);
  const y = numeric(box.Y ?? box.Location?.Y);
  const width = numeric(box.Width ?? box.Size?.Width);
  const height = numeric(box.Height ?? box.Size?.Height);
  if ([x, y, width, height].every(Number.isFinite)) {
    return makeRegion({ page, pageBase: 0, left: x, top: y, right: x + width, bottom: y + height, source });
  }

  return makeRegion({
    page,
    pageBase: 0,
    left: numeric(box.Left),
    top: numeric(box.Top),
    right: numeric(box.Right),
    bottom: numeric(box.Bottom),
    source
  });
}

/** Normalize one field entry from CapturedData.json or TrueData.json. */
export function normalizeJsonFieldRegion(field, source = "json") {
  if (!field) return null;
  const page = numeric(field.PageIndex);
  const rectangle = field.Region?.Rectangle || field.BoundingBox || field.Rectangle;
  const region = normalizeJsonRectangle(rectangle, page, source);
  if (!region) return null;
  return {
    ...region,
    name: field.Name,
    value: field.Value ?? field.OriginalValue ?? field.Region?.Content ?? null
  };
}

/** Find a field region in a document's parsed JSON metadata by field name. */
export function findJsonFieldRegion(doc, fieldName, dataKey = "trueData") {
  const fields = doc?.[dataKey]?.Fields;
  if (!Array.isArray(fields) || !fieldName) return null;
  const expected = normalizeFieldName(fieldName);
  const field = fields.find((item) => normalizeFieldName(item?.Name) === expected);
  return normalizeJsonFieldRegion(field, dataKey);
}

/** True for a zip or one of its split chunks: `name.zip` or `name.zip.partN`. */
export function isZipPart(name) {
  return /\.zip(\.part\d+)?$/i.test(String(name || ""));
}

/** Group key for split parts: drop a trailing `.partN` so all chunks share one base. */
export function zipBaseName(name) {
  return String(name || "").toLowerCase().replace(/\.part\d+$/i, "");
}

/**
 * Reassemble a split archive: the base `*.zip` is segment 0 and `*.zip.partN` follow in numeric
 * order. Raw byte‑split, so a Blob over the chunks in order *is* the original zip. The Blob only
 * references the File objects (no copy), so zip.js can slice it lazily off disk.
 */
export function assembleZipParts(files) {
  const ordered = files
    .map((file) => {
      const m = String(file.name).toLowerCase().match(/^(.*\.zip)(?:\.part(\d+))?$/);
      return m ? { file, order: m[2] === undefined ? 0 : Number(m[2]) } : null;
    })
    .filter(Boolean)
    .sort((a, b) => a.order - b.order);
  return new Blob(ordered.map((entry) => entry.file));
}

function readJsonEntry(entry) {
  return entry
    .getData(new TextWriter())
    .then((text) => JSON.parse(text))
    .catch(() => null);
}

/** Stable cache key for an archive: base name + total byte size + part count (no expensive hashing). */
export function archiveSignature(input) {
  const files = Array.isArray(input) ? input : [input];
  const total = files.reduce((sum, file) => sum + (file?.size || 0), 0);
  const base = zipBaseName(files[0]?.name || "archive");
  return `${base}|${total}|${files.length}`;
}

/**
 * Build the in-memory index (lookup maps + lazy doc objects) from a flat list of document summaries.
 * `resolveEntry(path, seg)` returns the zip.js entry for a stored path on demand, opening only the
 * one segment (`seg` = part index) that holds it — so a cache-hit document open never re-reads every
 * part's directory.
 */
function buildIndex(summaryDocs, resolveEntry) {
  const byFile = {};
  const byFileList = {};
  const byDoc = {};
  const byBatchDoc = {};
  const docs = [];

  for (const summary of summaryDocs) {
    const { fileName, batchId, docId, pdfPath, pdfSeg, capturedPath, capturedSeg, truePath, trueSeg } = summary;
    const doc = { fileName, batchId, docId, capturedData: null, trueData: null, _metaLoaded: false };
    doc.getArrayBuffer = async () => {
      const entry = await resolveEntry(pdfPath, pdfSeg);
      if (!entry) throw new Error(`Document not found in archive: ${fileName}`);
      const bytes = await entry.getData(new Uint8ArrayWriter());
      return bytes.buffer;
    };
    doc.loadMetadata = async () => {
      if (doc._metaLoaded) return doc;
      if (capturedPath) {
        const entry = await resolveEntry(capturedPath, capturedSeg);
        if (entry) doc.capturedData = await readJsonEntry(entry);
      }
      if (truePath) {
        const entry = await resolveEntry(truePath, trueSeg);
        if (entry) doc.trueData = await readJsonEntry(entry);
      }
      doc._metaLoaded = true;
      return doc;
    };

    const base = fileName.toLowerCase();
    byDoc[docId] = doc;
    byBatchDoc[`${batchId}/${docId}`] = doc;
    byFile[base] = doc;
    (byFileList[base] ||= []).push(doc);
    docs.push(doc);
  }
  return { byFile, byFileList, byDoc, byBatchDoc, docs };
}

/** Order a zip + its `.partN` chunks (or a single file) into a stable segment list. */
function orderZipParts(input) {
  const files = Array.isArray(input) ? input : [input];
  return files
    .map((file) => {
      const m = String(file?.name || "").toLowerCase().match(/^(.*\.zip)(?:\.part(\d+))?$/);
      return { file, order: m && m[2] !== undefined ? Number(m[2]) : 0 };
    })
    .sort((a, b) => a.order - b.order)
    .map((entry) => entry.file);
}

/** Wrap onProgress so high-frequency phases (per-entry directory scans) don't flood React with
 *  setState calls — a major cause of the multi-minute stall. `done`/`error`/`force` always fire. */
function makeThrottledReport(onProgress, intervalMs = 200) {
  let last = 0;
  const now = () => (typeof performance !== "undefined" ? performance.now() : Date.now());
  return (phase, extra = {}) => {
    if (!onProgress) return;
    const important = phase === "done" || phase === "error" || extra.force;
    if (!important && now() - last < intervalMs) return;
    last = now();
    const rest = { ...extra };
    delete rest.force;
    onProgress({ phase, ...rest });
  };
}

/** Quick check: does the blob's tail carry an End-Of-Central-Directory signature (PK\x05\x06)? Lets
 *  us skip headless continuation fragments instantly instead of letting zip.js scan the whole file. */
async function hasCentralDirectoryTail(blob) {
  const size = blob.size || 0;
  if (size < 22) return false;
  const tail = new Uint8Array(await blob.slice(Math.max(0, size - 70000)).arrayBuffer());
  for (let i = tail.length - 22; i >= 0; i -= 1) {
    if (tail[i] === 0x50 && tail[i + 1] === 0x4b && tail[i + 2] === 0x05 && tail[i + 3] === 0x06) return true;
  }
  return false;
}

/** Open a ZipReader over one blob and return entries + a path->entry map (keyed by raw filename). */
async function openArchive(blob, report, label = "") {
  const reader = new ZipReader(new BlobReader(blob), { useWebWorkers: false });
  const entries = await reader.getEntries({
    onprogress: (loaded, total) => {
      report?.("directory", { loaded, total, message: `Reading archive directory${label}… ${loaded.toLocaleString()} entries` });
    }
  });
  const map = new Map(entries.map((entry) => [entry.filename, entry]));
  return { reader, entries, map };
}

/**
 * Read every segment of an archive. Real BatchData exports split a large set into N files where each
 * `.zip`/`.partN` is itself a COMPLETE zip holding a subset of documents (concatenating them only
 * exposes the last segment's directory — the original bug). We open each segment independently and
 * merge, tagging every entry with its part index so a single document can later be extracted by
 * opening just its one part. If no segment opens standalone, the input is a true raw byte-split, so we
 * fall back to reading the concatenation as one archive. Headless continuation fragments (no EOCD) are
 * skipped fast (tail check) and counted so coverage can be reported honestly.
 */
async function readArchiveSegments(parts, report) {
  const segments = [];
  let failed = 0;
  for (let i = 0; i < parts.length; i += 1) {
    const label = parts.length > 1 ? ` (part ${i + 1}/${parts.length})` : "";
    // For multi-part sets, skip a fragment with no EOCD without making zip.js scan the whole 100+ MB.
    if (parts.length > 1 && !(await hasCentralDirectoryTail(parts[i]))) {
      failed += 1;
      continue;
    }
    try {
      const opened = await openArchive(parts[i], report, label);
      if (opened.entries.length) segments.push({ partIndex: i, ...opened });
      else await opened.reader.close().catch(() => {});
    } catch {
      failed += 1;
    }
  }

  // No segment opened independently → treat as a raw byte-split of one archive: concatenate and read.
  if (!segments.length && parts.length) {
    const opened = await openArchive(new Blob(parts), report);
    if (opened.entries.length) {
      segments.push({ partIndex: -1, ...opened });
      failed = 0;
    } else {
      await opened.reader.close().catch(() => {});
    }
  }

  return { segments, segmentsRead: segments.length, segmentsFailed: failed };
}

/**
 * Scan segment entries into the flat per-document summary the index/cache are built from.
 *
 * A docId folder can hold several PDFs: the COMBINED, multi-page document directly in `InputFiles\`
 * (the one OCR/capture ran on — its `CapturedPage`/`TruePage` indices refer to it), plus the original
 * single-page sources under `InputFiles\SourceFiles\`. We must render the combined doc, so PDFs are
 * scored: directly-in-InputFiles wins decisively, then larger byte size (more pages) breaks ties. A
 * single-page source name is kept as the display label when the combined file has a generic name.
 */
function summarizeEntries(segments, report) {
  const pdf = {}; // docId -> { path, seg, score }
  const meta = {}; // docId -> { capturedPath, capturedSeg, truePath, trueSeg }
  const info = {}; // docId -> { batchId, combinedName, sourceName }

  const total = segments.reduce((sum, segment) => sum + segment.entries.length, 0);
  let scanned = 0;
  for (const segment of segments) {
    for (const entry of segment.entries) {
      scanned += 1;
      if (scanned % 4000 === 0) report?.("index", { loaded: scanned, total, message: "Indexing documents…" });
      if (entry.directory) continue;

      const path = toForwardSlashes(entry.filename);
      const jsonMatch = path.match(DATA_JSON_PATH);
      if (jsonMatch) {
        const docId = jsonMatch[2];
        const slot = jsonMatch[3].toLowerCase() === "truedata" ? "true" : "captured";
        (meta[docId] ||= {})[`${slot}Path`] = entry.filename;
        meta[docId][`${slot}Seg`] = segment.partIndex;
        continue;
      }

      const pdfMatch = path.match(PDF_PATH);
      if (!pdfMatch) continue;
      const [, batchId, docId, afterInput] = pdfMatch;
      const direct = !afterInput.includes("/"); // InputFiles\file.pdf (combined) vs InputFiles\SourceFiles\file.pdf
      const score = (direct ? 1e15 : 0) + (entry.uncompressedSize || 0);
      const slot = (info[docId] ||= { batchId });
      if (direct) slot.combinedName = baseName(afterInput);
      else if (!slot.sourceName) slot.sourceName = baseName(afterInput);
      if (!pdf[docId] || score > pdf[docId].score) {
        pdf[docId] = { path: entry.filename, seg: segment.partIndex, score };
      }
    }
  }

  return Object.keys(pdf).map((docId) => ({
    // Prefer a meaningful source name for the label (e.g. 239134640.pdf) while rendering the combined doc.
    fileName: info[docId].sourceName || info[docId].combinedName || "document.pdf",
    batchId: info[docId].batchId,
    docId,
    pdfPath: pdf[docId].path,
    pdfSeg: pdf[docId].seg,
    capturedPath: meta[docId]?.capturedPath || null,
    capturedSeg: meta[docId]?.capturedSeg ?? null,
    truePath: meta[docId]?.truePath || null,
    trueSeg: meta[docId]?.trueSeg ?? null
  }));
}

/**
 * Read a BatchData zip (a single File/Blob, or an array of a `.zip` + its `.partN` segments) and
 * return a lazy index of its documents. Only central directories are read up front; PDF bytes and
 * (for large archives) metadata JSON are pulled on demand via blob.slice(), so a multi-GB archive
 * never sits in memory. The lightweight document summary is cached in IndexedDB keyed by the archive
 * signature; on re-open, documents resolve instantly and a viewed document opens only the single
 * segment that holds it (no re-reading every part's directory).
 *
 * @param {File|Blob|File[]} input
 * @param {{ onProgress?: (p: {phase: string, loaded?: number, total?: number, message?: string}) => void,
 *           signal?: AbortSignal, useCache?: boolean }} [options]
 * @returns {Promise<BatchImageIndex>}
 */
export async function parseBatchZip(input, options = {}) {
  const { onProgress, signal, useCache = true } = options;
  const report = makeThrottledReport(onProgress);
  const signature = archiveSignature(input);
  const archiveName = Array.isArray(input) ? zipBaseName(input[0]?.name || "") : input?.name || "";
  const parts = orderZipParts(input);

  // One reader per part, opened on demand and memoized. seg === -1 is the concatenation fallback.
  // Opens here are SILENT (no progress reporting): they happen during on-demand extraction when a user
  // views a document, which must NOT re-trigger the ingest banner. The initial index build reports
  // progress via readArchiveSegments (which calls openArchive directly with `report`) and primes these
  // openers, so a cache-miss extraction reuses an already-open reader without re-reporting either.
  const openers = new Map(); // seg -> Promise<{ reader, map }>
  const openPart = (seg) => {
    const key = seg == null ? -1 : seg;
    if (!openers.has(key)) {
      const blob = key === -1 ? new Blob(parts) : parts[key];
      openers.set(key, openArchive(blob)); // no `report` → silent
    }
    return openers.get(key);
  };
  const resolveEntry = async (path, seg) => (await openPart(seg)).map.get(path) || null;
  const close = async () =>
    Promise.all([...openers.values()].map(async (promise) => {
      try {
        (await promise).reader.close();
      } catch {
        /* already closed */
      }
    }));

  report("assemble", { message: "Preparing archive…", force: true });

  // Cache hit: build the index from the stored summary. A viewed document opens just its own part.
  if (useCache) {
    const cached = await idbGet(cacheKey(signature));
    // Guard against a summary missing the segment index (would mis-resolve to the concat fallback).
    if (cached?.docs?.length && typeof cached.docs[0]?.pdfSeg === "number") {
      report("done", {
        message: `Ready — ${cached.docs.length.toLocaleString()} documents (cached index).`,
        loaded: cached.docs.length,
        total: cached.docs.length,
        done: true
      });
      return { ...buildIndex(cached.docs, resolveEntry), archiveName, signature, fromCache: true, docCount: cached.docs.length, close };
    }
  }

  // Cache miss: read each segment, build the index, and cache the summary.
  report("directory", { message: "Reading archive directory…", force: true });
  const { segments, segmentsRead, segmentsFailed } = await readArchiveSegments(parts, report);
  if (signal?.aborted) {
    await Promise.all(segments.map((segment) => segment.reader.close().catch(() => {})));
    throw new DOMException("Aborted", "AbortError");
  }
  // Prime the per-part openers with the already-open segment readers so extraction reuses them.
  for (const segment of segments) openers.set(segment.partIndex, Promise.resolve({ reader: segment.reader, map: segment.map }));

  report("index", { message: "Indexing documents…", force: true });
  const summaryDocs = summarizeEntries(segments, report);
  const index = buildIndex(summaryDocs, resolveEntry);

  // Small archives: eagerly load every doc's metadata so behaviour matches the pre-lazy fixtures.
  if (index.docs.length > 0 && index.docs.length <= EAGER_METADATA_DOC_LIMIT) {
    report("metadata", { message: "Reading document metadata…", loaded: 0, total: index.docs.length, force: true });
    let done = 0;
    for (const doc of index.docs) {
      await doc.loadMetadata();
      done += 1;
      if (done % 50 === 0) report("metadata", { loaded: done, total: index.docs.length, message: "Reading document metadata…" });
    }
  }

  if (useCache && summaryDocs.length) idbSet(cacheKey(signature), { signature, docs: summaryDocs, savedAt: Date.now() });

  const skipped = segmentsFailed > 0 ? ` (${segmentsFailed} unreadable segment${segmentsFailed === 1 ? "" : "s"} skipped)` : "";
  report("done", {
    message: `Indexed ${index.docs.length.toLocaleString()} document${index.docs.length === 1 ? "" : "s"}${skipped}.`,
    loaded: index.docs.length,
    total: index.docs.length,
    done: true
  });

  return { ...index, archiveName, signature, fromCache: false, docCount: index.docs.length, segmentsRead, segmentsFailed, close };
}

/**
 * Merge several per-archive indexes into one (folder loads with multiple distinct batch archives).
 * Later archives win on key collisions, but every doc is preserved in `docs` and the filename
 * multimap, and all readers are kept for lazy extraction.
 */
export function mergeImageIndexes(indexes) {
  const live = indexes.filter(Boolean);
  if (live.length <= 1) return live[0] || null;
  const merged = { byFile: {}, byFileList: {}, byDoc: {}, byBatchDoc: {}, docs: [] };
  const closers = [];
  for (const index of live) {
    Object.assign(merged.byFile, index.byFile);
    Object.assign(merged.byDoc, index.byDoc);
    Object.assign(merged.byBatchDoc, index.byBatchDoc);
    merged.docs.push(...index.docs);
    Object.entries(index.byFileList || {}).forEach(([name, list]) => {
      (merged.byFileList[name] ||= []).push(...list);
    });
    if (index.close) closers.push(index.close);
  }
  merged.archiveName = live.map((index) => index.archiveName).filter(Boolean).join(", ");
  merged.docCount = merged.docs.length;
  merged.close = async () => {
    await Promise.all(closers.map((close) => close().catch(() => {})));
  };
  return merged;
}

/**
 * Resolve a report row's document from the index, with the match strength.
 * Priority: exact {batchId}/{docId} pair > docId/SourceDocId GUID > batch-scoped filename >
 * globally-unique filename. A bare-filename hit on a non-unique name is "approximate" — flagged so
 * the viewer can warn that the rendered PDF may not be this exact document.
 *
 * @returns {{ doc: object, strength: "exact"|"guid"|"batch-file"|"file", approximate: boolean } | null}
 */
export function resolveDocDetailed(imageIndex, { inputFileName, sourceDocId, docId, batchId } = {}) {
  if (!imageIndex) return null;
  const base = baseName(inputFileName).toLowerCase();

  if (batchId && docId && imageIndex.byBatchDoc[`${batchId}/${docId}`]) {
    return { doc: imageIndex.byBatchDoc[`${batchId}/${docId}`], strength: "exact", approximate: false };
  }
  if (batchId && sourceDocId && imageIndex.byBatchDoc[`${batchId}/${sourceDocId}`]) {
    return { doc: imageIndex.byBatchDoc[`${batchId}/${sourceDocId}`], strength: "exact", approximate: false };
  }
  if (docId && imageIndex.byDoc[docId]) {
    return { doc: imageIndex.byDoc[docId], strength: "guid", approximate: false };
  }
  if (sourceDocId && imageIndex.byDoc[sourceDocId]) {
    return { doc: imageIndex.byDoc[sourceDocId], strength: "guid", approximate: false };
  }
  // Filename fallbacks. Prefer a doc in the same batch; otherwise only trust a globally-unique name.
  const candidates = base ? imageIndex.byFileList?.[base] || (imageIndex.byFile[base] ? [imageIndex.byFile[base]] : []) : [];
  if (batchId && candidates.length) {
    const inBatch = candidates.filter((doc) => doc.batchId === batchId);
    if (inBatch.length === 1) return { doc: inBatch[0], strength: "batch-file", approximate: false };
    if (inBatch.length > 1) return { doc: inBatch[0], strength: "file", approximate: true };
  }
  if (candidates.length === 1) return { doc: candidates[0], strength: "file", approximate: false };
  if (candidates.length > 1) return { doc: candidates[0], strength: "file", approximate: true };
  return null;
}

/** Resolve a report row's document from the index, by GUID then filename. Returns the doc or null. */
export function resolveDoc(imageIndex, row = {}) {
  return resolveDocDetailed(imageIndex, row)?.doc || null;
}

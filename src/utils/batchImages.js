/**
 * batchImages — read a BatchData export zip in-browser and index the source documents so the
 * Detailed Report can render a page with the captured field regions overlaid.
 *
 * Export layout (paths use Windows backslashes):
 *   BatchData\{batchTypeId}\Batches\{batchId}\{docId}\InputFiles\{InputFileName}.pdf
 *   BatchData\{batchTypeId}\Batches\{batchId}\{docId}\CapturedData.json
 *   BatchData\{batchTypeId}\Batches\{batchId}\{docId}\TrueData.json
 *
 * The index keys each document by both its InputFileName (basename, lower-cased) and its docId
 * GUID, and exposes a lazy getArrayBuffer() so PDF bytes are only pulled when a viewer opens.
 */
import JSZip from "jszip";

const PDF_PATH = /Batches[\\/]([^\\/]+)[\\/]([^\\/]+)[\\/]InputFiles[\\/](.+\.pdf)$/i;
const DATA_JSON_PATH = /Batches[\\/]([^\\/]+)[\\/]([^\\/]+)[\\/](CapturedData|TrueData)\.json$/i;

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

/**
 * Read a BatchData zip File/Blob and return an index of its documents.
 * @returns {Promise<{ byFile: Record<string,Doc>, byDoc: Record<string,Doc>, docs: Doc[] }>}
 *   Doc = { fileName, batchId, docId, getArrayBuffer(): Promise<ArrayBuffer>, capturedData?: object, trueData?: object }
 */

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
 * order. Raw byte‑split, so concatenating the chunks in order reconstructs the original zip.
 * Returns a single Blob ready for JSZip.
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

/**
 * @param {File|Blob|File[]} input  a single zip File/Blob, or an array of a zip + its `.partN`
 *   chunks (reassembled before reading).
 */
export async function parseBatchZip(input) {
  const source = Array.isArray(input) ? assembleZipParts(input) : input;
  const zip = await JSZip.loadAsync(source);
  const byFile = {};
  const byDoc = {};
  const docs = [];
  const jsonByDoc = {}; // docId -> { capturedData?, trueData? }

  // First pass: collect metadata JSON (small) so a doc can carry page and truth regions.
  const capturedEntries = Object.values(zip.files).filter((e) => !e.dir && DATA_JSON_PATH.test(e.name));
  await Promise.all(
    capturedEntries.map(async (entry) => {
      const m = entry.name.match(DATA_JSON_PATH);
      try {
        const slot = m[3].toLowerCase() === "truedata" ? "trueData" : "capturedData";
        jsonByDoc[m[2]] = { ...(jsonByDoc[m[2]] || {}), [slot]: JSON.parse(await entry.async("string")) };
      } catch {
        /* ignore malformed metadata json — boxes can still come from the CSV */
      }
    })
  );

  Object.values(zip.files).forEach((entry) => {
    if (entry.dir) return;
    const m = entry.name.match(PDF_PATH);
    if (!m) return;
    const [, batchId, docId, fileName] = m;
    const base = baseName(fileName);
    const doc = {
      fileName: base,
      batchId,
      docId,
      capturedData: jsonByDoc[docId]?.capturedData || null,
      trueData: jsonByDoc[docId]?.trueData || null,
      getArrayBuffer: () => entry.async("arraybuffer")
    };
    byFile[base.toLowerCase()] = doc;
    byDoc[docId] = doc;
    docs.push(doc);
  });

  return { byFile, byDoc, docs };
}

/** Resolve a report row's document from the index, by SourceDocId then InputFileName. */
export function resolveDoc(imageIndex, { inputFileName, sourceDocId } = {}) {
  if (!imageIndex) return null;
  if (sourceDocId && imageIndex.byDoc[sourceDocId]) return imageIndex.byDoc[sourceDocId];
  const base = baseName(inputFileName).toLowerCase();
  if (base && imageIndex.byFile[base]) return imageIndex.byFile[base];
  return null;
}

/**
 * batchImages — read a BatchData export zip in-browser and index the source documents so the
 * Detailed Report can render a page with the captured field regions overlaid.
 *
 * Export layout (paths use Windows backslashes):
 *   BatchData\{batchTypeId}\Batches\{batchId}\{docId}\InputFiles\{InputFileName}.pdf
 *   BatchData\{batchTypeId}\Batches\{batchId}\{docId}\CapturedData.json
 *
 * The index keys each document by both its InputFileName (basename, lower-cased) and its docId
 * GUID, and exposes a lazy getArrayBuffer() so PDF bytes are only pulled when a viewer opens.
 */
import JSZip from "jszip";

const PDF_PATH = /Batches[\\/]([^\\/]+)[\\/]([^\\/]+)[\\/]InputFiles[\\/](.+\.pdf)$/i;
const CAPTURED_PATH = /Batches[\\/]([^\\/]+)[\\/]([^\\/]+)[\\/]CapturedData\.json$/i;

/** basename of a zip path (handles / and \). */
function baseName(path) {
  return String(path || "").split(/[\\/]/).pop() || "";
}

/**
 * Parse a CSV CaptureLocation string into a page + bounding box. The exact format from the
 * export isn't guaranteed, so we just pull the numbers out: 5 numbers => [page,l,t,r,b],
 * 4 numbers => [l,t,r,b] (page comes from the row's CapturedPage). Returns null if unparseable.
 */
export function parseCaptureLocation(value, fallbackPage) {
  const nums = String(value ?? "").match(/-?\d+(?:\.\d+)?/g);
  if (!nums || nums.length < 4) return null;
  const n = nums.map(Number);
  let page;
  let box;
  if (n.length >= 5) {
    [page, ...box] = n;
  } else {
    box = n.slice(0, 4);
    page = Number(fallbackPage);
  }
  const [left, top, right, bottom] = box;
  if (![left, top, right, bottom].every(Number.isFinite)) return null;
  return {
    page: Number.isFinite(page) ? page : 0,
    left: Math.min(left, right),
    top: Math.min(top, bottom),
    right: Math.max(left, right),
    bottom: Math.max(top, bottom)
  };
}

/**
 * Read a BatchData zip File/Blob and return an index of its documents.
 * @returns {Promise<{ byFile: Record<string,Doc>, byDoc: Record<string,Doc>, docs: Doc[] }>}
 *   Doc = { fileName, batchId, docId, getArrayBuffer(): Promise<ArrayBuffer>, capturedData?: object }
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
  const captured = {}; // docId -> CapturedData.json (parsed)

  // First pass: collect CapturedData.json (small) so a doc can carry its page metadata.
  const capturedEntries = Object.values(zip.files).filter((e) => !e.dir && CAPTURED_PATH.test(e.name));
  await Promise.all(
    capturedEntries.map(async (entry) => {
      const m = entry.name.match(CAPTURED_PATH);
      try {
        captured[m[2]] = JSON.parse(await entry.async("string"));
      } catch {
        /* ignore malformed capture json — boxes come from the CSV anyway */
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
      capturedData: captured[docId] || null,
      getArrayBuffer: () => entry.async("arraybuffer")
    };
    byFile[base.toLowerCase()] = doc;
    byDoc[docId] = doc;
    docs.push(doc);
  });

  return { byFile, byDoc, docs };
}

/** Resolve a report row's document from the index, by InputFileName then SourceDocId. */
export function resolveDoc(imageIndex, { inputFileName, sourceDocId } = {}) {
  if (!imageIndex) return null;
  const base = baseName(inputFileName).toLowerCase();
  if (base && imageIndex.byFile[base]) return imageIndex.byFile[base];
  if (sourceDocId && imageIndex.byDoc[sourceDocId]) return imageIndex.byDoc[sourceDocId];
  return null;
}

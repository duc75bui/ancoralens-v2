/**
 * DocumentViewer — modal that renders a source document page (from the BatchData export PDF,
 * via pdf.js) with the captured field regions drawn on top, colored by status. Built for
 * auditing: an "errors only" toggle spotlights region errors, and opening from a field row
 * focuses that field's box.
 *
 * Props:
 *   docs: Array<{ label, doc: { getArrayBuffer() }, regions: Array<{
 *           name, value, status, kind, captureRegion?, trueRegion? }> }>
 *   initialDocIndex?: number
 *   focusField?: string          // field Name to highlight/scroll to on open
 *   onClose: () => void
 */
import { AlertTriangle, ChevronLeft, ChevronRight, LoaderCircle, RefreshCw, RotateCcw, RotateCw, Search, X } from "lucide-react";
import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import * as pdfjsLib from "pdfjs-dist";
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";

pdfjsLib.GlobalWorkerOptions.workerSrc = workerUrl;
const APP_BASE_URL = import.meta.env.BASE_URL || "/";
const APP_ASSET_BASE = APP_BASE_URL.endsWith("/") ? APP_BASE_URL : `${APP_BASE_URL}/`;
const PDFJS_WASM_URL = `${APP_ASSET_BASE}pdfjs/wasm/`;
const OCR_ASSET_URL = `${APP_ASSET_BASE}ocr/`;

// The export's region coordinates are OCR raster pixels. ancoraDocs rasterizes at 300 DPI, so
// a box maps to the rendered canvas by (renderScale * 72/300). Exposed as a constant in case a
// dataset uses a different capture resolution.
const OCR_DPI = 300;
const RIGHT_ANGLE_ROTATIONS = [0, 90, 180, 270];
const OCR_RENDER_SCALE = 2;

const KIND_COLOR = { error: "#ef4444", warning: "#f59e0b", success: "#22c55e", neutral: "#6E6B5C", truth: "#2B3AE8" };

function finiteNumber(value) {
  if (value == null || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function normalizeRotation(value) {
  return ((value % 360) + 360) % 360;
}

function hasBox(region) {
  return [region?.left, region?.top, region?.right, region?.bottom].every((value) => finiteNumber(value) !== null);
}

function regionList(regionOrRegions) {
  if (!regionOrRegions) return [];
  return (Array.isArray(regionOrRegions) ? regionOrRegions : [regionOrRegions]).filter(hasBox);
}

function regionBoxes(region) {
  return regionBoxEntries(region).map((entry) => entry.box);
}

function regionBoxEntries(region) {
  if (!region) return [];
  return [
    ...regionList(region.captureRegion).map((box, boxIndex) => ({ role: "capture", box, boxIndex })),
    ...regionList(region.trueRegion).map((box, boxIndex) => ({ role: "truth", box, boxIndex })),
    ...(hasBox(region) ? [{ role: "region", box: region, boxIndex: 0 }] : [])
  ];
}

function regionKey(region, index) {
  return region?.id || `${region?.name || "field"}-${index}`;
}

function boxHintKey(region, index, role, boxIndex) {
  return `${regionKey(region, index)}:${role}:${boxIndex}`;
}

function primaryRegion(region) {
  return regionList(region?.captureRegion)[0] || regionList(region?.trueRegion)[0] || (hasBox(region) ? region : null);
}

function inferPageBase(regions, numPages) {
  const pages = regions
    .flatMap(regionBoxes)
    .filter((r) => finiteNumber(r.pageBase) === null)
    .map((r) => finiteNumber(r.page))
    .filter((page) => page !== null);
  if (!pages.length) return 0;
  return Math.min(...pages) >= 1 && Math.max(...pages) <= numPages ? 1 : 0;
}

function pageIndexOf(region, numPages, fallbackBase = 0) {
  const page = finiteNumber(region?.page);
  if (page === null || page < 0) return null;
  const base = finiteNumber(region?.pageBase) ?? fallbackBase;
  const index = page - base;
  return index >= 0 && index < numPages ? index : null;
}

function hasUnknownPage(region) {
  const page = finiteNumber(region?.page);
  return page === null || page < 0;
}

// Per-field page columns (TruePage / CapturedPage) are authoritative: 0-based (0 = first page), with
// -1 meaning unassigned (e.g. a value computed from a formula, not located on the page). makeRegion
// turns -1/negative into an unknown page. We trust these pages whenever a document has any box with a
// known page; the unassigned (-1/unknown) boxes still fall back to the content-based flow ("shown on
// every page" until Find pages resolves them, with blank-area culling). A multi-page document where
// NOTHING has a known page is treated as unreliable so every box uses that fallback.
function pageMetadataReliable(regions, numPages) {
  if (numPages <= 1) return true;
  return regions.some((region) => regionBoxes(region).some((box) => !hasUnknownPage(box)));
}

function stripBoxPage(box) {
  return box ? { ...box, page: null, pageBase: null } : box;
}

function stripRegionBoxPage(boxOrBoxes) {
  if (!boxOrBoxes) return boxOrBoxes;
  return Array.isArray(boxOrBoxes) ? boxOrBoxes.map(stripBoxPage) : stripBoxPage(boxOrBoxes);
}

// Discard untrustworthy page metadata so every box reads as "page unknown". Coordinates are untouched,
// so rotation inference and box drawing still work; only the (bogus) page assignment is removed.
function stripPageMetadata(region) {
  const stripped = {
    ...region,
    captureRegion: stripRegionBoxPage(region.captureRegion),
    trueRegion: stripRegionBoxPage(region.trueRegion)
  };
  if (hasBox(region)) {
    stripped.page = null;
    stripped.pageBase = null;
  }
  return stripped;
}

// `contentPages` is the set of 0-based page indexes that actually have a resolved box, built once
// "Find pages" places at least one. While it is empty (nothing resolved yet) unknown boxes are sprayed
// on every page. Once it has entries, unmatched boxes are shown only on the pages that carry data — so
// a single-content-page doc collapses them onto that one page, and a document whose line items span
// pages 1–3 keeps them on 1–3 without spilling onto the blank pages 4–5. Resolved boxes always stay on
// their own page, so genuinely multi-page content is preserved.
function isRegionOnPage(region, pageNum, numPages, fallbackBase, contentPages = null) {
  if (hasUnknownPage(region)) {
    if (!contentPages || contentPages.size === 0) return true;
    return contentPages.has(pageNum - 1);
  }
  const index = pageIndexOf(region, numPages, fallbackBase);
  return index !== null && index + 1 === pageNum;
}

function applyPageHintToBox(box, hint) {
  if (!box || !hasUnknownPage(box) || !hint?.pages?.length) return box;
  return hint.pages.map((pageIndex) => ({
    ...box,
    page: pageIndex,
    pageBase: 0,
    pageInferred: true,
    pageInferenceSource: hint.source
  }));
}

function applyPageHintToRegionBox(boxOrBoxes, hintForBox) {
  const boxes = regionList(boxOrBoxes);
  if (!boxes.length) return boxOrBoxes;
  const hinted = boxes.flatMap((box, boxIndex) => applyPageHintToBox(box, hintForBox(box, boxIndex)));
  return Array.isArray(boxOrBoxes) || hinted.length > 1 ? hinted : hinted[0];
}

function applyPageHints(regions, hints) {
  return regions.flatMap((region, index) => {
    const updated = {
      ...region,
      captureRegion: applyPageHintToRegionBox(
        region.captureRegion,
        (_box, boxIndex) => hints[boxHintKey(region, index, "capture", boxIndex)]
      ),
      trueRegion: applyPageHintToRegionBox(
        region.trueRegion,
        (_box, boxIndex) => hints[boxHintKey(region, index, "truth", boxIndex)]
      )
    };
    const directHint = hints[boxHintKey(region, index, "region", 0)];
    if (!hasBox(region) || !directHint?.pages?.length || !hasUnknownPage(region)) return updated;

    const hinted = applyPageHintToBox(updated, directHint);
    return Array.isArray(hinted) ? hinted : updated;
  });
}

function focusPageOf(region, numPages, fallbackBase) {
  const index = pageIndexOf(region, numPages, fallbackBase);
  return (index ?? 0) + 1;
}

function sourceSizeForRotation(baseWidthPts, baseHeightPts, rotation) {
  const swap = normalizeRotation(rotation) % 180 !== 0;
  return {
    width: ((swap ? baseHeightPts : baseWidthPts) * OCR_DPI) / 72,
    height: ((swap ? baseWidthPts : baseHeightPts) * OCR_DPI) / 72
  };
}

function regionOverflowPenalty(region, size) {
  return (
    Math.max(0, -region.left) +
    Math.max(0, -region.top) +
    Math.max(0, region.right - size.width) +
    Math.max(0, region.bottom - size.height)
  );
}

function rotationDistance(left, right) {
  const distance = Math.abs(normalizeRotation(left - right));
  return Math.min(distance, 360 - distance);
}

function inferOcrRotation(regions, baseWidthPts, baseHeightPts, preferredRotation) {
  const boxes = regions.flatMap(regionBoxes);
  if (!boxes.length) return preferredRotation;

  return RIGHT_ANGLE_ROTATIONS.map((candidate) => {
    const size = sourceSizeForRotation(baseWidthPts, baseHeightPts, candidate);
    return {
      rotation: candidate,
      penalty: boxes.reduce((total, box) => total + regionOverflowPenalty(box, size), 0),
      distance: rotationDistance(candidate, preferredRotation)
    };
  }).sort((left, right) => left.penalty - right.penalty || left.distance - right.distance || left.rotation - right.rotation)[0].rotation;
}

function rotateOcrPoint(x, y, width, height, rotation) {
  switch (normalizeRotation(rotation)) {
    case 90:
      return [height - y, x];
    case 180:
      return [width - x, height - y];
    case 270:
      return [y, width - x];
    default:
      return [x, y];
  }
}

function viewportRegion(region, layout) {
  const delta = normalizeRotation(layout.displayRotation - layout.ocrRotation);
  const points = [
    [region.left, region.top],
    [region.right, region.top],
    [region.right, region.bottom],
    [region.left, region.bottom]
  ].map(([x, y]) => rotateOcrPoint(x, y, layout.ocrWidth, layout.ocrHeight, delta));
  const xs = points.map(([x]) => x);
  const ys = points.map(([, y]) => y);
  return {
    left: Math.min(...xs),
    top: Math.min(...ys),
    right: Math.max(...xs),
    bottom: Math.max(...ys)
  };
}

function boxStyle(region, layout, color) {
  if (!region || !layout.sourceWidth || !layout.sourceHeight) return { display: "none" };
  const box = viewportRegion(region, layout);
  const scaleX = layout.width / layout.sourceWidth;
  const scaleY = layout.height / layout.sourceHeight;
  return {
    left: box.left * scaleX,
    top: box.top * scaleY,
    width: (box.right - box.left) * scaleX,
    height: (box.bottom - box.top) * scaleY,
    "--box": color
  };
}

// Stable identity for a drawn box, by role + rounded source coordinates (independent of array index).
function boxGeomKey(role, box) {
  return `${role}:${Math.round(box.left)}:${Math.round(box.top)}:${Math.round(box.right)}:${Math.round(box.bottom)}`;
}

// True when the rendered page has essentially no ink under the given canvas-pixel rect (i.e. the box
// would sit over blank document space). Used to drop fallback boxes that spilled onto a page where
// their value has no content. Reads the already-painted page canvas (same-origin, so not tainted).
function isBlankCanvasRegion(ctx, x, y, width, height) {
  if (width <= 0 || height <= 0) return false;
  let data;
  try {
    data = ctx.getImageData(x, y, width, height).data;
  } catch {
    return false; // can't sample -> never cull
  }
  const inkBudget = Math.max(6, Math.floor(width * height * 0.005)); // < 0.5% inked => blank
  let ink = 0;
  for (let i = 0; i < data.length; i += 4) {
    const alpha = data[i + 3];
    if (alpha > 10 && (data[i] < 225 || data[i + 1] < 225 || data[i + 2] < 225)) {
      ink += 1;
      if (ink > inkBudget) return false;
    }
  }
  return true;
}

// Keys of fallback (page-unknown) boxes that, on the current page, fall on blank document space. Only
// fallback boxes are considered — confidently page-resolved boxes are always kept.
function blankFallbackBoxKeys(ctx, regions, layout, pageNum, numPages, fallbackBase, contentPages) {
  const hidden = new Set();
  if (!ctx || !contentPages || contentPages.size === 0) return hidden;
  const consider = (role, box) => {
    if (!box || !hasUnknownPage(box)) return;
    if (!isRegionOnPage(box, pageNum, numPages, fallbackBase, contentPages)) return;
    const style = boxStyle(box, layout, "#000");
    if (style.display === "none") return;
    const x = Math.max(0, Math.floor(style.left));
    const y = Math.max(0, Math.floor(style.top));
    const width = Math.min(layout.width - x, Math.ceil(style.width));
    const height = Math.min(layout.height - y, Math.ceil(style.height));
    if (isBlankCanvasRegion(ctx, x, y, width, height)) hidden.add(boxGeomKey(role, box));
  };
  regions.forEach((region) => {
    regionList(region.captureRegion).forEach((box) => consider("capture", box));
    regionList(region.trueRegion).forEach((box) => consider("truth", box));
    if (hasBox(region)) consider("region", region);
  });
  return hidden;
}

function normalizeSearchText(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[|]/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeDigits(value) {
  return String(value || "").replace(/\D/g, "");
}

const GENERIC_PAGE_QUERIES = new Set([
  "invoice",
  "credit memo",
  "page",
  "total",
  "grand total",
  "amount",
  "parts receiving",
  "bottom",
  "top",
  "yes",
  "no"
]);

function queryTokens(value) {
  return normalizeSearchText(value)
    .split(" ")
    .filter((token) => token.length > 1);
}

function queryIsUseful(value) {
  const normalized = normalizeSearchText(value);
  if (!normalized || GENERIC_PAGE_QUERIES.has(normalized)) return false;

  const digits = normalizeDigits(value);
  if (digits.length >= 4) return true;
  if (digits.length > 0) return false;

  const tokens = queryTokens(value);
  return tokens.length >= 2 && normalized.length >= 8;
}

function uniqueCandidates(values) {
  return [
    ...new Set(
      values
        .map((value) => String(value || "").trim())
        .filter(queryIsUseful)
    )
  ];
}

function valuesForBox(region, role, box) {
  if (role === "truth") return [box?.trueValue, region?.trueValue];
  if (role === "capture") return [box?.value, region?.value];
  return [box?.value, box?.trueValue, region?.value, region?.trueValue];
}

function queriesForBox(region, role, box) {
  return uniqueCandidates(valuesForBox(region, role, box));
}

function normalizedValueKeys(values) {
  return values.flatMap((value) => {
    if (!queryIsUseful(value)) return [];
    const text = normalizeSearchText(value);
    const digits = normalizeDigits(value);
    return [text, digits.length >= 4 ? digits : null].filter(Boolean);
  });
}

function shareUsefulValue(leftValues, rightValues) {
  const left = new Set(normalizedValueKeys(leftValues));
  return normalizedValueKeys(rightValues).some((value) => left.has(value));
}

function scoreQueryOnPage(query, pageText) {
  const normalizedQuery = normalizeSearchText(query);
  const normalizedPage = normalizeSearchText(pageText);
  if (!normalizedQuery || !normalizedPage) return 0;
  if (normalizedPage.includes(normalizedQuery)) return 5;

  const queryDigits = normalizeDigits(query);
  const pageDigits = normalizeDigits(pageText);
  if (queryDigits.length >= 5 && pageDigits.includes(queryDigits)) return 4;

  const tokens = queryTokens(query);
  if (tokens.length >= 2 && tokens.every((token) => normalizedPage.includes(token))) return 3;
  return 0;
}

function pageIndexesForBoxAnchor(region, targetEntry, entries, numPages, fallbackBase) {
  const targetValues = valuesForBox(region, targetEntry.role, targetEntry.box);
  const pages = entries
    .filter((entry) => entry !== targetEntry && !hasUnknownPage(entry.box))
    .filter((entry) => shareUsefulValue(targetValues, valuesForBox(region, entry.role, entry.box)))
    .map((entry) => pageIndexOf(entry.box, numPages, fallbackBase))
    .filter((pageIndex) => pageIndex !== null);
  return [...new Set(pages)];
}

async function extractPageText(page) {
  try {
    const content = await page.getTextContent();
    return content.items?.map((item) => item.str || "").join(" ") || "";
  } catch {
    return "";
  }
}

function hintsFromPageTexts(targets, pageTexts, source) {
  return Object.fromEntries(
    targets
      .map((target) => {
        const scoredPages = pageTexts
          .map((pageText) => ({
            pageIndex: pageText.pageIndex,
            score: Math.max(...target.queries.map((query) => scoreQueryOnPage(query, pageText.text)))
          }))
          .filter((pageText) => pageText.score > 0);
        if (!scoredPages.length) return null;

        const bestScore = Math.max(...scoredPages.map((pageText) => pageText.score));
        const pages = scoredPages.filter((pageText) => pageText.score === bestScore).map((pageText) => pageText.pageIndex);
        return pages.length ? [target.key, { pages, source, score: bestScore }] : null;
      })
      .filter(Boolean)
  );
}

// A value can appear on more than one page (a repeated invoice number, header, ...), which would pin its
// box to every matching page and redraw it as a duplicate. For a box that matched several pages, collapse
// it to the page the most single-page boxes already agree on (the dominant content page) — BUT only when
// that page is among the box's own matches. If the box did not match the consensus page, it is genuinely
// ambiguous (e.g. distributed line items), so its matched pages are kept rather than guessing one and
// mis-placing it. Single-page matches are never touched, so multi-page line-item docs resolve per page.
function consolidateHintsToSinglePage(hints) {
  const tally = {};
  Object.values(hints).forEach((hint) => {
    if (hint?.pages?.length === 1) tally[hint.pages[0]] = (tally[hint.pages[0]] || 0) + 1;
  });
  const consensusEntry = Object.entries(tally).sort((left, right) => right[1] - left[1])[0];
  const consensusPage = consensusEntry ? Number(consensusEntry[0]) : null;

  return Object.fromEntries(
    Object.entries(hints).map(([key, hint]) => {
      if (!hint?.pages?.length || hint.pages.length === 1) return [key, hint];
      if (consensusPage != null && hint.pages.includes(consensusPage)) return [key, { ...hint, pages: [consensusPage] }];
      return [key, hint];
    })
  );
}

async function renderPageForOcr(page, rotation) {
  const viewport = page.getViewport({ scale: OCR_RENDER_SCALE, rotation });
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(viewport.width);
  canvas.height = Math.round(viewport.height);
  await page.render({ canvasContext: canvas.getContext("2d"), viewport }).promise;
  return canvas;
}

export default function DocumentViewer({ docs = [], initialDocIndex = 0, focusField = null, onClose }) {
  const [docIndex, setDocIndex] = useState(Math.min(initialDocIndex, Math.max(0, docs.length - 1)));
  const [pageNum, setPageNum] = useState(1);
  const [numPages, setNumPages] = useState(1);
  const [errorsOnly, setErrorsOnly] = useState(false);
  const [rotation, setRotation] = useState(0);
  const [validationTick, setValidationTick] = useState(0);
  const [revalidating, setRevalidating] = useState(false);
  const [pageHints, setPageHints] = useState({});
  const [findingPages, setFindingPages] = useState(false);
  const [findStatus, setFindStatus] = useState("");
  const [blankBoxKeys, setBlankBoxKeys] = useState(() => new Set());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [layout, setLayout] = useState({
    ready: false,
    width: 0,
    height: 0,
    sourceWidth: 0,
    sourceHeight: 0,
    ocrWidth: 0,
    ocrHeight: 0,
    displayRotation: 0,
    ocrRotation: 0
  });
  const [active, setActive] = useState(focusField);

  const canvasRef = useRef(null);
  const pdfRef = useRef(null);
  const renderTaskRef = useRef(null);

  const current = docs[docIndex];
  const regions = useMemo(() => current?.regions || [], [current]);
  // When the document's page metadata can't be trusted (see pageMetadataReliable), drop it up front so
  // every box falls back to "shown on every page" and can be relocated by Find pages.
  const pagesReliable = useMemo(() => pageMetadataReliable(regions, numPages), [regions, numPages]);
  const trustedRegions = useMemo(
    () => (pagesReliable ? regions : regions.map(stripPageMetadata)),
    [regions, pagesReliable]
  );
  const effectiveRegions = useMemo(() => applyPageHints(trustedRegions, pageHints), [trustedRegions, pageHints]);

  // Esc to close.
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  // Load the selected document's PDF; default the page to the focused field's page.
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError("");
    setRevalidating(false);
    setPageHints({});
    setFindingPages(false);
    setFindStatus("");
    setLayout((currentLayout) => ({ ...currentLayout, ready: false }));
    pdfRef.current = null;
    setRotation(0);

    (async () => {
      try {
        if (!current?.doc) throw new Error("No document selected.");
        const buffer = await current.doc.getArrayBuffer();
        if (cancelled) return;
        const pdf = await pdfjsLib.getDocument({ data: buffer, wasmUrl: PDFJS_WASM_URL }).promise;
        if (cancelled) return;
        pdfRef.current = pdf;
        setNumPages(pdf.numPages);
        const focusRegion = focusField && regions.find((r) => r.name === focusField);
        const base = inferPageBase(regions, pdf.numPages);
        const focusPage = focusRegion ? focusPageOf(primaryRegion(focusRegion), pdf.numPages, base) : 1;
        setPageNum(focusPage);
        setActive(focusField);
      } catch (err) {
        if (!cancelled) setError(err?.message || "Could not open this document.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [docIndex]);

  // Render the current page whenever the pdf or page changes.
  useEffect(() => {
    const pdf = pdfRef.current;
    if (!pdf || loading) return undefined;
    let cancelled = false;
    let task = null;
    setRevalidating(true);
    setBlankBoxKeys(new Set());
    setLayout((currentLayout) => ({ ...currentLayout, ready: false }));

    (async () => {
      try {
        const page = await pdf.getPage(pageNum);
        if (cancelled) return;
        const baseViewport = page.getViewport({ scale: 1, rotation: 0 });
        const displayRotation = normalizeRotation((page.rotate || 0) + rotation);
        const ocrRotation = inferOcrRotation(regions, baseViewport.width, baseViewport.height, displayRotation);
        const displaySource = sourceSizeForRotation(baseViewport.width, baseViewport.height, displayRotation);
        const ocrSource = sourceSizeForRotation(baseViewport.width, baseViewport.height, ocrRotation);
        const unit = page.getViewport({ scale: 1, rotation: displayRotation });
        const targetWidth = Math.min(880, Math.max(520, window.innerWidth - 360));
        const scale = targetWidth / unit.width;
        const viewport = page.getViewport({ scale, rotation: displayRotation });
        const canvas = canvasRef.current;
        if (!canvas) return;
        canvas.width = Math.round(viewport.width);
        canvas.height = Math.round(viewport.height);
        const nextLayout = {
          ready: true,
          width: canvas.width,
          height: canvas.height,
          sourceWidth: displaySource.width,
          sourceHeight: displaySource.height,
          ocrWidth: ocrSource.width,
          ocrHeight: ocrSource.height,
          displayRotation,
          ocrRotation
        };
        setLayout(nextLayout);
        const context = canvas.getContext("2d");
        task = page.render({ canvasContext: context, viewport });
        renderTaskRef.current = task;
        await task.promise;
        if (cancelled) return;
        // With the page now painted, drop fallback boxes that landed on blank document space.
        if (numPages > 1) {
          setBlankBoxKeys(
            blankFallbackBoxKeys(context, effectiveRegions, nextLayout, pageNum, numPages, pageBase, contentPages)
          );
        }
      } catch (err) {
        if (!cancelled && err?.name !== "RenderingCancelledException") {
          setError(err?.message || "Failed to render page.");
        }
      } finally {
        if (!cancelled) setRevalidating(false);
      }
    })();

    return () => {
      cancelled = true;
      try {
        task?.cancel();
      } catch {
        /* render already settled */
      }
    };
  }, [pageNum, loading, docIndex, rotation, validationTick, regions]);

  const pageBase = useMemo(() => inferPageBase(effectiveRegions, numPages), [effectiveRegions, numPages]);

  // The set of page indexes that carry a resolved box. Empty until "Find pages" places one (multi-page
  // docs start fully stripped). Once populated, unmatched boxes are shown only on these content pages
  // instead of being sprayed on every page — collapsing onto a single page when all data lives there,
  // or staying spread across pages 1–3 (and off blank pages 4–5) for multi-page line items.
  const contentPages = useMemo(() => {
    const set = new Set();
    effectiveRegions.forEach((region) =>
      regionBoxes(region).forEach((box) => {
        if (hasUnknownPage(box)) return;
        const index = pageIndexOf(box, numPages, pageBase);
        if (index != null) set.add(index);
      })
    );
    return set;
  }, [effectiveRegions, numPages, pageBase]);
  const contentPageLabel = useMemo(
    () => [...contentPages].map((index) => index + 1).sort((a, b) => a - b).join(", "),
    [contentPages]
  );

  // Regions for the current page. Known-page boxes stay page-specific; unmatched boxes are sprayed on
  // every page until Find pages resolves a primary page, after which they collapse onto it.
  const pageRegions = useMemo(
    () =>
      effectiveRegions.filter(
        (r) =>
          (regionList(r.captureRegion).some((region) => isRegionOnPage(region, pageNum, numPages, pageBase, contentPages)) ||
            regionList(r.trueRegion).some((region) => isRegionOnPage(region, pageNum, numPages, pageBase, contentPages)) ||
            (hasBox(r) && isRegionOnPage(r, pageNum, numPages, pageBase, contentPages))) &&
          (!errorsOnly || r.kind === "error")
      ),
    [effectiveRegions, pageNum, errorsOnly, pageBase, numPages, contentPages]
  );

  const errorCount = useMemo(() => regions.filter((r) => r.kind === "error").length, [regions]);
  const unknownPageCount = useMemo(
    () => effectiveRegions.reduce((count, region) => count + regionBoxes(region).filter(hasUnknownPage).length, 0),
    [effectiveRegions]
  );
  const pageHintTargets = useMemo(
    () =>
      trustedRegions.flatMap((region, index) => {
        const entries = regionBoxEntries(region);
        return entries
          .filter((entry) => hasUnknownPage(entry.box))
          .map((entry) => {
            const key = boxHintKey(region, index, entry.role, entry.boxIndex);
            const queries = queriesForBox(region, entry.role, entry.box);
            const anchorPages = pageIndexesForBoxAnchor(region, entry, entries, numPages, pageBase);
            return { key, queries, anchorPages };
          })
          .filter((target) => !pageHints[target.key] && (target.queries.length > 0 || target.anchorPages.length === 1));
      }),
    [trustedRegions, pageHints, numPages, pageBase]
  );

  const findPagesByText = async () => {
    const pdf = pdfRef.current;
    if (!pdf || findingPages || !pageHintTargets.length) {
      if (!pageHintTargets.length) {
        setFindStatus(
          unknownPageCount === 0
            ? "All locatable regions already have page metadata."
            : "No page-unknown regions have useful values to resolve."
        );
      }
      return;
    }

    setFindingPages(true);
    setFindStatus("Checking known metadata anchors...");

    try {
      let hints = Object.fromEntries(
        pageHintTargets
          .filter((target) => target.anchorPages.length === 1)
          .map((target) => [target.key, { pages: target.anchorPages, source: "metadata", score: 6 }])
      );
      const textTargets = pageHintTargets.filter((target) => !hints[target.key] && target.queries.length > 0);

      if (textTargets.length) setFindStatus("Checking PDF text layer...");
      const pageTexts = [];
      for (let pageIndex = 0; pageIndex < pdf.numPages && textTargets.length; pageIndex += 1) {
        const page = await pdf.getPage(pageIndex + 1);
        pageTexts.push({ pageIndex, text: await extractPageText(page) });
      }

      hints = { ...hints, ...hintsFromPageTexts(textTargets, pageTexts, "text") };
      const unresolved = textTargets.filter((target) => !hints[target.key]);

      if (unresolved.length) {
        setFindStatus("Loading OCR engine...");
        const { createWorker } = await import("tesseract.js");
        const worker = await createWorker("eng", 1, {
          workerPath: `${OCR_ASSET_URL}worker.min.js`,
          corePath: `${OCR_ASSET_URL}core`,
          langPath: `${OCR_ASSET_URL}lang`,
          logger: (message) => {
            if (message?.status) {
              const progress = Number.isFinite(message.progress) ? ` ${Math.round(message.progress * 100)}%` : "";
              setFindStatus(`OCR ${message.status}${progress}`);
            }
          }
        });

        try {
          const ocrTexts = [];
          for (let pageIndex = 0; pageIndex < pdf.numPages; pageIndex += 1) {
            setFindStatus(`OCR page ${pageIndex + 1} / ${pdf.numPages}...`);
            const page = await pdf.getPage(pageIndex + 1);
            const displayRotation = normalizeRotation((page.rotate || 0) + rotation);
            const canvas = await renderPageForOcr(page, displayRotation);
            const result = await worker.recognize(canvas, { preserve_interword_spaces: "1" });
            ocrTexts.push({ pageIndex, text: result?.data?.text || "" });
            canvas.width = 0;
            canvas.height = 0;
          }
          hints = { ...hints, ...hintsFromPageTexts(unresolved, ocrTexts, "ocr") };
        } finally {
          await worker.terminate();
        }
      }

      const found = Object.keys(hints).length;
      if (!found) {
        setFindStatus("No text/OCR page matches found; page-unknown boxes stay repeated.");
        return;
      }

      hints = consolidateHintsToSinglePage(hints);
      setPageHints((currentHints) => ({ ...currentHints, ...hints }));
      const firstPage = Math.min(...Object.values(hints).flatMap((hint) => hint.pages)) + 1;
      if (Number.isFinite(firstPage)) setPageNum(firstPage);
      setValidationTick((value) => value + 1);
      const sources = [...new Set(Object.values(hints).map((hint) => hint.source))].join("/");
      setFindStatus(`Applied ${found} page hint${found === 1 ? "" : "s"} from ${sources}.`);
    } catch (err) {
      setFindStatus(`Page finding failed: ${err?.message || err}`);
    } finally {
      setFindingPages(false);
    }
  };

  return (
    <div className="docviewer-backdrop" onClick={onClose}>
      <div className="docviewer" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true">
        <header className="docviewer-head">
          <div className="docviewer-title">
            <strong>{current?.label || "Document"}</strong>
            <span>
              {regions.length} field{regions.length === 1 ? "" : "s"}
              {errorCount > 0 && <em className="dv-err-badge">{errorCount} region error{errorCount === 1 ? "" : "s"}</em>}
              {numPages > 1 && !pagesReliable && contentPages.size === 0 && (
                <em className="dv-warn-badge">page data unreliable — shown on every page</em>
              )}
              {numPages > 1 && !pagesReliable && contentPages.size > 0 && unknownPageCount > 0 && (
                <em className="dv-warn-badge">
                  {unknownPageCount} unmatched box{unknownPageCount === 1 ? "" : "es"} on content page
                  {contentPages.size === 1 ? "" : "s"} {contentPageLabel}
                </em>
              )}
              {numPages > 1 && pagesReliable && unknownPageCount > 0 && (
                <em className="dv-warn-badge">{unknownPageCount} page-unknown box{unknownPageCount === 1 ? "" : "es"}</em>
              )}
              {revalidating && <em className="dv-wait-badge">Revalidating regions</em>}
              {findingPages && <em className="dv-wait-badge">Finding pages</em>}
            </span>
          </div>
          <div className="docviewer-actions">
            <div className="dv-rotate-tools" aria-label="Rotate page">
              <button
                type="button"
                className="dv-icon-button"
                onClick={() => setRotation((value) => normalizeRotation(value - 90))}
                title="Rotate left"
                aria-label="Rotate left"
              >
                <RotateCcw size={16} />
              </button>
              <span>{rotation}°</span>
              <button
                type="button"
                className="dv-icon-button"
                onClick={() => setRotation((value) => normalizeRotation(value + 90))}
                title="Rotate right"
                aria-label="Rotate right"
              >
                <RotateCw size={16} />
              </button>
            </div>
            <button
              type="button"
              className="dv-revalidate-button"
              onClick={() => {
                // Real reset: drop any inferred page hints and re-derive placement from the data, then
                // re-render. Combined with the trust check this restores the every-page fallback.
                setPageHints({});
                setFindStatus("");
                setValidationTick((value) => value + 1);
              }}
              disabled={loading || revalidating}
              title="Revalidate regions"
            >
              <RefreshCw size={14} className={revalidating ? "spin" : ""} />
              Revalidate regions
            </button>
            <button
              type="button"
              className="dv-revalidate-button"
              onClick={findPagesByText}
              disabled={loading || findingPages || pageHintTargets.length === 0}
              title="Find matching pages with PDF text/OCR"
            >
              <Search size={14} className={findingPages ? "spin" : ""} />
              Find pages
            </button>
            {errorCount > 0 && (
              <label className="dv-toggle">
                <input type="checkbox" checked={errorsOnly} onChange={(e) => setErrorsOnly(e.target.checked)} />
                Errors only
              </label>
            )}
            {docs.length > 1 && (
              <select value={docIndex} onChange={(e) => setDocIndex(Number(e.target.value))} className="dv-doc-select">
                {docs.map((d, i) => (
                  <option key={d.label + i} value={i}>
                    {d.label}
                  </option>
                ))}
              </select>
            )}
            <button type="button" className="dv-close" onClick={onClose} aria-label="Close">
              <X size={18} />
            </button>
          </div>
        </header>

        <div className="docviewer-stage">
          {loading && (
            <div className="dv-status">
              <LoaderCircle className="spin" size={22} /> Loading document…
            </div>
          )}
          {error && (
            <div className="dv-status error">
              <AlertTriangle size={22} /> {error}
            </div>
          )}
          {!loading && !error && (
            <div className="dv-canvas-wrap" style={{ width: layout.width || undefined }}>
              <canvas ref={canvasRef} className="dv-canvas" />
              <div className="dv-overlay" style={{ width: layout.width, height: layout.height }}>
                {numPages > 1 && unknownPageCount > 0 && contentPages.size === 0 && (
                  <div className="dv-page-warning">
                    {pagesReliable ? (
                      <>
                        {unknownPageCount} region box{unknownPageCount === 1 ? "" : "es"} do not have page metadata and are shown on
                        every page.
                      </>
                    ) : (
                      <>
                        Page numbers in this document don’t reliably match its PDF pages, so all {unknownPageCount} region
                        box{unknownPageCount === 1 ? "" : "es"} are shown on every page. Use “Find pages” to locate them by content.
                      </>
                    )}
                  </div>
                )}
                {revalidating && (
                  <div className="dv-revalidate-status">
                    <LoaderCircle className="spin" size={16} /> Revalidating regions...
                  </div>
                )}
                {(findingPages || findStatus) && (
                  <div className="dv-ocr-status">
                    {findingPages && <LoaderCircle className="spin" size={16} />}
                    {findStatus || "Finding pages..."}
                  </div>
                )}
                {layout.ready && pageRegions.map((r, i) => {
                  const isActive = active && r.name === active;
                  const captureRegions = regionList(r.captureRegion).filter(
                    (region) =>
                      isRegionOnPage(region, pageNum, numPages, pageBase, contentPages) &&
                      !blankBoxKeys.has(boxGeomKey("capture", region))
                  );
                  const truthRegions = regionList(r.trueRegion).filter(
                    (region) =>
                      isRegionOnPage(region, pageNum, numPages, pageBase, contentPages) &&
                      !blankBoxKeys.has(boxGeomKey("truth", region))
                  );
                  const directRegions =
                    hasBox(r) &&
                    isRegionOnPage(r, pageNum, numPages, pageBase, contentPages) &&
                    !blankBoxKeys.has(boxGeomKey("region", r))
                      ? [r]
                      : [];
                  // Datasets that only export truth locations (no captured-location box) would otherwise
                  // draw every field — including errors — as a plain blue truth box. Color the truth box
                  // by status for error/warning fields so problems are visible even without a capture box.
                  const truthColor = r.kind === "error" || r.kind === "warning" ? KIND_COLOR[r.kind] : KIND_COLOR.truth;
                  return (
                    <Fragment key={`${r.name}-${i}`}>
                      {truthRegions.map((truthRegion, truthIndex) => (
                        <button
                          key={`truth-${truthIndex}`}
                          type="button"
                          className={`dv-box truth${isActive ? " active" : ""}`}
                          style={boxStyle(truthRegion, layout, truthColor)}
                          onClick={() => setActive(r.name)}
                          title={`Truth ${r.name}: ${r.trueValue ?? truthRegion.value ?? ""} — ${r.status || r.kind}${
                            hasUnknownPage(truthRegion) ? " - page unknown" : ""
                          }`}
                        >
                          <span className="dv-box-tag">TRUE {r.name}</span>
                        </button>
                      ))}
                      {captureRegions.map((captureRegion, captureIndex) => (
                        <button
                          key={`capture-${captureIndex}`}
                          type="button"
                          className={`dv-box${isActive ? " active" : ""}`}
                          style={boxStyle(captureRegion, layout, KIND_COLOR[r.kind] || KIND_COLOR.neutral)}
                          onClick={() => setActive(r.name)}
                          title={`${r.name}: ${r.value ?? ""} — ${r.status || r.kind}${
                            hasUnknownPage(captureRegion) ? " - page unknown" : ""
                          }`}
                        >
                          <span className="dv-box-tag">{r.name}</span>
                        </button>
                      ))}
                      {directRegions.map((directRegion, directIndex) => (
                        <button
                          key={`direct-${directIndex}`}
                          type="button"
                          className={`dv-box${isActive ? " active" : ""}`}
                          style={boxStyle(directRegion, layout, KIND_COLOR[r.kind] || KIND_COLOR.neutral)}
                          onClick={() => setActive(r.name)}
                          title={`${r.name}: ${r.value ?? ""} — ${r.status || r.kind}${
                            hasUnknownPage(directRegion) ? " - page unknown" : ""
                          }`}
                        >
                          <span className="dv-box-tag">{r.name}</span>
                        </button>
                      ))}
                    </Fragment>
                  );
                })}
              </div>
            </div>
          )}
        </div>

        <footer className="docviewer-foot">
          <div className="dv-legend">
            <span><i style={{ background: KIND_COLOR.error }} /> error</span>
            <span><i style={{ background: KIND_COLOR.warning }} /> warning</span>
            <span><i style={{ background: KIND_COLOR.success }} /> correct</span>
            <span><i style={{ background: "transparent", border: `2px dashed ${KIND_COLOR.truth}` }} /> truth</span>
          </div>
          {numPages > 1 && (
            <div className="dv-pager">
              <button type="button" onClick={() => setPageNum((p) => Math.max(1, p - 1))} disabled={pageNum === 1}>
                <ChevronLeft size={15} />
              </button>
              <span>Page {pageNum} / {numPages}</span>
              <button
                type="button"
                onClick={() => setPageNum((p) => Math.min(numPages, p + 1))}
                disabled={pageNum === numPages}
              >
                <ChevronRight size={15} />
              </button>
            </div>
          )}
        </footer>
      </div>
    </div>
  );
}

/**
 * DocumentViewer — modal that renders a source document page (from the BatchData export PDF,
 * via pdf.js) with the captured field regions drawn on top, colored by status. Built for
 * auditing: an "errors only" toggle spotlights region errors, and opening from a field row
 * focuses that field's box.
 *
 * Props:
 *   docs: Array<{ label, doc: { getArrayBuffer() }, regions: Array<{
 *           name, value, status, kind, page, left, top, right, bottom }> }>
 *   initialDocIndex?: number
 *   focusField?: string          // field Name to highlight/scroll to on open
 *   onClose: () => void
 */
import { AlertTriangle, ChevronLeft, ChevronRight, LoaderCircle, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import * as pdfjsLib from "pdfjs-dist";
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";

pdfjsLib.GlobalWorkerOptions.workerSrc = workerUrl;

// The export's region coordinates are OCR raster pixels. ancoraDocs rasterizes at 300 DPI, so
// a box maps to the rendered canvas by (renderScale * 72/300). Exposed as a constant in case a
// dataset uses a different capture resolution.
const OCR_DPI = 300;

const KIND_COLOR = { error: "#ef4444", warning: "#f59e0b", success: "#22c55e", neutral: "#6E6B5C" };

export default function DocumentViewer({ docs = [], initialDocIndex = 0, focusField = null, onClose }) {
  const [docIndex, setDocIndex] = useState(Math.min(initialDocIndex, Math.max(0, docs.length - 1)));
  const [pageNum, setPageNum] = useState(1);
  const [numPages, setNumPages] = useState(1);
  const [errorsOnly, setErrorsOnly] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [layout, setLayout] = useState({ width: 0, height: 0, overlayScale: 1 });
  const [active, setActive] = useState(focusField);

  const canvasRef = useRef(null);
  const pdfRef = useRef(null);
  const renderTaskRef = useRef(null);

  const current = docs[docIndex];
  const regions = current?.regions || [];

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
    pdfRef.current = null;

    (async () => {
      try {
        const buffer = await current.doc.getArrayBuffer();
        if (cancelled) return;
        const pdf = await pdfjsLib.getDocument({ data: buffer }).promise;
        if (cancelled) return;
        pdfRef.current = pdf;
        setNumPages(pdf.numPages);
        const focusRegion = focusField && regions.find((r) => r.name === focusField);
        setPageNum(Math.min(Math.max(1, (focusRegion?.page ?? 0) + 1), pdf.numPages));
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

    (async () => {
      try {
        const page = await pdf.getPage(pageNum);
        if (cancelled) return;
        const unit = page.getViewport({ scale: 1 });
        const targetWidth = Math.min(880, Math.max(520, window.innerWidth - 360));
        const scale = targetWidth / unit.width;
        const viewport = page.getViewport({ scale });
        const canvas = canvasRef.current;
        if (!canvas) return;
        canvas.width = Math.round(viewport.width);
        canvas.height = Math.round(viewport.height);
        // The overlay geometry is fully known here — commit it before the async raster render so
        // the field boxes are positioned even while the page is still painting (and regardless of
        // a StrictMode double-invoke cancelling the render task).
        setLayout({ width: canvas.width, height: canvas.height, overlayScale: (scale * 72) / OCR_DPI });
        task = page.render({ canvasContext: canvas.getContext("2d"), viewport });
        renderTaskRef.current = task;
        await task.promise;
      } catch (err) {
        if (!cancelled && err?.name !== "RenderingCancelledException") {
          setError(err?.message || "Failed to render page.");
        }
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
  }, [pageNum, loading, docIndex]);

  // Regions for the current page (pdf pages are 1-based; region.page is 0-based).
  const pageRegions = useMemo(
    () =>
      regions.filter((r) => (r.page ?? 0) + 1 === pageNum && (!errorsOnly || r.kind === "error")),
    [regions, pageNum, errorsOnly]
  );

  const errorCount = useMemo(() => regions.filter((r) => r.kind === "error").length, [regions]);

  return (
    <div className="docviewer-backdrop" onClick={onClose}>
      <div className="docviewer" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true">
        <header className="docviewer-head">
          <div className="docviewer-title">
            <strong>{current?.label || "Document"}</strong>
            <span>
              {regions.length} field{regions.length === 1 ? "" : "s"}
              {errorCount > 0 && <em className="dv-err-badge">{errorCount} region error{errorCount === 1 ? "" : "s"}</em>}
            </span>
          </div>
          <div className="docviewer-actions">
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
                {pageRegions.map((r, i) => {
                  const s = layout.overlayScale;
                  const isActive = active && r.name === active;
                  return (
                    <button
                      type="button"
                      key={`${r.name}-${i}`}
                      className={`dv-box${isActive ? " active" : ""}`}
                      style={{
                        left: r.left * s,
                        top: r.top * s,
                        width: (r.right - r.left) * s,
                        height: (r.bottom - r.top) * s,
                        "--box": KIND_COLOR[r.kind] || KIND_COLOR.neutral
                      }}
                      onClick={() => setActive(r.name)}
                      title={`${r.name}: ${r.value ?? ""} — ${r.status || r.kind}`}
                    >
                      <span className="dv-box-tag">{r.name}</span>
                    </button>
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

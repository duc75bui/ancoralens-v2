/**
 * DetailsReport — dense field-level report table built from the detailed CSV.
 * Features: training-pass filter, assignable/compact toggles, search, column chooser,
 * pagination, batch -> field -> line-item expansion, and CSV export. Heavy UI state is
 * persisted via savedState/onStateChange (wired to App.viewMemory).
 */
import {
  AlertTriangle,
  Columns3,
  ChevronDown,
  ChevronRight,
  Download,
  Expand,
  FileImage,
  Filter,
  Minimize2,
  Maximize2,
  Search,
  Table2
} from "lucide-react";
import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { downloadCsv } from "../utils/csv.js";
import DocumentViewer from "./DocumentViewer.jsx";
import { findJsonFieldRegion, parseCaptureLocation, resolveDoc, resolveDocDetailed } from "../utils/batchImages.js";
import {
  buildDetailModel,
  countLineItems,
  countProblems,
  groupLineItems,
  isAssignableField,
  isLineItemField,
  statusBackground,
  statusColor,
  statusKind
} from "../utils/parsers.js";

const PAGE_SIZE = 2000;
const DEFAULT_VISIBLE_COLUMNS = [
  "SourceDocId",
  "BatchId",
  "InputFileName",
  "FieldName",
  "TrueValue",
  "CapturedValue",
  "FieldStatus",
  "TrainingPass",
  "BatchName",
  "DocumentType",
  "CapturedPage",
  "Confidence",
  "CaptureLocation"
];

function defaultVisibleColumns(allColumns = []) {
  const preferred = DEFAULT_VISIBLE_COLUMNS.filter((column) => allColumns.includes(column));
  const remaining = allColumns.filter((column) => !preferred.includes(column));
  return [...preferred, ...remaining].slice(0, Math.min(15, allColumns.length));
}

function normalizeTrainingPass(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/training\s*pass/g, "")
    .replace(/\bpass\b/g, "")
    .replace(/[^a-z0-9]/g, "");
}

function findTrainingPassMatch(requested, options = []) {
  if (!requested) return null;
  if (options.includes(requested)) return requested;

  const normalizedRequest = normalizeTrainingPass(requested);
  if (!normalizedRequest) return null;

  return (
    options.find((option) => normalizeTrainingPass(option) === normalizedRequest) ||
    options.find((option) => {
      const normalizedOption = normalizeTrainingPass(option);
      return normalizedOption && (normalizedOption.includes(normalizedRequest) || normalizedRequest.includes(normalizedOption));
    }) ||
    null
  );
}

function problemBadge(counts) {
  if (counts.errors > 0) return { label: `${counts.errors} error${counts.errors > 1 ? "s" : ""}`, className: "error" };
  if (counts.warnings > 0) return { label: `${counts.warnings} warning${counts.warnings > 1 ? "s" : ""}`, className: "warning" };
  return null;
}

// Severity filter for the report toolbar: "all" keeps everything, "errors" keeps only
// error fields, "warnings" keeps both warnings and errors. Mirrors countProblems' status
// resolution so the filter and the problem badges agree on what counts as an error/warning.
function matchesSeverity(row, severity) {
  if (severity === "all") return true;
  const kind = statusKind(row.FieldStatus || row.Status || row.Result || "");
  return severity === "errors" ? kind === "error" : kind === "error" || kind === "warning";
}

function isFinitePage(value) {
  if (value == null || value === "") return false;
  const number = Number(value);
  return Number.isFinite(number) && number >= 0;
}

function withFallbackPage(region, fallback) {
  if (!region) return null;
  const hasRegionPage = isFinitePage(region.page);
  const hasRegionBase = isFinitePage(region.pageBase);
  const hasFallbackPage = isFinitePage(fallback?.page);
  const hasFallbackBase = isFinitePage(fallback?.pageBase);

  if (!hasRegionBase && hasFallbackPage && hasFallbackBase) {
    return { ...region, page: fallback.page, pageBase: fallback.pageBase };
  }

  return {
    ...region,
    page: hasRegionPage ? region.page : null,
    pageBase: hasRegionBase ? region.pageBase : null
  };
}

function sameRegion(left, right) {
  if (!left || !right) return false;
  return ["page", "left", "top", "right", "bottom"].every((key) => Math.round(Number(left[key])) === Math.round(Number(right[key])));
}

function regionWithField(region, row) {
  if (!region) return null;
  return {
    ...region,
    name: row.FieldName,
    value: row.CapturedValue || row.Value,
    trueValue: row.TrueValue,
    status: row.FieldStatus || row.Status || row.Result || ""
  };
}

function rowRegions(row, doc) {
  // Page columns are 0-based (0 = first page, -1 = unassigned). Accept the common name variants.
  const truePage = row.TruePage ?? row.TruepageIndex ?? row.TruePageIndex;
  const capturedPage = row.CapturedPage ?? row.CapturePage ?? row.CapturedPageIndex;
  const trueCsv = parseCaptureLocation(row.TrueLocation, truePage);
  const trueJson = doc?.trueData ? findJsonFieldRegion(doc, row.FieldName, "trueData") : null;
  const trueRegion = withFallbackPage(trueCsv || trueJson, trueJson);

  const capturedCsv = parseCaptureLocation(row.CaptureLocation, capturedPage);
  const capturedJson = findJsonFieldRegion(doc, row.FieldName, "capturedData");
  const capturedRegion = withFallbackPage(capturedCsv || capturedJson, capturedJson || trueRegion);

  return { capturedRegion, trueRegion };
}

// Identity a report row carries for matching its source PDF: the {batchId}/{docId} GUID pair is
// authoritative; SourceDocId and InputFileName are fallbacks (filenames are NOT distinct).
function docKeyOf(row) {
  return {
    inputFileName: row?.InputFileName,
    sourceDocId: row?.SourceDocId,
    docId: row?.DocId,
    batchId: row?.BatchId
  };
}

function rowHasLocatableRegion(imageIndex, row) {
  const doc = resolveDoc(imageIndex, docKeyOf(row));
  if (!doc) return false;
  const { capturedRegion, trueRegion } = rowRegions(row, doc);
  return Boolean(capturedRegion || trueRegion);
}

function LineItemsTable({ lineItems, assignableOnly = false }) {
  const [expanded, setExpanded] = useState({});
  const { lines, columns } = useMemo(() => groupLineItems(lineItems), [lineItems]);

  if (!lines.length) {
    return <div className="empty-note">No parsable line items found.</div>;
  }

  const visibleColumns = assignableOnly
    ? columns.filter((column) => lines.some((line) => isAssignableField(line.fields[column] || {})))
    : columns;

  return (
    <div className="line-items-table">
      <table>
        <thead>
          <tr>
            <th>Line #</th>
            {visibleColumns.map((column) => (
              <th key={column}>{column}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {lines.map((line) => {
            const isOpen = Boolean(expanded[line.index]);
            const counts = countProblems(Object.values(line.fields), assignableOnly);
            const rowClass = counts.errors ? "row-error" : counts.warnings ? "row-warning" : "";

            return (
              <Fragment key={line.index}>
                <tr
                  className={rowClass}
                  onClick={() => setExpanded((current) => ({ ...current, [line.index]: !current[line.index] }))}
                >
                  <td className="line-title">
                    {isOpen ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                    Line {line.index}
                  </td>
                  {visibleColumns.map((column) => {
                    const field = line.fields[column];
                    return <td key={column}>{field ? field.CapturedValue || field.Value || "-" : <span className="muted-cell">-</span>}</td>;
                  })}
                </tr>

                {isOpen && (
                  <tr className="line-detail-row">
                    <td colSpan={visibleColumns.length + 1}>
                      <table className="line-detail-table">
                        <thead>
                          <tr>
                            <th>Field</th>
                            <th>True Value</th>
                            <th>Captured Value</th>
                            <th>Conf %</th>
                            <th>Status</th>
                            <th>Coords</th>
                            <th>Page</th>
                          </tr>
                        </thead>
                        <tbody>
                          {visibleColumns.map((column) => {
                            const field = line.fields[column];
                            if (!field) return null;

                            const status = field.FieldStatus || "";
                            const active = !assignableOnly || isAssignableField(field);
                            const kind = active ? statusKind(status) : "neutral";

                            return (
                              <tr key={column} className={kind === "error" ? "row-error-soft" : kind === "warning" ? "row-warning-soft" : ""}>
                                <td>{column}</td>
                                <td>{field.TrueValue}</td>
                                <td>{field.CapturedValue}</td>
                                <td>{field.Confidence}</td>
                                <td style={{ color: statusColor(status) }}>{status}</td>
                                <td className="mono-cell">{field.CaptureLocation}</td>
                                <td>{field.CapturedPage}</td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </td>
                  </tr>
                )}
              </Fragment>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export default function DetailsReport({ data, imageIndex = null, savedState = {}, onStateChange }) {
  const [query, setQuery] = useState(() => savedState.query || "");
  const [trainingPass, setTrainingPass] = useState(() => savedState.trainingPass || "all");
  const [assignableOnly, setAssignableOnly] = useState(() => Boolean(savedState.assignableOnly));
  const [severity, setSeverity] = useState(() => savedState.severity || "all");
  const [compact, setCompact] = useState(() => Boolean(savedState.compact));
  const [showColumnMenu, setShowColumnMenu] = useState(false);
  const [visibleColumns, setVisibleColumns] = useState(() => savedState.visibleColumns || null);
  const [expandedBatches, setExpandedBatches] = useState(() => savedState.expandedBatches || {});
  const [expandedLineItems, setExpandedLineItems] = useState(() => savedState.expandedLineItems || {});
  const [sort, setSort] = useState(() => savedState.sort || { key: null, direction: "asc" });
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(() => savedState.page || 1);
  const [viewer, setViewer] = useState(null);
  const [openingViewer, setOpeningViewer] = useState(false);
  const [model, setModel] = useState({
    allColumns: [],
    trainingPasses: [],
    batches: [],
    filteredRows: []
  });
  const didMountFilterReset = useRef(false);

  useEffect(() => {
    setLoading(true);
    const handle = window.setTimeout(() => {
      const nextModel = buildDetailModel(data || []);
      setModel(nextModel);
      setVisibleColumns(savedState.visibleColumns || null);
      setExpandedBatches(
        savedState.expandedBatches && Object.keys(savedState.expandedBatches).length
          ? savedState.expandedBatches
          : nextModel.batches[0]
            ? { [nextModel.batches[0].id]: true }
            : {}
      );
      setExpandedLineItems(savedState.expandedLineItems || {});
      setLoading(false);
      setPage(savedState.page || 1);
    }, 150);

    return () => window.clearTimeout(handle);
  }, [data]);

  useEffect(() => {
    if (!savedState.requestedTrainingPass || !model.trainingPasses.length) return;

    const requestedMatch = findTrainingPassMatch(savedState.requestedTrainingPass, model.trainingPasses);
    if (requestedMatch && requestedMatch !== trainingPass) {
      const firstMatchingRow = model.filteredRows.find(
        (row) => String(row.TrainingPass || row.Pass || row.trainingPass || "") === requestedMatch
      );
      const firstBatchId = firstMatchingRow?.BatchId || firstMatchingRow?.BatchName;

      setTrainingPass(requestedMatch);
      if (firstBatchId) {
        setExpandedBatches({ [firstBatchId]: true });
        setExpandedLineItems({});
      }
      setPage(1);
    }
    onStateChange?.({ requestedTrainingPass: null });
  }, [savedState.requestedTrainingPass, model.trainingPasses, trainingPass]);

  useEffect(() => {
    if (!model.allColumns.length) return;
    setVisibleColumns((current) => {
      if (current?.length) return current.filter((column) => model.allColumns.includes(column));
      return defaultVisibleColumns(model.allColumns);
    });
  }, [model.allColumns]);

  useEffect(() => {
    onStateChange?.({
      query,
      trainingPass,
      assignableOnly,
      severity,
      compact,
      visibleColumns,
      expandedBatches,
      expandedLineItems,
      sort,
      page
    });
  }, [query, trainingPass, assignableOnly, severity, compact, visibleColumns, expandedBatches, expandedLineItems, sort, page]);

  const filteredRows = useMemo(() => {
    let rows = model.filteredRows;

    if (trainingPass !== "all") {
      rows = rows.filter((row) => String(row.TrainingPass || row.Pass || row.trainingPass || "") === trainingPass);
    }

    if (assignableOnly) rows = rows.filter(isAssignableField);

    if (severity !== "all") rows = rows.filter((row) => matchesSeverity(row, severity));

    if (query.trim()) {
      const needle = query.toLowerCase();
      rows = rows.filter((row) => Object.values(row).some((value) => String(value).toLowerCase().includes(needle)));
    }

    if (sort.key) {
      rows = [...rows].sort((left, right) => {
        const leftValue = left[sort.key] || "";
        const rightValue = right[sort.key] || "";
        if (leftValue < rightValue) return sort.direction === "asc" ? -1 : 1;
        if (leftValue > rightValue) return sort.direction === "asc" ? 1 : -1;
        return 0;
      });
    }

    return rows;
  }, [model.filteredRows, trainingPass, assignableOnly, severity, query, sort]);

  useEffect(() => {
    if (didMountFilterReset.current) {
      setPage(1);
    } else {
      didMountFilterReset.current = true;
    }
  }, [query, trainingPass, assignableOnly, severity, sort]);

  const totalPages = Math.max(1, Math.ceil(filteredRows.length / PAGE_SIZE));

  useEffect(() => {
    if (page > totalPages) setPage(totalPages);
  }, [page, totalPages]);

  const pageRows = filteredRows.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  const displayedColumns = visibleColumns?.length ? visibleColumns : model.allColumns;

  const pageBatchGroups = useMemo(() => {
    const groups = {};
    pageRows.forEach((row) => {
      const batchId = row.BatchId || row.BatchName || "Unknown_Batch";
      if (!groups[batchId]) groups[batchId] = [];
      groups[batchId].push(row);
    });
    return groups;
  }, [pageRows]);

  const pageBatchIds = Object.keys(pageBatchGroups);
  const getLineItems = (batchId) => {
    const batch = model.batches.find((item) => item.id === batchId);
    if (!batch) return [];
    let items = batch.lineItemRows;
    if (trainingPass !== "all") {
      items = items.filter((row) => String(row.TrainingPass || row.Pass || row.trainingPass || "") === trainingPass);
    }
    if (severity !== "all") items = items.filter((row) => matchesSeverity(row, severity));
    return items;
  };

  // Whether a batch's document is available in the loaded images zip (cheap lookup on one row).
  const batchHasImage = (sampleRow) => Boolean(imageIndex) && Boolean(resolveDoc(imageIndex, docKeyOf(sampleRow)));

  // Build the DocumentViewer payload for a batch: every captured field grouped by its document,
  // each resolved to a PDF in the zip (by GUID pair, not filename), with parsed region boxes colored
  // by status. Async because each matched doc's CapturedData/TrueData JSON is read lazily on open
  // (huge archives don't pre-read tens of thousands of JSON blobs).
  const buildViewerDocs = async (batchId) => {
    const batch = model.batches.find((item) => item.id === batchId);
    if (!batch) return [];
    const allRows = [...batch.rows, ...batch.lineItemRows];
    const groups = {};
    allRows.forEach((row) => {
      // Group by the document's GUID so rows for distinct docs that happen to share a filename
      // (e.g. several "generatedByQASuite.pdf") don't collapse into one viewer entry.
      const key = row.DocId || row.SourceDocId || `${row.BatchId || ""}|${row.InputFileName || "document"}`;
      (groups[key] ||= []).push(row);
    });

    const built = [];
    for (const rows of Object.values(groups)) {
      const sample = rows[0];
      const match = resolveDocDetailed(imageIndex, docKeyOf(sample));
      if (!match) continue;
      const { doc, approximate } = match;
      await doc.loadMetadata?.(); // ensure JSON-region fallback is available before reading regions
      const regions = rows
        .map((row) => {
          const { capturedRegion, trueRegion } = rowRegions(row, doc);
          if (!capturedRegion && !trueRegion) return null;
          const status = row.FieldStatus || row.Status || row.Result || "";
          const kind = statusKind(status);
          return {
            name: row.FieldName,
            value: row.CapturedValue || row.Value,
            trueValue: row.TrueValue,
            status,
            kind,
            captureRegion: regionWithField(capturedRegion, row),
            trueRegion: trueRegion && !sameRegion(capturedRegion, trueRegion) ? regionWithField(trueRegion, row) : null
          };
        })
        .filter(Boolean);
      built.push({ label: doc.fileName, doc, regions, approximate });
    }
    return built;
  };

  const openViewer = async (batchId, focusRow = null) => {
    setOpeningViewer(true);
    try {
      const docs = await buildViewerDocs(batchId);
      if (!docs.length) return;
      let initialDocIndex = 0;
      let focusField = null;
      if (focusRow) {
        const target = String(focusRow.InputFileName || "").toLowerCase();
        const targetDocId = String(focusRow.DocId || focusRow.SourceDocId || "");
        const idx = docs.findIndex((d) => (targetDocId && d.doc.docId === targetDocId) || d.label.toLowerCase() === target);
        if (idx >= 0) initialDocIndex = idx;
        focusField = focusRow.FieldName;
      }
      setViewer({ docs, initialDocIndex, focusField });
    } catch (exception) {
      console.warn("Could not open document viewer", exception?.message);
    } finally {
      setOpeningViewer(false);
    }
  };

  const toggleSort = (column) => {
    setSort((current) => ({
      key: column,
      direction: current.key === column && current.direction === "asc" ? "desc" : "asc"
    }));
  };

  const expandAll = () => {
    setExpandedBatches(Object.fromEntries(pageBatchIds.map((id) => [id, true])));
  };

  const collapseAll = () => {
    setExpandedBatches({});
  };

  const expandAllLineItems = () => {
    setExpandedLineItems(Object.fromEntries(pageBatchIds.map((id) => [id, true])));
  };

  const expandSummary = () => {
    setExpandedBatches(Object.fromEntries(pageBatchIds.slice(0, 10).map((id) => [id, true])));
    setExpandedLineItems({});
  };

  const expandEverything = () => {
    expandAll();
    expandAllLineItems();
  };

  const toggleColumn = (column) => {
    setVisibleColumns((current) => {
      const selected = current?.length ? current : model.allColumns;
      if (selected.includes(column)) {
        if (selected.length === 1) return selected;
        return selected.filter((item) => item !== column);
      }
      return [...selected, column];
    });
  };

  const selectAllColumns = () => setVisibleColumns(model.allColumns);
  const resetColumns = () => {
    setVisibleColumns(defaultVisibleColumns(model.allColumns));
  };

  if (!data || data.length === 0) {
    return (
      <section className="glass-panel empty-state">
        <AlertTriangle size={48} />
        <h3>No Detailed Report Loaded</h3>
        <p>Upload a detailed report CSV.</p>
      </section>
    );
  }

  if (loading) {
    return (
      <section className="glass-panel empty-state">
        <Table2 size={44} />
        <h3>Preparing Detailed Report</h3>
        <p>Indexing batches and line items...</p>
      </section>
    );
  }

  return (
    <div className={`fade-in details-view ${compact ? "compact" : ""}`}>
      <div className="hero" style={{ marginBottom: 18 }}>
        <div>
          <div className="eyebrow">
            <span className="dot" /> {model.batches.length.toLocaleString()} batches · page {page.toLocaleString()} of{" "}
            {totalPages.toLocaleString()}
          </div>
          <h1 style={{ fontSize: "clamp(34px,4.5vw,56px)" }}>Detailed report</h1>
          <p className="sub">Browse, filter and audit every extracted field with its full validation trace.</p>
        </div>
      </div>

      <div className="details-toolbar glass-panel">
        <div className="details-top-controls">
          <Filter size={16} color="var(--text-muted)" />
          <label className="details-top-select">
            <select value={trainingPass} onChange={(event) => setTrainingPass(event.target.value)}>
              <option value="all">All Passes ({model.trainingPasses.length || 0})</option>
              {model.trainingPasses.map((pass) => (
                <option key={pass} value={pass}>
                  {pass}
                </option>
              ))}
            </select>
          </label>
          <label className="details-top-select">
            <select value={severity} onChange={(event) => setSeverity(event.target.value)}>
              <option value="all">All Fields</option>
              <option value="warnings">Warnings &amp; Errors</option>
              <option value="errors">Errors Only</option>
            </select>
          </label>
          <label className="details-chip">
            <input
              type="checkbox"
              checked={assignableOnly}
              onChange={(event) => setAssignableOnly(event.target.checked)}
            />
            Assignable Only
          </label>
          <label className="details-chip">
            <input type="checkbox" checked={compact} onChange={(event) => setCompact(event.target.checked)} />
            Compact
          </label>
          <label className="details-filter-input">
            <Search size={16} />
            <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Filter..." />
          </label>
          <button type="button" className="details-pill-button" onClick={expandSummary}>
            <Expand size={14} />
            Summary
          </button>
          <button type="button" className="details-pill-button" onClick={expandEverything}>
            <Maximize2 size={14} />
            All
          </button>
          <button type="button" className="details-icon-button" onClick={collapseAll} title="Collapse batches">
            <Minimize2 size={14} />
          </button>
          <div className="columns-menu-wrap">
            <button type="button" className="details-pill-button" onClick={() => setShowColumnMenu((current) => !current)}>
              <Columns3 size={14} />
              Columns <span>{displayedColumns.length}</span>
            </button>
            {showColumnMenu && (
              <div className="columns-menu">
                <div className="columns-menu-header">
                  <strong>Visible Columns</strong>
                  <span>{displayedColumns.length} / {model.allColumns.length}</span>
                </div>
                <div className="columns-menu-actions">
                  <button type="button" onClick={selectAllColumns}>All</button>
                  <button type="button" onClick={resetColumns}>Default</button>
                </div>
                <div className="columns-menu-list">
                  {model.allColumns.map((column) => (
                    <label key={column}>
                      <input
                        type="checkbox"
                        checked={displayedColumns.includes(column)}
                        onChange={() => toggleColumn(column)}
                      />
                      <span>{column}</span>
                    </label>
                  ))}
                </div>
              </div>
            )}
          </div>
          <button type="button" className="details-pill-button" onClick={() => downloadCsv(filteredRows, "detailed_report_filtered.csv")}>
            <Download size={14} />
            Export
          </button>
        </div>
      </div>

      {totalPages > 1 && (
        <div className="details-pagination">
          <button type="button" onClick={() => setPage(1)} disabled={page === 1}>
            «
          </button>
          <button type="button" onClick={() => setPage((current) => Math.max(1, current - 1))} disabled={page === 1}>
            Prev
          </button>
          <span>
            {page} / {totalPages}
          </span>
          <button
            type="button"
            onClick={() => setPage((current) => Math.min(totalPages, current + 1))}
            disabled={page === totalPages}
          >
            Next
          </button>
          <button type="button" onClick={() => setPage(totalPages)} disabled={page === totalPages}>
            »
          </button>
        </div>
      )}

      <section className="glass-panel details-table-shell">
        <table className="details-table">
          <thead>
            <tr>
              <th className="expander-col" />
              {displayedColumns.map((column) => (
                <th key={column} onClick={() => toggleSort(column)} className={sort.key === column ? "sorted" : ""}>
                  {column}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {Object.entries(pageBatchGroups).map(([batchId, rows]) => {
              const lineItems = getLineItems(batchId);
              // Line-item fields (IL_*:n*) live only in the Line Items node, never the main rows.
              const headerRows = rows.filter((row) => !isLineItemField(row));
              // Number of actual invoice lines (distinct ":index"), not raw field-row count.
              const lineCount = countLineItems(lineItems);
              const open = Boolean(expandedBatches[batchId]);
              const lineOpen = Boolean(expandedLineItems[batchId]);
              const rowProblems = countProblems(assignableOnly ? headerRows.filter(isAssignableField) : headerRows);
              const lineProblems = countProblems(lineItems, assignableOnly);
              const totalProblems = {
                errors: rowProblems.errors + lineProblems.errors,
                warnings: rowProblems.warnings + lineProblems.warnings
              };
              const badge = problemBadge(totalProblems);
              const hasImage = batchHasImage(headerRows[0] || rows[0]);

              return (
                <Fragment key={batchId}>
                  <tr className={`batch-row ${totalProblems.errors ? "row-error" : totalProblems.warnings ? "row-warning" : ""}`}>
                    <td onClick={() => setExpandedBatches((current) => ({ ...current, [batchId]: !current[batchId] }))}>
                      {open ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
                    </td>
                    <td colSpan={displayedColumns.length} onClick={() => setExpandedBatches((current) => ({ ...current, [batchId]: !current[batchId] }))}>
                      <strong>{batchId}</strong>
                      <span>
                        ({headerRows.length} fields{lineItems.length ? ` / ${lineCount} line items` : ""})
                      </span>
                      {badge && <em className={`problem-badge ${badge.className}`}>{badge.label}</em>}
                      {hasImage && (
                        <button
                          type="button"
                          className="view-doc-button"
                          onClick={(event) => {
                            event.stopPropagation();
                            openViewer(batchId);
                          }}
                          title="View source document with field regions"
                        >
                          <FileImage size={13} />
                          View document
                        </button>
                      )}
                    </td>
                  </tr>

                  {open &&
                    headerRows.map((row, index) => {
                      const locatable = hasImage && rowHasLocatableRegion(imageIndex, row);
                      return (
                        <tr
                          key={`${batchId}-${index}`}
                          style={{ background: statusBackground(row), cursor: locatable ? "pointer" : undefined }}
                          onClick={locatable ? () => openViewer(batchId, row) : undefined}
                          title={locatable ? "Locate this field on the document" : undefined}
                        >
                          <td />
                          {displayedColumns.map((column) => (
                            <td key={column} className={column === "FieldStatus" ? "status-cell" : ""} style={{ color: column === "FieldStatus" ? statusColor(row[column]) : undefined }}>
                              {row[column]}
                            </td>
                          ))}
                        </tr>
                      );
                    })}

                  {open && lineItems.length > 0 && (
                    <tr className="line-items-row">
                      <td />
                      <td colSpan={displayedColumns.length}>
                        <button
                          type="button"
                          className="line-items-toggle"
                          onClick={() => setExpandedLineItems((current) => ({ ...current, [batchId]: !current[batchId] }))}
                        >
                          {lineOpen ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                          Line Items ({lineCount})
                          {lineProblems.errors > 0 && <em className="problem-badge error">{lineProblems.errors} errors</em>}
                          {lineProblems.warnings > 0 && <em className="problem-badge warning">{lineProblems.warnings} warnings</em>}
                        </button>
                        {lineOpen && <LineItemsTable lineItems={lineItems} assignableOnly={assignableOnly} />}
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </section>

      {openingViewer && !viewer && (
        <div className="dv-opening-overlay">
          <div className="dv-opening-card">
            <span className="dv-spinner" />
            Opening document…
          </div>
        </div>
      )}

      {viewer && (
        <DocumentViewer
          docs={viewer.docs}
          initialDocIndex={viewer.initialDocIndex}
          focusField={viewer.focusField}
          onClose={() => setViewer(null)}
        />
      )}
    </div>
  );
}

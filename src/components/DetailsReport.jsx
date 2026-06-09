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
  Filter,
  Minimize2,
  Maximize2,
  Search,
  Table2
} from "lucide-react";
import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { downloadCsv } from "../utils/csv.js";
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

export default function DetailsReport({ data, savedState = {}, onStateChange }) {
  const [query, setQuery] = useState(() => savedState.query || "");
  const [trainingPass, setTrainingPass] = useState(() => savedState.trainingPass || "all");
  const [assignableOnly, setAssignableOnly] = useState(() => Boolean(savedState.assignableOnly));
  const [compact, setCompact] = useState(() => Boolean(savedState.compact));
  const [showColumnMenu, setShowColumnMenu] = useState(false);
  const [visibleColumns, setVisibleColumns] = useState(() => savedState.visibleColumns || null);
  const [expandedBatches, setExpandedBatches] = useState(() => savedState.expandedBatches || {});
  const [expandedLineItems, setExpandedLineItems] = useState(() => savedState.expandedLineItems || {});
  const [sort, setSort] = useState(() => savedState.sort || { key: null, direction: "asc" });
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(() => savedState.page || 1);
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
      compact,
      visibleColumns,
      expandedBatches,
      expandedLineItems,
      sort,
      page
    });
  }, [query, trainingPass, assignableOnly, compact, visibleColumns, expandedBatches, expandedLineItems, sort, page]);

  const filteredRows = useMemo(() => {
    let rows = model.filteredRows;

    if (trainingPass !== "all") {
      rows = rows.filter((row) => String(row.TrainingPass || row.Pass || row.trainingPass || "") === trainingPass);
    }

    if (assignableOnly) rows = rows.filter(isAssignableField);

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
  }, [model.filteredRows, trainingPass, assignableOnly, query, sort]);

  useEffect(() => {
    if (didMountFilterReset.current) {
      setPage(1);
    } else {
      didMountFilterReset.current = true;
    }
  }, [query, trainingPass, assignableOnly, sort]);

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
    if (trainingPass === "all") return batch.lineItemRows;
    return batch.lineItemRows.filter((row) => String(row.TrainingPass || row.Pass || row.trainingPass || "") === trainingPass);
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

  const collapseAllLineItems = () => {
    setExpandedLineItems({});
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
                    </td>
                  </tr>

                  {open &&
                    headerRows.map((row, index) => (
                      <tr key={`${batchId}-${index}`} style={{ background: statusBackground(row) }}>
                        <td />
                        {displayedColumns.map((column) => (
                          <td key={column} className={column === "FieldStatus" ? "status-cell" : ""} style={{ color: column === "FieldStatus" ? statusColor(row[column]) : undefined }}>
                            {row[column]}
                          </td>
                        ))}
                      </tr>
                    ))}

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
    </div>
  );
}

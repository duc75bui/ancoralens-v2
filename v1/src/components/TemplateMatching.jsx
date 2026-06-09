import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Copy,
  FileText,
  FolderOpen,
  Grid3X3,
  Layers,
  Search,
  XCircle
} from "lucide-react";
import { Fragment, memo, useCallback, useEffect, useMemo, useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis
} from "recharts";
import { numericValue } from "../utils/parsers.js";

function numberFormat(value) {
  return Number(value || 0).toLocaleString();
}

function summarizeBatchForDocuments(batch, documents) {
  const totals = documents.reduce(
    (summary, doc) => {
      summary.totalPages += doc.pages.length;
      summary.matchedPages += numericValue(doc.matchedPages);
      summary.unmatchedPages += numericValue(doc.unmatchedPages);
      return summary;
    },
    { totalPages: 0, matchedPages: 0, unmatchedPages: 0 }
  );

  return {
    ...batch,
    documents,
    totalPages: totals.totalPages,
    matchedPages: totals.matchedPages,
    unmatchedPages: totals.unmatchedPages,
    matchRate: totals.totalPages > 0 ? ((totals.matchedPages / totals.totalPages) * 100).toFixed(1) : "0.0"
  };
}

function KpiCard({ label, value, detail, icon, color }) {
  return (
    <section className="glass-panel template-kpi" style={{ borderTopColor: color }}>
      <div>
        <span>{label}</span>
        <strong style={{ color }}>{value}</strong>
        <em>{detail}</em>
      </div>
      <div className="template-kpi-icon" style={{ color }}>
        {icon}
      </div>
    </section>
  );
}

function CoveragePanel({ summary }) {
  const coverage = Math.max(0, Math.min(100, numericValue(summary.matchRate)));

  return (
    <section className="glass-panel template-panel template-coverage-panel">
      <h3>
        <CheckCircle2 size={20} color="#10b981" />
        Template Coverage
      </h3>
      <div className="template-css-donut" style={{ "--coverage": `${coverage}%` }}>
        <div className="template-donut-hole">
          <strong>{summary.matchRate}%</strong>
          <span>Coverage</span>
        </div>
      </div>
      <div className="template-legend">
        <span>
          <i style={{ background: "#10b981" }} />
          Matched: {numberFormat(summary.matchedPages)}
        </span>
        <span>
          <i style={{ background: "#ef4444" }} />
          Unmatched: {numberFormat(summary.unmatchedPages)}
        </span>
      </div>
    </section>
  );
}

function FrequencyPanel({ templates }) {
  const chartData = useMemo(() => {
    const top = templates.slice(0, 12);
    const rest = templates.slice(12);
    const otherCount = rest.reduce((sum, item) => sum + numericValue(item.count), 0);
    return otherCount > 0 ? [...top, { id: `Other (${rest.length})`, count: otherCount }] : top;
  }, [templates]);

  return (
    <section className="glass-panel template-panel template-frequency-panel">
      <h3>
        <Layers size={20} color="#8b5cf6" />
        Template Usage Frequency
      </h3>
      <ResponsiveContainer width="100%" height={330}>
        <BarChart data={chartData} layout="vertical" margin={{ left: 110, right: 32, top: 8, bottom: 12 }}>
          <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="rgba(148,163,184,0.16)" />
          <XAxis type="number" tick={{ fill: "#64748b", fontSize: 11 }} />
          <YAxis
            dataKey="id"
            type="category"
            width={118}
            tick={{ fill: "#cbd5e1", fontSize: 10 }}
            tickFormatter={(value) => (String(value).length > 18 ? `${String(value).slice(0, 18)}...` : value)}
          />
          <Tooltip contentStyle={{ background: "var(--bg-tooltip)", borderColor: "var(--glass-border)" }} />
          <Bar dataKey="count" radius={[0, 5, 5, 0]} fill="#8b5cf6" />
        </BarChart>
      </ResponsiveContainer>
    </section>
  );
}

function CopyButton({ value }) {
  const [copied, setCopied] = useState(false);

  const copy = async (event) => {
    event.stopPropagation();
    if (!value) return;

    const text = String(value);
    try {
      const textarea = document.createElement("textarea");
      textarea.value = text;
      textarea.setAttribute("readonly", "");
      textarea.style.position = "fixed";
      textarea.style.left = "-9999px";
      textarea.style.top = "0";
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand("copy");
      document.body.removeChild(textarea);
    } catch {
      // The async Clipboard API below is still attempted as a best-effort fallback.
    }

    setCopied(true);
    window.setTimeout(() => setCopied(false), 1000);
    navigator.clipboard?.writeText(text).catch(() => {});
  };

  return (
    <button
      type="button"
      className="template-copy-button"
      onClick={copy}
      onPointerDown={(event) => event.stopPropagation()}
      disabled={!value}
    >
      <Copy size={12} />
      {copied ? "Copied" : "Copy"}
    </button>
  );
}

function PagePopover({ batch, doc, page }) {
  return (
    <div className="template-page-popover">
      <h4>
        <CheckCircle2 size={16} color={page.hasTemplate ? "#10b981" : "#ef4444"} />
        Page {page.pageIndex || 0}
      </h4>
      <div>
        <span>Template ID</span>
        <strong className={page.hasTemplate ? "" : "danger-text"}>{page.templateId || "No template"}</strong>
        <CopyButton value={page.templateId} />
      </div>
      <div>
        <span>Document ID</span>
        <strong>{doc.id}</strong>
        <CopyButton value={doc.id} />
      </div>
      <div>
        <span>Batch ID</span>
        <strong>{batch.id}</strong>
        <CopyButton value={batch.id} />
      </div>
    </div>
  );
}

const TemplateDocumentRow = memo(function TemplateDocumentRow({
  batch,
  doc,
  docOpen,
  activePageKey,
  onInspectPage,
  onClearPage,
  onPinPage,
  onToggleDoc
}) {
  const docKey = `${batch.id}-${doc.id}`;

  return (
    <div className="template-doc-block">
      <button type="button" className="template-doc-row" onClick={() => onToggleDoc(docKey)}>
        {docOpen ? <ChevronDown size={15} /> : <ChevronRight size={15} />}
        <FileText size={15} />
        <strong>{doc.sourceDocId || doc.id}</strong>
        <span>{doc.pages.length} pages</span>
        <i style={{ width: `${Math.max(4, numericValue(doc.matchRate))}%` }} />
      </button>

      {docOpen && (
        <div className="template-page-zone">
          <div className="template-page-grid">
            {doc.pages.map((page) => {
              const pageKey = `${docKey}-${page.pageIndex}-${page.templateId || "none"}`;
              const isSelected = activePageKey === pageKey;

              return (
                <span className="template-page-item" key={pageKey} onPointerLeave={() => onClearPage(pageKey)}>
                  <button
                    type="button"
                    className={`template-page-tile ${page.hasTemplate ? "matched" : "unmatched"} ${isSelected ? "selected" : ""}`}
                    title={page.templateId || "No template"}
                    onPointerEnter={() => onInspectPage({ pageKey, batch, doc, page })}
                    onPointerDown={() => onPinPage({ pageKey, batch, doc, page })}
                    onFocus={() => onInspectPage({ pageKey, batch, doc, page })}
                    onBlur={() => onClearPage(pageKey)}
                    onClick={() => onPinPage({ pageKey, batch, doc, page })}
                  >
                    {page.pageIndex || 0}
                  </button>
                  {isSelected && <PagePopover batch={batch} doc={doc} page={page} />}
                </span>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}, (previous, next) => {
  const previousDocKey = `${previous.batch.id}-${previous.doc.id}`;
  const nextDocKey = `${next.batch.id}-${next.doc.id}`;
  const wasActive = previous.activePageKey?.startsWith(`${previousDocKey}-`);
  const isActive = next.activePageKey?.startsWith(`${nextDocKey}-`);

  return (
    previous.batch === next.batch &&
    previous.doc === next.doc &&
    previous.onInspectPage === next.onInspectPage &&
    previous.onClearPage === next.onClearPage &&
    previous.onPinPage === next.onPinPage &&
    previous.onToggleDoc === next.onToggleDoc &&
    previous.docOpen === next.docOpen &&
    wasActive === isActive &&
    (!isActive || previous.activePageKey === next.activePageKey)
  );
});

function TemplateTree({ batches, savedState = {}, onStateChange }) {
  const [expandedBatches, setExpandedBatches] = useState(() => savedState.expandedBatches || {});
  const [expandedDocs, setExpandedDocs] = useState(() => savedState.expandedDocs || {});
  const [activePage, setActivePage] = useState(null);

  useEffect(() => {
    onStateChange?.({ expandedBatches, expandedDocs });
  }, [expandedBatches, expandedDocs]);

  const inspectPage = useCallback((nextPage) => {
    setActivePage((current) => {
      if (current?.pageKey === nextPage.pageKey) return current;
      return { ...nextPage, pinned: false };
    });
  }, []);

  const pinPage = useCallback((nextPage) => {
    setActivePage((current) => {
      if (current?.pageKey === nextPage.pageKey && current?.pinned) return current;
      return { ...nextPage, pinned: true };
    });
  }, []);

  const clearPage = useCallback((pageKey) => {
    setActivePage((current) => (current?.pageKey === pageKey && !current?.pinned ? null : current));
  }, []);

  const toggleDoc = useCallback((docKey) => {
    setExpandedDocs((current) => ({ ...current, [docKey]: !current[docKey] }));
  }, []);

  if (!batches.length) {
    return <div className="empty-note">No batches matched the current search.</div>;
  }

  return (
    <div className="template-tree">
      {batches.map((batch) => {
        const batchOpen = expandedBatches[batch.id] ?? true;
        const batchKey = batch.id;

        return (
          <Fragment key={batch.id}>
            <button
              type="button"
              className={`template-batch-row ${batch.unmatchedPages > 0 ? "has-unmatched" : ""}`}
              onClick={() => setExpandedBatches((current) => ({ ...current, [batchKey]: !batchOpen }))}
            >
              {batchOpen ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
              <FolderOpen size={16} />
              <strong>{batch.id}</strong>
              <span>{batch.documents.length} docs</span>
              <span>{numberFormat(batch.matchedPages)} matched</span>
              <span>{numberFormat(batch.unmatchedPages)} unmatched</span>
              <em>{batch.matchRate}%</em>
            </button>

            {batchOpen &&
              batch.documents.map((doc) => (
                <TemplateDocumentRow
                  activePageKey={activePage?.pageKey}
                  batch={batch}
                  doc={doc}
                  docOpen={Boolean(expandedDocs[`${batch.id}-${doc.id}`])}
                  key={`${batch.id}-${doc.id}`}
                  onClearPage={clearPage}
                  onInspectPage={inspectPage}
                  onPinPage={pinPage}
                  onToggleDoc={toggleDoc}
                />
              ))}
          </Fragment>
        );
      })}
    </div>
  );
}

export default function TemplateMatching({ data, savedState = {}, onStateChange }) {
  const [query, setQuery] = useState(() => savedState.query || "");
  const [treeState, setTreeState] = useState(() => savedState.tree || {});

  useEffect(() => {
    onStateChange?.({ query, tree: treeState });
  }, [query, treeState]);

  const filteredBatches = useMemo(() => {
    const batches = data?.batches || [];
    if (!query.trim()) return batches;

    const needle = query.trim().toLowerCase();
    return batches
      .map((batch) => {
        if (batch.id.toLowerCase().includes(needle)) return batch;

        const documents = batch.documents.filter(
          (doc) => doc.id.toLowerCase().includes(needle) || String(doc.sourceDocId || "").toLowerCase().includes(needle)
        );

        return documents.length ? summarizeBatchForDocuments(batch, documents) : null;
      })
      .filter(Boolean);
  }, [data, query]);

  if (!data || data.error) {
    return (
      <section className="glass-panel empty-state error-state">
        <AlertTriangle size={48} />
        <h3>Error Parsing Template Matching</h3>
        <p>{data?.error || "No template matching CSV loaded."}</p>
        <small>Expected columns similar to BatchId, DocId, SourceDocId, PageIndex, and TemplateId.</small>
      </section>
    );
  }

  const summary = data.summary || {};

  return (
    <div className="fade-in template-view">
      <div className="template-header">
        <div>
          <h2>
            <Grid3X3 color="#8b5cf6" size={32} />
            Template Matching Analysis
          </h2>
          <p>Region template coverage across batches and documents</p>
        </div>
      </div>

      <div className="template-kpi-grid">
        <KpiCard
          label="Total Pages"
          value={numberFormat(summary.totalPages)}
          detail={`${numberFormat(summary.uniqueDocuments)} documents`}
          icon={<FileText size={22} />}
          color="#3b82f6"
        />
        <KpiCard
          label="Templates Matched"
          value={numberFormat(summary.matchedPages)}
          detail={`${summary.matchRate}% coverage`}
          icon={<CheckCircle2 size={22} />}
          color="#10b981"
        />
        <KpiCard
          label="No Template"
          value={numberFormat(summary.unmatchedPages)}
          detail={`${(100 - numericValue(summary.matchRate)).toFixed(1)}% unmatched`}
          icon={<XCircle size={22} />}
          color="#ef4444"
        />
        <KpiCard
          label="Unique Templates"
          value={numberFormat(summary.uniqueTemplates)}
          detail="detected"
          icon={<Layers size={22} />}
          color="#8b5cf6"
        />
        <KpiCard
          label="Batches"
          value={numberFormat(summary.uniqueBatches)}
          detail="processed"
          icon={<FolderOpen size={22} />}
          color="#f59e0b"
        />
      </div>

      <div className="template-chart-grid">
        <CoveragePanel summary={summary} />
        <FrequencyPanel templates={data.templates || []} />
      </div>

      <section className="glass-panel template-browser">
        <h3>
          <FolderOpen size={18} color="#f59e0b" />
          Batch & Document Template Coverage
        </h3>
        <label className="template-search">
          <Search size={18} />
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search by Batch ID or Doc ID..." />
        </label>
        <TemplateTree batches={filteredBatches} savedState={treeState} onStateChange={setTreeState} />
        <div className="template-browser-legend">
          <span>
            <i className="matched" /> Matched page
          </span>
          <span>
            <i className="unmatched" /> No template
          </span>
          <span>Click any page tile to inspect IDs.</span>
        </div>
      </section>
    </div>
  );
}

/**
 * TemplateMatching — region-template coverage view.
 * KPI cards + coverage donut + usage-frequency chart + a windowed, memoized
 * batch -> document -> page accordion. Each batch is a React.memo'd `TemplateBatch` that
 * owns its own expand/popover state, so toggling one batch never re-renders the other
 * thousands (perf). Shows a loading screen on entry and a "Limited data" warning when no
 * template data is present.
 */
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
  LoaderCircle,
  Search,
  XCircle
} from "lucide-react";
import { memo, useCallback, useEffect, useMemo, useState } from "react";
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
import { ChartTooltip, CountUp, useGrow } from "./AncoraCharts.jsx";

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

function KpiCard({ label, value, detail, icon, color, variant = "", delay = 0 }) {
  return (
    <div className={`kpi fade-in ${variant}`} style={{ animationDelay: `${delay}ms` }}>
      <div className="kpi-label">
        <span style={variant ? undefined : { color }}>{icon}</span>
        {label}
      </div>
      <div className="kpi-val">
        <CountUp to={numericValue(value)} group />
      </div>
      <div className="kpi-foot">{detail}</div>
    </div>
  );
}

function CoveragePanel({ summary }) {
  const t = useGrow(1200);
  const target = Math.max(0, Math.min(100, numericValue(summary.matchRate)));
  const coverage = target * t;

  return (
    <section className="glass-panel template-panel template-coverage-panel">
      <h3>
        <CheckCircle2 size={20} color="#15966B" />
        Template Coverage
      </h3>
      <div className="template-css-donut" style={{ "--coverage": `${coverage}%`, transition: "none" }}>
        <div className="template-donut-hole">
          <strong>{coverage.toFixed(1)}%</strong>
          <span>Coverage</span>
        </div>
      </div>
      <div className="template-legend">
        <span>
          <i style={{ background: "#15966B" }} />
          Matched: {numberFormat(summary.matchedPages)}
        </span>
        <span>
          <i style={{ background: "#D8412F" }} />
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
        <Layers size={20} color="#6B4FD8" />
        Template Usage Frequency
      </h3>
      <ResponsiveContainer width="100%" height={330}>
        <BarChart data={chartData} layout="vertical" margin={{ left: 110, right: 32, top: 8, bottom: 12 }}>
          <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="rgba(148,163,184,0.16)" />
          <XAxis type="number" tick={{ fill: "#6E6B5C", fontSize: 11 }} />
          <YAxis
            dataKey="id"
            type="category"
            width={118}
            tick={{ fill: "#6E6B5C", fontSize: 10 }}
            tickFormatter={(value) => (String(value).length > 18 ? `${String(value).slice(0, 18)}...` : value)}
          />
          <Tooltip content={<ChartTooltip formatter={(value) => [numberFormat(value), "Pages"]} />} />
          <Bar dataKey="count" radius={[0, 5, 5, 0]} fill="#6B4FD8" />
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
        <CheckCircle2 size={16} color={page.hasTemplate ? "#15966B" : "#D8412F"} />
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

/* Each batch owns its own expand / doc / popover state and is memoized, so toggling
   one batch (or a doc, or a page tile) only re-renders that batch — not all 2,000+. */
const TemplateBatch = memo(
  function TemplateBatch({ batch, defaultOpen }) {
    const [open, setOpen] = useState(defaultOpen);
    const [expandedDocs, setExpandedDocs] = useState({});
    const [activePage, setActivePage] = useState(null);

    const inspectPage = useCallback((nextPage) => {
      setActivePage((current) => (current?.pageKey === nextPage.pageKey ? current : { ...nextPage, pinned: false }));
    }, []);

    const pinPage = useCallback((nextPage) => {
      setActivePage((current) =>
        current?.pageKey === nextPage.pageKey && current?.pinned ? current : { ...nextPage, pinned: true }
      );
    }, []);

    const clearPage = useCallback((pageKey) => {
      setActivePage((current) => (current?.pageKey === pageKey && !current?.pinned ? null : current));
    }, []);

    const toggleDoc = useCallback((docKey) => {
      setExpandedDocs((current) => ({ ...current, [docKey]: !current[docKey] }));
    }, []);

    return (
      <>
        <button
          type="button"
          className={`template-batch-row ${batch.unmatchedPages > 0 ? "has-unmatched" : ""}`}
          onClick={() => setOpen((value) => !value)}
        >
          {open ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
          <FolderOpen size={16} />
          <strong>{batch.id}</strong>
          <span>{batch.documents.length} docs</span>
          <span>{numberFormat(batch.matchedPages)} matched</span>
          <span>{numberFormat(batch.unmatchedPages)} unmatched</span>
          <em>{batch.matchRate}%</em>
        </button>

        {open &&
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
      </>
    );
  },
  (previous, next) => previous.batch === next.batch && previous.defaultOpen === next.defaultOpen
);

/* Renders a windowed slice of batches with a "load more" control, so the initial
   mount never has to build all 2,000+ rows at once. */
const BATCH_WINDOW = 60;

function TemplateTree({ batches }) {
  const [visible, setVisible] = useState(BATCH_WINDOW);

  // reset the window whenever the (filtered) batch list changes
  useEffect(() => {
    setVisible(BATCH_WINDOW);
  }, [batches]);

  if (!batches.length) {
    return <div className="empty-note">No batches matched the current search.</div>;
  }

  const shown = batches.slice(0, visible);
  const remaining = batches.length - shown.length;

  return (
    <div className="template-tree">
      {shown.map((batch, index) => (
        <TemplateBatch key={batch.id} batch={batch} defaultOpen={index === 0} />
      ))}

      {remaining > 0 && (
        <button
          type="button"
          className="template-load-more"
          onClick={() => setVisible((value) => value + BATCH_WINDOW * 2)}
        >
          Show {Math.min(remaining, BATCH_WINDOW * 2).toLocaleString()} more
          <span>{remaining.toLocaleString()} batches hidden</span>
        </button>
      )}
    </div>
  );
}

export default function TemplateMatching({ data, savedState = {}, onStateChange }) {
  const [query, setQuery] = useState(() => savedState.query || "");
  const [loading, setLoading] = useState(true);

  // Let the browser paint the loading screen before the heavy tree mounts,
  // so the page never appears frozen on entry.
  useEffect(() => {
    setLoading(true);
    const id = window.setTimeout(() => setLoading(false), 120);
    return () => window.clearTimeout(id);
  }, [data]);

  useEffect(() => {
    onStateChange?.({ query });
  }, [query]);

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
      <div className="fade-in al-page template-view">
        <div className="hero" style={{ marginBottom: 18 }}>
          <div>
            <div className="eyebrow">
              <span className="dot" style={{ background: "var(--amber)" }} /> Limited data
            </div>
            <h1 style={{ fontSize: "clamp(34px,4.5vw,56px)" }}>Template matching</h1>
            <p className="sub">Region template coverage across every batch, document and page.</p>
          </div>
        </div>
        <div className="alert error" style={{ alignItems: "flex-start" }}>
          <AlertTriangle size={20} />
          <div>
            <strong>This page could not be loaded due to insufficient data.</strong>
            <div style={{ marginTop: 4, fontWeight: 500 }}>
              This report didn't include template-matching results, so coverage can't be shown here. The rest of the
              dashboard is unaffected.
            </div>
            <div style={{ marginTop: 8, fontSize: 12.5, opacity: 0.8 }}>
              Expected a CSV with BatchId, DocId, SourceDocId, PageIndex and TemplateId columns.
            </div>
          </div>
        </div>
      </div>
    );
  }

  const summary = data.summary || {};

  if (loading) {
    return (
      <div className="fade-in template-view al-page">
        <div className="template-loading">
          <div className="template-loading-orb">
            <LoaderCircle className="spin" size={30} />
          </div>
          <h3>Mapping template coverage…</h3>
          <p>
            Indexing {numberFormat(summary.totalPages)} pages across {numberFormat(summary.uniqueBatches)} batches and{" "}
            {numberFormat(summary.uniqueDocuments)} documents.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="template-view al-page">
      <div className="hero fade-in" style={{ marginBottom: 18 }}>
        <div>
          <div className="eyebrow">
            <span className="dot" style={{ background: numericValue(summary.unmatchedPages) > 0 ? "var(--coral)" : "var(--green)" }} />{" "}
            {summary.matchRate}% template coverage
          </div>
          <h1 style={{ fontSize: "clamp(34px,4.5vw,56px)" }}>Template matching</h1>
          <p className="sub">Region template coverage across every batch, document and page.</p>
        </div>
      </div>

      <div className="template-kpi-grid">
        <KpiCard
          label="Total Pages"
          value={numberFormat(summary.totalPages)}
          detail={`${numberFormat(summary.uniqueDocuments)} documents`}
          icon={<FileText size={15} />}
          color="#2B3AE8"
          delay={40}
        />
        <KpiCard
          label="Templates Matched"
          value={numberFormat(summary.matchedPages)}
          detail={`${summary.matchRate}% coverage`}
          icon={<CheckCircle2 size={15} />}
          variant="accent"
          delay={100}
        />
        <KpiCard
          label="No Template"
          value={numberFormat(summary.unmatchedPages)}
          detail={`${(100 - numericValue(summary.matchRate)).toFixed(1)}% unmatched`}
          icon={<XCircle size={15} />}
          color="#D8412F"
          delay={160}
        />
        <KpiCard
          label="Unique Templates"
          value={numberFormat(summary.uniqueTemplates)}
          detail="detected"
          icon={<Layers size={15} />}
          color="#6B4FD8"
          delay={220}
        />
        <KpiCard
          label="Batches"
          value={numberFormat(summary.uniqueBatches)}
          detail="processed"
          icon={<FolderOpen size={15} />}
          variant="dark"
          delay={280}
        />
      </div>

      <div className="template-chart-grid fade-in" style={{ animationDelay: "320ms" }}>
        <CoveragePanel summary={summary} />
        <FrequencyPanel templates={data.templates || []} />
      </div>

      <section className="glass-panel template-browser fade-in" style={{ animationDelay: "400ms" }}>
        <h3>
          <FolderOpen size={18} color="#E6A12C" />
          Batch & Document Template Coverage
        </h3>
        <label className="template-search">
          <Search size={18} />
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search by Batch ID or Doc ID..." />
        </label>
        <TemplateTree batches={filteredBatches} />
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

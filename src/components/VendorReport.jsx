/**
 * VendorReport — vendor accuracy table.
 * Editorial KPI row + a searchable, column-sortable vendor list (see VENDOR_SORTERS:
 * name / doc count / accuracy / bypass % / template match) with expandable per-vendor
 * field detail. Shows a "Limited data" warning when parsing yields no usable vendors.
 */
import { AlertTriangle, Award, ChevronDown, ChevronRight, Crosshair, Search, SlidersHorizontal, Users } from "lucide-react";
import { Fragment } from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import { numericValue, parseVendorMetrics } from "../utils/parsers.js";
import { CountUp } from "./AncoraCharts.jsx";

function accuracyColor(value) {
  const number = numericValue(value);
  if (!Number.isFinite(number)) return "#6E6B5C";
  if (number >= 90) return "#15966B";
  if (number >= 70) return "#E6A12C";
  return "#D8412F";
}

// Column sorters for the vendor table (numericValue strips % and commas).
const VENDOR_SORTERS = {
  name: (a, b) => a.name.localeCompare(b.name),
  docs_desc: (a, b) => numericValue(b.docCount) - numericValue(a.docCount),
  docs_asc: (a, b) => numericValue(a.docCount) - numericValue(b.docCount),
  acc_desc: (a, b) => numericValue(b.overall?.accuracy) - numericValue(a.overall?.accuracy),
  acc_asc: (a, b) => numericValue(a.overall?.accuracy) - numericValue(b.overall?.accuracy),
  bypass_desc: (a, b) => numericValue(b.bypassRate) - numericValue(a.bypassRate),
  bypass_asc: (a, b) => numericValue(a.bypassRate) - numericValue(b.bypassRate),
  template_desc: (a, b) => numericValue(b.templateRate) - numericValue(a.templateRate),
  template_asc: (a, b) => numericValue(a.templateRate) - numericValue(b.templateRate)
};

function VendorRowsTable({ rows, title }) {
  if (!rows || rows.length === 0) {
    return (
      <div className="vendor-table-block">
        {title && <h4>{title}</h4>}
        <div className="vendor-empty-note">No rows available for this section.</div>
      </div>
    );
  }

  return (
    <div className="vendor-table-block">
      {title && <h4>{title}</h4>}
      <div className="vendor-table-scroll">
        <table className="vendor-detail-table">
          <thead>
            <tr>
              <th>Field Name</th>
              <th>Doc Count</th>
              <th>Total</th>
              <th>Correct</th>
              <th>Accuracy</th>
              <th>Unassigned Valid</th>
              <th>Unassigned Invalid</th>
              <th>Wrong Assign</th>
              <th>Text Match Fail</th>
              <th>Wrong Input</th>
              <th>Mis Assign</th>
              <th>Wrong Location</th>
              <th>Wrong Page</th>
              <th>Wrong Region</th>
              <th>Unknown</th>
              <th>Unknown Captured</th>
              <th>Unknown True</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row, index) => (
              <tr
                key={`${row.field}-${index}`}
                title={`${row.field}: ${row.correct || 0}/${row.total || 0} correct, ${row.accuracy || "N/A"} accuracy`}
              >
                <td>{row.field}</td>
                <td>{row.docCount}</td>
                <td>{row.total}</td>
                <td className="success-text">{row.correct}</td>
                <td style={{ color: accuracyColor(row.accuracy), fontWeight: 700 }}>{row.accuracy}</td>
                <td>{row.unassignedValid}</td>
                <td>{row.unassignedInvalid}</td>
                <td>{row.wrongAssignment}</td>
                <td>{row.textMatchFail}</td>
                <td>{row.wrongInput}</td>
                <td>{row.misAssignment}</td>
                <td>{row.wrongLocation}</td>
                <td>{row.wrongPage}</td>
                <td>{row.wrongRegion}</td>
                <td>{row.unknown}</td>
                <td>{row.unknownCaptured}</td>
                <td>{row.unknownTrue}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default function VendorReport({ data, savedState = {}, onStateChange }) {
  const parsed = useMemo(() => parseVendorMetrics(data || []), [data]);
  const [expanded, setExpanded] = useState(() => savedState.expanded || {});
  const [query, setQuery] = useState(() => savedState.query || "");
  const [sortMode, setSortMode] = useState(() => savedState.sortMode || "name");
  const scrollRef = useRef(null);

  useEffect(() => {
    onStateChange?.({ expanded, query, sortMode });
  }, [expanded, query, sortMode]);

  const vendors = useMemo(() => {
    if (!Array.isArray(parsed)) return [];

    return [...parsed]
      .filter((vendor) => vendor.rows.length > 0 || numericValue(vendor.overall?.accuracy) > 0)
      .filter((vendor) => vendor.name.toLowerCase().includes(query.toLowerCase()))
      .sort(VENDOR_SORTERS[sortMode] || VENDOR_SORTERS.name);
  }, [parsed, query, sortMode]);

  if (!Array.isArray(parsed)) {
    return (
      <div className="fade-in al-page vendor-view">
        <div className="hero" style={{ marginBottom: 18 }}>
          <div>
            <div className="eyebrow">
              <span className="dot" style={{ background: "var(--amber)" }} /> Limited data
            </div>
            <h1 style={{ fontSize: "clamp(34px,4.5vw,56px)" }}>Vendor analysis</h1>
            <p className="sub">Compare every vendor's extraction accuracy, template match and exception profile.</p>
          </div>
        </div>
        <div className="alert error" style={{ alignItems: "flex-start" }}>
          <AlertTriangle size={20} />
          <div>
            <strong>This page could not be loaded due to insufficient data.</strong>
            <div style={{ marginTop: 4, fontWeight: 500 }}>
              {parsed?.error || "No valid vendor data was found in this report."} The rest of the dashboard is unaffected.
            </div>
            <div style={{ marginTop: 8, fontSize: 12.5, opacity: 0.8 }}>
              Expected a CSV with Value, Field and Doc Count columns.
            </div>
          </div>
        </div>
      </div>
    );
  }

  const allVendors = Array.isArray(parsed)
    ? parsed.filter((vendor) => vendor.rows.length > 0 || numericValue(vendor.overall?.accuracy) > 0)
    : [];
  const accs = allVendors.map((v) => numericValue(v.overall?.accuracy)).filter((n) => Number.isFinite(n) && n > 0);
  const avgAcc = accs.length ? accs.reduce((a, b) => a + b, 0) / accs.length : 0;
  const topVendor = allVendors.reduce(
    (best, v) => (numericValue(v.overall?.accuracy) > numericValue(best?.overall?.accuracy) ? v : best),
    allVendors[0]
  );
  const topAcc = numericValue(topVendor?.overall?.accuracy);
  const belowTarget = allVendors.filter((v) => numericValue(v.overall?.accuracy) < 90).length;

  return (
    <div className="fade-in vendor-view al-page">
      <div className="hero" style={{ marginBottom: 18 }}>
        <div>
          <div className="eyebrow">
            <span className="dot" style={{ background: belowTarget ? "var(--coral)" : "var(--green)" }} />{" "}
            {allVendors.length.toLocaleString()} vendors analyzed
          </div>
          <h1 style={{ fontSize: "clamp(34px,4.5vw,56px)" }}>Vendor analysis</h1>
          <p className="sub">Compare every vendor's extraction accuracy, template match and exception profile.</p>
        </div>
      </div>

      <div className="kpis">
        <div className="kpi">
          <div className="kpi-label">
            <Users size={15} /> Vendors
          </div>
          <div className="kpi-val">
            <CountUp to={allVendors.length} />
          </div>
          <div className="kpi-foot">in this report</div>
        </div>
        <div className="kpi accent">
          <div className="kpi-label">
            <Crosshair size={15} /> Avg. accuracy
          </div>
          <div className="kpi-val">
            <CountUp to={avgAcc} decimals={1} suffix="%" />
          </div>
          <div className="kpi-foot">across vendors</div>
        </div>
        <div className="kpi">
          <div className="kpi-label">
            <Award size={15} /> Top performer
          </div>
          <div className="kpi-val">
            <CountUp to={topAcc} decimals={1} suffix="%" />
          </div>
          <div className="kpi-foot" title={topVendor?.name}>
            {topVendor?.name ? topVendor.name.slice(0, 22) : "—"}
          </div>
        </div>
        <div className="kpi dark">
          <div className="kpi-label">
            <AlertTriangle size={15} /> Below 90%
          </div>
          <div className="kpi-val">
            <CountUp to={belowTarget} />
          </div>
          <div className="kpi-foot">need review</div>
        </div>
      </div>

      <div className="details-toolbar glass-panel" style={{ marginTop: 14 }}>
        <div className="vendor-controls">
          <label className="toolbar-field select-field">
            <SlidersHorizontal size={18} />
            <select value={sortMode} onChange={(event) => setSortMode(event.target.value)}>
              <option value="name">Name (A–Z)</option>
              <optgroup label="Doc Count">
                <option value="docs_desc">Doc Count: High → Low</option>
                <option value="docs_asc">Doc Count: Low → High</option>
              </optgroup>
              <optgroup label="Overall Accuracy">
                <option value="acc_asc">Accuracy: Lowest First (High Error)</option>
                <option value="acc_desc">Accuracy: Highest First</option>
              </optgroup>
              <optgroup label="Bypass %">
                <option value="bypass_desc">Bypass %: High → Low</option>
                <option value="bypass_asc">Bypass %: Low → High</option>
              </optgroup>
              <optgroup label="Template Match">
                <option value="template_desc">Template Match: High → Low</option>
                <option value="template_asc">Template Match: Low → High</option>
              </optgroup>
            </select>
          </label>
          <label className="toolbar-field search-field">
            <Search size={18} />
            <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search vendors..." />
          </label>
        </div>
      </div>

      <section className="glass-panel vendor-table-shell" ref={scrollRef}>
        <table className="vendor-summary-table">
          <thead>
            <tr>
              <th />
              <th>Vendor Name</th>
              <th>Doc Count</th>
              <th>Template Match</th>
              <th>Bypass %</th>
              <th>Overall Accuracy</th>
            </tr>
          </thead>
          <tbody>
            {vendors.map((vendor, index) => {
              const isOpen = Boolean(expanded[vendor.name]);
              const color = accuracyColor(vendor.overall?.accuracy);
              const summaryText = `${vendor.name}: ${vendor.docCount || 0} docs, ${vendor.overall?.accuracy || "N/A"} overall accuracy`;

              return (
                <Fragment key={vendor.name}>
                  <tr
                    className={isOpen ? "vendor-row open" : "vendor-row"}
                    style={{ animationDelay: `${Math.min(index * 0.04, 1)}s` }}
                    title={summaryText}
                    onClick={() => setExpanded((current) => ({ ...current, [vendor.name]: !current[vendor.name] }))}
                  >
                    <td>{isOpen ? <ChevronDown size={18} /> : <ChevronRight size={18} />}</td>
                    <td>{vendor.name}</td>
                    <td>{vendor.docCount}</td>
                    <td className="violet-text">{vendor.templateRate}</td>
                    <td className="amber-text">{vendor.bypassRate}</td>
                    <td>
                      <span className="accuracy-pill" style={{ color, background: `${color}22` }}>
                        {vendor.overall?.accuracy || "N/A"}
                      </span>
                    </td>
                  </tr>
                  {isOpen && (
                    <tr className="vendor-expanded-row">
                      <td colSpan={6}>
                        <div className="vendor-expanded-content">
                          <VendorRowsTable rows={vendor.specialStats} title="Report Summary" />
                          <VendorRowsTable rows={vendor.rows} title="Field Details" />
                        </div>
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

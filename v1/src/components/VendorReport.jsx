import { AlertTriangle, ChevronDown, ChevronRight, Search, SlidersHorizontal, Users } from "lucide-react";
import { Fragment } from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import { numericValue, parseVendorMetrics } from "../utils/parsers.js";

function accuracyColor(value) {
  const number = numericValue(value);
  if (!Number.isFinite(number)) return "#94a3b8";
  if (number >= 90) return "#10b981";
  if (number >= 70) return "#f59e0b";
  return "#ef4444";
}

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
      .sort((left, right) => {
        if (sortMode === "name") return left.name.localeCompare(right.name);

        const leftAccuracy = numericValue(left.overall?.accuracy);
        const rightAccuracy = numericValue(right.overall?.accuracy);

        return sortMode === "acc_asc" ? leftAccuracy - rightAccuracy : rightAccuracy - leftAccuracy;
      });
  }, [parsed, query, sortMode]);

  if (!Array.isArray(parsed)) {
    return (
      <section className="glass-panel empty-state error-state">
        <AlertTriangle size={48} />
        <h3>Error Parsing Vendor Report</h3>
        <p>{parsed?.error || "No valid Vendor Data found."}</p>
        <small>Ensure the CSV has "Value", "Field", and "Doc Count" columns.</small>
      </section>
    );
  }

  return (
    <div className="fade-in vendor-view">
      <div className="vendor-header">
        <div>
          <h2>
            <Users color="#f59e0b" size={32} />
            Vendor Analysis
          </h2>
          <p>Detailed breakdown by Vendor and Field Accuracy</p>
        </div>
        <div className="vendor-controls">
          <label className="toolbar-field select-field">
            <SlidersHorizontal size={18} />
            <select value={sortMode} onChange={(event) => setSortMode(event.target.value)}>
              <option value="name">Name (A-Z)</option>
              <option value="acc_asc">Accuracy: Lowest First (High Error)</option>
              <option value="acc_desc">Accuracy: Highest First (Low Error)</option>
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

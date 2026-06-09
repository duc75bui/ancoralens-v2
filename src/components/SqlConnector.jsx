/**
 * SqlConnector — MSSQL query console.
 * Builds a connection string from the form and POSTs it with the query to
 * /api/sql/execute (same-origin in prod; Vite-proxied in dev). Config + last query persist
 * to localStorage. The server blocks DROP DATABASE / SHUTDOWN; nothing is stored server-side.
 */
import { AlertTriangle, CheckCircle2, Copy, Database, Download, Play, Server, ShieldCheck } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { downloadCsv } from "../utils/csv.js";

// Empty default → same-origin relative calls ("/api/..."). In dev, Vite proxies
// /api to the Express server; in production the unified server serves both.
const API_BASE = import.meta.env.VITE_API_BASE_URL || "";
const CONFIG_KEY = "sqlConnector_config";
const QUERY_KEY = "sqlConnector_query";

const DEFAULT_CONFIG = {
  server: "SQL2019.ancora.local",
  database: "ancoraDocsServerDb-WIN2025",
  integratedSecurity: true,
  user: "",
  password: "",
  encrypt: false,
  trustServerCertificate: true
};

const DEFAULT_QUERY = "SELECT TOP 100 * FROM Batch";

function loadStoredConfig() {
  try {
    return { ...DEFAULT_CONFIG, ...JSON.parse(localStorage.getItem(CONFIG_KEY) || "{}") };
  } catch {
    return DEFAULT_CONFIG;
  }
}

function buildConnectionString(config) {
  const auth = config.integratedSecurity
    ? "Integrated Security=True;"
    : `User Id=${config.user || ""};Password=${config.password || ""};`;
  const encrypt = config.encrypt ? "Encrypt=True;" : "";
  const trust = config.trustServerCertificate ? "TrustServerCertificate=True;" : "";

  return `Server=${config.server};Database=${config.database};${auth}${encrypt}${trust}`;
}

function copyText(value) {
  return navigator.clipboard.writeText(String(value || ""));
}

export default function SqlConnector() {
  const [config, setConfig] = useState(loadStoredConfig);
  const [query, setQuery] = useState(() => localStorage.getItem(QUERY_KEY) || DEFAULT_QUERY);
  const [status, setStatus] = useState({ connected: false, checking: true, message: "Checking backend..." });
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState({ rows: [], rowsAffected: [], error: null });

  const connectionString = useMemo(() => buildConnectionString(config), [config]);
  const resultColumns = useMemo(() => {
    const first = result.rows?.[0] || {};
    return Object.keys(first);
  }, [result.rows]);

  useEffect(() => {
    localStorage.setItem(CONFIG_KEY, JSON.stringify(config));
  }, [config]);

  useEffect(() => {
    localStorage.setItem(QUERY_KEY, query);
  }, [query]);

  useEffect(() => {
    let active = true;

    fetch(`${API_BASE}/api/health`)
      .then((response) => response.json())
      .then((payload) => {
        if (!active) return;
        setStatus({ connected: true, checking: false, message: payload.message || "Backend connected" });
      })
      .catch(() => {
        if (!active) return;
        setStatus({ connected: false, checking: false, message: "Start the Node backend on port 3001" });
      });

    return () => {
      active = false;
    };
  }, []);

  const updateConfig = (key, value) => {
    setConfig((current) => ({ ...current, [key]: value }));
  };

  const executeQuery = async () => {
    setRunning(true);
    setResult({ rows: [], rowsAffected: [], error: null });

    try {
      const response = await fetch(`${API_BASE}/api/sql/execute`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ connectionString, query })
      });
      const payload = await response.json();

      if (!response.ok) {
        throw new Error(payload.error || "SQL query failed.");
      }

      setResult({
        rows: payload.recordset || [],
        rowsAffected: payload.rowsAffected || [],
        error: null
      });
    } catch (error) {
      setResult({ rows: [], rowsAffected: [], error: error.message });
    } finally {
      setRunning(false);
    }
  };

  return (
    <div className="fade-in sql-view">
      <div className="hero" style={{ marginBottom: 18 }}>
        <div>
          <div className="eyebrow">
            <span
              className="dot"
              style={{ background: status.checking ? "var(--amber)" : status.connected ? "var(--green)" : "var(--coral)" }}
            />{" "}
            {status.checking ? "Checking backend…" : status.connected ? "Backend connected" : "Backend offline"}
          </div>
          <h1 style={{ fontSize: "clamp(34px,4.5vw,56px)" }}>SQL connector</h1>
          <p className="sub">Query your MSSQL database directly, inspect results and export to CSV.</p>
        </div>
        <div className="hero-right">
          <button type="button" className="execute-button" onClick={executeQuery} disabled={running || !query.trim()}>
            <Play size={16} fill="currentColor" />
            {running ? "Running..." : "Execute Query"}
          </button>
        </div>
      </div>

      <div className="sql-layout">
        <aside className="sql-config-panel">
          <h3>
            <Server size={17} color="#6B4FD8" />
            Connection Settings
          </h3>

          <label>
            <span>Server Address</span>
            <input value={config.server} onChange={(event) => updateConfig("server", event.target.value)} />
          </label>

          <label>
            <span>Database Name</span>
            <input value={config.database} onChange={(event) => updateConfig("database", event.target.value)} />
          </label>

          <label className="sql-toggle-row">
            <input
              type="checkbox"
              checked={config.integratedSecurity}
              onChange={(event) => updateConfig("integratedSecurity", event.target.checked)}
            />
            <span>Integrated Security</span>
            <em>Windows Auth</em>
          </label>

          {!config.integratedSecurity && (
            <div className="sql-auth-fields">
              <label>
                <span>User</span>
                <input value={config.user} onChange={(event) => updateConfig("user", event.target.value)} />
              </label>
              <label>
                <span>Password</span>
                <input
                  type="password"
                  value={config.password}
                  onChange={(event) => updateConfig("password", event.target.value)}
                />
              </label>
            </div>
          )}

          <label className="sql-toggle-row compact">
            <input type="checkbox" checked={config.encrypt} onChange={(event) => updateConfig("encrypt", event.target.checked)} />
            <span>Encrypt</span>
          </label>

          <label className="sql-toggle-row compact">
            <input
              type="checkbox"
              checked={config.trustServerCertificate}
              onChange={(event) => updateConfig("trustServerCertificate", event.target.checked)}
            />
            <span>Trust Server Certificate</span>
          </label>

          <div className="connection-string">
            <span>Connection String</span>
            <code>{connectionString}</code>
            <button type="button" className="template-copy-button" onClick={() => copyText(connectionString)}>
              <Copy size={12} />
              Copy
            </button>
          </div>

          <div className={`backend-pill ${status.connected ? "connected" : ""}`}>
            {status.connected ? <CheckCircle2 size={14} /> : <AlertTriangle size={14} />}
            {status.message}
          </div>
        </aside>

        <section className="sql-workbench">
          <div className="sql-editor-header">
            <span>&gt;_</span>
            <strong>Query Editor</strong>
          </div>
          <textarea value={query} spellCheck="false" onChange={(event) => setQuery(event.target.value)} />

          <div className="sql-results-header">
            <div>
              <Database size={15} color="#2B3AE8" />
              <strong>Results</strong>
            </div>
            <span>{numberLabel(result.rows.length, "row")}</span>
          </div>

          <div className="sql-results">
            {result.error && (
              <div className="sql-empty error">
                <AlertTriangle size={28} />
                <strong>Query failed</strong>
                <p>{result.error}</p>
              </div>
            )}

            {!result.error && result.rows.length === 0 && (
              <div className="sql-empty">
                <ShieldCheck size={34} />
                <strong>Ready to execute</strong>
                <p>Configure connection and run a query to see results.</p>
              </div>
            )}

            {!result.error && result.rows.length > 0 && (
              <>
                <div className="sql-result-actions">
                  <span>Rows affected: {result.rowsAffected.join(", ") || "0"}</span>
                  <button type="button" className="glass-button details-control-button" onClick={() => downloadCsv(result.rows, "sql_results.csv")}>
                    <Download size={14} />
                    Export CSV
                  </button>
                </div>
                <div className="sql-table-scroll">
                  <table className="sql-table">
                    <thead>
                      <tr>
                        {resultColumns.map((column) => (
                          <th key={column}>{column}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {result.rows.map((row, rowIndex) => (
                        <tr key={rowIndex}>
                          {resultColumns.map((column) => (
                            <td key={column}>{String(row[column] ?? "")}</td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}

function numberLabel(count, noun) {
  return `${count.toLocaleString()} ${noun}${count === 1 ? "" : "s"}`;
}

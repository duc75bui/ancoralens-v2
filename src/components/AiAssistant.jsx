/**
 * AiAssistant — Google Gemini chat grounded in the loaded report context.
 * The API key + model are stored client-side (localStorage) and sent per-request to
 * /api/ai/* ; nothing is persisted server-side. buildDataContext() compacts the parsed
 * reports into the system prompt so answers reference the user's actual numbers.
 */
import { CheckCircle2, ExternalLink, KeyRound, LoaderCircle, Send, Settings, Sparkles, XCircle } from "lucide-react";
import { useMemo, useState } from "react";
import { parseSummaryMetrics, parseVendorMetrics } from "../utils/parsers.js";

// Empty default → same-origin relative calls ("/api/..."). In dev, Vite proxies
// /api to the Express server; in production the unified server serves both.
const API_BASE = import.meta.env.VITE_API_BASE_URL || "";
const API_KEY_STORAGE = "aiChat_apiKey";
const MODEL_STORAGE = "aiChat_model";

const MODELS = [
  { value: "gemini-3-flash-preview", label: "Gemini 3 Flash Preview" },
  { value: "gemini-3-pro-preview", label: "Gemini 3 Pro Preview" },
  { value: "gemini-2.0-flash-exp", label: "Gemini 2.0 Flash Experimental" },
  { value: "gemini-1.5-pro", label: "Gemini 1.5 Pro" },
  { value: "gemini-1.5-flash", label: "Gemini 1.5 Flash" },
  { value: "gemini-pro", label: "Gemini Pro" }
];

function sampleRows(rows, limit = 40) {
  return Array.isArray(rows) ? rows.slice(0, limit) : [];
}

function summarizeRows(label, rows) {
  if (!Array.isArray(rows) || rows.length === 0) return `${label}: not uploaded.`;
  const columns = Object.keys(rows[0] || {});
  return `${label}: ${rows.length.toLocaleString()} rows. Columns: ${columns.join(", ")}. Sample rows: ${JSON.stringify(sampleRows(rows, 25))}`;
}

function buildDataContext(reportContext) {
  const parts = [];
  const { dashboard, details, vendor, template, session } = reportContext || {};

  if (session) {
    parts.push(`Session: ${session.clientName || "Unknown client"} ${session.version || ""}`.trim());
  }

  if (dashboard?.length) {
    const parsed = parseSummaryMetrics(dashboard, details || []);
    parts.push(`Dashboard summary: ${JSON.stringify(parsed.groups.general)}`);
    parts.push(`Summary field stats: ${JSON.stringify(parsed.groups.summaryStats)}`);
    parts.push(`Table cell stats: ${JSON.stringify(parsed.groups.tableStats)}`);
  }

  parts.push(summarizeRows("Detailed extraction report", details));

  if (vendor?.length) {
    const vendors = parseVendorMetrics(vendor);
    if (Array.isArray(vendors)) {
      const sorted = [...vendors]
        .sort((left, right) => Number.parseFloat(String(left.overall?.accuracy || "0")) - Number.parseFloat(String(right.overall?.accuracy || "0")))
        .slice(0, 50)
        .map((item) => ({
          vendor: item.name,
          docCount: item.docCount,
          templateRate: item.templateRate,
          bypassRate: item.bypassRate,
          overallAccuracy: item.overall?.accuracy,
          fieldCount: item.rows.length
        }));
      parts.push(`Vendor analysis: ${vendors.length.toLocaleString()} vendors. Lowest accuracy vendors: ${JSON.stringify(sorted)}`);
    }
    parts.push(summarizeRows("Vendor CSV", vendor));
  }

  if (template?.summary) {
    parts.push(`Template matching summary: ${JSON.stringify(template.summary)}`);
    parts.push(`Top template frequencies: ${JSON.stringify((template.templates || []).slice(0, 40))}`);
    parts.push(
      `Template batch coverage sample: ${JSON.stringify(
        (template.batches || []).slice(0, 25).map((batch) => ({
          id: batch.id,
          documents: batch.documents.length,
          totalPages: batch.totalPages,
          matchedPages: batch.matchedPages,
          unmatchedPages: batch.unmatchedPages,
          matchRate: batch.matchRate,
          templateCount: batch.templateCount
        }))
      )}`
    );
  }

  return parts.join("\n\n").slice(0, 55000);
}

function dataRowCount(reportContext) {
  const { dashboard, details, vendor, template } = reportContext || {};
  return (
    (Array.isArray(dashboard) ? dashboard.length : 0) +
    (Array.isArray(details) ? details.length : 0) +
    (Array.isArray(vendor) ? vendor.length : 0) +
    (Array.isArray(template?.raw) ? template.raw.length : 0)
  );
}

export default function AiAssistant({ reportContext }) {
  const [apiKey, setApiKey] = useState(() => localStorage.getItem(API_KEY_STORAGE) || "");
  const [model, setModel] = useState(() => localStorage.getItem(MODEL_STORAGE) || "gemini-3-flash-preview");
  const [connected, setConnected] = useState(Boolean(localStorage.getItem(API_KEY_STORAGE)));
  const [testing, setTesting] = useState(false);
  const [showSettings, setShowSettings] = useState(true);
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");

  const dataContext = useMemo(() => buildDataContext(reportContext), [reportContext]);
  const rowCount = useMemo(() => dataRowCount(reportContext), [reportContext]);
  const modelLabel = MODELS.find((item) => item.value === model)?.label || model;

  const saveAiSettings = (nextApiKey = apiKey, nextModel = model) => {
    localStorage.setItem(API_KEY_STORAGE, nextApiKey);
    localStorage.setItem(MODEL_STORAGE, nextModel);
  };

  const testConnection = async () => {
    setTesting(true);
    setError("");

    try {
      const response = await fetch(`${API_BASE}/api/ai/test`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ apiKey, model })
      });
      const payload = await response.json();

      if (!response.ok || !payload.connected) throw new Error(payload.error || "Connection failed.");

      saveAiSettings();
      setConnected(true);
    } catch (exception) {
      setConnected(false);
      setError(exception.message);
    } finally {
      setTesting(false);
    }
  };

  const sendMessage = async (messageText = input) => {
    const text = messageText.trim();
    if (!text || sending) return;

    if (!apiKey.trim()) {
      setError("Enter a Gemini API key before sending a question.");
      setShowSettings(true);
      return;
    }

    setError("");
    setSending(true);
    saveAiSettings();
    setConnected(true);
    setInput("");

    const nextMessages = [...messages, { role: "user", content: text }];
    setMessages(nextMessages);

    try {
      const response = await fetch(`${API_BASE}/api/ai/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          apiKey,
          message: text,
          dataContext,
          history: messages,
          model
        })
      });
      const payload = await response.json();

      if (!response.ok) throw new Error(payload.error || "AI request failed.");

      setMessages([...nextMessages, { role: "assistant", content: payload.response || "" }]);
    } catch (exception) {
      setError(exception.message);
      setMessages([...nextMessages, { role: "assistant", content: `I could not answer yet: ${exception.message}` }]);
    } finally {
      setSending(false);
    }
  };

  const onKeyDown = (event) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      sendMessage();
    }
  };

  const prompts = [
    "What vendors have the lowest accuracy?",
    "Summarize the main error types",
    "What trends do you see?"
  ];

  return (
    <div className="fade-in ai-view">
      <div className="hero" style={{ marginBottom: 18 }}>
        <div>
          <div className="eyebrow">
            <span className="dot" style={{ background: connected ? "var(--green)" : "var(--coral)" }} />{" "}
            {connected ? `Connected · ${modelLabel}` : "Not connected"}
          </div>
          <h1 style={{ fontSize: "clamp(34px,4.5vw,56px)" }}>AI assistant</h1>
          <p className="sub">
            Ask questions about your reports — grounded in {rowCount.toLocaleString()} rows of your real uploaded data.
          </p>
        </div>
        <div className="hero-right" style={{ flexDirection: "row", alignItems: "center" }}>
          <span className={`ai-status ${connected ? "connected" : ""}`}>
            {connected ? <CheckCircle2 size={14} /> : <XCircle size={14} />}
            {connected ? "Connected" : "Not connected"}
          </span>
          <button type="button" className="icon-button" onClick={() => setShowSettings((current) => !current)} title="AI settings">
            <Settings size={18} />
          </button>
        </div>
      </div>

      {showSettings && (
        <section className="ai-settings">
          <label>
            <span>Gemini API Key</span>
            <div className="ai-input-wrap">
              <KeyRound size={16} />
              <input
                type="password"
                value={apiKey}
                onChange={(event) => {
                  setApiKey(event.target.value);
                  setConnected(false);
                }}
                placeholder="Paste your Gemini API key"
              />
            </div>
          </label>

          <label>
            <span>Model Selection</span>
            <select
              value={model}
              onChange={(event) => {
                setModel(event.target.value);
                localStorage.setItem(MODEL_STORAGE, event.target.value);
              }}
            >
              {MODELS.map((item) => (
                <option key={item.value} value={item.value}>
                  {item.label}
                </option>
              ))}
            </select>
          </label>

          <div className="ai-settings-actions">
            <a href="https://aistudio.google.com/app/apikey" target="_blank" rel="noreferrer">
              Get your API key from Google AI Studio
              <ExternalLink size={13} />
            </a>
            <button type="button" className="ai-test-button" onClick={testConnection} disabled={testing || !apiKey.trim()}>
              {testing && <LoaderCircle className="spin" size={15} />}
              {testing ? "Testing..." : "Test Connection"}
            </button>
          </div>
        </section>
      )}

      {error && <div className="ai-error">{error}</div>}

      <section className="ai-chat-shell">
        {messages.length === 0 ? (
          <div className="ai-empty">
            <Sparkles size={46} />
            <h3>Ask me about your data</h3>
            <p>
              I can see {rowCount.toLocaleString()} rows across the uploaded reports. Try asking about accuracy trends,
              vendor performance, template coverage, or error patterns.
            </p>
            <div className="ai-prompt-row">
              {prompts.map((prompt) => (
                <button type="button" key={prompt} onClick={() => sendMessage(prompt)}>
                  {prompt}
                </button>
              ))}
            </div>
          </div>
        ) : (
          <div className="ai-messages">
            {messages.map((message, index) => (
              <article key={`${message.role}-${index}`} className={`ai-message ${message.role}`}>
                <strong>{message.role === "user" ? "You" : "AI"}</strong>
                <p>{message.content}</p>
              </article>
            ))}
            {sending && (
              <article className="ai-message assistant">
                <strong>AI</strong>
                <p>
                  <LoaderCircle className="spin inline-spinner" size={14} />
                  Thinking through the uploaded reports...
                </p>
              </article>
            )}
          </div>
        )}
      </section>

      <form
        className="ai-composer"
        onSubmit={(event) => {
          event.preventDefault();
          sendMessage();
        }}
      >
        <input
          value={input}
          onChange={(event) => setInput(event.target.value)}
          onKeyDown={onKeyDown}
          placeholder="Ask about your data..."
        />
        <button type="submit" disabled={sending || !input.trim()}>
          <Send size={16} />
          Send
        </button>
      </form>
    </div>
  );
}

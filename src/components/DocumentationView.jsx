/**
 * DocumentationView — searchable reference for the report field-status / error types
 * (the canonical glossary). Three collapsible groups (Field Value / Location & Region /
 * System & Assignment) + a Quick Reference footer. Static content; no data dependency.
 */
import { AlertTriangle, BookOpen, CheckCircle2, ChevronDown, HelpCircle, MapPin, Search, XCircle } from "lucide-react";
import { useMemo, useState } from "react";

/* ── Field-status reference content (source of truth for the report error types) ── */
const GROUPS = [
  {
    key: "value",
    title: "Field Value Errors",
    subtitle: "Issues with the actual data captured in fields",
    tone: "error",
    items: [
      {
        name: "Correct",
        code: "Correct",
        status: "ok",
        summary: "The system captured the field value correctly.",
        detail:
          "The extracted text matches the expected (true) value. This is the ideal outcome and indicates successful data capture.",
        fix: "No action needed — the system is working as expected for this field."
      },
      {
        name: "Wrong Input",
        code: "WrongInput",
        status: "fail",
        summary: "The captured text does not match the expected value.",
        detail:
          "The system found and extracted text from the correct location, but the text itself is different from what was expected. This can happen due to OCR errors, unclear printing, or the document having different content than expected.",
        fix: "Review the source document to verify if the original text is legible. If the document is clear, the system may need retraining on similar document formats."
      },
      {
        name: "Text Match Fail",
        code: "TextMatchFail",
        status: "fail",
        summary: "The OCR text extraction failed to match the expected content.",
        detail:
          "The system attempted to read text from the document but the optical character recognition (OCR) result did not match what was expected. This often occurs with poor scan quality, unusual fonts, or handwritten text.",
        fix: "Check scan quality and ensure documents are clear. Consider rescanning at higher resolution if issues persist."
      }
    ]
  },
  {
    key: "location",
    title: "Location & Region Errors",
    subtitle: "Issues with where data was found on the document",
    tone: "warn",
    items: [
      {
        name: "Wrong Assignment",
        code: "WrongAssignment",
        status: "fail",
        summary: "The field was assigned to the wrong data region on the document.",
        detail:
          'During training or AI processing, the system linked this field to an incorrect area of the document. For example, the "Invoice Total" field might be reading from the "Subtotal" area instead.',
        fix: "In the training interface, redraw or reassign the field region to point to the correct area of the document."
      },
      {
        name: "Mis-Assignment",
        code: "MisAssignment",
        status: "warn",
        summary: "The field was partially or incorrectly assigned during training.",
        detail:
          "Similar to Wrong Assignment, but typically indicates the region is close but not quite right — perhaps overlapping with adjacent fields or capturing extra/missing content.",
        fix: "Fine-tune the field region boundaries in the training interface to ensure it covers exactly the intended content area."
      },
      {
        name: "Wrong Location",
        code: "WrongLocation",
        status: "fail",
        summary: "The field was found at an unexpected position on the document.",
        detail:
          "The system located the field, but its coordinates do not match where it should be based on the template or training. This can occur when document layouts vary slightly between versions.",
        fix: "Review if the document format has changed. May need to create a new template variant or adjust training for layout variations."
      },
      {
        name: "Wrong Page",
        code: "WrongPage",
        status: "fail",
        summary: "The field was detected on a different page than expected.",
        detail:
          "The system found the field, but on page 2 when it should be on page 1, for example. This can happen with multi-page documents where page ordering varies.",
        fix: "Verify the document page structure. Ensure training accounts for the correct page location for each field."
      },
      {
        name: "Wrong Region Size",
        code: "WrongRegion",
        status: "fail",
        summary: "The captured region dimensions are incorrect.",
        detail:
          "The bounding box (region) drawn or detected for this field is too large, too small, or the wrong shape. This affects what content gets extracted.",
        fix: "Resize the field region in the training interface to properly encompass the entire field value without capturing extra content."
      }
    ]
  },
  {
    key: "system",
    title: "System & Assignment Status",
    subtitle: "How the system processed or failed to process fields",
    tone: "info",
    items: [
      {
        name: "Unassigned Valid",
        code: "UnassignedValid",
        status: "warn",
        summary: "A valid field exists but has no assigned region.",
        detail:
          "The system knows this field should exist on the document (it is defined in the template), but no region has been drawn or assigned to capture it. The field contains valid data that should be extracted.",
        fix: "In the training interface, draw a region around this field on the document to teach the system where to find it."
      },
      {
        name: "Unassigned Invalid",
        code: "UnassignedInvalid",
        status: "warn",
        summary: "An unassigned field with invalid or no data.",
        detail:
          "Similar to Unassigned Valid, but the field either does not exist on this document type or contains no meaningful data. May be an optional field that is not present.",
        fix: "Determine if this field is truly needed for this document type. If optional, it can be ignored. If required, assign a region."
      },
      {
        name: "Unknown",
        code: "Unknown",
        status: "warn",
        summary: "The system could not determine the field status.",
        detail:
          "An error occurred during processing that prevented the system from categorizing this field outcome. Could be due to processing timeouts, corrupted data, or system errors.",
        fix: "Try reprocessing the document. If the issue persists, check document quality or contact support."
      },
      {
        name: "Unknown Captured Region",
        code: "UnknownCapturedRegion",
        status: "warn",
        summary: "The captured region could not be identified.",
        detail:
          "The system extracted a region but could not match it to a known field definition. May occur with new document formats the system has not been trained on.",
        fix: "Review if this is a new document format requiring training, or if existing templates need updates."
      },
      {
        name: "Unknown True Region",
        code: "UnknownTrueRegion",
        status: "warn",
        summary: "The expected (ground truth) region is not defined.",
        detail:
          "There is no reference data for where this field should be located. This typically occurs during initial testing before complete training data is established.",
        fix: "Define the expected field locations in the training/testing dataset to enable accurate comparison."
      }
    ]
  }
];

const QUICK_REF = [
  { icon: <CheckCircle2 size={16} />, tone: "ok", title: "Correct", body: "Field captured successfully" },
  { icon: <AlertTriangle size={16} />, tone: "warn", title: "Location Issues", body: "Region needs adjustment in training" },
  { icon: <XCircle size={16} />, tone: "fail", title: "Value Errors", body: "OCR or input mismatch" },
  { icon: <HelpCircle size={16} />, tone: "info", title: "Unassigned", body: "Field needs to be defined" }
];

const STATUS_ICON = {
  ok: <CheckCircle2 size={16} />,
  fail: <XCircle size={16} />,
  warn: <AlertTriangle size={16} />
};

const GROUP_ICON = {
  error: <XCircle size={18} />,
  warn: <AlertTriangle size={18} />,
  info: <MapPin size={18} />
};

function matchItem(item, q) {
  if (!q) return true;
  return [item.name, item.code, item.summary, item.detail, item.fix].join(" ").toLowerCase().includes(q);
}

function ErrorRow({ item }) {
  return (
    <div className="docs-row">
      <div className={`docs-et tone-${item.status}`}>
        <span className="docs-et-name">
          <span className="docs-et-icon">{STATUS_ICON[item.status]}</span>
          {item.name}
        </span>
        <span className="docs-code">{item.code}</span>
      </div>
      <div className="docs-mean">
        <strong>{item.summary}</strong>
        <p>{item.detail}</p>
      </div>
      <div className="docs-fix">{item.fix}</div>
    </div>
  );
}

export default function DocumentationView() {
  const [query, setQuery] = useState("");
  const [collapsed, setCollapsed] = useState({});
  const q = query.trim().toLowerCase();

  const groups = useMemo(
    () => GROUPS.map((g) => ({ ...g, matches: g.items.filter((it) => matchItem(it, q)) })).filter((g) => g.matches.length),
    [q]
  );

  const totalMatches = groups.reduce((s, g) => s + g.matches.length, 0);

  return (
    <div className="fade-in al-page docs-view">
      {/* Hero */}
      <div className="hero" style={{ marginBottom: 18 }}>
        <div>
          <div className="eyebrow">
            <BookOpen size={14} /> Reference
          </div>
          <h1 style={{ fontSize: "clamp(34px,4.5vw,56px)" }}>Documentation</h1>
          <p className="sub">Understanding report metrics &amp; error types.</p>
        </div>
      </div>

      {/* About callout */}
      <div className="panel docs-about">
        <div className="panel-title" style={{ color: "var(--blue)", marginBottom: 8 }}>
          About these reports
        </div>
        <p>
          The reports in this dashboard show how accurately the system captures data from documents. During{" "}
          <b>training</b>, users draw regions on documents to teach the system where fields are located. The AI then
          learns to find these fields automatically on new documents. Errors occur when the captured data does not match
          what was expected — this guide explains each error type and how to resolve it.
        </p>
      </div>

      {/* Search */}
      <label className="docs-search">
        <Search size={18} />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search error types…"
          aria-label="Search error types"
        />
      </label>

      {/* Groups */}
      {groups.map((g) => {
        const isOpen = q ? true : !collapsed[g.key];
        return (
          <div className="panel docs-group" key={g.key}>
            <button
              type="button"
              className="docs-group-head"
              onClick={() => setCollapsed((c) => ({ ...c, [g.key]: !c[g.key] }))}
              aria-expanded={isOpen}
            >
              <ChevronDown size={18} className={"docs-chevron" + (isOpen ? " open" : "")} />
              <span className={`docs-group-icon tone-${g.tone}`}>{GROUP_ICON[g.tone]}</span>
              <span className="docs-group-title">
                <span className="panel-title">{g.title}</span>
                <span className="panel-sub">{g.subtitle}</span>
              </span>
              <span className={`docs-count tone-${g.tone}`}>{g.matches.length}</span>
            </button>

            {isOpen && (
              <div className="docs-table">
                <div className="docs-colhead">
                  <span>Error Type</span>
                  <span>What It Means</span>
                  <span>How to Fix</span>
                </div>
                {g.matches.map((it) => (
                  <ErrorRow item={it} key={it.code} />
                ))}
              </div>
            )}
          </div>
        );
      })}

      {totalMatches === 0 && <div className="chart-empty">No error types match “{query}”.</div>}

      {/* Quick reference */}
      <div className="docs-quickref">
        {QUICK_REF.map((r) => (
          <div className={`docs-qr tone-${r.tone}`} key={r.title}>
            <span className="docs-qr-icon">{r.icon}</span>
            <div>
              <div className="docs-qr-title">{r.title}</div>
              <div className="docs-qr-body">{r.body}</div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

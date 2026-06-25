/**
 * App — single source of truth for the whole SPA.
 *
 * Owns every parsed dataset (dashboard / details / vendor / template), `sessionInfo`,
 * `theme`, and the `activeView` string that acts as the router (there is no router lib).
 * `handleDataLoaded` ingests results from UploadView; `viewMemory` persists per-view UI
 * state (filters, expansion, page) to sessionStorage. See ARCHITECTURE.md §4.
 */
import { useEffect, useState } from "react";
import DashboardView from "./components/DashboardView.jsx";
import DetailsReport from "./components/DetailsReport.jsx";
import AiAssistant from "./components/AiAssistant.jsx";
import DocumentationView from "./components/DocumentationView.jsx";
import Landing from "./components/Landing.jsx";
import Sidebar from "./components/Sidebar.jsx";
import SqlConnector from "./components/SqlConnector.jsx";
import TemplateMatching from "./components/TemplateMatching.jsx";
import UploadView from "./components/UploadView.jsx";
import VendorReport from "./components/VendorReport.jsx";
import { matchPassKey } from "./utils/parsers.js";

const VIEW_MEMORY_KEY = "ancoralens:view-memory";

function loadViewMemory() {
  try {
    return JSON.parse(sessionStorage.getItem(VIEW_MEMORY_KEY) || "{}");
  } catch {
    return {};
  }
}

// Floating, non-blocking banner for the background document-archive ingest. Lives at App level so it
// persists while the user works in the dashboard/details views during a long (multi-GB) index.
function ImageLoadBanner({ status, onDismiss }) {
  const [elapsed, setElapsed] = useState(0);
  const startedAt = status?.startedAt || null;

  useEffect(() => {
    if (!startedAt || status?.done || status?.error) return undefined;
    const tick = () => setElapsed(Math.floor((Date.now() - startedAt) / 1000));
    tick();
    const handle = window.setInterval(tick, 1000);
    return () => window.clearInterval(handle);
  }, [startedAt, status?.done, status?.error]);

  // Once indexing succeeds, auto-dismiss the banner after a few seconds so it doesn't linger.
  useEffect(() => {
    if (!status?.done || status?.error) return undefined;
    const handle = window.setTimeout(() => onDismiss?.(), 6000);
    return () => window.clearTimeout(handle);
  }, [status?.done, status?.error, onDismiss]);

  if (!status) return null;

  const { message, loaded, total, error, done, phase } = status;
  const pct = total ? Math.min(100, Math.round((loaded / total) * 100)) : null;
  const mins = Math.floor(elapsed / 60);
  const secs = elapsed % 60;
  const elapsedLabel = mins ? `${mins}m ${secs}s` : `${secs}s`;

  return (
    <div className={`image-load-banner ${error ? "is-error" : done ? "is-done" : ""}`} role="status" aria-live="polite">
      <div className="ilb-row">
        {!done && !error && <span className="dv-spinner" aria-hidden="true" />}
        <div className="ilb-text">
          <strong>
            {error ? "Document archive failed to load" : done ? "Documents ready" : "Indexing document archive…"}
          </strong>
          <span>{error || message || "Working…"}</span>
        </div>
        <div className="ilb-meta">
          {!done && !error && <span className="ilb-elapsed">{elapsedLabel}</span>}
          {(done || error) && (
            <button type="button" className="ilb-dismiss" onClick={onDismiss} aria-label="Dismiss">
              ✕
            </button>
          )}
        </div>
      </div>
      {!done && !error && (
        <div className="ilb-bar">
          <div className={`ilb-bar-fill ${pct == null ? "indeterminate" : ""}`} style={pct == null ? undefined : { width: `${pct}%` }} />
        </div>
      )}
      {phase === "directory" && !done && !error && (
        <div className="ilb-hint">Large batches can take several minutes — you can keep working; this finishes in the background.</div>
      )}
    </div>
  );
}

function EmptyPanel({ title, message, onUpload }) {
  return (
    <section className="fade-in glass-panel empty-state">
      <h3>{title}</h3>
      <p>{message}</p>
      <button type="button" className="glass-button" onClick={onUpload}>
        Go to Upload
      </button>
    </section>
  );
}

export default function App() {
  const [activeView, setActiveView] = useState("landing");
  const [theme, setTheme] = useState("light");
  const [dashboardData, setDashboardData] = useState(null);
  const [detailsData, setDetailsData] = useState(null);
  const [vendorData, setVendorData] = useState(null);
  const [templateData, setTemplateData] = useState(null);
  const [trainingPassData, setTrainingPassData] = useState({});
  const [activePass, setActivePass] = useState(null);
  const [imageIndex, setImageIndex] = useState(null);
  // Document-archive ingest status, lifted here so the progress banner survives navigating away from
  // the Upload view while a multi-GB archive indexes in the background.
  const [imageStatus, setImageStatus] = useState(null);
  const [sessionInfo, setSessionInfo] = useState(null);
  const [viewMemory, setViewMemory] = useState(loadViewMemory);

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
  }, [theme]);

  useEffect(() => {
    sessionStorage.setItem(VIEW_MEMORY_KEY, JSON.stringify(viewMemory));
  }, [viewMemory]);

  const hasData = Boolean(
    dashboardData || detailsData || vendorData || templateData || Object.keys(trainingPassData).length
  );

  const updateViewMemory = (view, patch) => {
    setViewMemory((current) => ({
      ...current,
      [view]: {
        ...(current[view] || {}),
        ...patch
      }
    }));
  };

  const openDetailsForTrainingPass = (trainingPassName) => {
    updateViewMemory("details", { requestedTrainingPass: trainingPassName, page: 1 });
    setActiveView("details");
  };

  // Resolve the per-pass CSV rows for a clicked pass. Per-pass files may be 0-indexed while the
  // summary labels are 1-indexed, so try the exact key, then ±1, before giving up.
  const resolvePassRows = (trainingPassName) => {
    const key = matchPassKey(trainingPassName);
    if (key == null) return null;
    const candidates = [key, String(Number(key) - 1), String(Number(key) + 1)];
    const hit = candidates.find((candidate) => trainingPassData[candidate]);
    return hit ? trainingPassData[hit] : null;
  };

  const openPassDashboard = (trainingPassName) => {
    setActivePass(trainingPassName);
    setActiveView("passDashboard");
  };

  const handleDataLoaded = (type, payload, sessionPatch = null) => {
    switch (type) {
      case "dashboard":
        setDashboardData(payload);
        if (sessionPatch) setSessionInfo((current) => ({ ...current, ...sessionPatch }));
        break;
      case "details":
        setDetailsData(payload);
        break;
      case "trainingPass":
        // payload = parsed rows, sessionPatch = the pass key (e.g. "0", "1")
        setTrainingPassData((current) => ({ ...current, [sessionPatch]: payload }));
        break;
      case "images":
        setImageIndex((previous) => {
          if (previous && previous !== payload) previous.close?.();
          return payload;
        });
        break;
      case "imagesProgress":
        // payload = { phase, message, loaded, total, error, done } from the archive indexer.
        setImageStatus(payload);
        break;
      case "vendor":
        setVendorData(payload);
        break;
      case "template":
        setTemplateData(payload);
        break;
      case "session":
        setSessionInfo((current) => ({ ...current, ...payload }));
        break;
      case "all":
        if (payload.dashboard) setDashboardData(payload.dashboard);
        if (payload.details) setDetailsData(payload.details);
        if (payload.vendor) setVendorData(payload.vendor);
        if (payload.template) setTemplateData(payload.template);
        if (payload.trainingPasses && Object.keys(payload.trainingPasses).length) {
          setTrainingPassData((current) => ({ ...current, ...payload.trainingPasses }));
        }
        if (payload.images) setImageIndex(payload.images);
        if (payload.session) setSessionInfo((current) => ({ ...current, ...payload.session }));
        break;
      case "imagesReset":
        setImageStatus(null);
        break;
      default:
        console.warn("Unknown data type loaded:", type);
    }
  };

  const resetSession = () => {
    setDashboardData(null);
    setDetailsData(null);
    setVendorData(null);
    setTemplateData(null);
    setTrainingPassData({});
    setActivePass(null);
    setImageIndex((previous) => {
      previous?.close?.();
      return null;
    });
    setImageStatus(null);
    setSessionInfo(null);
    setViewMemory({});
    sessionStorage.removeItem(VIEW_MEMORY_KEY);
    setActiveView("landing");
  };

  const reportContext = {
    dashboard: dashboardData,
    details: detailsData,
    vendor: vendorData,
    template: templateData,
    session: sessionInfo
  };

  if (activeView === "landing") {
    return <Landing onStart={() => setActiveView("upload")} />;
  }

  return (
    <div className="app-container">
      <Sidebar
        activeView={activeView}
        setActiveView={setActiveView}
        sessionInfo={sessionInfo}
        hasData={hasData}
        onReset={resetSession}
        theme={theme}
        toggleTheme={() => setTheme((current) => (current === "dark" ? "light" : "dark"))}
      />

      <main className="main-content">
        {activeView === "upload" && (
          <UploadView onDataLoaded={handleDataLoaded} onComplete={(nextView) => setActiveView(nextView || "dashboard")} />
        )}

        {activeView === "dashboard" &&
          (dashboardData ? (
            <DashboardView
              sessionInfo={sessionInfo}
              data={dashboardData}
              detailsData={detailsData}
              vendorData={vendorData}
              onTrainingPassSelect={openDetailsForTrainingPass}
              onOpenPassDashboard={openPassDashboard}
            />
          ) : (
            <EmptyPanel
              title="No Dashboard Metrics Loaded"
              message='Upload "TrainingPassSummary.csv" or use Folder Auto-Load.'
              onUpload={() => setActiveView("upload")}
            />
          ))}

        {activeView === "passDashboard" &&
          (() => {
            const passRows = resolvePassRows(activePass);
            if (!passRows) {
              return (
                <EmptyPanel
                  title={`No data loaded for ${activePass || "this training pass"}`}
                  message='Upload its per-pass CSV ("TrainingPass*.csv") via the Training Pass tile or folder auto-load.'
                  onUpload={() => setActiveView("upload")}
                />
              );
            }
            const passKey = matchPassKey(activePass);
            const passDetails =
              detailsData?.filter(
                (row) => matchPassKey(row.TrainingPass || row.Pass || row.trainingPass || "") === passKey
              ) || null;
            return (
              <DashboardView
                sessionInfo={sessionInfo}
                data={passRows}
                detailsData={passDetails && passDetails.length ? passDetails : null}
                vendorData={null}
                onTrainingPassSelect={openDetailsForTrainingPass}
                passContext={{ passName: activePass, onBack: () => setActiveView("dashboard") }}
              />
            );
          })()}

        {activeView === "details" &&
          (detailsData ? (
            <DetailsReport
              data={detailsData}
              imageIndex={imageIndex}
              savedState={viewMemory.details}
              onStateChange={(patch) => updateViewMemory("details", patch)}
            />
          ) : (
            <EmptyPanel
              title="No Detailed Report Loaded"
              message='Upload "flatReportData.csv" or use Folder Auto-Load.'
              onUpload={() => setActiveView("upload")}
            />
          ))}

        {activeView === "vendor" &&
          (vendorData ? (
            <VendorReport
              data={vendorData}
              savedState={viewMemory.vendor}
              onStateChange={(patch) => updateViewMemory("vendor", patch)}
            />
          ) : (
            <EmptyPanel
              title="No Vendor Analysis Loaded"
              message="Upload a Vendor Report CSV or use Folder Auto-Load."
              onUpload={() => setActiveView("upload")}
            />
          ))}

        {activeView === "template" &&
          (templateData ? (
            <TemplateMatching
              data={templateData}
              savedState={viewMemory.template}
              onStateChange={(patch) => updateViewMemory("template", patch)}
            />
          ) : (
            <EmptyPanel
              title="No Template Matching Loaded"
              message="Upload a template matching CSV or use Folder Auto-Load."
              onUpload={() => setActiveView("upload")}
            />
          ))}

        {activeView === "sql" && <SqlConnector />}

        {activeView === "ai" && <AiAssistant reportContext={reportContext} />}

        {activeView === "docs" && <DocumentationView hasData={hasData} />}
      </main>

      <ImageLoadBanner status={imageStatus} onDismiss={() => setImageStatus(null)} />
    </div>
  );
}

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

const VIEW_MEMORY_KEY = "ancoralens:view-memory";

function loadViewMemory() {
  try {
    return JSON.parse(sessionStorage.getItem(VIEW_MEMORY_KEY) || "{}");
  } catch {
    return {};
  }
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
  const [theme, setTheme] = useState("dark");
  const [dashboardData, setDashboardData] = useState(null);
  const [detailsData, setDetailsData] = useState(null);
  const [vendorData, setVendorData] = useState(null);
  const [templateData, setTemplateData] = useState(null);
  const [sessionInfo, setSessionInfo] = useState(null);
  const [viewMemory, setViewMemory] = useState(loadViewMemory);

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
  }, [theme]);

  useEffect(() => {
    sessionStorage.setItem(VIEW_MEMORY_KEY, JSON.stringify(viewMemory));
  }, [viewMemory]);

  const hasData = Boolean(dashboardData || detailsData || vendorData || templateData);

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

  const handleDataLoaded = (type, payload, sessionPatch = null) => {
    switch (type) {
      case "dashboard":
        setDashboardData(payload);
        if (sessionPatch) setSessionInfo((current) => ({ ...current, ...sessionPatch }));
        break;
      case "details":
        setDetailsData(payload);
        break;
      case "vendor":
        setVendorData(payload);
        break;
      case "template":
        setTemplateData(payload);
        break;
      case "session":
        setSessionInfo(payload);
        break;
      case "all":
        if (payload.dashboard) setDashboardData(payload.dashboard);
        if (payload.details) setDetailsData(payload.details);
        if (payload.vendor) setVendorData(payload.vendor);
        if (payload.template) setTemplateData(payload.template);
        if (payload.session) setSessionInfo(payload.session);
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
              data={dashboardData}
              detailsData={detailsData}
              vendorData={vendorData}
              onTrainingPassSelect={openDetailsForTrainingPass}
            />
          ) : (
            <EmptyPanel
              title="No Dashboard Metrics Loaded"
              message='Upload "TrainingPassSummary.csv" or use Folder Auto-Load.'
              onUpload={() => setActiveView("upload")}
            />
          ))}

        {activeView === "details" &&
          (detailsData ? (
            <DetailsReport
              data={detailsData}
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
    </div>
  );
}

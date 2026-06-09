import {
  BookOpen,
  BarChart3,
  ChevronRight,
  Database,
  FileSpreadsheet,
  Grid3X3,
  Sparkles,
  Moon,
  RefreshCw,
  Sun,
  Upload,
  Users
} from "lucide-react";

function NavButton({ icon, label, active, disabled, onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`nav-item ${active ? "active" : ""}`}
    >
      {icon}
      <span>{label}</span>
      {active && <ChevronRight className="nav-active-icon" size={16} />}
    </button>
  );
}

export default function Sidebar({
  activeView,
  setActiveView,
  sessionInfo,
  hasData,
  onReset,
  theme,
  toggleTheme
}) {
  return (
    <aside className="glass-sidebar app-sidebar">
      <button type="button" className="sidebar-brand" onClick={() => setActiveView("landing")}>
        <div>
          {sessionInfo ? (
            <h2 className="client-title">{sessionInfo.clientName}</h2>
          ) : (
            <h2 className="brand-title">
              <span>ancora</span>
              <strong>Lens</strong>
            </h2>
          )}
        </div>
        <p>{sessionInfo?.version || "CSV INTEL"}</p>
      </button>

      <nav className="sidebar-nav">
        <NavButton
          icon={<Upload size={20} />}
          label="Upload Data"
          active={activeView === "upload"}
          onClick={() => setActiveView("upload")}
        />
        <NavButton
          icon={<BarChart3 size={20} />}
          label="Dashboard Metrics"
          active={activeView === "dashboard"}
          disabled={!hasData}
          onClick={() => setActiveView("dashboard")}
        />
        <NavButton
          icon={<FileSpreadsheet size={20} />}
          label="Detailed Report"
          active={activeView === "details"}
          disabled={!hasData}
          onClick={() => setActiveView("details")}
        />
        <NavButton
          icon={<Users size={20} />}
          label="Vendor Analysis"
          active={activeView === "vendor"}
          disabled={!hasData}
          onClick={() => setActiveView("vendor")}
        />
        <NavButton
          icon={<Grid3X3 size={20} />}
          label="Template Matching"
          active={activeView === "template"}
          disabled={!hasData}
          onClick={() => setActiveView("template")}
        />
        <NavButton
          icon={<Database size={20} />}
          label="SQL Connector"
          active={activeView === "sql"}
          onClick={() => setActiveView("sql")}
        />
        <NavButton
          icon={<Sparkles size={20} />}
          label="AI Assistant"
          active={activeView === "ai"}
          onClick={() => setActiveView("ai")}
        />
        <div className="sidebar-separator" />
        <NavButton
          icon={<BookOpen size={20} />}
          label="Documentation"
          active={activeView === "docs"}
          onClick={() => setActiveView("docs")}
        />
      </nav>

      <div className="sidebar-actions">
        <button type="button" className="glass-button sidebar-button" onClick={toggleTheme}>
          {theme === "dark" ? <Sun size={16} /> : <Moon size={16} />}
          {theme === "dark" ? "Light Mode" : "Dark Mode"}
        </button>
        <button type="button" className="glass-button sidebar-button muted" onClick={onReset}>
          <RefreshCw size={16} />
          Reset Session
        </button>
      </div>
    </aside>
  );
}

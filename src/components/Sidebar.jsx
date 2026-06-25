/**
 * Sidebar — left navigation rail. Switches `activeView`, toggles theme, resets session.
 * Data views (Dashboard/Details/Vendor/Template) are disabled until `hasData`; SQL / AI /
 * Documentation are always enabled. Shows the client/session title when sessionInfo exists.
 * Props: { activeView, setActiveView, sessionInfo, hasData, onReset, theme, toggleTheme }.
 */
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
import { APP_BUILD } from "../appBuild.js";

function NavButton({ icon, label, active, disabled, onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`nav-item${active ? " active" : ""}`}
    >
      {icon}
      <span>{label}</span>
      {active && <ChevronRight className="nav-active-icon" size={14} strokeWidth={2.5} />}
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
    <aside className="app-sidebar">
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
        <p>{sessionInfo?.version || "CSV Intelligence"}</p>
        <span className="app-build">APP BUILD: {APP_BUILD}</span>
      </button>

      <nav className="sidebar-nav">
        <NavButton
          icon={<Upload size={17} />}
          label="Upload Data"
          active={activeView === "upload"}
          onClick={() => setActiveView("upload")}
        />
        <NavButton
          icon={<BarChart3 size={17} />}
          label="Dashboard"
          active={activeView === "dashboard" || activeView === "passDashboard"}
          disabled={!hasData}
          onClick={() => setActiveView("dashboard")}
        />
        <NavButton
          icon={<FileSpreadsheet size={17} />}
          label="Detailed Report"
          active={activeView === "details"}
          disabled={!hasData}
          onClick={() => setActiveView("details")}
        />
        <NavButton
          icon={<Users size={17} />}
          label="Vendor Analysis"
          active={activeView === "vendor"}
          disabled={!hasData}
          onClick={() => setActiveView("vendor")}
        />
        <NavButton
          icon={<Grid3X3 size={17} />}
          label="Template Matching"
          active={activeView === "template"}
          disabled={!hasData}
          onClick={() => setActiveView("template")}
        />
        <NavButton
          icon={<Database size={17} />}
          label="SQL Connector"
          active={activeView === "sql"}
          onClick={() => setActiveView("sql")}
        />
        <NavButton
          icon={<Sparkles size={17} />}
          label="AI Assistant"
          active={activeView === "ai"}
          onClick={() => setActiveView("ai")}
        />

        <div className="sidebar-separator" />

        <NavButton
          icon={<BookOpen size={17} />}
          label="Documentation"
          active={activeView === "docs"}
          onClick={() => setActiveView("docs")}
        />
      </nav>

      <div className="sidebar-actions">
        <button type="button" className="glass-button sidebar-button" onClick={toggleTheme}>
          {theme === "dark" ? <Sun size={14} /> : <Moon size={14} />}
          {theme === "dark" ? "Light mode" : "Dark mode"}
        </button>
        <button type="button" className="glass-button sidebar-button muted" onClick={onReset}>
          <RefreshCw size={14} />
          Reset session
        </button>
      </div>
    </aside>
  );
}

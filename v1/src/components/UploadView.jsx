import { AlertTriangle, BarChart3, FileText, FolderOpen, Grid3X3, LoaderCircle, Users } from "lucide-react";
import { useRef, useState } from "react";
import { parseCsvFile, readFileAsText } from "../utils/csv.js";
import { looksLikeTemplateMatching, parseTemplateMatching } from "../utils/parsers.js";

function UploadCard({ title, filename, icon, color, borderColor, onSelect, children }) {
  return (
    <button type="button" className="glass-panel upload-card" style={{ borderColor }} onClick={onSelect}>
      <div className="upload-card-icon" style={{ background: color }}>
        {icon}
      </div>
      <h4>{title}</h4>
      <p>{filename}</p>
      {children}
    </button>
  );
}

export default function UploadView({ onDataLoaded, onComplete }) {
  const [processing, setProcessing] = useState(false);
  const [error, setError] = useState(null);
  const [status, setStatus] = useState(null);
  const folderInput = useRef(null);
  const dashboardInput = useRef(null);
  const detailsInput = useRef(null);
  const vendorInput = useRef(null);
  const templateInput = useRef(null);

  const loadFolder = async (event) => {
    const files = Array.from(event.target.files || []);
    if (!files.length) return;

    setProcessing(true);
    setError(null);
    setStatus(null);

    try {
      const result = {
        session: null,
        dashboard: null,
        details: null,
        vendor: null,
        template: null
      };

      const infoFile = files.find((file) => file.name.toLowerCase() === "info.txt");
      if (infoFile) {
        const info = await readFileAsText(infoFile);
        const lines = info.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
        result.session = {
          clientName: lines[0] || "Unknown Client",
          version: lines[1] || "",
          raw: info
        };
      }

      const summaryFile = files.find((file) => {
        const name = file.name.toLowerCase();
        return name.includes("summary") && name.endsWith(".csv");
      });
      if (summaryFile) result.dashboard = await parseCsvFile(summaryFile);

      const detailsFile = files.find((file) => {
        const name = file.name.toLowerCase();
        return (name === "flatreportdata.csv" || name.startsWith("_flat")) && name.endsWith(".csv");
      });
      if (detailsFile) result.details = await parseCsvFile(detailsFile);

      const vendorCandidates = files
        .filter((file) => {
          const name = file.name.toLowerCase();
          return name.includes("vendor") && name.endsWith(".csv");
        })
        .sort((left, right) => right.lastModified - left.lastModified);
      const vendorReportFiles = vendorCandidates.filter((file) => {
        const name = file.name.toLowerCase();
        return name.includes("report") && !name.includes("low_overall_accuracy");
      });
      const vendorLowFiles = vendorCandidates.filter((file) => file.name.toLowerCase().includes("low_overall_accuracy"));
      const selectedVendorFile = vendorReportFiles[0] || vendorLowFiles[0] || vendorCandidates[0];
      if (selectedVendorFile) result.vendor = await parseCsvFile(selectedVendorFile);

      const csvFiles = files.filter((file) => file.name.toLowerCase().endsWith(".csv"));
      const templateFileByName = csvFiles.find((file) => {
        const name = file.name.toLowerCase();
        return name.includes("template") || name.includes("region");
      });

      if (templateFileByName) {
        result.template = parseTemplateMatching(await parseCsvFile(templateFileByName));
      } else {
        for (const candidate of csvFiles) {
          if ([summaryFile, detailsFile, selectedVendorFile].includes(candidate)) continue;
          const rows = await parseCsvFile(candidate);
          if (looksLikeTemplateMatching(rows)) {
            result.template = parseTemplateMatching(rows);
            break;
          }
        }
      }

      onDataLoaded("all", result);
      setProcessing(false);
      setStatus("success");

      if (result.dashboard || result.details || result.vendor || result.template) {
        const nextView = result.dashboard ? "dashboard" : result.template ? "template" : result.vendor ? "vendor" : "details";
        window.setTimeout(() => onComplete(nextView), 1000);
      } else {
        setError("No relevant data files found in folder.");
      }
    } catch (exception) {
      setProcessing(false);
      setError(`Error processing folder: ${exception.message}`);
    } finally {
      event.target.value = "";
    }
  };

  const loadSingleFile = async (event, type) => {
    const file = event.target.files?.[0];
    if (!file) return;

    setProcessing(true);
    setError(null);

    try {
      const rows = await parseCsvFile(file);
      const payload = type === "template" ? parseTemplateMatching(rows) : rows;
      onDataLoaded(type, payload);
      setProcessing(false);
      setStatus("success");
      window.setTimeout(() => onComplete(type), 700);
    } catch (exception) {
      setProcessing(false);
      setError(`Error parsing ${type}: ${exception.message}`);
    } finally {
      event.target.value = "";
    }
  };

  return (
    <div className="fade-in upload-view">
      <h2>Upload Data Files</h2>

      {error && (
        <div className="alert error">
          <AlertTriangle size={20} />
          {error}
        </div>
      )}

      {status === "success" && !processing && (
        <div className="alert success">Data loaded successfully.</div>
      )}

      {processing && (
        <div className="processing-overlay">
          <div className="glass-panel processing-panel">
            <LoaderCircle className="spin" size={32} color="var(--accent-primary)" />
            <p>Processing files...</p>
          </div>
        </div>
      )}

      <section className="glass-panel folder-panel">
        <div className="folder-icon">
          <FolderOpen size={32} color="#a855f7" />
        </div>
        <h3>Auto-Load from Folder</h3>
        <p>Fastest way to load structured datasets</p>
        <button type="button" className="crystal-button-blue" onClick={() => folderInput.current.click()}>
          <FolderOpen size={18} />
          Select Data Folder
        </button>
        <input
          type="file"
          ref={folderInput}
          webkitdirectory=""
          directory=""
          onChange={loadFolder}
          hidden
        />
      </section>

      <div className="upload-divider">
        <span />
        <strong>OR UPLOAD MANUALLY</strong>
        <span />
      </div>

      <div className="upload-grid">
        <UploadCard
          title="Metrics"
          filename="TrainingPassSummary.csv"
          icon={<BarChart3 size={24} color="#3b82f6" />}
          color="rgba(59, 130, 246, 0.1)"
          borderColor="rgba(59, 130, 246, 0.3)"
          onSelect={() => dashboardInput.current.click()}
        >
          <input
            type="file"
            ref={dashboardInput}
            accept=".csv"
            onChange={(event) => loadSingleFile(event, "dashboard")}
            hidden
          />
        </UploadCard>

        <UploadCard
          title="Details"
          filename="flatReportData.csv"
          icon={<FileText size={24} color="#8b5cf6" />}
          color="rgba(139, 92, 246, 0.1)"
          borderColor="rgba(139, 92, 246, 0.3)"
          onSelect={() => detailsInput.current.click()}
        >
          <input
            type="file"
            ref={detailsInput}
            accept=".csv"
            onChange={(event) => loadSingleFile(event, "details")}
            hidden
          />
        </UploadCard>

        <UploadCard
          title="Vendor"
          filename="*Vendor*.csv"
          icon={<Users size={24} color="#f97316" />}
          color="rgba(249, 115, 22, 0.1)"
          borderColor="rgba(249, 115, 22, 0.3)"
          onSelect={() => vendorInput.current.click()}
        >
          <input
            type="file"
            ref={vendorInput}
            accept=".csv"
            onChange={(event) => loadSingleFile(event, "vendor")}
            hidden
          />
        </UploadCard>

        <UploadCard
          title="Templates"
          filename="*Template*.csv"
          icon={<Grid3X3 size={24} color="#6366f1" />}
          color="rgba(99, 102, 241, 0.1)"
          borderColor="rgba(99, 102, 241, 0.3)"
          onSelect={() => templateInput.current.click()}
        >
          <input
            type="file"
            ref={templateInput}
            accept=".csv"
            onChange={(event) => loadSingleFile(event, "template")}
            hidden
          />
        </UploadCard>
      </div>
    </div>
  );
}

/**
 * UploadView — ingests report data two ways:
 *   - Folder auto-load (webkitdirectory): classifies nested files by name with lenient
 *     matchers (see ARCHITECTURE.md §5) and records the source folder name for the chip.
 *   - Five single-file tiles (Metrics / Details / Vendor / Templates / Training Pass).
 * CSVs are parsed in-browser; raw rows are handed up via onDataLoaded(type, payload[, session]).
 * Props: { onDataLoaded, onComplete }.
 */
import { AlertTriangle, BarChart3, Check, FileText, FolderOpen, Grid3X3, Images, Layers, LoaderCircle, Upload, Users } from "lucide-react";
import { useRef, useState } from "react";
import { parseCsvFile, readFileAsText } from "../utils/csv.js";
import { parseBatchZip } from "../utils/batchImages.js";
import { looksLikeTemplateMatching, matchPassKey, parseTemplateMatching } from "../utils/parsers.js";

const MANUAL_FILES = [
  {
    type: "dashboard",
    title: "Metrics",
    filename: "TrainingPassSummary.csv",
    icon: <BarChart3 size={18} color="#2B3AE8" />,
    tint: "rgba(43,58,232,0.10)"
  },
  {
    type: "details",
    title: "Details",
    filename: "flatReportData.csv",
    icon: <FileText size={18} color="#6B4FD8" />,
    tint: "rgba(107,79,216,0.12)"
  },
  {
    type: "vendor",
    title: "Vendor",
    filename: "*Vendor*.csv",
    icon: <Users size={18} color="#F0552B" />,
    tint: "rgba(240,85,43,0.12)"
  },
  {
    type: "template",
    title: "Templates",
    filename: "*Template*.csv",
    icon: <Grid3X3 size={18} color="#15966B" />,
    tint: "rgba(21,150,107,0.12)"
  },
  {
    type: "trainingPass",
    title: "Training Pass",
    filename: "TrainingPass*.csv",
    icon: <Layers size={18} color="#E6A12C" />,
    tint: "rgba(230,161,44,0.14)",
    multiple: true
  },
  {
    type: "images",
    title: "Doc Images",
    filename: "*.zip (BatchData export)",
    icon: <Images size={18} color="#0E8F8A" />,
    tint: "rgba(14,143,138,0.14)",
    accept: ".zip"
  }
];

const STEPS = [
  { t: "Auto-detect", d: "Point us at a results folder — we find your summary, details, vendor and template CSVs." },
  { t: "Parse & validate", d: "Each CSV is parsed into metrics, field accuracy, vendors and batches." },
  { t: "Explore", d: "Jump straight into the dashboard, reports, SQL console and AI assistant." }
];

const EXPECTED = ["info.txt", "*Summary*.csv", "flatReportData.csv", "*Vendor*.csv", "*Template*.csv", "TrainingPass*.csv"];

export default function UploadView({ onDataLoaded, onComplete }) {
  const [processing, setProcessing] = useState(false);
  const [error, setError] = useState(null);
  const [status, setStatus] = useState(null);
  const folderInput = useRef(null);
  const fileInputs = {
    dashboard: useRef(null),
    details: useRef(null),
    vendor: useRef(null),
    template: useRef(null),
    trainingPass: useRef(null),
    images: useRef(null)
  };

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
        template: null,
        trainingPasses: {}
      };

      // Record where the data came from (top-level folder name) so the dashboard can show it.
      const folderName =
        (files.find((file) => file.webkitRelativePath)?.webkitRelativePath || "").split("/")[0] || "Uploaded folder";
      result.session = {
        source: { kind: "folder", name: folderName, fileCount: files.length, loadedAt: Date.now() }
      };

      const infoFile = files.find((file) => file.name.toLowerCase() === "info.txt");
      if (infoFile) {
        const info = await readFileAsText(infoFile);
        const lines = info.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
        result.session = {
          ...result.session,
          clientName: lines[0] || "Unknown Client",
          version: lines[1] || "",
          raw: info
        };
      }

      // Prefer the *Summary*.csv (full metrics incl. per-pass training breakdown);
      // only fall back to a *TrainingPass*.csv when no summary file is present.
      const summaryFile =
        files.find((file) => {
          const name = file.name.toLowerCase();
          return name.endsWith(".csv") && name.includes("summary");
        }) ||
        files.find((file) => {
          const name = file.name.toLowerCase();
          return name.endsWith(".csv") && name.includes("trainingpass");
        });
      if (summaryFile) result.dashboard = await parseCsvFile(summaryFile);

      // Per-pass dashboards: every TrainingPass{N}_*.csv (a single-pass summary export), but
      // NOT the overall *Summary* file and NOT whichever file became the dashboard above.
      const passFiles = files
        .filter((file) => {
          const name = file.name.toLowerCase();
          return name.endsWith(".csv") && name.includes("trainingpass") && !name.includes("summary") && file !== summaryFile;
        })
        .sort((left, right) => left.name.localeCompare(right.name));
      for (let index = 0; index < passFiles.length; index += 1) {
        const file = passFiles[index];
        const key = matchPassKey(file.name) ?? String(index);
        result.trainingPasses[key] = await parseCsvFile(file);
      }

      const detailsFile = files.find((file) => {
        const name = file.name.toLowerCase();
        // Detailed report = *flatReportData*.csv (any prefix / subfolder), but NOT the region-templates flat file
        return name.endsWith(".csv") && name.includes("flatreportdata") && !name.includes("regiontemplate");
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
          if ([summaryFile, detailsFile, selectedVendorFile].includes(candidate) || passFiles.includes(candidate)) continue;
          const rows = await parseCsvFile(candidate);
          if (looksLikeTemplateMatching(rows)) {
            result.template = parseTemplateMatching(rows);
            break;
          }
        }
      }

      // Document images: ANY .zip in the folder (not name-bound — real exports use prefixes like
      // "BFS_batchData.zip"). parseBatchZip identifies it by its internal Batches/.../InputFiles
      // structure, so a non-document zip simply yields no docs and is ignored.
      const zipFile = files.find((file) => file.name.toLowerCase().endsWith(".zip"));

      onDataLoaded("all", result);
      setProcessing(false);
      setStatus("success");

      // Parse the zip in the background (it can be very large) so the CSV-driven views load
      // immediately; the Detailed Report's "View document" affordance appears once it resolves.
      if (zipFile) {
        parseBatchZip(zipFile)
          .then((index) => {
            if (index.docs.length) onDataLoaded("images", index);
          })
          .catch((exception) => console.warn("Folder load: could not read", zipFile.name, exception?.message));
      }

      if (
        result.dashboard ||
        result.details ||
        result.vendor ||
        result.template ||
        Object.keys(result.trainingPasses).length ||
        zipFile
      ) {
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
      onDataLoaded("session", { source: { kind: "file", name: file.name, loadedAt: Date.now() } });
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

  // Per-pass dashboards. Accepts one or many TrainingPass{N}_*.csv files at once; each is keyed
  // by its pass number so the dashboard's training-pass table can open the matching one.
  const loadTrainingPassFiles = async (event) => {
    const files = Array.from(event.target.files || []);
    if (!files.length) return;

    setProcessing(true);
    setError(null);

    try {
      for (let index = 0; index < files.length; index += 1) {
        const file = files[index];
        const rows = await parseCsvFile(file);
        const key = matchPassKey(file.name) ?? String(index);
        onDataLoaded("trainingPass", rows, key);
      }
      onDataLoaded("session", {
        source: {
          kind: "file",
          name: files.length > 1 ? `${files.length} training-pass files` : files[0].name,
          loadedAt: Date.now()
        }
      });
      setProcessing(false);
      setStatus("success");
      window.setTimeout(() => onComplete("dashboard"), 700);
    } catch (exception) {
      setProcessing(false);
      setError(`Error parsing training pass: ${exception.message}`);
    } finally {
      event.target.value = "";
    }
  };

  // Document images: a BatchData*.zip of source PDFs. Parsed in-browser into a doc index the
  // Detailed Report uses to render pages with field-region overlays.
  const loadImageZip = async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;

    setProcessing(true);
    setError(null);

    try {
      const index = await parseBatchZip(file);
      if (!index.docs.length) throw new Error("No document PDFs found in this zip.");
      onDataLoaded("images", index);
      onDataLoaded("session", { source: { kind: "file", name: file.name, loadedAt: Date.now() } });
      setProcessing(false);
      setStatus("success");
      window.setTimeout(() => onComplete("details"), 700);
    } catch (exception) {
      setProcessing(false);
      setError(`Error reading images zip: ${exception.message}`);
    } finally {
      event.target.value = "";
    }
  };

  return (
    <div className="fade-in al-page upload-view">
      {/* Hero */}
      <div className="hero" style={{ marginBottom: 20 }}>
        <div>
          <div className="eyebrow">
            <span className="dot" /> Step 1 · Load your data
          </div>
          <h1>
            Bring your data <em>in.</em>
          </h1>
          <p className="sub">
            Auto-load a structured results folder, or upload individual report CSVs. AncoraLens parses each file and
            routes it to the right dashboard.
          </p>
        </div>
      </div>

      {error && (
        <div className="alert error">
          <AlertTriangle size={20} />
          {error}
        </div>
      )}

      {status === "success" && !processing && <div className="alert success">Data loaded successfully.</div>}

      {processing && (
        <div className="processing-overlay">
          <div className="glass-panel processing-panel">
            <LoaderCircle className="spin" size={32} color="var(--accent-primary)" />
            <p>Processing files...</p>
          </div>
        </div>
      )}

      <div className="grid cols-12">
        {/* left: dropzone + manual files */}
        <div className="col-8" style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <div className="panel">
            <div
              className="big-drop"
              role="button"
              tabIndex={0}
              onClick={() => folderInput.current?.click()}
              onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && folderInput.current?.click()}
            >
              <div className="dz-ic">
                <FolderOpen size={32} />
              </div>
              <h3>Auto-load from a folder</h3>
              <p>The fastest way to load a full dataset — select your results folder and we detect the rest</p>
              <span className="btn btn-primary" style={{ marginTop: 18 }}>
                <FolderOpen size={16} /> Select data folder
              </span>
              <div className="dz-meta">
                <span>
                  <Check size={14} color="var(--green)" strokeWidth={2.6} /> Auto-detected
                </span>
                <span>
                  <Check size={14} color="var(--green)" strokeWidth={2.6} /> Parsed locally
                </span>
                <span>
                  <Check size={14} color="var(--green)" strokeWidth={2.6} /> Nothing uploaded
                </span>
              </div>
            </div>
            <input type="file" ref={folderInput} webkitdirectory="" directory="" onChange={loadFolder} hidden />
          </div>

          <div className="panel">
            <div className="panel-head">
              <div>
                <div className="panel-title">Upload individual files</div>
                <div className="panel-sub">add one report at a time</div>
              </div>
            </div>
            <div className="up-tiles">
              {MANUAL_FILES.map((item) => (
                <button
                  key={item.type}
                  type="button"
                  className="up-tile"
                  onClick={() => fileInputs[item.type].current?.click()}
                >
                  <span className="ti" style={{ background: item.tint }}>
                    {item.icon}
                  </span>
                  <span className="tt">{item.title}</span>
                  <span className="tf">{item.filename}</span>
                  <input
                    type="file"
                    ref={fileInputs[item.type]}
                    accept={item.accept || ".csv"}
                    multiple={item.multiple}
                    onChange={(event) => {
                      if (item.type === "images") return loadImageZip(event);
                      if (item.type === "trainingPass") return loadTrainingPassFiles(event);
                      return loadSingleFile(event, item.type);
                    }}
                    hidden
                  />
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* right: how it works + expected files */}
        <div className="col-4" style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <div className="panel ink">
            <div className="panel-head" style={{ marginBottom: 8 }}>
              <div>
                <div className="panel-title" style={{ color: "var(--on-emph)" }}>
                  Local & private
                </div>
                <div className="panel-sub">your CSVs never leave the browser</div>
              </div>
            </div>
            <p style={{ margin: 0, fontFamily: "var(--ui)", fontSize: 14, color: "rgba(239,234,221,.7)", lineHeight: 1.55 }}>
              Files are parsed in-session with <b style={{ color: "var(--lime)" }}>PapaParse</b> — no server round-trip,
              no storage. Reset the session any time to clear everything.
            </p>
          </div>

          <div className="panel">
            <div className="panel-head" style={{ marginBottom: 6 }}>
              <div>
                <div className="panel-title">How it works</div>
              </div>
            </div>
            {STEPS.map((step, i) => (
              <div className="step" key={step.t}>
                <span className="sn">{i + 1}</span>
                <div>
                  <div className="st-t">{step.t}</div>
                  <div className="st-d">{step.d}</div>
                </div>
              </div>
            ))}
          </div>

          <div className="panel">
            <div className="panel-head" style={{ marginBottom: 12 }}>
              <div>
                <div className="panel-title">Expected files</div>
              </div>
            </div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
              {EXPECTED.map((name) => (
                <span className="fmt" key={name}>
                  {name}
                </span>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

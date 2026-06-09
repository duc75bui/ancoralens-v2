import { BookOpen, Bot, Database, FileSpreadsheet, FolderOpen, Grid3X3, Server } from "lucide-react";

const docs = [
  {
    icon: <FolderOpen size={20} />,
    title: "Folder Auto-Load",
    body: "Select the exported report folder. The app reads info.txt, TrainingPassSummary.csv, flatReportData.csv, Vendor CSV files, and template matching CSV files when present."
  },
  {
    icon: <FileSpreadsheet size={20} />,
    title: "Report CSVs",
    body: "Dashboard Metrics uses TrainingPassSummary.csv. Detailed Report uses flatReportData.csv. Vendor Analysis expects Value, Field, Doc Count, and accuracy/error count columns."
  },
  {
    icon: <Grid3X3 size={20} />,
    title: "Template Matching",
    body: "Template Matching expects columns similar to BatchId, DocId, SourceDocId, PageIndex, and TemplateId. Missing TemplateId values are treated as unmatched pages."
  },
  {
    icon: <Server size={20} />,
    title: "Recovered Node Server",
    body: "Run the saved backend from v2/server. It exposes /api/health, /api/sql/execute, /api/ai/test, and /api/ai/chat on port 3001 by default."
  },
  {
    icon: <Database size={20} />,
    title: "SQL Connector",
    body: "The SQL page builds an MSSQL connection string from the form and sends it with the query to /api/sql/execute. The server blocks DROP DATABASE and SHUTDOWN."
  },
  {
    icon: <Bot size={20} />,
    title: "AI Assistant",
    body: "The AI page stores the Gemini API key and model in localStorage, tests through /api/ai/test, and sends compact report context to /api/ai/chat."
  }
];

export default function DocumentationView({ hasData }) {
  return (
    <div className="fade-in docs-view">
      <div className="docs-header">
        <h2>
          <BookOpen color="#60a5fa" size={32} />
          Documentation
        </h2>
        <p>{hasData ? "Current session data is loaded." : "Upload a report folder to populate the analysis pages."}</p>
      </div>

      <div className="docs-grid">
        {docs.map((item) => (
          <section className="glass-panel doc-card" key={item.title}>
            <div>{item.icon}</div>
            <h3>{item.title}</h3>
            <p>{item.body}</p>
          </section>
        ))}
      </div>

      <section className="glass-panel docs-command-panel">
        <h3>Local commands</h3>
        <code>cd "C:\ancoralens 1\v1" &amp;&amp; npm run dev</code>
        <code>cd "C:\ancoralens 1\v2" &amp;&amp; node server/index.js</code>
      </section>
    </div>
  );
}

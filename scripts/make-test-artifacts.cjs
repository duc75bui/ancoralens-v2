/**
 * make-test-artifacts — generate a SYNTHETIC BatchData export (zip of PDFs + JSON) and a
 * matching flatReportData.csv + TrainingPassSummary.csv so the app (and the new document
 * viewer) can be tested without any real customer data. Run: node scripts/make-test-artifacts.cjs
 * Output: ./test-artifacts/
 */
const fs = require("fs");
const path = require("path");
const JSZip = require("jszip");

const OUT = path.join(__dirname, "..", "test-artifacts");
fs.mkdirSync(OUT, { recursive: true });

// ── minimal single-page PDF (Helvetica), letter 612x792pt, valid xref so pdf.js renders it ──
function esc(s) {
  return String(s).replace(/([\\()])/g, "\\$1");
}
function makePdf(title, lines) {
  let content = `BT\n/F1 22 Tf\n60 720 Td\n(${esc(title)}) Tj\n/F1 13 Tf\n`;
  lines.forEach((l) => {
    content += `0 -26 Td\n(${esc(l)}) Tj\n`;
  });
  content += "ET";
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    `<< /Length ${content.length} >>\nstream\n${content}\nendstream`
  ];
  let pdf = "%PDF-1.4\n";
  const offsets = [];
  objects.forEach((body, i) => {
    offsets.push(pdf.length);
    pdf += `${i + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xrefStart = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  offsets.forEach((off) => {
    pdf += `${String(off).padStart(10, "0")} 00000 n \n`;
  });
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF`;
  return Buffer.from(pdf, "latin1");
}

// ── synthetic documents: each is one batch / one document / one page ──
const TYPE_ID = "aaaa1111-bbbb-2222-cccc-333333333333";
const DOCS = [
  { batchId: "b0000001-0000-0000-0000-000000000001", docId: "d0000001-0000-0000-0000-000000000001",
    file: "Invoice_SAMPLE_1001.pdf", vendor: "Acme Supplies Inc", number: "1001", date: "2024-03-04", total: "1,240.00", captured: "1,240.00" },
  { batchId: "b0000002-0000-0000-0000-000000000002", docId: "d0000002-0000-0000-0000-000000000002",
    file: "Invoice_SAMPLE_1002.pdf", vendor: "Globex Corporation", number: "1002", date: "2024-03-09", total: "865.50", captured: "8G5.50" },
  { batchId: "b0000003-0000-0000-0000-000000000003", docId: "d0000003-0000-0000-0000-000000000003",
    file: "Invoice_SAMPLE_1003.pdf", vendor: "Initech LLC", number: "1003", date: "2024-03-15", total: "402.75", captured: "402.75" }
];

// Field layout in OCR raster pixels (300 DPI of a 612x792pt page => 2550 x 3300).
// page is 0-based; boxes are "left,top,right,bottom".
const fieldDefs = (doc, i) => [
  { name: "FT_VENDOR_NAME", value: doc.vendor, status: "Correct", loc: "180,300,1100,372" },
  { name: "FT_INVOICE_NUMBER", value: doc.number, status: "Correct", loc: "1980,300,2360,372" },
  { name: "FT_ISSUE_DATE", value: doc.date, status: "Correct", loc: "1980,430,2330,498" },
  { name: "FT_PO_NUMBER", value: "", status: i === 2 ? "UnassignedValid" : "Correct", loc: "180,2660,640,2728" },
  { name: "FT_INVOICE_TOTAL", value: doc.captured, status: doc.captured === doc.total ? "Correct" : "WrongInput", loc: "1820,2700,2300,2790" }
];

// ── flatReportData.csv ──
function csvField(v) {
  const s = String(v ?? "");
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
const COLUMNS = ["SourceDocId", "BatchId", "InputFileName", "DocumentType", "FieldName", "TrueValue", "CapturedValue", "FieldStatus", "TrainingPass", "CapturedPage", "CaptureLocation", "Confidence"];
const rows = [COLUMNS.join(",")];
DOCS.forEach((doc, i) => {
  fieldDefs(doc, i).forEach((f) => {
    const trueVal = f.name === "FT_INVOICE_TOTAL" ? doc.total : f.value;
    rows.push(
      [doc.docId, `Batch-SAMPLE-${doc.number}`, doc.file, "Invoice", f.name, trueVal, f.value, f.status, "Training Pass 1", 0, f.loc, f.status === "Correct" ? 96 : 41]
        .map(csvField)
        .join(",")
    );
  });
});
fs.writeFileSync(path.join(OUT, "flatReportData.csv"), rows.join("\n"), "utf8");

// ── TrainingPassSummary.csv (so the dashboard has metrics too) ──
const summary = [
  "Label,V1,V2,V3",
  "Total Batches,3,,",
  "Total Exceptional Batches,1,,",
  "Total Processed Documents,3,,",
  "Total Processed Pages,3,,",
  "Field Accuracy (correct/all) %,86.7,,",
  "Field and Position Accuracy %,80.0,,",
  "Labor Savings(Chars) %,78.0,,",
  "Labor Savings(Fields) %,73.5,,",
  "Training Pass 1,86.7,3,1"
];
fs.writeFileSync(path.join(OUT, "TrainingPassSummary.csv"), summary.join("\n"), "utf8");

// ── the BatchData zip (all artifacts: PDFs + CapturedData.json + BatchInfo.json + info.txt) ──
(async () => {
  const zip = new JSZip();
  zip.file(
    "info.txt",
    ["--- System Information ---", "App Version: SAMPLE", "ancoraDocs Version: synthetic", "", "--- Download Filters ---", "Synthetic test export — safe, no real data."].join("\n")
  );
  zip.file("RegionTemplates.td", "synthetic region templates placeholder");
  zip.file(`BatchData/${TYPE_ID}/BatchTypeInfo.json`, JSON.stringify({ Id: TYPE_ID, Name: "SAMPLE Batch Type" }));

  DOCS.forEach((doc, i) => {
    const base = `BatchData/${TYPE_ID}/Batches/${doc.batchId}`;
    zip.file(
      `${base}/BatchInfo.json`,
      JSON.stringify({
        Id: doc.batchId,
        Name: `Batch-SAMPLE-${doc.number}`,
        Status: "Completed",
        DocumentCount: "1",
        TotalPageCount: "1",
        Documents: [{ Id: doc.docId, Type: "Invoice", IsExceptional: String(doc.captured !== doc.total), Pages: [{ Type: "regular" }] }]
      })
    );
    zip.file(
      `${base}/${doc.docId}/CapturedData.json`,
      JSON.stringify({
        FtfName: "SAMPLE",
        Pages: [{ Width: 2550, Height: 3300 }],
        Fields: fieldDefs(doc, i).map((f) => {
          const [l, t, r, b] = f.loc.split(",").map(Number);
          return { Name: f.name, Value: f.value, PageIndex: 0, Region: { Content: f.value, Rectangle: { m_nLeft: l, m_nTop: t, m_nRight: r, m_nBottom: b } } };
        })
      })
    );
    zip.file(
      `${base}/${doc.docId}/InputFiles/${doc.file}`,
      makePdf(`INVOICE ${doc.number}`, [
        `Vendor: ${doc.vendor}`,
        `Invoice #: ${doc.number}`,
        `Date: ${doc.date}`,
        "",
        "Description            Qty     Amount",
        "Professional services    1     " + doc.total,
        "",
        `TOTAL DUE: ${doc.total}`
      ])
    );
  });

  const buffer = await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
  const zipName = "BatchData-SAMPLE-20260623.zip";
  fs.writeFileSync(path.join(OUT, zipName), buffer);

  fs.writeFileSync(
    path.join(OUT, "README.txt"),
    [
      "Synthetic AncoraLens test artifacts (no real data).",
      "",
      "Files:",
      `  ${zipName}        - BatchData export (3 synthetic invoice PDFs + JSON)`,
      "  flatReportData.csv          - detailed report matching the 3 documents",
      "  TrainingPassSummary.csv     - dashboard metrics",
      "",
      "How to test the document viewer:",
      "  1. Upload Data -> 'Details' tile  -> flatReportData.csv",
      "  2. Upload Data -> 'Metrics' tile  -> TrainingPassSummary.csv (optional, for the dashboard)",
      `  3. Upload Data -> 'Doc Images' tile -> ${zipName}`,
      "  4. Detailed Report -> expand a batch -> 'View document'.",
      "     FT_INVOICE_TOTAL on Batch-SAMPLE-1002 is a WrongInput (red) region error.",
      "     Click any field row to locate its region; toggle 'Errors only'."
    ].join("\n")
  );

  const list = fs.readdirSync(OUT).map((f) => `${f} (${fs.statSync(path.join(OUT, f)).size} bytes)`);
  console.log("Wrote test-artifacts:\n  " + list.join("\n  "));
})();

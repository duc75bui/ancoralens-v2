/**
 * make-test-artifacts — generate a SYNTHETIC BatchData export (zip of PDFs + JSON) and a
 * matching flatReportData.csv + TrainingPassSummary.csv so the app (and the document viewer)
 * can be tested without any real customer data. Run: node scripts/make-test-artifacts.cjs
 * Output: ./test-artifacts/
 *
 * Region boxes are COMPUTED from where each value is drawn in the PDF (PDF points -> 300 DPI
 * raster, Y flipped), so the overlay lands on the actual text — a faithful fixture that also
 * doubles as a visual check of the viewer's coordinate math.
 */
const fs = require("fs");
const path = require("path");
const JSZip = require("jszip");

const OUT = path.join(__dirname, "..", "test-artifacts");
fs.mkdirSync(OUT, { recursive: true });

// ── page + text geometry (must match makePdf below) ──
const PAGE_W_PT = 612;
const PAGE_H_PT = 792;
const DPI = 300;
const K = DPI / 72; // pt -> raster px
const TITLE_Y = 720;
const BODY_Y0 = 690; // first body line baseline (pt, from page bottom)
const LINE_GAP = 26;
const BODY_SIZE = 13;
const LEFT_PT = 60;
const CHAR_W = 0.52; // avg Helvetica advance (em)
const CAP = 0.70; // cap height (em)
const DESC = 0.22; // descender (em)

// Bounding box (raster "left,top,right,bottom") of the `value` part of body line `lineIndex`,
// given the literal `prefix` text that precedes it on that line.
function valueBox(lineIndex, prefix, value) {
  const yb = BODY_Y0 - LINE_GAP * lineIndex;
  const x0 = LEFT_PT + CHAR_W * BODY_SIZE * prefix.length;
  const x1 = x0 + CHAR_W * BODY_SIZE * Math.max(String(value).length, 2);
  const left = Math.max(0, Math.round(x0 * K) - 8);
  const right = Math.round(x1 * K) + 8;
  const top = Math.max(0, Math.round((PAGE_H_PT - (yb + CAP * BODY_SIZE)) * K) - 6);
  const bottom = Math.round((PAGE_H_PT - (yb - DESC * BODY_SIZE)) * K) + 6;
  return `${left},${top},${right},${bottom}`;
}

// ── minimal single-page PDF (Helvetica), letter 612x792pt, valid xref so pdf.js renders it ──
function esc(s) {
  return String(s).replace(/([\\()])/g, "\\$1");
}
function makePdf(title, lines) {
  let content = `BT\n/F1 22 Tf\n${LEFT_PT} ${TITLE_Y} Td\n(${esc(title)}) Tj\n/F1 ${BODY_SIZE} Tf\n${LEFT_PT} ${BODY_Y0} Td\n(${esc(lines[0] || "")}) Tj\n`;
  for (let i = 1; i < lines.length; i += 1) content += `0 -${LINE_GAP} Td\n(${esc(lines[i])}) Tj\n`;
  content += "ET";
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PAGE_W_PT} ${PAGE_H_PT}] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>`,
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
    file: "Invoice_SAMPLE_1001.pdf", vendor: "Acme Supplies Inc", number: "1001", date: "2024-03-04", total: "1240.00", captured: "1240.00" },
  { batchId: "b0000002-0000-0000-0000-000000000002", docId: "d0000002-0000-0000-0000-000000000002",
    file: "Invoice_SAMPLE_1002.pdf", vendor: "Globex Corporation", number: "1002", date: "2024-03-09", total: "865.50", captured: "8G5.50" },
  { batchId: "b0000003-0000-0000-0000-000000000003", docId: "d0000003-0000-0000-0000-000000000003",
    file: "Invoice_SAMPLE_1003.pdf", vendor: "Initech LLC", number: "1003", date: "2024-03-15", total: "402.75", captured: "402.75" }
];

// Ordered body lines for a document; tagged lines become report fields with a computed box.
function docSpec(doc, i) {
  const po = `PO-${doc.number}`;
  return [
    { text: `Vendor: ${doc.vendor}`, field: "FT_VENDOR_NAME", prefix: "Vendor: ", value: doc.vendor, status: "Correct" },
    { text: `Invoice #: ${doc.number}`, field: "FT_INVOICE_NUMBER", prefix: "Invoice #: ", value: doc.number, status: "Correct" },
    { text: `Date: ${doc.date}`, field: "FT_ISSUE_DATE", prefix: "Date: ", value: doc.date, status: "Correct" },
    { text: `PO Number: ${po}`, field: "FT_PO_NUMBER", prefix: "PO Number: ", value: po, status: i === 2 ? "MisAssignment" : "Correct" },
    { text: "" },
    { text: "Description            Qty     Amount" },
    { text: `Professional services    1     ${doc.total}` },
    { text: "" },
    { text: `TOTAL DUE: ${doc.captured}`, field: "FT_INVOICE_TOTAL", prefix: "TOTAL DUE: ", value: doc.captured, status: doc.captured === doc.total ? "Correct" : "WrongInput", trueValue: doc.total }
  ];
}
function fieldsFor(doc, i) {
  return docSpec(doc, i)
    .map((line, idx) => (line.field ? { name: line.field, value: line.value, status: line.status, trueValue: line.trueValue ?? line.value, loc: valueBox(idx, line.prefix, line.value) } : null))
    .filter(Boolean);
}

// ── flatReportData.csv ──
function csvField(v) {
  const s = String(v ?? "");
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
const COLUMNS = ["SourceDocId", "BatchId", "InputFileName", "DocumentType", "FieldName", "TrueValue", "CapturedValue", "FieldStatus", "TrainingPass", "CapturedPage", "CaptureLocation", "Confidence"];
const rows = [COLUMNS.join(",")];
DOCS.forEach((doc, i) => {
  fieldsFor(doc, i).forEach((f) => {
    rows.push(
      [doc.docId, `Batch-SAMPLE-${doc.number}`, doc.file, "Invoice", f.name, f.trueValue, f.value, f.status, "Training Pass 1", 0, f.loc, f.status === "Correct" ? 96 : 41]
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
  zip.file("info.txt", ["--- System Information ---", "App Version: SAMPLE", "ancoraDocs Version: synthetic", "", "--- Download Filters ---", "Synthetic test export — safe, no real data."].join("\n"));
  zip.file("RegionTemplates.td", "synthetic region templates placeholder");
  zip.file(`BatchData/${TYPE_ID}/BatchTypeInfo.json`, JSON.stringify({ Id: TYPE_ID, Name: "SAMPLE Batch Type" }));

  DOCS.forEach((doc, i) => {
    const base = `BatchData/${TYPE_ID}/Batches/${doc.batchId}`;
    zip.file(
      `${base}/BatchInfo.json`,
      JSON.stringify({ Id: doc.batchId, Name: `Batch-SAMPLE-${doc.number}`, Status: "Completed", DocumentCount: "1", TotalPageCount: "1", Documents: [{ Id: doc.docId, Type: "Invoice", IsExceptional: String(doc.captured !== doc.total), Pages: [{ Type: "regular" }] }] })
    );
    zip.file(
      `${base}/${doc.docId}/CapturedData.json`,
      JSON.stringify({
        FtfName: "SAMPLE",
        Pages: [{ Width: Math.round(PAGE_W_PT * K), Height: Math.round(PAGE_H_PT * K) }],
        Fields: fieldsFor(doc, i).map((f) => {
          const [l, t, r, b] = f.loc.split(",").map(Number);
          return { Name: f.name, Value: f.value, PageIndex: 0, Region: { Content: f.value, Rectangle: { m_nLeft: l, m_nTop: t, m_nRight: r, m_nBottom: b } } };
        })
      })
    );
    zip.file(`${base}/${doc.docId}/InputFiles/${doc.file}`, makePdf(`INVOICE ${doc.number}`, docSpec(doc, i).map((l) => l.text)));
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
      "Region boxes are computed from where the value text is drawn in each PDF, so the",
      "viewer overlay lands on the actual fields.",
      "",
      "How to test the document viewer:",
      "  1. Upload Data -> 'Details' tile    -> flatReportData.csv",
      "  2. Upload Data -> 'Metrics' tile    -> TrainingPassSummary.csv (optional, dashboard)",
      `  3. Upload Data -> 'Doc Images' tile -> ${zipName}`,
      "  4. Detailed Report -> expand a batch -> 'View document'.",
      "     FT_INVOICE_TOTAL on Batch-SAMPLE-1002 is a WrongInput (red) error;",
      "     FT_PO_NUMBER on Batch-SAMPLE-1003 is a warning. Click a field row to locate it."
    ].join("\n")
  );

  console.log("Wrote test-artifacts:\n  " + fs.readdirSync(OUT).map((f) => `${f} (${fs.statSync(path.join(OUT, f)).size} bytes)`).join("\n  "));
})();

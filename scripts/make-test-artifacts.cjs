/**
 * make-test-artifacts — generate a SYNTHETIC BatchData export (zip of PDFs + JSON) and a
 * matching flatReportData.csv + TrainingPassSummary.csv so the app (and the document viewer)
 * can be tested without any real customer data. Run: node scripts/make-test-artifacts.cjs
 * Output: ./test-artifacts/
 *
 * Region boxes are COMPUTED from where each value is drawn in the PDF (PDF points -> 300 DPI
 * raster, Y flipped), so the overlay lands on the actual text. Includes a multi-page document
 * (1004) with an error on page 2 to exercise per-page region mapping + page navigation.
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
const K = DPI / 72;
const TITLE_Y = 720;
const BODY_Y0 = 690;
const LINE_GAP = 26;
const BODY_SIZE = 13;
const LEFT_PT = 60;
const CHAR_W = 0.52;
const CAP = 0.7;
const DESC = 0.22;

// Raster "left,top,right,bottom" of the value text on body line `lineIndex` (0-based, per page).
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

// ── multi-page PDF (Helvetica), valid xref so pdf.js renders it. pages: [{title, lines:[str]}] ──
function esc(s) {
  return String(s).replace(/([\\()])/g, "\\$1");
}
function makePdf(pages) {
  const FONT = 3;
  const objects = [];
  objects[0] = "<< /Type /Catalog /Pages 2 0 R >>";
  objects[2] = "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>";
  const kids = [];
  pages.forEach((pg, p) => {
    const pageObj = 4 + 2 * p;
    const contentObj = 5 + 2 * p;
    kids.push(`${pageObj} 0 R`);
    // Td is RELATIVE to the previous line's start. Title sits at TITLE_Y; the first body line is
    // reached by moving down (TITLE_Y - BODY_Y0), then each subsequent line by LINE_GAP. (Using an
    // absolute-looking "x BODY_Y0 Td" here would add to the title position and push text off-page.)
    let content = `BT\n/F1 22 Tf\n${LEFT_PT} ${TITLE_Y} Td\n(${esc(pg.title)}) Tj\n/F1 ${BODY_SIZE} Tf\n0 -${TITLE_Y - BODY_Y0} Td\n(${esc(pg.lines[0] || "")}) Tj\n`;
    for (let i = 1; i < pg.lines.length; i += 1) content += `0 -${LINE_GAP} Td\n(${esc(pg.lines[i])}) Tj\n`;
    content += "ET";
    objects[pageObj - 1] = `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PAGE_W_PT} ${PAGE_H_PT}] /Resources << /Font << /F1 ${FONT} 0 R >> >> /Contents ${contentObj} 0 R >>`;
    objects[contentObj - 1] = `<< /Length ${content.length} >>\nstream\n${content}\nendstream`;
  });
  objects[1] = `<< /Type /Pages /Kids [${kids.join(" ")}] /Count ${pages.length} >>`;
  let pdf = "%PDF-1.4\n";
  const offsets = [];
  for (let i = 0; i < objects.length; i += 1) {
    offsets.push(pdf.length);
    pdf += `${i + 1} 0 obj\n${objects[i]}\nendobj\n`;
  }
  const xrefStart = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  offsets.forEach((off) => {
    pdf += `${String(off).padStart(10, "0")} 00000 n \n`;
  });
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF`;
  return Buffer.from(pdf, "latin1");
}

// ── documents: each has pages[]; tagged lines become report fields with a computed box ──
const TYPE_ID = "aaaa1111-bbbb-2222-cccc-333333333333";

function invoice1Page(meta, i) {
  const po = `PO-${meta.number}`;
  return {
    batchId: meta.batchId,
    docId: meta.docId,
    file: meta.file,
    batchName: `Batch-SAMPLE-${meta.number}`,
    pages: [
      {
        title: `INVOICE ${meta.number}`,
        lines: [
          { text: `Vendor: ${meta.vendor}`, field: "FT_VENDOR_NAME", prefix: "Vendor: ", value: meta.vendor, status: "Correct" },
          { text: `Invoice #: ${meta.number}`, field: "FT_INVOICE_NUMBER", prefix: "Invoice #: ", value: meta.number, status: "Correct" },
          { text: `Date: ${meta.date}`, field: "FT_ISSUE_DATE", prefix: "Date: ", value: meta.date, status: "Correct" },
          { text: `PO Number: ${po}`, field: "FT_PO_NUMBER", prefix: "PO Number: ", value: po, status: i === 2 ? "MisAssignment" : "Correct" },
          { text: "" },
          { text: "Description            Qty     Amount" },
          { text: `Professional services    1     ${meta.total}` },
          { text: "" },
          { text: `TOTAL DUE: ${meta.captured}`, field: "FT_INVOICE_TOTAL", prefix: "TOTAL DUE: ", value: meta.captured, status: meta.captured === meta.total ? "Correct" : "WrongInput", trueValue: meta.total }
        ]
      }
    ]
  };
}

const DOCUMENTS = [
  invoice1Page({ batchId: "b0000001-0000-0000-0000-000000000001", docId: "d0000001-0000-0000-0000-000000000001", file: "Invoice_SAMPLE_1001.pdf", vendor: "Acme Supplies Inc", number: "1001", date: "2024-03-04", total: "1240.00", captured: "1240.00" }, 0),
  invoice1Page({ batchId: "b0000002-0000-0000-0000-000000000002", docId: "d0000002-0000-0000-0000-000000000002", file: "Invoice_SAMPLE_1002.pdf", vendor: "Globex Corporation", number: "1002", date: "2024-03-09", total: "865.50", captured: "8G5.50" }, 1),
  invoice1Page({ batchId: "b0000003-0000-0000-0000-000000000003", docId: "d0000003-0000-0000-0000-000000000003", file: "Invoice_SAMPLE_1003.pdf", vendor: "Initech LLC", number: "1003", date: "2024-03-15", total: "402.75", captured: "402.75" }, 2),
  // Multi-page document: header fields on page 1, line items + an error on page 2.
  {
    batchId: "b0000004-0000-0000-0000-000000000004",
    docId: "d0000004-0000-0000-0000-000000000004",
    file: "Invoice_SAMPLE_1004_multipage.pdf",
    batchName: "Batch-SAMPLE-1004",
    pages: [
      {
        title: "INVOICE 1004 - PAGE 1",
        lines: [
          { text: "Vendor: Umbrella Logistics", field: "FT_VENDOR_NAME", prefix: "Vendor: ", value: "Umbrella Logistics", status: "Correct" },
          { text: "Invoice #: 1004", field: "FT_INVOICE_NUMBER", prefix: "Invoice #: ", value: "1004", status: "Correct" },
          { text: "Date: 2024-03-20", field: "FT_ISSUE_DATE", prefix: "Date: ", value: "2024-03-20", status: "Correct" },
          { text: "" },
          { text: "(line items continue on page 2)" }
        ]
      },
      {
        title: "INVOICE 1004 - PAGE 2",
        lines: [
          { text: "Line items:" },
          { text: "Widget A    qty 2    500.00", field: "FT_LINE_1_AMOUNT", prefix: "Widget A    qty 2    ", value: "500.00", status: "Correct" },
          { text: "Widget B    qty 1    3OO.OO", field: "FT_LINE_2_AMOUNT", prefix: "Widget B    qty 1    ", value: "3OO.OO", status: "WrongInput", trueValue: "300.00" },
          { text: "" },
          { text: "TOTAL DUE: 800.00", field: "FT_INVOICE_TOTAL", prefix: "TOTAL DUE: ", value: "800.00", status: "Correct" }
        ]
      }
    ]
  },
  // Multi-page document with line items genuinely spread across pages 1-3 and BLANK pages 4-5, and with
  // NO page references at all (blank CapturedPage, no PageIndex). This exercises the viewer's content-
  // based resolution: each distinctive line-item value must be matched to its own page, the line items
  // must land on pages 1-3 (not collapsed onto one page), and the blank pages 4-5 must stay empty.
  {
    batchId: "b0000005-0000-0000-0000-000000000005",
    docId: "d0000005-0000-0000-0000-000000000005",
    file: "PO_SAMPLE_5001_multipage_unreferenced.pdf",
    batchName: "Batch-SAMPLE-5001",
    unreferencedPages: true,
    pages: [
      {
        title: "PURCHASE ORDER 5001 - PAGE 1 OF 5",
        lines: [
          { text: "Vendor: Northwind Traders", field: "FT_VENDOR_NAME", prefix: "Vendor: ", value: "Northwind Traders", status: "Correct" },
          { text: "PO Number: PO-5001", field: "FT_PO_NUMBER", prefix: "PO Number: ", value: "PO-5001", status: "Correct" },
          { text: "" },
          { text: "Line items (page 1 of 3):" },
          { text: "PN-AX1190  Bearing assembly   412.55", field: "FT_LINE_01_AMOUNT", prefix: "PN-AX1190  Bearing assembly   ", value: "412.55", status: "Correct" },
          { text: "PN-BX2281  Hydraulic seal      88.20", field: "FT_LINE_02_AMOUNT", prefix: "PN-BX2281  Hydraulic seal      ", value: "88.20", status: "Correct" }
        ]
      },
      {
        title: "PURCHASE ORDER 5001 - PAGE 2 OF 5",
        lines: [
          { text: "Line items (page 2 of 3):" },
          { text: "PN-CX3372  Coupling flange   1530.00", field: "FT_LINE_03_AMOUNT", prefix: "PN-CX3372  Coupling flange   ", value: "1530.00", status: "Correct" },
          { text: "PN-DX4463  Gasket kit          47.99", field: "FT_LINE_04_AMOUNT", prefix: "PN-DX4463  Gasket kit          ", value: "47.99", status: "WrongInput", trueValue: "479.90" }
        ]
      },
      {
        title: "PURCHASE ORDER 5001 - PAGE 3 OF 5",
        lines: [
          { text: "Line items (page 3 of 3):" },
          { text: "PN-EX5554  Drive shaft        209.10", field: "FT_LINE_05_AMOUNT", prefix: "PN-EX5554  Drive shaft        ", value: "209.10", status: "Correct" },
          { text: "PN-FX6645  Control module     765.40", field: "FT_LINE_06_AMOUNT", prefix: "PN-FX6645  Control module     ", value: "765.40", status: "Correct" },
          { text: "" },
          { text: "GRAND TOTAL: 3053.24", field: "FT_GRAND_TOTAL", prefix: "GRAND TOTAL: ", value: "3053.24", status: "Correct" }
        ]
      },
      { title: "PAGE 4 OF 5", lines: ["This page intentionally left blank."] },
      { title: "PAGE 5 OF 5", lines: ["This page intentionally left blank."] }
    ]
  }
];

// All report fields for a document, with the page index (0-based) and computed box.
function fieldsFor(doc) {
  const out = [];
  doc.pages.forEach((pg, pageIdx) => {
    pg.lines.forEach((line, lineIdx) => {
      if (!line.field) return;
      out.push({ name: line.field, value: line.value, status: line.status, trueValue: line.trueValue ?? line.value, page: pageIdx, loc: valueBox(lineIdx, line.prefix, line.value) });
    });
  });
  return out;
}

// ── flatReportData.csv ──
function csvField(v) {
  const s = String(v ?? "");
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
const COLUMNS = ["SourceDocId", "BatchId", "InputFileName", "DocumentType", "FieldName", "TrueValue", "CapturedValue", "FieldStatus", "TrainingPass", "CapturedPage", "CaptureLocation", "Confidence"];
const rows = [COLUMNS.join(",")];
DOCUMENTS.forEach((doc) => {
  fieldsFor(doc).forEach((f) => {
    // When a document has no page references, CapturedPage is left blank so the viewer must resolve the
    // page from content rather than trusting metadata.
    const capturedPage = doc.unreferencedPages ? "" : f.page;
    rows.push(
      [doc.docId, doc.batchName, doc.file, "Invoice", f.name, f.trueValue, f.value, f.status, "Training Pass 1", capturedPage, f.loc, f.status === "Correct" ? 96 : 41]
        .map(csvField)
        .join(",")
    );
  });
});
fs.writeFileSync(path.join(OUT, "flatReportData.csv"), rows.join("\n"), "utf8");

// ── TrainingPassSummary.csv (so the dashboard has metrics too) ──
fs.writeFileSync(
  path.join(OUT, "TrainingPassSummary.csv"),
  [
    "Label,V1,V2,V3",
    "Total Batches,5,,",
    "Total Exceptional Batches,3,,",
    "Total Processed Documents,5,,",
    "Total Processed Pages,10,,",
    "Field Accuracy (correct/all) %,85.0,,",
    "Field and Position Accuracy %,79.0,,",
    "Labor Savings(Chars) %,78.0,,",
    "Labor Savings(Fields) %,73.5,,",
    "Training Pass 1,85.0,5,3"
  ].join("\n"),
  "utf8"
);

// ── the BatchData zip (all artifacts) ──
(async () => {
  const zip = new JSZip();
  zip.file("info.txt", ["--- System Information ---", "App Version: SAMPLE", "ancoraDocs Version: synthetic", "", "--- Download Filters ---", "Synthetic test export — safe, no real data."].join("\n"));
  zip.file("RegionTemplates.td", "synthetic region templates placeholder");
  zip.file(`BatchData/${TYPE_ID}/BatchTypeInfo.json`, JSON.stringify({ Id: TYPE_ID, Name: "SAMPLE Batch Type" }));

  DOCUMENTS.forEach((doc) => {
    const base = `BatchData/${TYPE_ID}/Batches/${doc.batchId}`;
    zip.file(`${base}/BatchInfo.json`, JSON.stringify({ Id: doc.batchId, Name: doc.batchName, Status: "Completed", DocumentCount: "1", TotalPageCount: String(doc.pages.length), Documents: [{ Id: doc.docId, Type: "Invoice", Pages: doc.pages.map(() => ({ Type: "regular" })) }] }));
    zip.file(
      `${base}/${doc.docId}/CapturedData.json`,
      JSON.stringify({
        FtfName: "SAMPLE",
        Pages: doc.pages.map(() => ({ Width: Math.round(PAGE_W_PT * K), Height: Math.round(PAGE_H_PT * K) })),
        Fields: fieldsFor(doc).map((f) => {
          const [l, t, r, b] = f.loc.split(",").map(Number);
          const field = { Name: f.name, Value: f.value, Region: { Content: f.value, Rectangle: { m_nLeft: l, m_nTop: t, m_nRight: r, m_nBottom: b } } };
          // Omit PageIndex for unreferenced docs so neither CSV nor JSON carries a page hint.
          if (!doc.unreferencedPages) field.PageIndex = f.page;
          return field;
        })
      })
    );
    zip.file(`${base}/${doc.docId}/InputFiles/${doc.file}`, makePdf(doc.pages.map((pg) => ({ title: pg.title, lines: pg.lines.map((l) => l.text) }))));
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
      `  ${zipName}        - BatchData export (4 synthetic invoice PDFs + JSON)`,
      "  flatReportData.csv          - detailed report matching the documents",
      "  TrainingPassSummary.csv     - dashboard metrics",
      "",
      "Region boxes are computed from where the value text is drawn, so the viewer overlay lands",
      "on the actual fields. The page each field is on comes from the CapturedPage column.",
      "",
      "How to test the document viewer:",
      "  1. Upload Data -> 'Details' tile    -> flatReportData.csv",
      "  2. Upload Data -> 'Metrics' tile    -> TrainingPassSummary.csv (optional, dashboard)",
      `  3. Upload Data -> 'Doc Images' tile -> ${zipName}`,
      "  4. Detailed Report -> expand a batch -> 'View document'.",
      "     - Batch-SAMPLE-1002: FT_INVOICE_TOTAL is a WrongInput (red) error.",
      "     - Batch-SAMPLE-1003: FT_PO_NUMBER is a warning.",
      "     - Batch-SAMPLE-1004: MULTI-PAGE. Header fields on page 1; line items on page 2,",
      "       where FT_LINE_2_AMOUNT is a red error. Use the page arrows, or click that field",
      "       row to jump straight to page 2 with its region highlighted.",
      "     - Batch-SAMPLE-5001: MULTI-PAGE, NO PAGE REFERENCES. Line items genuinely span pages",
      "       1-3 (pages 4-5 are blank), and the export carries no CapturedPage/PageIndex. On open,",
      "       boxes are shown on every page; click 'Find pages' to resolve them by content. Each",
      "       line item should snap to its real page (1, 2 or 3), pages 4-5 stay empty, and",
      "       FT_LINE_04_AMOUNT on page 2 is a red error."
    ].join("\n")
  );

  console.log("Wrote test-artifacts:\n  " + fs.readdirSync(OUT).map((f) => `${f} (${fs.statSync(path.join(OUT, f)).size} bytes)`).join("\n  "));
})();

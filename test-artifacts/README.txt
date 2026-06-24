Synthetic AncoraLens test artifacts (no real data).

Files:
  BatchData-SAMPLE-20260623.zip        - BatchData export (4 synthetic invoice PDFs + JSON)
  flatReportData.csv          - detailed report matching the documents
  TrainingPassSummary.csv     - dashboard metrics

Region boxes are computed from where the value text is drawn, so the viewer overlay lands
on the actual fields. The page each field is on comes from the CapturedPage column.

How to test the document viewer:
  1. Upload Data -> 'Details' tile    -> flatReportData.csv
  2. Upload Data -> 'Metrics' tile    -> TrainingPassSummary.csv (optional, dashboard)
  3. Upload Data -> 'Doc Images' tile -> BatchData-SAMPLE-20260623.zip
  4. Detailed Report -> expand a batch -> 'View document'.
     - Batch-SAMPLE-1002: FT_INVOICE_TOTAL is a WrongInput (red) error.
     - Batch-SAMPLE-1003: FT_PO_NUMBER is a warning.
     - Batch-SAMPLE-1004: MULTI-PAGE. Header fields on page 1; line items on page 2,
       where FT_LINE_2_AMOUNT is a red error. Use the page arrows, or click that field
       row to jump straight to page 2 with its region highlighted.
     - Batch-SAMPLE-5001: MULTI-PAGE, NO PAGE REFERENCES. Line items genuinely span pages
       1-3 (pages 4-5 are blank), and the export carries no CapturedPage/PageIndex. On open,
       boxes are shown on every page; click 'Find pages' to resolve them by content. Each
       line item should snap to its real page (1, 2 or 3), pages 4-5 stay empty, and
       FT_LINE_04_AMOUNT on page 2 is a red error.
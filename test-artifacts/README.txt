Synthetic AncoraLens test artifacts (no real data).

Files:
  BatchData-SAMPLE-20260623.zip        - BatchData export (3 synthetic invoice PDFs + JSON)
  flatReportData.csv          - detailed report matching the 3 documents
  TrainingPassSummary.csv     - dashboard metrics

How to test the document viewer:
  1. Upload Data -> 'Details' tile  -> flatReportData.csv
  2. Upload Data -> 'Metrics' tile  -> TrainingPassSummary.csv (optional, for the dashboard)
  3. Upload Data -> 'Doc Images' tile -> BatchData-SAMPLE-20260623.zip
  4. Detailed Report -> expand a batch -> 'View document'.
     FT_INVOICE_TOTAL on Batch-SAMPLE-1002 is a WrongInput (red) region error.
     Click any field row to locate its region; toggle 'Errors only'.
export const POSITIVE_STATUS = ["correct", "valid", "match"];
export const ERROR_STATUS = [
  "wrong",
  "invalid",
  "missing",
  "error",
  "fail",
  "incorrect",
  "mismatch",
  "no match"
];
export const WARNING_STATUS = [
  "misassign",
  "unknown",
  "unassign",
  "warning",
  "partial",
  "review",
  "skipped"
];

const BREAKDOWN_ORDER = [
  "Correct & Location",
  "Correct (Unassigned)",
  "Correct (Pg Mismatch)",
  "Correct (Rgn Mismatch)",
  "Incorrect (Matches Pos)",
  "Incorrect (Mismatch)",
  "Incorrect (Unassigned)",
  "Incorrect (Size)",
  "Incorrect (Overlapping)",
  "Unknown Region"
];

const BREAKDOWN_COLORS = {
  "Correct & Location": "#22c55e",
  "Correct (Unassigned)": "#eab308",
  "Correct (Pg Mismatch)": "#06b6d4",
  "Correct (Rgn Mismatch)": "#3b82f6",
  "Incorrect (Matches Pos)": "#d946ef",
  "Incorrect (Mismatch)": "#ef4444",
  "Incorrect (Unassigned)": "#f97316",
  "Incorrect (Size)": "#a855f7",
  "Incorrect (Overlapping)": "#ec4899",
  "Unknown Region": "#64748b"
};

export function numericValue(value) {
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  const parsed = parseFloat(String(value ?? "").replace(/,/g, "").replace(/%/g, "").trim());
  return Number.isFinite(parsed) ? parsed : 0;
}

export function displayValue(value) {
  if (value == null) return "";
  return String(value).trim();
}

export function findColumn(row, expectedName) {
  const expected = expectedName.toLowerCase().trim();
  return Object.keys(row || {}).find((key) => key && key.toLowerCase().trim() === expected);
}

function normalizeColumnName(value) {
  return String(value || "").toLowerCase().replace(/[^a-z0-9]/g, "");
}

function findColumnLoose(row, names = []) {
  const keys = Object.keys(row || {});
  const normalizedNames = names.map(normalizeColumnName);

  return (
    keys.find((key) => normalizedNames.includes(normalizeColumnName(key))) ||
    keys.find((key) => normalizedNames.some((name) => normalizeColumnName(key).includes(name))) ||
    null
  );
}

export function statusKind(value) {
  const text = String(value || "").toLowerCase().trim();
  if (!text) return "neutral";
  if (POSITIVE_STATUS.some((token) => text.includes(token)) || text === "valid") return "success";
  if (ERROR_STATUS.some((token) => text.includes(token))) return "error";
  if (WARNING_STATUS.some((token) => text.includes(token))) return "warning";
  return "warning";
}

export function statusColor(value) {
  const kind = statusKind(value);
  if (kind === "success") return "#4ade80";
  if (kind === "error") return "#f87171";
  if (kind === "warning") return "#fbbf24";
  return "var(--text-secondary)";
}

export function statusBackground(row) {
  const status =
    row.FieldStatus ||
    row.Status ||
    row.Result ||
    row.Outcome ||
    row.ValidationResult ||
    row.MatchResult ||
    "";

  const kind = statusKind(status);
  if (kind === "error") return "rgba(248, 113, 113, 0.25)";
  if (kind === "warning") return "rgba(251, 191, 36, 0.25)";
  return "transparent";
}

function classifyBreakdown(label) {
  const text = label.toLowerCase();

  if (text.includes("correct value, correct position")) return "Correct & Location";
  if (text.includes("incorrect value, correct position")) return "Incorrect (Matches Pos)";
  if (text.includes("correct value, position unknown")) return "Correct (Unassigned)";
  if (text.includes("incorrect value, position unknown")) return "Incorrect (Unassigned)";
  if (text.includes("correct value, incorrect page")) return "Correct (Pg Mismatch)";
  if (text.includes("correct value region mismatch")) return "Correct (Rgn Mismatch)";
  if (text.includes("incorrect value, incorrect position")) return "Incorrect (Mismatch)";
  if (text.includes("incorrect value, incorrect region size")) return "Incorrect (Size)";
  if (text.includes("unknown true region")) return "Unknown Region";
  if (text.includes("correct value and location")) return "Correct & Location";
  if (text.includes("correct value region unassigned")) return "Correct (Unassigned)";
  if (text.includes("incorrect value region unassigned")) return "Incorrect (Unassigned)";
  if (text.includes("incorrect value region mismatch")) return "Incorrect (Mismatch)";
  if (text.includes("incorrect value region matches")) return "Incorrect (Matches Pos)";
  if (text.includes("correct value page mismatch")) return "Correct (Pg Mismatch)";
  if (text.includes("incorrect value region overlapping")) return "Incorrect (Overlapping)";

  return null;
}

function buildBreakdown(map) {
  return Object.keys(map)
    .map((name) => ({
      name,
      value: map[name],
      color: BREAKDOWN_COLORS[name] || "#94a3b8"
    }))
    .sort((left, right) => {
      const leftIndex = BREAKDOWN_ORDER.indexOf(left.name);
      const rightIndex = BREAKDOWN_ORDER.indexOf(right.name);
      return (leftIndex === -1 ? 99 : leftIndex) - (rightIndex === -1 ? 99 : rightIndex);
    });
}

function extractLastNumeric(rowValues) {
  for (let index = rowValues.length - 1; index >= 1; index -= 1) {
    const raw = rowValues[index];
    if (raw == null || raw === "") continue;

    if (typeof raw === "number" && Number.isFinite(raw)) {
      return { text: String(raw), number: raw };
    }

    const text = String(raw).trim();
    if (!text || text.toLowerCase() === "nan") continue;

    const number = numericValue(text);
    if (Number.isFinite(number)) return { text, number };
  }

  return null;
}

export function parseSummaryMetrics(summaryRows = [], detailRows = []) {
  const groups = {
    general: [],
    hdrFields: [],
    liFields: [],
    typeMetrics: [],
    summaryStats: { total: 0, accuracy: 0, positionAccuracy: 0, breakdown: [] },
    tableStats: { total: 0, accuracy: 0, positionAccuracy: 0, breakdown: [] },
    trainingPass: [],
    regionTemplate: []
  };

  const timelineData = [];
  const docTypeData = [];
  const summaryBreakdown = {};
  const tableBreakdown = {};

  if (summaryRows.length > 0) {
    let section = "general";

    summaryRows.forEach((row) => {
      const values = Array.isArray(row) ? row : Object.values(row);
      if (values.length < 2) return;

      const rawLabel = String(values[0] ?? "").trim();
      if (!rawLabel) return;

      const normalized = rawLabel.toLowerCase().trim().replace(/:/g, "");

      if (normalized === "summary fields") {
        section = "summary";
        return;
      }
      if (normalized === "table cells") {
        section = "table";
        return;
      }
      if (normalized.includes("summary fields position")) {
        section = "hdr";
        return;
      }
      if (normalized.includes("table fields position")) {
        section = "li";
        return;
      }
      if (normalized.includes("position accuracy by field type")) {
        section = "type";
        return;
      }
      if (normalized.includes("trainingpass") || normalized === "trainingpass") {
        section = "training";
        return;
      }
      if (normalized === "dpd name") {
        section = "skip";
        return;
      }

      const extracted = extractLastNumeric(values);
      if (!extracted) return;

      const { text, number } = extracted;
      const lower = rawLabel.toLowerCase().trim();

      if (lower.includes("region template matched documents count")) {
        groups.regionTemplate.push({ label: "Matched Docs", value: text });
        return;
      }
      if (lower.includes("region template matched documents rate")) {
        groups.regionTemplate.push({
          label: "Match Rate %",
          value: number,
          numeric: number,
          isPercentage: true
        });
        return;
      }
      if (lower.includes("training pass")) {
        const fieldAccuracy = numericValue(values[1]);
        const totalBatches = numericValue(values[2]);
        const exBatches = numericValue(values[3]);

        groups.trainingPass.push({
          name: rawLabel,
          value: fieldAccuracy,
          fieldAccuracy,
          totalBatches,
          exBatches
        });
        return;
      }

      if (section === "general") {
        if (lower.includes("total batches") && !lower.includes("exceptional")) {
          groups.general.push({ label: "Total Batches", value: text });
        } else if (lower.includes("total processed documents")) {
          groups.general.push({ label: "Processed Docs", value: text });
        } else if (lower.includes("total processed pages")) {
          groups.general.push({ label: "Processed Pages", value: text });
        } else if (lower.includes("total exceptional batches")) {
          groups.general.push({ label: "Exceptional Batches", value: text });
        } else if (lower.includes("labor savings(chars)")) {
          groups.general.push({ label: "Labor Sav (Chars) %", value: number, numeric: number, isPercentage: true });
        } else if (lower.includes("labor savings(fields)")) {
          groups.general.push({ label: "Labor Sav (Fields) %", value: number, numeric: number, isPercentage: true });
        } else if (lower.includes("field accuracy (correct/all)")) {
          groups.general.push({ label: "Field Acc %", value: number, numeric: number, isPercentage: true });
        } else if (lower.includes("pass-through rate pages")) {
          groups.general.push({ label: "Pass-Through %", value: number, numeric: number, isPercentage: true });
        } else if (lower.includes("field and position accuracy") && lower.includes("%")) {
          groups.general.push({ label: "Field & Pos Acc %", value: number, numeric: number, isPercentage: true });
        }
      } else if (section === "summary") {
        if (lower === "total fields") {
          groups.summaryStats.total = text;
        } else if (lower.includes("total fields accuracy")) {
          groups.summaryStats.accuracy = number;
        } else if (lower.includes("total fields and position accuracy")) {
          groups.summaryStats.positionAccuracy = number;
        } else if (!lower.includes("total fields ocr error")) {
          const bucket = classifyBreakdown(rawLabel);
          if (bucket && number > 0) summaryBreakdown[bucket] = (summaryBreakdown[bucket] || 0) + number;
        }
      } else if (section === "table") {
        if (lower === "total cells") {
          groups.tableStats.total = text;
        } else if (lower.includes("total table accuracy")) {
          groups.tableStats.accuracy = number;
        } else if (lower.includes("total table and position accuracy")) {
          groups.tableStats.positionAccuracy = number;
        } else if (!lower.includes("total cells ocr error")) {
          const bucket = classifyBreakdown(rawLabel);
          if (bucket && number > 0) tableBreakdown[bucket] = (tableBreakdown[bucket] || 0) + number;
        }
      } else if (section === "hdr") {
        groups.hdrFields.push({
          name: rawLabel.replace(/HDR_|HEADER_/gi, "").replace(" %", ""),
          value: number
        });
      } else if (section === "li") {
        groups.liFields.push({
          name: rawLabel.replace(/LI_|LINE_/gi, "").replace(" %", ""),
          value: number
        });
      } else if (section === "type") {
        if (lower.includes("text")) groups.typeMetrics.push({ subject: "Text", A: number, fullMark: 100 });
        if (lower.includes("date")) groups.typeMetrics.push({ subject: "Date", A: number, fullMark: 100 });
        if (lower.includes("money")) groups.typeMetrics.push({ subject: "Money", A: number, fullMark: 100 });
        if (lower.includes("decimal")) groups.typeMetrics.push({ subject: "Decimal", A: number, fullMark: 100 });
      }
    });
  }

  groups.summaryStats.breakdown = buildBreakdown(summaryBreakdown);
  groups.tableStats.breakdown = buildBreakdown(tableBreakdown);

  if (detailRows.length > 0) {
    const timeline = {};
    const docTypes = {};

    detailRows.forEach((row) => {
      let date = "Unknown";
      const explicitDate = row.Date || row.ValidationDate;

      if (explicitDate) {
        const parsed = new Date(explicitDate);
        if (!Number.isNaN(parsed.getTime())) date = parsed.toISOString().split("T")[0];
      }

      if (date === "Unknown" && row.BatchName) {
        const match = String(row.BatchName).match(/(\d{4}-\d{2}-\d{2})/);
        if (match) date = match[1];
      }

      if (date !== "Unknown") timeline[date] = (timeline[date] || 0) + 1;

      const docType = row.DocumentType || "Unknown";
      docTypes[docType] = (docTypes[docType] || 0) + 1;
    });

    Object.keys(timeline).forEach((date) => timelineData.push({ date, count: timeline[date] }));
    timelineData.sort((left, right) => new Date(left.date) - new Date(right.date));
    Object.keys(docTypes).forEach((name) => docTypeData.push({ name, value: docTypes[name] }));
  }

  return { groups, timelineData, docTypeData };
}

export function parseVendorMetrics(rows = []) {
  if (!Array.isArray(rows) || rows.length === 0) return { error: "No data found in file." };

  const first = rows[0] || {};
  const column = (...names) => findColumnLoose(first, names);
  const valueColumn = column("Value", "Vendor", "Vendor Name", "VendorName", "Vendor Unique Text");
  const fieldColumn = column("Field", "Field Name", "FieldName", "Metric", "Metric Name");

  if (!valueColumn || !fieldColumn) {
    return { error: "Missing vendor/value or field/metric columns in CSV." };
  }

  const columns = {
    docCount: column("Doc Count", "DocCount", "Document Count", "Documents"),
    total: column("Total Field Count", "Total", "Total Count"),
    correct: column("Correct Fields Count", "Correct", "Correct Count"),
    accuracy: column("Correct Field Accuracy %", "Accuracy", "Overall Accuracy", "Field Accuracy"),
    unassignedValid: column("Unassigned Valid Fields Count", "Unassigned Valid"),
    unassignedInvalid: column("Unassigned Invalid Fields Count", "Unassigned Invalid"),
    wrongAssignment: column("WrongAssignment Fields Count", "Wrong Assignment", "Wrong Assign"),
    textMatchFail: column("TextMatchFail Fields Count", "Text Match Fail"),
    wrongInput: column("WrongInput Fields Count", "Wrong Input"),
    misAssignment: column("MisAssignment Fields Count", "Mis Assignment", "MisAssign"),
    wrongLocation: column("WrongLocation Fields Count", "Wrong Location"),
    wrongPage: column("WrongPage Fields Count", "Wrong Page"),
    wrongRegion: column("WrongRegionSize Fields Count", "Wrong Region", "Wrong Region Size"),
    unknown: column("Unknown Fields Count", "Unknown"),
    unknownCaptured: column("UnknownCapturedRegion Fields Count", "Unknown Captured"),
    unknownTrue: column("UnknownTrueRegion Fields Count", "Unknown True")
  };

  const vendors = {};
  const read = (row, key, fallback = "0") => (key ? row[key] : fallback);
  const orderedColumns = [
    valueColumn,
    fieldColumn,
    columns.docCount,
    columns.total,
    columns.correct,
    columns.accuracy,
    columns.unassignedValid,
    columns.unassignedInvalid,
    columns.wrongAssignment,
    columns.textMatchFail,
    columns.wrongInput,
    columns.misAssignment,
    columns.wrongLocation,
    columns.wrongPage,
    columns.wrongRegion,
    columns.unknown,
    columns.unknownCaptured,
    columns.unknownTrue
  ].filter(Boolean);
  const metricFieldPattern =
    /^(overall|total|template matching rate|% of possibility for data verify bypass|hdr_|il_)/i;
  const looksLikeMetricField = (value) => metricFieldPattern.test(displayValue(value));
  const repairVendorRow = (row) => {
    const values = orderedColumns.map((key) => row[key]);
    const fieldIndex = values.findIndex((value, index) => index > 0 && looksLikeMetricField(value));

    if (fieldIndex <= 1) return row;

    const repaired = { ...row };
    repaired[valueColumn] = values
      .slice(0, fieldIndex)
      .map(displayValue)
      .filter(Boolean)
      .join(",");

    orderedColumns.slice(1).forEach((key, index) => {
      repaired[key] = values[fieldIndex + index] ?? "";
    });

    return repaired;
  };

  rows.forEach((row) => {
    const repairedRow = repairVendorRow(row);
    const vendorName = displayValue(repairedRow[valueColumn]);
    const fieldName = displayValue(repairedRow[fieldColumn]);
    if (!vendorName || !fieldName || vendorName.toLowerCase() === "sep=" || fieldName.toLowerCase() === "field") return;

    if (!vendors[vendorName]) {
      vendors[vendorName] = {
        name: vendorName,
        docCount: 0,
        rows: [],
        overall: null,
        templateRate: "N/A",
        bypassRate: "N/A",
        specialStats: []
      };
    }

    const vendor = vendors[vendorName];
    const metricRow = {
      field: fieldName,
      docCount: read(repairedRow, columns.docCount, ""),
      total: read(repairedRow, columns.total),
      correct: read(repairedRow, columns.correct),
      accuracy: read(repairedRow, columns.accuracy, "N/A"),
      unassignedValid: read(repairedRow, columns.unassignedValid),
      unassignedInvalid: read(repairedRow, columns.unassignedInvalid),
      wrongAssignment: read(repairedRow, columns.wrongAssignment),
      textMatchFail: read(repairedRow, columns.textMatchFail),
      wrongInput: read(repairedRow, columns.wrongInput),
      misAssignment: read(repairedRow, columns.misAssignment),
      wrongLocation: read(repairedRow, columns.wrongLocation),
      wrongPage: read(repairedRow, columns.wrongPage),
      wrongRegion: read(repairedRow, columns.wrongRegion),
      unknown: read(repairedRow, columns.unknown),
      unknownCaptured: read(repairedRow, columns.unknownCaptured),
      unknownTrue: read(repairedRow, columns.unknownTrue)
    };

    const normalizedField = fieldName.toLowerCase();

    if (normalizedField === "overall" || normalizedField === "total") {
      vendor.overall = metricRow;
      vendor.docCount = metricRow.docCount;
    } else if (normalizedField.includes("template matching rate")) {
      vendor.templateRate = metricRow.accuracy || "0%";
      vendor.specialStats.push(metricRow);
    } else if (normalizedField.includes("possibility for data verify bypass") || normalizedField.includes("bypass")) {
      vendor.bypassRate = metricRow.accuracy || "0%";
      vendor.specialStats.push(metricRow);
    } else {
      vendor.rows.push(metricRow);
    }
  });

  return Object.values(vendors).map((vendor) => {
    if (!vendor.overall) {
      const totals = vendor.rows.reduce(
        (sum, row) => ({
          docCount: Math.max(sum.docCount, numericValue(row.docCount)),
          total: sum.total + numericValue(row.total),
          correct: sum.correct + numericValue(row.correct)
        }),
        { docCount: 0, total: 0, correct: 0 }
      );
      vendor.overall = {
        field: "OVERALL",
        docCount: totals.docCount || vendor.rows[0]?.docCount || "",
        total: totals.total || "",
        correct: totals.correct || "",
        accuracy: totals.total > 0 ? ((totals.correct / totals.total) * 100).toFixed(2) : vendor.rows[0]?.accuracy || "N/A",
        unassignedValid: "0",
        unassignedInvalid: "0",
        wrongAssignment: "0",
        textMatchFail: "0",
        wrongInput: "0",
        misAssignment: "0",
        wrongLocation: "0",
        wrongPage: "0",
        wrongRegion: "0",
        unknown: "0",
        unknownCaptured: "0",
        unknownTrue: "0"
      };
      vendor.docCount = vendor.overall.docCount;
    }

    return vendor;
  });
}

export function parseTemplateMatching(rows = []) {
  if (!Array.isArray(rows) || rows.length === 0) return { error: "No data found in file." };

  const first = rows[0] || {};
  const keys = Object.keys(first);
  const exact = (name) => keys.find((key) => key && String(key).toLowerCase().trim() === name.toLowerCase().trim());
  const fuzzy = (name) => keys.find((key) => key && String(key).toLowerCase().includes(name.toLowerCase()));

  const batchCol = exact("BatchId") || fuzzy("batch");
  const docCol = exact("DocId") || fuzzy("doc");
  const sourceCol = exact("SourceDocId") || fuzzy("source");
  const pageCol = exact("PageIndex") || fuzzy("page");
  const templateCol = exact("TemplateId") || fuzzy("template");

  if (!batchCol && !docCol) return { error: "Missing BatchId or DocId columns in CSV." };

  const batches = {};
  const templateCounts = {};
  let totalPages = 0;
  let matchedPages = 0;
  let unmatchedPages = 0;

  rows.forEach((row) => {
    const batchId = displayValue(row[batchCol]) || "Unknown Batch";
    const docId = displayValue(row[docCol]) || "Unknown Doc";
    const sourceDocId = displayValue(row[sourceCol]);
    const pageIndex = parseInt(row[pageCol], 10) || 0;
    const templateId = displayValue(row[templateCol]) || null;
    const hasTemplate = Boolean(templateId);

    totalPages += 1;

    if (hasTemplate) {
      matchedPages += 1;
      templateCounts[templateId] = (templateCounts[templateId] || 0) + 1;
    } else {
      unmatchedPages += 1;
    }

    if (!batches[batchId]) {
      batches[batchId] = {
        id: batchId,
        documents: {},
        totalPages: 0,
        matchedPages: 0,
        unmatchedPages: 0,
        templates: new Set()
      };
    }

    const batch = batches[batchId];
    batch.totalPages += 1;

    if (hasTemplate) {
      batch.matchedPages += 1;
      batch.templates.add(templateId);
    } else {
      batch.unmatchedPages += 1;
    }

    if (!batch.documents[docId]) {
      batch.documents[docId] = {
        id: docId,
        sourceDocId,
        pages: [],
        matchedPages: 0,
        unmatchedPages: 0
      };
    }

    const doc = batch.documents[docId];
    doc.pages.push({ pageIndex, templateId, hasTemplate });

    if (hasTemplate) doc.matchedPages += 1;
    else doc.unmatchedPages += 1;
  });

  const normalizedBatches = Object.values(batches)
    .map((batch) => ({
      ...batch,
      templates: Array.from(batch.templates),
      templateCount: batch.templates.size,
      matchRate: batch.totalPages > 0 ? ((batch.matchedPages / batch.totalPages) * 100).toFixed(1) : "0.0",
      documents: Object.values(batch.documents).map((doc) => ({
        ...doc,
        pages: doc.pages.sort((left, right) => left.pageIndex - right.pageIndex),
        matchRate: doc.pages.length > 0 ? ((doc.matchedPages / doc.pages.length) * 100).toFixed(1) : "0.0"
      }))
    }))
    .sort((left, right) => right.totalPages - left.totalPages);

  const templates = Object.entries(templateCounts)
    .map(([id, count]) => ({ id, count }))
    .sort((left, right) => right.count - left.count);

  return {
    summary: {
      totalPages,
      matchedPages,
      unmatchedPages,
      matchRate: totalPages > 0 ? ((matchedPages / totalPages) * 100).toFixed(1) : "0.0",
      uniqueTemplates: Object.keys(templateCounts).length,
      uniqueBatches: Object.keys(batches).length,
      uniqueDocuments: normalizedBatches.reduce((sum, batch) => sum + batch.documents.length, 0)
    },
    batches: normalizedBatches,
    templates,
    raw: rows
  };
}

export function looksLikeTemplateMatching(rows = []) {
  if (!Array.isArray(rows) || rows.length === 0) return false;

  const keys = Object.keys(rows[0] || {}).map((key) => key.toLowerCase());
  const hasBatch = keys.some((key) => key.includes("batch"));
  const hasDoc = keys.some((key) => key.includes("doc"));
  const hasTemplate = keys.some((key) => key.includes("template"));
  const hasPage = keys.some((key) => key.includes("page"));

  return (hasBatch || hasDoc) && hasTemplate && hasPage;
}

export function buildDetailModel(rows = []) {
  const allColumns = Array.from(rows.reduce((set, row) => {
    Object.keys(row).forEach((key) => set.add(key));
    return set;
  }, new Set()));

  const trainingPasses = Array.from(rows.reduce((set, row) => {
    const trainingPass = row.TrainingPass || row.Pass || row.trainingPass;
    if (trainingPass) set.add(String(trainingPass));
    return set;
  }, new Set())).sort();

  const batchMap = {};
  rows.forEach((row) => {
    const batchId = row.BatchId || row.BatchName || "Unknown_Batch";
    if (!batchMap[batchId]) {
      batchMap[batchId] = {
        id: batchId,
        rows: [],
        lineItemRows: []
      };
    }

    const fieldName = String(row.FieldName || "");
    if (/(.+):(\d+)\*?$/.test(fieldName)) {
      batchMap[batchId].lineItemRows.push(row);
    } else {
      batchMap[batchId].rows.push(row);
    }
  });

  return {
    allColumns,
    trainingPasses,
    batches: Object.values(batchMap),
    filteredRows: rows
  };
}

export function groupLineItems(rows = []) {
  const lineMap = {};
  const columns = new Set();

  rows.forEach((row) => {
    const match = String(row.FieldName || "").match(/(.+):(\d+)\*?$/);
    if (!match) return;

    const fieldName = match[1];
    const index = parseInt(match[2], 10);

    if (!lineMap[index]) lineMap[index] = { index, fields: {} };
    lineMap[index].fields[fieldName] = row;
    columns.add(fieldName);
  });

  return {
    lines: Object.values(lineMap).sort((left, right) => left.index - right.index),
    columns: Array.from(columns).sort()
  };
}

export function countProblems(rows = [], assignableOnly = false) {
  return rows.reduce(
    (counts, row) => {
      if (assignableOnly && !String(row.FieldName || "").includes("*")) return counts;
      const kind = statusKind(row.FieldStatus || row.Status || row.Result || "");
      if (kind === "error") counts.errors += 1;
      if (kind === "warning") counts.warnings += 1;
      return counts;
    },
    { errors: 0, warnings: 0 }
  );
}

export function isAssignableField(row) {
  return String(row.FieldName || "").includes("*");
}

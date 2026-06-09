import Papa from "papaparse";

export function readFileAsText(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (event) => resolve(event.target.result || "");
    reader.onerror = () => reject(reader.error || new Error("Unable to read file."));
    reader.readAsText(file);
  });
}

export function parseCsvText(text) {
  let normalized = String(text || "");

  if (normalized.includes("\u0000")) {
    normalized = normalized.replace(/\u0000/g, "");
  }

  normalized = normalized.replace(/^\uFEFF/, "").replace(/^[^\w\r\n]*sep=.*\r?\n/i, "");

  return new Promise((resolve, reject) => {
    Papa.parse(normalized, {
      header: true,
      skipEmptyLines: true,
      complete: (result) => resolve(result.data),
      error: (error) => reject(error)
    });
  });
}

export async function parseCsvFile(file) {
  return parseCsvText(await readFileAsText(file));
}

export function unparseCsv(rows) {
  return Papa.unparse(rows || []);
}

export function downloadCsv(rows, filename) {
  const csv = unparseCsv(rows);
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");

  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  URL.revokeObjectURL(url);
}

/**
 * csv.js
 *
 * Just enough CSV for the study's files (responses, rating sheets, keys): a header row,
 * quoted fields with "" escapes, commas and newlines inside quotes, CRLF, a UTF-8 BOM
 * from Excel. No dependencies, so the analysis runs anywhere Node does.
 */

const BOM = String.fromCharCode(0xfeff);

/** @returns {Record<string, string>[]} one object per row, keyed by the header. */
export function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = "";
  let quoted = false;
  const s = text.startsWith(BOM) ? text.slice(1) : text;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (quoted) {
      if (c === '"' && s[i + 1] === '"') {
        field += '"';
        i++;
      } else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ",") {
      row.push(field);
      field = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && s[i + 1] === "\n") i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else field += c;
  }
  if (field !== "" || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  const [header = [], ...body] = rows.filter((r) => r.some((f) => f.trim() !== ""));
  const keys = header.map((h) => h.trim());
  return body.map((r) => Object.fromEntries(keys.map((k, i) => [k, (r[i] ?? "").trim()])));
}

/** @param {object[]} rows @param {string[]} columns */
export function toCsv(rows, columns) {
  const cell = (value) => {
    const text = value === null || value === undefined ? "" : String(value);
    return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  };
  return [columns, ...rows.map((r) => columns.map((c) => r[c]))]
    .map((r) => r.map(cell).join(","))
    .join("\n")
    .concat("\n");
}

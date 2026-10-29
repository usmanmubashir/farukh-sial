// CSV export. UTF-8 with a byte order mark so Excel reads Urdu text, CRLF line ends, and quoting only where needed.
// Money is written as plain rupees with two decimals (no thousands separators) so spreadsheets can sum it.

/** columns: [{ label, value: (row) => any }]. Returns the file text. */
export function toCsv(columns, rows) {
  const cell = (value) => {
    const text = value === null || value === undefined ? '' : String(value);
    return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  };
  const head = columns.map((column) => cell(column.label)).join(',');
  const body = rows.map((row) => columns.map((column) => cell(column.value(row))).join(','));
  return `﻿${[head, ...body].join('\r\n')}\r\n`;
}

/** Paisa as plain rupees for CSV, for example 150000 → "1500.00". */
export const rupeesForCsv = (paisa) => (Number(paisa ?? 0) / 100).toFixed(2);

/** Starts a file download in the browser. */
export function downloadText(filename, text, type = 'text/csv;charset=utf-8') {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

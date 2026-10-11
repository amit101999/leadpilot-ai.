/**
 * CSV serialization with protection against spreadsheet formula injection:
 * cells beginning with = + - @ (or tab/CR) are prefixed with a single quote.
 */
const FORMULA_PREFIX = /^[=+\-@\t\r]/;

export function escapeCsvCell(value: unknown): string {
  if (value === null || value === undefined) return "";
  let text = value instanceof Date ? value.toISOString() : typeof value === "object" ? JSON.stringify(value) : String(value);
  if (FORMULA_PREFIX.test(text)) text = `'${text}`;
  if (/[",\n\r]/.test(text)) text = `"${text.replace(/"/g, '""')}"`;
  return text;
}

export function toCsv<T>(rows: readonly T[], columns: ReadonlyArray<{ header: string; value: (row: T) => unknown }>): string {
  const header = columns.map((c) => escapeCsvCell(c.header)).join(",");
  const body = rows.map((row) => columns.map((c) => escapeCsvCell(c.value(row))).join(","));
  return [header, ...body].join("\r\n") + "\r\n";
}

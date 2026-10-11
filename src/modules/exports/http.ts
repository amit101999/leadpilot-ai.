import type { CsvExport } from "./service";

/** CSV download response. A UTF-8 BOM makes Excel read non-ASCII job titles correctly. */
export function csvResponse(name: string, result: CsvExport): Response {
  const date = new Date().toISOString().slice(0, 10);
  return new Response(`﻿${result.csv}`, {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="leadpilot-${name}-${date}.csv"`,
      "cache-control": "no-store",
      "x-export-rows": String(result.rows),
      "x-export-truncated": String(result.truncated),
    },
  });
}

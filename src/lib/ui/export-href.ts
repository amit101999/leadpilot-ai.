/**
 * Builds a CSV export link from filters that have already been validated by the
 * page (server side), so the export endpoint only ever receives values it accepts.
 */
export function exportHref(endpoint: string, filters: Record<string, unknown>): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(filters)) {
    if (value === undefined || value === null || value === "" || key === "page" || key === "pageSize")
      continue;
    if (Array.isArray(value)) {
      if (value.length > 0) params.set(key, value.join(","));
    } else if (value instanceof Date) {
      params.set(key, value.toISOString());
    } else {
      params.set(key, String(value));
    }
  }
  const query = params.toString();
  return query ? `${endpoint}?${query}` : endpoint;
}

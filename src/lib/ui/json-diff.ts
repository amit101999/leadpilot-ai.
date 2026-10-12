export interface JsonChange {
  path: string;
  before: string;
  after: string;
}

const ABSENT = "–";

/** Flattens nested objects into dotted paths; arrays and primitives become display strings. */
function flatten(value: unknown, prefix: string, out: Map<string, string>): void {
  if (value !== null && typeof value === "object" && !Array.isArray(value)) {
    const entries = Object.entries(value as Record<string, unknown>);
    if (entries.length === 0 && prefix) out.set(prefix, "{}");
    for (const [key, child] of entries) flatten(child, prefix ? `${prefix}.${key}` : key, out);
    return;
  }
  if (!prefix) prefix = "value";
  if (value === null || value === undefined) out.set(prefix, "null");
  else if (Array.isArray(value)) {
    out.set(
      prefix,
      value.every((v) => v === null || typeof v !== "object")
        ? value.length
          ? value.map(String).join(", ")
          : "[]"
        : JSON.stringify(value),
    );
  } else out.set(prefix, String(value));
}

/**
 * Field-level differences between two JSON values (audit before/after states).
 * Paths present on one side only show "–" on the other.
 */
export function diffJson(before: unknown, after: unknown): JsonChange[] {
  const a = new Map<string, string>();
  const b = new Map<string, string>();
  if (before !== null && before !== undefined) flatten(before, "", a);
  if (after !== null && after !== undefined) flatten(after, "", b);
  const paths = [...new Set([...a.keys(), ...b.keys()])].sort();
  return paths
    .filter((path) => a.get(path) !== b.get(path))
    .map((path) => ({ path, before: a.get(path) ?? ABSENT, after: b.get(path) ?? ABSENT }));
}

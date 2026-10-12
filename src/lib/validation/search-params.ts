import type { z } from "zod";

export type RawSearchParams = Record<string, string | string[] | undefined>;

/**
 * Parses page search params with the same schema as the matching API route.
 * A hand-edited or stale URL must not break the page: parameters that fail
 * validation are dropped (the page falls back to its defaults for them).
 */
export function parseSearchParams<S extends z.ZodType>(schema: S, params: RawSearchParams): z.output<S> {
  const raw: Record<string, string | string[]> = {};
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined) raw[key] = value;
  }
  for (let attempt = 0; attempt < 5; attempt++) {
    const result = schema.safeParse(raw);
    if (result.success) return result.data;
    const invalid = new Set(result.error.issues.map((issue) => String(issue.path[0] ?? "")));
    if (invalid.size === 0 || [...invalid].every((key) => !(key in raw))) break;
    for (const key of invalid) delete raw[key];
  }
  return schema.parse({});
}

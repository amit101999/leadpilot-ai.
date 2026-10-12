import { z } from "zod";

export const uuidParam = z.uuid({ message: "Invalid id" });

/** Query-string helpers: values arrive as strings (or arrays when repeated). */
// Generic so the inner schema's output type survives (a plain z.ZodType parameter widens it to unknown).
const single = <S extends z.ZodType>(schema: S) =>
  z.preprocess((v) => (Array.isArray(v) ? v[0] : v === "" ? undefined : v), schema);

export const q = {
  int: (min: number, max: number) => single(z.coerce.number().int().min(min).max(max).optional()),
  string: (max = 200) => single(z.string().trim().max(max).optional()),
  uuid: () => single(z.uuid().optional()),
  date: () => single(z.coerce.date().optional()),
  /** Upper bound of a date range: a bare YYYY-MM-DD means "through the end of that UTC day". */
  endDate: () =>
    single(
      z.preprocess(
        (v) => (typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) ? `${v}T23:59:59.999Z` : v),
        z.coerce.date().optional(),
      ),
    ),
  bool: () =>
    single(
      z
        .enum(["true", "false"])
        .transform((v) => v === "true")
        .optional(),
    ),
  enumOf: <T extends readonly [string, ...string[]]>(values: T) => single(z.enum(values).optional()),
  enumList: <T extends readonly [string, ...string[]]>(values: T) =>
    z.preprocess(
      (v) => (v === undefined || v === "" ? undefined : Array.isArray(v) ? v : String(v).split(",")),
      z.array(z.enum(values)).max(20).optional(),
    ),
};

export const paginationQuery = {
  page: q.int(1, 10_000),
  pageSize: q.int(1, 100),
  sortDir: q.enumOf(["asc", "desc"] as const),
};

export function resolvePagination(input: { page?: unknown; pageSize?: unknown }) {
  const page = typeof input.page === "number" ? input.page : 1;
  const pageSize = typeof input.pageSize === "number" ? input.pageSize : 25;
  return { page, pageSize, offset: (page - 1) * pageSize };
}

export const idempotencyKeySchema = z
  .string()
  .trim()
  .regex(/^[A-Za-z0-9_-]{16,128}$/, "Idempotency-Key must be 16-128 URL-safe characters");

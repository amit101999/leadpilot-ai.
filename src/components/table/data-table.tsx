"use client";

import {
  flexRender,
  getCoreRowModel,
  useReactTable,
  type ColumnDef,
  type RowData,
} from "@tanstack/react-table";
import { ArrowDown, ArrowUp, ArrowUpDown, ChevronLeft, ChevronRight } from "lucide-react";
import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/ui/cn";
import { formatCount } from "@/lib/ui/format";
import { useUrlState } from "@/lib/ui/use-url-state";

declare module "@tanstack/react-table" {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- generic params required by the augmented interface
  interface ColumnMeta<TData extends RowData, TValue> {
    /** Server sort key; only columns with one are sortable. */
    sortKey?: string;
    align?: "left" | "right";
    className?: string;
  }
}

export interface PageMeta {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

/**
 * Server-driven table: rows, sorting and paging come from the server and are
 * controlled through the URL (TanStack Table in manual mode).
 */
export function DataTable<T>({
  columns,
  data,
  meta,
  caption,
  defaultSort,
  empty,
}: {
  columns: ColumnDef<T, unknown>[];
  data: T[];
  meta: PageMeta;
  caption: string;
  defaultSort: { key: string; dir: "asc" | "desc" };
  empty: ReactNode;
}) {
  const url = useUrlState();
  const sortKey = url.get("sort") || defaultSort.key;
  const sortDir = (url.get("sortDir") || defaultSort.dir) as "asc" | "desc";

  // eslint-disable-next-line react-hooks/incompatible-library -- TanStack Table manages its own memoisation
  const table = useReactTable({
    data,
    columns,
    getCoreRowModel: getCoreRowModel(),
    manualSorting: true,
    manualPagination: true,
    rowCount: meta.total,
  });

  function toggleSort(key: string) {
    const nextDir = sortKey === key && sortDir === "desc" ? "asc" : "desc";
    url.update({ sort: key, sortDir: nextDir });
  }

  const first = meta.total === 0 ? 0 : (meta.page - 1) * meta.pageSize + 1;
  const last = Math.min(meta.page * meta.pageSize, meta.total);

  return (
    <div className={cn("min-w-0", url.pending && "opacity-70 transition-opacity")} aria-busy={url.pending}>
      <div className="overflow-x-auto">
        <table className="tabular w-full text-left text-[13px]">
          <caption className="sr-only">{caption}</caption>
          <thead className="text-muted">
            {table.getHeaderGroups().map((group) => (
              <tr key={group.id} className="border-b border-line">
                {group.headers.map((header) => {
                  const colMeta = header.column.columnDef.meta;
                  const key = colMeta?.sortKey;
                  const active = key !== undefined && key === sortKey;
                  return (
                    <th
                      key={header.id}
                      scope="col"
                      aria-sort={active ? (sortDir === "asc" ? "ascending" : "descending") : undefined}
                      className={cn(
                        "px-4 py-2 font-medium whitespace-nowrap",
                        colMeta?.align === "right" && "text-right",
                        colMeta?.className,
                      )}
                    >
                      {key ? (
                        <button
                          type="button"
                          onClick={() => toggleSort(key)}
                          className={cn(
                            "inline-flex items-center gap-1 rounded-control hover:text-ink",
                            active && "text-ink",
                          )}
                        >
                          {flexRender(header.column.columnDef.header, header.getContext())}
                          {active ? (
                            sortDir === "asc" ? (
                              <ArrowUp aria-hidden className="size-3.5" />
                            ) : (
                              <ArrowDown aria-hidden className="size-3.5" />
                            )
                          ) : (
                            <ArrowUpDown aria-hidden className="size-3.5 opacity-40" />
                          )}
                        </button>
                      ) : (
                        flexRender(header.column.columnDef.header, header.getContext())
                      )}
                    </th>
                  );
                })}
              </tr>
            ))}
          </thead>
          <tbody>
            {table.getRowModel().rows.map((row) => (
              <tr key={row.id} className="border-b border-line last:border-0 hover:bg-sunken/60">
                {row.getVisibleCells().map((cell) => {
                  const colMeta = cell.column.columnDef.meta;
                  return (
                    <td
                      key={cell.id}
                      className={cn(
                        "px-4 py-2.5 align-top",
                        colMeta?.align === "right" && "text-right",
                        colMeta?.className,
                      )}
                    >
                      {flexRender(cell.column.columnDef.cell, cell.getContext())}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {data.length === 0 && empty}
      <nav
        aria-label="Pagination"
        className="flex flex-wrap items-center justify-between gap-2 border-t border-line px-4 py-2 text-[13px] text-muted"
      >
        <span>
          {meta.total === 0
            ? "No results"
            : `${formatCount(first)}–${formatCount(last)} of ${formatCount(meta.total)}`}
        </span>
        <span className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="sm"
            disabled={meta.page <= 1 || url.pending}
            onClick={() => url.update({ page: String(meta.page - 1) })}
          >
            <ChevronLeft />
            Previous
          </Button>
          <span aria-current="page">
            Page {meta.page} of {meta.totalPages}
          </span>
          <Button
            variant="ghost"
            size="sm"
            disabled={meta.page >= meta.totalPages || url.pending}
            onClick={() => url.update({ page: String(meta.page + 1) })}
          >
            Next
            <ChevronRight />
          </Button>
        </span>
      </nav>
    </div>
  );
}

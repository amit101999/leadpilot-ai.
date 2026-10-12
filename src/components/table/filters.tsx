"use client";

import { Download, Search, SlidersHorizontal, X } from "lucide-react";
import { useEffect, useId, useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Input, Label, Select } from "@/components/ui/field";
import { useUrlState } from "@/lib/ui/use-url-state";

/**
 * Row of filters above a table. Every control writes to the URL. On small
 * screens the filters collapse behind a toggle so the results stay in view.
 */
export function FilterBar({ children, filterKeys }: { children: ReactNode; filterKeys: string[] }) {
  const url = useUrlState();
  const panelId = useId();
  const [open, setOpen] = useState(false);
  const activeCount = filterKeys.filter((key) => url.get(key)).length;
  return (
    <div className="border-b border-line px-4 py-3">
      <Button
        variant="secondary"
        size="sm"
        className="sm:hidden"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((value) => !value)}
      >
        <SlidersHorizontal />
        Filters{activeCount > 0 ? ` (${activeCount} active)` : ""}
      </Button>
      <div
        id={panelId}
        className={`${open ? "mt-3 flex" : "hidden"} flex-wrap items-end gap-3 sm:mt-0 sm:flex`}
      >
        {children}
        {activeCount > 0 && (
          <Button variant="ghost" size="sm" onClick={() => url.clear(["sort", "sortDir", "tab"])}>
            <X />
            Clear filters
          </Button>
        )}
      </div>
    </div>
  );
}

export function SearchFilter({
  param,
  label,
  placeholder,
}: {
  param: string;
  label: string;
  placeholder?: string;
}) {
  const url = useUrlState();
  const id = useId();
  const current = url.get(param);
  const [value, setValue] = useState(current);
  const [syncedWith, setSyncedWith] = useState(current);

  // Keep the box in sync when the URL changes elsewhere (Clear filters, back button).
  // Adjusting state during render avoids an extra effect-driven render.
  if (current !== syncedWith) {
    setSyncedWith(current);
    setValue(current);
  }

  useEffect(() => {
    if (value === current) return;
    const timer = setTimeout(() => url.update({ [param]: value.trim() || null }), 300);
    return () => clearTimeout(timer);
  }, [value, current, param, url]);

  return (
    <div className="flex min-w-48 flex-1 flex-col gap-1.5 sm:max-w-72">
      <Label htmlFor={id}>{label}</Label>
      <div className="relative">
        <Search
          aria-hidden
          className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted"
        />
        <Input
          id={id}
          type="search"
          value={value}
          placeholder={placeholder}
          onChange={(event) => setValue(event.target.value)}
          className="pl-8"
        />
      </div>
    </div>
  );
}

export function SelectFilter({
  param,
  label,
  options,
  allLabel = "All",
}: {
  param: string;
  label: string;
  options: Array<{ value: string; label: string }>;
  allLabel?: string;
}) {
  const url = useUrlState();
  const id = useId();
  return (
    <div className="flex min-w-40 flex-col gap-1.5">
      <Label htmlFor={id}>{label}</Label>
      <Select
        id={id}
        value={url.get(param)}
        onChange={(event) => url.update({ [param]: event.target.value })}
      >
        <option value="">{allLabel}</option>
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </Select>
    </div>
  );
}

export function DateFilter({ param, label }: { param: string; label: string }) {
  const url = useUrlState();
  const id = useId();
  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={id}>{label}</Label>
      <Input
        id={id}
        type="date"
        value={url.get(param).slice(0, 10)}
        onChange={(event) => url.update({ [param]: event.target.value })}
        className="w-40"
      />
    </div>
  );
}

export function NumberFilter({
  param,
  label,
  min,
  max,
}: {
  param: string;
  label: string;
  min: number;
  max: number;
}) {
  const url = useUrlState();
  const id = useId();
  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={id}>{label}</Label>
      <Input
        id={id}
        type="number"
        inputMode="numeric"
        min={min}
        max={max}
        value={url.get(param)}
        onChange={(event) => url.update({ [param]: event.target.value })}
        className="w-28"
      />
    </div>
  );
}

/** CSV download. `href` is built on the server from the validated filters (see exportHref). */
export function ExportLink({ href, label = "Export CSV" }: { href: string; label?: string }) {
  return (
    <Button variant="secondary" size="sm" asChild>
      <a href={href} download>
        <Download />
        {label}
      </a>
    </Button>
  );
}

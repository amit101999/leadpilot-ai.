"use client";

import { X } from "lucide-react";
import { useState, type KeyboardEvent } from "react";
import { cn } from "@/lib/ui/cn";

/**
 * List editor: type and press Enter (or comma) to add, click the × or press
 * Backspace in an empty box to remove the last item. Case-insensitive duplicates are ignored.
 */
export function ChipInput({
  id,
  value,
  onChange,
  placeholder,
  max = 50,
  invalid,
  describedBy,
}: {
  id: string;
  value: string[];
  onChange: (next: string[]) => void;
  placeholder?: string;
  max?: number;
  invalid?: boolean;
  describedBy?: string;
}) {
  const [draft, setDraft] = useState("");

  function add(raw: string) {
    const term = raw.trim();
    if (!term || value.length >= max) return;
    if (value.some((v) => v.toLowerCase() === term.toLowerCase())) {
      setDraft("");
      return;
    }
    onChange([...value, term.slice(0, 80)]);
    setDraft("");
  }

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Enter" || event.key === ",") {
      event.preventDefault();
      add(draft);
    } else if (event.key === "Backspace" && draft === "" && value.length > 0) {
      onChange(value.slice(0, -1));
    }
  }

  return (
    <div
      className={cn(
        "flex min-h-9 w-full flex-wrap items-center gap-1 rounded-control border border-line-strong bg-surface px-1.5 py-1 focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-focus",
        invalid && "border-danger",
      )}
    >
      <ul className="contents" aria-label="Current items">
        {value.map((item) => (
          <li
            key={item}
            className="flex items-center gap-1 rounded-full bg-info-soft py-0.5 pr-1 pl-2 text-xs"
          >
            {item}
            <button
              type="button"
              onClick={() => onChange(value.filter((v) => v !== item))}
              aria-label={`Remove ${item}`}
              className="rounded-full p-0.5 text-muted hover:bg-line hover:text-ink"
            >
              <X className="size-3" />
            </button>
          </li>
        ))}
      </ul>
      <input
        id={id}
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        onKeyDown={onKeyDown}
        onBlur={() => add(draft)}
        placeholder={value.length >= max ? "Limit reached" : placeholder}
        disabled={value.length >= max}
        aria-invalid={invalid || undefined}
        aria-describedby={describedBy}
        className="h-7 min-w-32 flex-1 bg-transparent px-1 text-sm outline-none placeholder:text-muted"
      />
    </div>
  );
}

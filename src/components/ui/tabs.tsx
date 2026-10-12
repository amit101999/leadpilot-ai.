"use client";

import { useId, useRef, type KeyboardEvent, type ReactNode } from "react";
import { cn } from "@/lib/ui/cn";

export interface TabItem {
  key: string;
  label: string;
  /** Shown as a small marker, e.g. when the tab contains a validation error. */
  alert?: boolean;
  content: ReactNode;
}

/**
 * WAI-ARIA tabs: arrow keys, Home and End move between tabs; only the active
 * tab is in the tab order. All panels stay mounted so form fields keep their state.
 */
export function Tabs({
  items,
  active,
  onChange,
  label,
}: {
  items: TabItem[];
  active: string;
  onChange: (key: string) => void;
  label: string;
}) {
  const baseId = useId();
  const refs = useRef<Array<HTMLButtonElement | null>>([]);

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const index = items.findIndex((item) => item.key === active);
    let next = index;
    if (event.key === "ArrowRight") next = (index + 1) % items.length;
    else if (event.key === "ArrowLeft") next = (index - 1 + items.length) % items.length;
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = items.length - 1;
    else return;
    event.preventDefault();
    onChange(items[next]!.key);
    refs.current[next]?.focus();
  }

  return (
    <div>
      <div
        role="tablist"
        aria-label={label}
        onKeyDown={onKeyDown}
        className="flex gap-1 overflow-x-auto border-b border-line px-2"
      >
        {items.map((item, index) => {
          const selected = item.key === active;
          return (
            <button
              key={item.key}
              ref={(el) => {
                refs.current[index] = el;
              }}
              id={`${baseId}-tab-${item.key}`}
              type="button"
              role="tab"
              aria-selected={selected}
              aria-controls={`${baseId}-panel-${item.key}`}
              tabIndex={selected ? 0 : -1}
              onClick={() => onChange(item.key)}
              className={cn(
                "-mb-px flex items-center gap-1.5 border-b-2 px-3 py-2.5 text-sm whitespace-nowrap",
                selected
                  ? "border-accent font-medium text-ink"
                  : "border-transparent text-muted hover:text-ink",
              )}
            >
              {item.label}
              {item.alert && (
                <span className="size-1.5 rounded-full bg-danger" aria-label="has errors" role="img" />
              )}
            </button>
          );
        })}
      </div>
      {items.map((item) => (
        <div
          key={item.key}
          id={`${baseId}-panel-${item.key}`}
          role="tabpanel"
          aria-labelledby={`${baseId}-tab-${item.key}`}
          hidden={item.key !== active}
          tabIndex={0}
          className="focus-visible:outline-offset-[-2px]"
        >
          {item.content}
        </div>
      ))}
    </div>
  );
}

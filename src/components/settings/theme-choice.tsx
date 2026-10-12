"use client";

import { useTheme } from "next-themes";
import { useSyncExternalStore } from "react";

const subscribe = () => () => {};

/** Light / dark preference, stored in this browser by next-themes. */
export function ThemeChoice() {
  const { theme, setTheme } = useTheme();
  // The stored theme is only known in the browser; render nothing selected on the server.
  const mounted = useSyncExternalStore(
    subscribe,
    () => true,
    () => false,
  );
  return (
    <fieldset className="px-4 py-4">
      <legend className="sr-only">Theme</legend>
      <div className="flex gap-4 text-sm">
        {(["light", "dark"] as const).map((value) => (
          <label key={value} className="flex cursor-pointer items-center gap-2">
            <input
              type="radio"
              name="theme"
              value={value}
              checked={mounted && theme === value}
              onChange={() => setTheme(value)}
              className="size-4 accent-[var(--accent)]"
            />
            {value === "light" ? "Light" : "Dark"}
          </label>
        ))}
      </div>
      <p className="mt-2 text-[13px] text-muted">Saved in this browser only.</p>
    </fieldset>
  );
}

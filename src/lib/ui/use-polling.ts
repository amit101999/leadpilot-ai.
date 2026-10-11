"use client";

import { useEffect, useRef, useState } from "react";
import { ApiError, apiFetch } from "@/lib/http/client";

/**
 * Polls a JSON endpoint until `isDone(data)` is true. Pauses while the tab is
 * hidden, never overlaps requests, and keeps the last good data on errors.
 */
export function usePolling<T>(
  path: string | null,
  options: { intervalMs?: number; isDone?: (data: T) => boolean; initial?: T } = {},
) {
  const { intervalMs = 2000, isDone, initial } = options;
  const [data, setData] = useState<T | undefined>(initial);
  const [error, setError] = useState<ApiError | null>(null);
  const isDoneRef = useRef(isDone);
  useEffect(() => {
    isDoneRef.current = isDone;
  });

  useEffect(() => {
    if (!path) return;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const controller = new AbortController();

    const tick = async () => {
      if (stopped) return;
      if (document.visibilityState === "hidden") {
        timer = setTimeout(tick, intervalMs);
        return;
      }
      try {
        const next = await apiFetch<T>(path, { signal: controller.signal });
        if (stopped) return;
        setData(next);
        setError(null);
        if (isDoneRef.current?.(next)) return;
      } catch (err) {
        if (stopped || (err instanceof DOMException && err.name === "AbortError")) return;
        setError(err instanceof ApiError ? err : new ApiError("UNKNOWN", "Could not refresh progress", 0));
      }
      timer = setTimeout(tick, intervalMs);
    };
    void tick();
    return () => {
      stopped = true;
      controller.abort();
      clearTimeout(timer);
    };
  }, [path, intervalMs]);

  return { data, error };
}

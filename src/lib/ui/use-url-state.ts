"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useTransition } from "react";

/**
 * Table state (filters, sort, page) lives in the URL so views can be shared
 * and the back button works. Changing anything except the page resets to page 1.
 */
export function useUrlState() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [pending, startTransition] = useTransition();

  const get = useCallback((key: string) => searchParams.get(key) ?? "", [searchParams]);

  const update = useCallback(
    (changes: Record<string, string | null | undefined>) => {
      const next = new URLSearchParams(searchParams.toString());
      for (const [key, value] of Object.entries(changes)) {
        if (value === null || value === undefined || value === "") next.delete(key);
        else next.set(key, value);
      }
      if (!("page" in changes)) next.delete("page");
      const query = next.toString();
      startTransition(() => router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false }));
    },
    [pathname, router, searchParams],
  );

  const clear = useCallback(
    (keep: string[] = []) => {
      const next = new URLSearchParams();
      for (const key of keep) {
        const value = searchParams.get(key);
        if (value) next.set(key, value);
      }
      const query = next.toString();
      startTransition(() => router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false }));
    },
    [pathname, router, searchParams],
  );

  return { get, update, clear, pending, query: searchParams.toString() };
}

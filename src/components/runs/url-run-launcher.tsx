"use client";

import { useRouter } from "next/navigation";
import { RunLauncher, type LaunchableProfile } from "./run-launcher";

/** Run launcher that keeps the selected profile in the URL so the page can show its settings. */
export function UrlRunLauncher(props: {
  profiles: LaunchableProfile[];
  selectedId: string | null;
  canRun: boolean;
}) {
  const router = useRouter();
  return (
    <RunLauncher
      {...props}
      onProfileChange={(id) => router.replace(`/run?profileId=${encodeURIComponent(id)}`, { scroll: false })}
    />
  );
}

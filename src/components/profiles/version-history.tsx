"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogClose, DialogContent } from "@/components/ui/dialog";
import { Time } from "@/components/ui/time";
import { ApiError, apiFetch } from "@/lib/http/client";
import type { ConfigChange } from "@/modules/profiles/diff";

export interface VersionEntry {
  id: string;
  versionNumber: number;
  name: string;
  description: string | null;
  changeNote: string | null;
  createdAt: Date | string;
  authorEmail: string | null;
  /** Differences from the previous version (empty for version 1). */
  changes: ConfigChange[];
  configuration: unknown;
}

/** Version list, newest first. Restoring saves the old settings as a new version; history is never rewritten. */
export function VersionHistory({
  profileId,
  currentVersion,
  versions,
  canRestore,
}: {
  profileId: string;
  currentVersion: number;
  versions: VersionEntry[];
  canRestore: boolean;
}) {
  const router = useRouter();
  const [target, setTarget] = useState<VersionEntry | null>(null);
  const [busy, setBusy] = useState(false);

  async function restore() {
    if (!target) return;
    setBusy(true);
    try {
      const saved = await apiFetch<{ currentVersion: number }>(`/api/profiles/${profileId}`, {
        method: "PATCH",
        body: {
          expectedVersion: currentVersion,
          name: target.name,
          description: target.description,
          configuration: target.configuration,
          changeNote: `Restored version ${target.versionNumber}`,
        },
      });
      toast.success(
        saved.currentVersion === currentVersion
          ? "The current settings already match that version."
          : `Version ${target.versionNumber} restored as version ${saved.currentVersion}.`,
      );
      setTarget(null);
      router.refresh();
    } catch (error) {
      toast.error(
        error instanceof ApiError && error.code === "VERSION_CONFLICT"
          ? "Someone saved a newer version. Reload the page and try again."
          : error instanceof ApiError
            ? error.message
            : "The version could not be restored.",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <ol className="divide-y divide-line">
        {versions.map((version) => (
          <li key={version.id} className="px-4 py-3">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div>
                <p className="text-sm font-medium">
                  Version {version.versionNumber}{" "}
                  {version.versionNumber === currentVersion && <Badge tone="accent">Current</Badge>}
                </p>
                <p className="text-[13px] text-muted">
                  Saved <Time value={version.createdAt} />
                  {version.authorEmail && ` by ${version.authorEmail}`}
                  {version.changeNote && `: ${version.changeNote}`}
                </p>
              </div>
              {canRestore && version.versionNumber !== currentVersion && (
                <Button variant="secondary" size="sm" onClick={() => setTarget(version)}>
                  Restore this version
                </Button>
              )}
            </div>
            {version.versionNumber === 1 ? (
              <p className="mt-1 text-[13px] text-muted">First version.</p>
            ) : version.changes.length === 0 ? (
              <p className="mt-1 text-[13px] text-muted">Only the name or description changed.</p>
            ) : (
              <ul className="mt-2 flex flex-col gap-1 text-[13px]">
                {version.changes.map((change) => (
                  <li key={change.path} className="grid gap-x-3 sm:grid-cols-[220px_1fr]">
                    <span className="text-muted">{change.label}</span>
                    <span>
                      <span className="text-muted line-through decoration-muted/50">{change.before}</span>
                      <span aria-hidden> → </span>
                      <span className="sr-only"> changed to </span>
                      <span className="font-medium">{change.after}</span>
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </li>
        ))}
      </ol>

      <Dialog open={target !== null} onOpenChange={(open) => !busy && !open && setTarget(null)}>
        <DialogContent
          title={`Restore version ${target?.versionNumber ?? ""}?`}
          description={`Its settings will be saved as a new version ${currentVersion + 1}. Nothing in the history is deleted, and runs already started keep their own settings.`}
        >
          <div className="flex justify-end gap-2">
            <DialogClose asChild>
              <Button variant="secondary" disabled={busy}>
                Cancel
              </Button>
            </DialogClose>
            <Button onClick={restore} disabled={busy}>
              {busy ? "Restoring…" : "Restore as a new version"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

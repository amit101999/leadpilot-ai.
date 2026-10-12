"use client";

import { Archive, ArchiveRestore, Copy, Star } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogClose, DialogContent } from "@/components/ui/dialog";
import { ApiError, apiFetch } from "@/lib/http/client";

/** Duplicate, set as default, archive and restore. Each action is audited on the server. */
export function ProfileActions({
  profile,
  size = "sm",
}: {
  profile: { id: string; name: string; isDefault: boolean; archived: boolean };
  size?: "sm" | "md";
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [confirmArchive, setConfirmArchive] = useState(false);

  async function act(path: string, success: string, body?: unknown) {
    setBusy(true);
    try {
      const result = await apiFetch<{ id: string }>(`/api/profiles/${profile.id}/${path}`, {
        method: "POST",
        body,
      });
      toast.success(success);
      return result;
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : "The action could not be completed.");
      return null;
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <Button
        variant="secondary"
        size={size}
        disabled={busy}
        onClick={async () => {
          const copy = await act("duplicate", "Profile duplicated.", {});
          if (copy) router.push(`/profiles/${copy.id}`);
        }}
      >
        <Copy />
        Duplicate
      </Button>
      {!profile.archived && !profile.isDefault && (
        <Button
          variant="secondary"
          size={size}
          disabled={busy}
          onClick={async () => {
            if (await act("default", `"${profile.name}" is now the default profile.`)) router.refresh();
          }}
        >
          <Star />
          Set as default
        </Button>
      )}
      {profile.archived ? (
        <Button
          variant="secondary"
          size={size}
          disabled={busy}
          onClick={async () => {
            if (await act("restore", "Profile restored. It can be edited and run again.")) router.refresh();
          }}
        >
          <ArchiveRestore />
          Restore
        </Button>
      ) : (
        <Button variant="secondary" size={size} disabled={busy} onClick={() => setConfirmArchive(true)}>
          <Archive />
          Archive
        </Button>
      )}

      <Dialog open={confirmArchive} onOpenChange={(open) => !busy && setConfirmArchive(open)}>
        <DialogContent
          title={`Archive "${profile.name}"?`}
          description="Archived profiles cannot be run or edited until restored. Their runs and history are kept."
        >
          <div className="flex justify-end gap-2">
            <DialogClose asChild>
              <Button variant="secondary" disabled={busy}>
                Cancel
              </Button>
            </DialogClose>
            <Button
              variant="danger"
              disabled={busy}
              onClick={async () => {
                if (await act("archive", "Profile archived.")) {
                  setConfirmArchive(false);
                  router.refresh();
                }
              }}
            >
              Archive profile
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

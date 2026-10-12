"use client";

import { RotateCcw } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogClose, DialogContent } from "@/components/ui/dialog";
import { ApiError, apiFetch } from "@/lib/http/client";
import { retryModeFor, uncertainRetryEligibleAt } from "@/modules/notifications/retry-policy";

function formatWait(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

/**
 * Manual resend. Failed sends can be retried directly. A send with unknown
 * delivery may already have reached the phone, so it waits 15 minutes for a
 * WhatsApp status update and then needs an explicit confirmation.
 */
export function RetryButton({
  notification,
}: {
  notification: { id: string; status: string; lastAttemptAt: Date | string | null; updatedAt: Date | string };
}) {
  const router = useRouter();
  const mode = retryModeFor(notification.status);
  const eligibleAt = uncertainRetryEligibleAt(notification.lastAttemptAt, notification.updatedAt).getTime();
  const [now, setNow] = useState(() => Date.now());
  const [open, setOpen] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const waiting = mode === "confirm-after-wait" && now < eligibleAt;

  useEffect(() => {
    if (!waiting) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [waiting]);

  if (mode === "none") return null;

  async function retry() {
    setBusy(true);
    try {
      const result = await apiFetch<{ status: string }>(`/api/notifications/${notification.id}/retry`, {
        method: "POST",
        body: mode === "confirm-after-wait" ? { confirmNotReceived: true } : {},
      });
      toast.success(
        result.status === "SENT"
          ? "Resent. WhatsApp accepted the message."
          : `Retry finished with status: ${result.status.toLowerCase().replace(/_/g, " ")}.`,
      );
      setOpen(false);
      router.refresh();
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : "The retry could not be started.");
    } finally {
      setBusy(false);
    }
  }

  if (waiting) {
    return (
      <Button variant="secondary" size="sm" disabled title="Waiting for a delivery update from WhatsApp">
        <RotateCcw />
        Retry in {formatWait(eligibleAt - now)}
      </Button>
    );
  }

  return (
    <>
      <Button
        variant="secondary"
        size="sm"
        onClick={() => {
          setConfirmed(false);
          setOpen(true);
        }}
      >
        <RotateCcw />
        Retry
      </Button>
      <Dialog open={open} onOpenChange={(next) => !busy && setOpen(next)}>
        <DialogContent
          title="Resend this alert?"
          description={
            mode === "confirm-after-wait"
              ? "The first attempt timed out, so WhatsApp may already have delivered it and no update arrived. Resend only if you know it was not received."
              : "The alert will be sent again to the same recipient. The recipient's opt-in is checked first."
          }
        >
          {mode === "confirm-after-wait" && (
            <Checkbox
              className="mb-4"
              label="The recipient did not receive this message"
              checked={confirmed}
              onChange={(event) => setConfirmed(event.target.checked)}
            />
          )}
          <div className="flex justify-end gap-2">
            <DialogClose asChild>
              <Button variant="secondary" disabled={busy}>
                Cancel
              </Button>
            </DialogClose>
            <Button onClick={retry} disabled={busy || (mode === "confirm-after-wait" && !confirmed)}>
              {busy ? "Resending…" : "Resend alert"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

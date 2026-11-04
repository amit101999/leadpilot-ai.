"use client";

import { RefreshCw, Send } from "lucide-react";
import { useRouter } from "next/navigation";
import { useId, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogClose, DialogContent } from "@/components/ui/dialog";
import { Label, Select } from "@/components/ui/field";
import { ApiError, apiFetch } from "@/lib/http/client";

/** Runs one live check for an integration and stores the result. */
export function TestConnectionButton({ name, label }: { name: string; label: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  return (
    <Button
      variant="secondary"
      size="sm"
      disabled={busy}
      onClick={async () => {
        setBusy(true);
        try {
          const result = await apiFetch<{ status: string; message: string | null }>(
            `/api/integrations/${name}/check`,
            { method: "POST" },
          );
          const ok = result.status === "CONNECTED" || result.status === "MOCK";
          (ok ? toast.success : toast.warning)(`${label}: ${result.message ?? result.status}`);
          router.refresh();
        } catch (error) {
          toast.error(error instanceof ApiError ? error.message : "The check could not be run.");
        } finally {
          setBusy(false);
        }
      }}
    >
      <RefreshCw className={busy ? "animate-spin" : undefined} />
      {busy ? "Testing…" : "Test connection"}
    </Button>
  );
}

/** Sends WhatsApp's connection-test template to an opted-in recipient, after confirmation. */
const TEST_TEXT = {
  whatsapp: {
    name: "WhatsApp",
    accepted: "WhatsApp accepted the test message. Check the phone to confirm it arrived.",
    live: "WhatsApp's connection-test template will be sent to the recipient below. Limited to 3 per 10 minutes.",
  },
  email: {
    name: "E-mail",
    accepted:
      "The mail server accepted the test e-mail. Check the inbox (and spam folder) to confirm it arrived.",
    live: "A short test e-mail will be sent to the recipient below. Limited to 3 per 10 minutes.",
  },
} as const;

/** Sends a connection test on one channel to an opted-in recipient of that channel. */
export function TestMessageButton({
  channel,
  recipients,
  isMock,
}: {
  channel: "whatsapp" | "email";
  recipients: Array<{ id: string; label: string; address: string }>;
  isMock: boolean;
}) {
  const text = TEST_TEXT[channel];
  const selectId = useId();
  const [open, setOpen] = useState(false);
  const [recipientId, setRecipientId] = useState(recipients[0]?.id ?? "");
  const [busy, setBusy] = useState(false);

  async function send() {
    setBusy(true);
    try {
      const result = await apiFetch<{ status: string; error: string | null; isMock: boolean }>(
        `/api/integrations/${channel}/test`,
        { method: "POST", body: { recipientId } },
      );
      if (result.status === "ACCEPTED") {
        toast.success(
          result.isMock ? "Mock provider: the test message was recorded, not sent." : text.accepted,
        );
        setOpen(false);
      } else {
        toast.error(`${text.name} did not accept the test message: ${result.error ?? result.status}`);
      }
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : "The test message could not be sent.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Button variant="secondary" size="sm" disabled={recipients.length === 0} onClick={() => setOpen(true)}>
        <Send />
        Send test message
      </Button>
      {recipients.length === 0 && (
        <p className="text-[13px] text-muted">Add a recipient and confirm their opt-in in Settings first.</p>
      )}
      <Dialog open={open} onOpenChange={(next) => !busy && setOpen(next)}>
        <DialogContent
          title={`Send a${channel === "email" ? "n e-mail" : " WhatsApp"} test message?`}
          description={
            isMock
              ? `${text.name} is in mock mode, so nothing is actually sent; the attempt is recorded.`
              : text.live
          }
        >
          <div className="mb-4 flex flex-col gap-1.5">
            <Label htmlFor={selectId}>Recipient</Label>
            <Select
              id={selectId}
              value={recipientId}
              onChange={(event) => setRecipientId(event.target.value)}
            >
              {recipients.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.label} ({r.address})
                </option>
              ))}
            </Select>
          </div>
          <div className="flex justify-end gap-2">
            <DialogClose asChild>
              <Button variant="secondary" disabled={busy}>
                Cancel
              </Button>
            </DialogClose>
            <Button onClick={send} disabled={busy || !recipientId}>
              {busy ? "Sending…" : "Send test message"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { Plus } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogClose, DialogContent } from "@/components/ui/dialog";
import { Field, Input } from "@/components/ui/field";
import { EmptyState } from "@/components/ui/panel";
import { Time } from "@/components/ui/time";
import { ApiError, apiFetch } from "@/lib/http/client";

export interface RecipientRow {
  id: string;
  label: string;
  emailMasked: string | null;
  optInConfirmedAt: Date | string | null;
  archivedAt: Date | string | null;
}

const OPT_IN_STATEMENT = "This person agreed to receive lead alert e-mails from us";

const addSchema = z.object({
  label: z.string().trim().min(1, "Enter a name").max(80),
  email: z.email("Enter a valid e-mail address").trim(),
  optInConfirmed: z.boolean(),
});
type AddValues = z.infer<typeof addSchema>;

/**
 * Alert recipients (e-mail addresses). Addresses are shown masked; opt-in is recorded only
 * through an explicit statement and every change is audited on the server.
 */
export function RecipientsManager({ recipients, canEdit }: { recipients: RecipientRow[]; canEdit: boolean }) {
  const router = useRouter();
  const [adding, setAdding] = useState(false);
  const [optInFor, setOptInFor] = useState<RecipientRow | null>(null);
  const [agreed, setAgreed] = useState(false);
  const [busy, setBusy] = useState(false);
  const form = useForm<AddValues>({
    resolver: zodResolver(addSchema),
    defaultValues: { label: "", email: "", optInConfirmed: false },
  });

  async function update(id: string, body: Record<string, unknown>, success: string) {
    setBusy(true);
    try {
      await apiFetch(`/api/recipients/${id}`, { method: "PATCH", body });
      toast.success(success);
      router.refresh();
      return true;
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : "The recipient could not be updated.");
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function add(values: AddValues) {
    const body = { channel: "EMAIL", ...values };
    try {
      await apiFetch("/api/recipients", { method: "POST", body });
      toast.success(`${values.label} added.`);
      form.reset();
      setAdding(false);
      router.refresh();
    } catch (error) {
      if (error instanceof ApiError && error.code === "CONFLICT") {
        form.setError("email", { message: "This address is already a recipient" });
      } else if (error instanceof ApiError && error.code === "VALIDATION_ERROR") {
        for (const [path, message] of Object.entries(error.fieldErrors())) {
          form.setError(path as keyof AddValues, { message });
        }
      } else {
        toast.error(error instanceof ApiError ? error.message : "The recipient could not be added.");
      }
    }
  }

  return (
    <div>
      {recipients.length === 0 ? (
        <EmptyState title="No recipients yet">
          Add the e-mail address that should receive lead alerts. Alerts are sent only after you confirm the
          person agreed to receive them.
        </EmptyState>
      ) : (
        <ul className="divide-y divide-line">
          {recipients.map((r) => (
            <li key={r.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 text-sm">
              <div>
                <p className="font-medium">
                  {r.label} <span className="tabular font-normal text-muted">{r.emailMasked}</span>
                </p>
                <p className="mt-0.5 flex flex-wrap items-center gap-2 text-[13px] text-muted">
                  {r.archivedAt ? (
                    <Badge>Archived</Badge>
                  ) : r.optInConfirmedAt ? (
                    <>
                      <Badge tone="success">Opt-in confirmed</Badge>
                      <span>
                        <Time value={r.optInConfirmedAt} />
                      </span>
                    </>
                  ) : (
                    <Badge tone="warning">Opt-in not confirmed: no alerts are sent</Badge>
                  )}
                </p>
              </div>
              {canEdit && (
                <div className="flex flex-wrap gap-1.5">
                  {!r.archivedAt && !r.optInConfirmedAt && (
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={() => {
                        setAgreed(false);
                        setOptInFor(r);
                      }}
                    >
                      Confirm opt-in
                    </Button>
                  )}
                  {!r.archivedAt && r.optInConfirmedAt && (
                    <Button
                      size="sm"
                      variant="secondary"
                      disabled={busy}
                      onClick={() =>
                        update(
                          r.id,
                          { optInConfirmed: false },
                          `Opt-in withdrawn for ${r.label}. No more alerts are sent to them.`,
                        )
                      }
                    >
                      Withdraw opt-in
                    </Button>
                  )}
                  <Button
                    size="sm"
                    variant="secondary"
                    disabled={busy}
                    onClick={() =>
                      update(
                        r.id,
                        { archived: !r.archivedAt },
                        r.archivedAt ? `${r.label} restored.` : `${r.label} archived.`,
                      )
                    }
                  >
                    {r.archivedAt ? "Restore" : "Archive"}
                  </Button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}

      {canEdit && (
        <div className="border-t border-line px-4 py-3">
          {!adding ? (
            <Button size="sm" variant="secondary" onClick={() => setAdding(true)}>
              <Plus />
              Add recipient
            </Button>
          ) : (
            <form
              method="post"
              onSubmit={form.handleSubmit(add)}
              noValidate
              className="grid gap-4 sm:max-w-xl"
            >
              <div className="grid gap-4 sm:grid-cols-2">
                <Field id="recipient-label" label="Name" error={form.formState.errors.label?.message}>
                  <Input
                    id="recipient-label"
                    aria-invalid={Boolean(form.formState.errors.label)}
                    {...form.register("label")}
                  />
                </Field>
                <Field
                  id="recipient-email"
                  label="E-mail address"
                  hint="Shown masked after saving."
                  error={form.formState.errors.email?.message}
                >
                  <Input
                    id="recipient-email"
                    type="email"
                    autoComplete="off"
                    aria-invalid={Boolean(form.formState.errors.email)}
                    {...form.register("email")}
                  />
                </Field>
              </div>
              <Checkbox
                label={OPT_IN_STATEMENT}
                hint="Leave unticked if you have not asked them yet."
                {...form.register("optInConfirmed")}
              />
              <div className="flex gap-2">
                <Button type="submit" size="sm" disabled={form.formState.isSubmitting}>
                  Save recipient
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  onClick={() => {
                    form.reset();
                    setAdding(false);
                  }}
                >
                  Cancel
                </Button>
              </div>
            </form>
          )}
        </div>
      )}

      <Dialog open={optInFor !== null} onOpenChange={(open) => !busy && !open && setOptInFor(null)}>
        <DialogContent
          title={`Confirm opt-in for ${optInFor?.label ?? ""}?`}
          description="People must agree before a business messages them. Your confirmation is recorded in the audit log."
        >
          <Checkbox
            className="mb-4"
            label={OPT_IN_STATEMENT}
            checked={agreed}
            onChange={(event) => setAgreed(event.target.checked)}
          />
          <div className="flex justify-end gap-2">
            <DialogClose asChild>
              <Button variant="secondary" disabled={busy}>
                Cancel
              </Button>
            </DialogClose>
            <Button
              disabled={busy || !agreed}
              onClick={async () => {
                if (
                  optInFor &&
                  (await update(
                    optInFor.id,
                    { optInConfirmed: true },
                    `Opt-in confirmed for ${optInFor.label}.`,
                  ))
                ) {
                  setOptInFor(null);
                }
              }}
            >
              Confirm opt-in
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

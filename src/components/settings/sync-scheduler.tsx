"use client";

import { useRouter } from "next/navigation";
import { useId, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Field, Input, Select } from "@/components/ui/field";
import { ApiError, apiFetch } from "@/lib/http/client";
import { scheduleSchema, SYNC_INTERVALS, type Schedule } from "@/modules/scheduler/schema";

const intervalLabel = (hours: number) => (hours === 1 ? "Every hour" : `Every ${hours} hours`);

/**
 * The app-wide Upwork sync scheduler: how often the active profile is synced. It stays as set until
 * changed here, whichever profile is active.
 */
export function SyncSchedulerForm({ schedule, canEdit }: { schedule: Schedule; canEdit: boolean }) {
  const router = useRouter();
  const ids = useId();
  const id = (name: string) => `${ids}-${name}`;
  const [value, setValue] = useState<Schedule>(schedule);
  const [errors, setErrors] = useState<Partial<Record<keyof Schedule, string>>>({});
  const [busy, setBusy] = useState(false);
  const changed = JSON.stringify(value) !== JSON.stringify(schedule);

  function set<K extends keyof Schedule>(key: K, next: Schedule[K]) {
    setValue((current) => ({ ...current, [key]: next }));
    setErrors((current) => ({ ...current, [key]: undefined }));
  }

  async function save() {
    const parsed = scheduleSchema.safeParse(value);
    if (!parsed.success) {
      setErrors(
        Object.fromEntries(parsed.error.issues.map((issue) => [String(issue.path[0]), issue.message])),
      );
      return;
    }
    setBusy(true);
    try {
      await apiFetch("/api/sync-schedule", { method: "PUT", body: parsed.data });
      toast.success("Sync scheduler saved. It applies from the agent's next hourly check.");
      router.refresh();
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : "The scheduler could not be saved.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form
      className="flex flex-col gap-4 px-4 py-4"
      onSubmit={(event) => {
        event.preventDefault();
        void save();
      }}
    >
      <Checkbox
        label="Sync the active profile from Upwork on this schedule"
        hint="When off, no scheduled sync runs. A sync started by hand still works."
        checked={value.enabled}
        disabled={!canEdit}
        onChange={(event) => set("enabled", event.target.checked)}
      />
      <div className="grid gap-4 sm:grid-cols-2">
        <Field
          id={id("every")}
          label="Sync"
          hint="Never more often than hourly: the Claude sync agent checks in every hour."
          error={errors.everyHours}
        >
          <Select
            id={id("every")}
            className="w-48"
            value={value.everyHours}
            disabled={!canEdit}
            onChange={(event) => set("everyHours", Number(event.target.value))}
          >
            {SYNC_INTERVALS.map((hours) => (
              <option key={hours} value={hours}>
                {intervalLabel(hours)}
              </option>
            ))}
          </Select>
        </Field>
        <Field
          id={id("tz")}
          label="Time zone"
          hint="IANA name, e.g. Asia/Kolkata or UTC."
          error={errors.timezone}
        >
          <Input
            id={id("tz")}
            value={value.timezone}
            disabled={!canEdit}
            onChange={(event) => set("timezone", event.target.value)}
          />
        </Field>
        <Field id={id("from")} label="Active from" error={errors.activeFrom}>
          <Input
            id={id("from")}
            type="time"
            value={value.activeFrom}
            disabled={!canEdit}
            onChange={(event) => set("activeFrom", event.target.value)}
          />
        </Field>
        <Field
          id={id("to")}
          label="Active until"
          hint="00:00 to 23:59 means around the clock."
          error={errors.activeTo}
        >
          <Input
            id={id("to")}
            type="time"
            value={value.activeTo}
            disabled={!canEdit}
            onChange={(event) => set("activeTo", event.target.value)}
          />
        </Field>
      </div>
      {canEdit ? (
        <div className="flex gap-2">
          <Button type="submit" disabled={busy || !changed}>
            Save scheduler
          </Button>
          {changed && (
            <Button
              type="button"
              variant="secondary"
              disabled={busy}
              onClick={() => {
                setValue(schedule);
                setErrors({});
              }}
            >
              Discard changes
            </Button>
          )}
        </div>
      ) : (
        <p className="text-sm text-muted">Your role can view the scheduler but not change it.</p>
      )}
    </form>
  );
}

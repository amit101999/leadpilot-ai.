"use client";

import { Play } from "lucide-react";
import { useRouter } from "next/navigation";
import { useId, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogClose, DialogContent } from "@/components/ui/dialog";
import { Label, Select } from "@/components/ui/field";
import { ApiError, apiFetch, newIdempotencyKey } from "@/lib/http/client";

export interface LaunchableProfile {
  id: string;
  name: string;
  isDefault: boolean;
  emailEnabled: boolean;
  maxAlerts: number;
}

/**
 * Profile picker plus "Run agent" with a confirmation step. One idempotency key
 * is created per confirmation, so double clicks or a retried request after a
 * network error return the same run instead of starting another.
 */
export function RunLauncher({
  profiles,
  selectedId,
  canRun,
  onProfileChange,
}: {
  profiles: LaunchableProfile[];
  selectedId: string | null;
  canRun: boolean;
  onProfileChange?: (id: string) => void;
}) {
  const router = useRouter();
  const selectId = useId();
  const [profileId, setProfileId] = useState(selectedId ?? profiles[0]?.id ?? "");
  const [open, setOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const keyRef = useRef<string | null>(null);
  const profile = profiles.find((p) => p.id === profileId);

  function openConfirm() {
    keyRef.current = newIdempotencyKey();
    setError(null);
    setOpen(true);
  }

  async function start() {
    if (!profile || !keyRef.current) return;
    setSubmitting(true);
    setError(null);
    try {
      const run = await apiFetch<{ id: string }>("/api/runs", {
        method: "POST",
        body: { profileId: profile.id },
        headers: { "idempotency-key": keyRef.current },
      });
      router.push(`/run/${run.id}`);
    } catch (err) {
      setSubmitting(false);
      if (err instanceof ApiError && err.code === "RUN_ALREADY_ACTIVE") {
        setError("A run for this profile is already in progress. Wait for it to finish, then try again.");
      } else if (err instanceof ApiError && err.code === "RATE_LIMITED") {
        setError("Too many runs started in the last minute. Wait a moment and try again.");
      } else {
        setError(err instanceof ApiError ? err.message : "The run could not be started. Try again.");
      }
    }
  }

  if (profiles.length === 0) {
    return <p className="text-sm text-muted">Create a search profile before running the agent.</p>;
  }

  return (
    <div className="flex flex-wrap items-end gap-2">
      <div className="flex min-w-56 flex-col gap-1.5">
        <Label htmlFor={selectId}>Search profile</Label>
        <Select
          id={selectId}
          value={profileId}
          onChange={(event) => {
            setProfileId(event.target.value);
            onProfileChange?.(event.target.value);
          }}
        >
          {profiles.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
              {p.isDefault ? " (default)" : ""}
            </option>
          ))}
        </Select>
      </div>
      <Button
        onClick={openConfirm}
        disabled={!canRun || !profile}
        title={canRun ? undefined : "Viewers cannot start runs"}
      >
        <Play />
        Run agent
      </Button>
      {!canRun && (
        <p className="w-full text-[13px] text-muted">Your role can view runs but not start them.</p>
      )}

      <Dialog open={open} onOpenChange={(next) => !submitting && setOpen(next)}>
        <DialogContent
          title="Start a run?"
          description={
            profile && (
              <>
                The agent will search the job source with <strong className="text-ink">{profile.name}</strong>
                , check every job against its rules and score the rest with AI.{" "}
                {profile.emailEnabled
                  ? `Up to ${profile.maxAlerts} qualified leads will be e-mailed to you.`
                  : "E-mail alerts are turned off for this profile; leads appear in LeadPilot only."}
              </>
            )
          }
        >
          {error && (
            <p role="alert" className="mb-3 rounded-control bg-danger-soft px-3 py-2 text-sm text-danger">
              {error}
            </p>
          )}
          <div className="flex justify-end gap-2">
            <DialogClose asChild>
              <Button variant="secondary" disabled={submitting}>
                Cancel
              </Button>
            </DialogClose>
            <Button onClick={start} disabled={submitting}>
              {submitting ? "Starting…" : "Start run"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

"use client";

import { Copy, KeyRound } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/field";
import { EmptyState } from "@/components/ui/panel";
import { Time } from "@/components/ui/time";
import { ApiError, apiFetch } from "@/lib/http/client";

export interface ImportTokenRow {
  id: string;
  name: string;
  lastUsedAt: Date | string | null;
  revokedAt: Date | string | null;
  createdAt: Date | string;
}

/**
 * Tokens for the Upwork sync agent. A new token is shown exactly once (only its hash is stored);
 * revoking one stops the agent immediately.
 */
export function ImportTokensManager({ tokens, canEdit }: { tokens: ImportTokenRow[]; canEdit: boolean }) {
  const router = useRouter();
  const [name, setName] = useState("Upwork sync");
  const [created, setCreated] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function create() {
    setBusy(true);
    try {
      const result = await apiFetch<{ token: string }>("/api/import-tokens", { method: "POST", body: { name } });
      setCreated(result.token);
      router.refresh();
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : "The token could not be created.");
    } finally {
      setBusy(false);
    }
  }

  async function revoke(token: ImportTokenRow) {
    setBusy(true);
    try {
      await apiFetch(`/api/import-tokens/${token.id}/revoke`, { method: "POST" });
      toast.success(`${token.name} revoked. The agent can no longer import with it.`);
      router.refresh();
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : "The token could not be revoked.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      {created && (
        <div role="status" className="m-4 rounded-md border border-line bg-sunken p-3 text-sm">
          <p className="font-medium">Copy this token now. It will not be shown again.</p>
          <p className="mt-1 text-muted">
            Put it in <code>.env</code> as <code>LEADPILOT_IMPORT_TOKEN</code> on the computer that runs the sync.
          </p>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <code className="rounded bg-surface px-2 py-1 break-all" data-testid="new-import-token">
              {created}
            </code>
            <Button
              size="sm"
              variant="secondary"
              onClick={async () => {
                await navigator.clipboard.writeText(created);
                toast.success("Token copied.");
              }}
            >
              <Copy />
              Copy
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setCreated(null)}>
              Done
            </Button>
          </div>
        </div>
      )}

      {tokens.length === 0 ? (
        <EmptyState title="No import tokens">
          Create a token for the Upwork sync agent. It lets the agent send jobs to LeadPilot as you.
        </EmptyState>
      ) : (
        <ul className="divide-y divide-line">
          {tokens.map((t) => (
            <li key={t.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 text-sm">
              <div>
                <p className="font-medium">{t.name}</p>
                <p className="mt-0.5 flex flex-wrap items-center gap-2 text-[13px] text-muted">
                  {t.revokedAt ? <Badge>Revoked</Badge> : <Badge tone="success">Active</Badge>}
                  <span>
                    Created <Time value={t.createdAt} />
                  </span>
                  <span>{t.lastUsedAt ? <>Last used <Time value={t.lastUsedAt} /></> : "Never used"}</span>
                </p>
              </div>
              {canEdit && !t.revokedAt && (
                <Button size="sm" variant="secondary" disabled={busy} onClick={() => revoke(t)}>
                  Revoke
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}

      {canEdit && (
        <form
          className="flex flex-wrap items-end gap-2 border-t border-line px-4 py-3"
          onSubmit={(event) => {
            event.preventDefault();
            void create();
          }}
        >
          <Field id="import-token-name" label="Token name">
            <Input id="import-token-name" value={name} maxLength={80} onChange={(e) => setName(e.target.value)} />
          </Field>
          <Button type="submit" size="sm" variant="secondary" disabled={busy || name.trim() === ""}>
            <KeyRound />
            Create token
          </Button>
        </form>
      )}
    </div>
  );
}

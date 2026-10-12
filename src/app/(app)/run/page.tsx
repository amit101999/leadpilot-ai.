import type { Metadata } from "next";
import { ProfileSummary } from "@/components/profiles/profile-summary";
import { toLaunchable } from "@/components/runs/launchable";
import { UrlRunLauncher } from "@/components/runs/url-run-launcher";
import { EmptyState, Panel } from "@/components/ui/panel";
import { hasRole } from "@/lib/auth/authorization";
import { requireUser } from "@/lib/auth/current-user";
import { getDb } from "@/lib/database/client";
import { listProfiles, parseStoredConfig } from "@/modules/profiles/service";

export const metadata: Metadata = { title: "Run Agent" };

export default async function RunAgentPage({
  searchParams,
}: {
  searchParams: Promise<{ profileId?: string }>;
}) {
  const { actor } = await requireUser();
  const profiles = await listProfiles(getDb(), actor);
  const launchable = toLaunchable(profiles);
  const requested = (await searchParams).profileId;
  const selected =
    profiles.find((p) => p.id === requested && p.active && !p.archivedAt) ??
    profiles.find((p) => p.isDefault && !p.archivedAt) ??
    profiles.find((p) => p.active && !p.archivedAt);

  return (
    <div className="flex flex-col gap-6">
      <header>
        <h1 className="text-[28px] leading-tight font-semibold">Run Agent</h1>
        <p className="mt-1 max-w-prose text-sm text-muted">
          A run searches the job source once, checks every job against the profile&apos;s rules, scores the
          rest with AI and sends the best matches to WhatsApp. The settings are frozen when the run starts.
        </p>
      </header>

      <Panel id="launch" title="Start a run">
        <div className="px-4 py-4">
          <UrlRunLauncher
            profiles={launchable}
            selectedId={selected?.id ?? null}
            canRun={hasRole(actor, "OPERATOR")}
          />
        </div>
      </Panel>

      {selected ? (
        <Panel
          id="profile-summary"
          title={`What "${selected.name}" looks for`}
          description={`Configuration version ${selected.currentVersion}. Edit it on the Search Profiles page.`}
        >
          <ProfileSummary config={parseStoredConfig(selected.configuration)} />
        </Panel>
      ) : (
        <Panel id="profile-summary">
          <EmptyState title="No active search profile">
            Create or restore a search profile to run the agent.
          </EmptyState>
        </Panel>
      )}
    </div>
  );
}

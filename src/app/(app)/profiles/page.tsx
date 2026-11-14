import { Plus } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { ProfileActions } from "@/components/profiles/profile-actions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState, Panel } from "@/components/ui/panel";
import { Time } from "@/components/ui/time";
import { hasRole } from "@/lib/auth/authorization";
import { requireUser } from "@/lib/auth/current-user";
import { getDb } from "@/lib/database/client";
import { formatMoney } from "@/lib/ui/format";
import { listProfiles, parseStoredConfig } from "@/modules/profiles/service";

export const metadata: Metadata = { title: "Search Profiles" };

export default async function ProfilesPage({
  searchParams,
}: {
  searchParams: Promise<{ archived?: string }>;
}) {
  const { actor } = await requireUser();
  const showArchived = (await searchParams).archived === "1";
  const profiles = await listProfiles(getDb(), actor, { includeArchived: showArchived });
  const canEdit = hasRole(actor, "OPERATOR");

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-[28px] leading-tight font-semibold">Search Profiles</h1>
          <p className="mt-1 max-w-prose text-sm text-muted">
            Each profile is a set of rules the agent uses to find and qualify jobs. Every save creates a new
            version; runs keep the version they started with.
          </p>
        </div>
        {canEdit && (
          <Button asChild>
            <Link href="/profiles/new">
              <Plus />
              New profile
            </Link>
          </Button>
        )}
      </header>

      <Panel
        id="profiles"
        actions={
          <Link
            href={showArchived ? "/profiles" : "/profiles?archived=1"}
            className="text-[13px] font-medium text-accent hover:underline"
          >
            {showArchived ? "Hide archived profiles" : "Show archived profiles"}
          </Link>
        }
        title={`${profiles.length} ${profiles.length === 1 ? "profile" : "profiles"}`}
      >
        {profiles.length === 0 ? (
          <EmptyState
            title="No search profiles yet"
            action={
              canEdit ? (
                <Button asChild size="sm">
                  <Link href="/profiles/new">Create a profile</Link>
                </Button>
              ) : undefined
            }
          >
            A profile holds the skills, budget, client and AI rules for one kind of job.
          </EmptyState>
        ) : (
          <ul className="divide-y divide-line">
            {profiles.map((profile) => {
              const config = parseStoredConfig(profile.configuration);
              const archived = Boolean(profile.archivedAt);
              return (
                <li
                  key={profile.id}
                  className="flex flex-col gap-3 px-4 py-4 lg:flex-row lg:items-start lg:justify-between"
                >
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <Link
                        href={`/profiles/${profile.id}`}
                        className="text-sm font-semibold text-ink hover:text-accent hover:underline"
                      >
                        {profile.name}
                      </Link>
                      {profile.isDefault && <Badge tone="accent">Default</Badge>}
                      {archived && <Badge>Archived</Badge>}
                    </div>
                    {profile.description && (
                      <p className="mt-0.5 max-w-prose text-[13px] text-muted">{profile.description}</p>
                    )}
                    <p className="tabular mt-1 text-[13px] text-muted">
                      {config.skills.required.map((s) => s.name).join(", ") || "No required skills"};{" "}
                      {config.budget.fixedMin
                        ? `from ${formatMoney(config.budget.fixedMin, config.budget.currency)}`
                        : "any budget"}
                      ; score {config.ai.minScore}+; e-mail alerts{" "}
                      {config.notifications.emailEnabled
                        ? `on (up to ${config.notifications.maxPerRun})`
                        : "off"}
                    </p>
                    <p className="mt-0.5 text-[13px] text-muted">
                      Version {profile.currentVersion}, updated <Time value={profile.updatedAt} />
                    </p>
                  </div>
                  {canEdit && (
                    <ProfileActions
                      profile={{ id: profile.id, name: profile.name, isDefault: profile.isDefault, archived }}
                    />
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </Panel>
    </div>
  );
}

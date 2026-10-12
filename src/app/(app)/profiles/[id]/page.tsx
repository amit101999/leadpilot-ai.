import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ProfileActions } from "@/components/profiles/profile-actions";
import { ProfileEditor } from "@/components/profiles/profile-editor";
import { toRecipientOptions } from "@/components/profiles/recipient-options";
import { VersionHistory, type VersionEntry } from "@/components/profiles/version-history";
import { Badge } from "@/components/ui/badge";
import { Panel } from "@/components/ui/panel";
import { hasRole } from "@/lib/auth/authorization";
import { requireUser } from "@/lib/auth/current-user";
import { getDb } from "@/lib/database/client";
import { AppError } from "@/lib/http/errors";
import { uuidParam } from "@/lib/validation/common";
import { listRecipients } from "@/modules/notifications/recipients";
import { diffConfigs } from "@/modules/profiles/diff";
import { getProfile, listVersionsWithAuthors, parseStoredConfig } from "@/modules/profiles/service";

export const metadata: Metadata = { title: "Search profile" };

export default async function ProfilePage({ params }: { params: Promise<{ id: string }> }) {
  const { actor } = await requireUser();
  const parsed = uuidParam.safeParse((await params).id);
  if (!parsed.success) notFound();
  const db = getDb();
  let profile;
  try {
    profile = await getProfile(db, actor, parsed.data);
  } catch (error) {
    if (error instanceof AppError && error.code === "NOT_FOUND") notFound();
    throw error;
  }
  const [versionRows, recipientViews] = await Promise.all([
    listVersionsWithAuthors(db, actor, profile.id),
    listRecipients(db, actor, true),
  ]);
  const canEdit = hasRole(actor, "OPERATOR");
  const archived = Boolean(profile.archivedAt);
  const recipientName = (id: string) => {
    const r = recipientViews.find((v) => v.id === id);
    return r ? `${r.label} (${r.phoneMasked})` : "A removed recipient";
  };

  // Newest first; each version is compared with the one before it.
  const versions: VersionEntry[] = versionRows.map(({ version, authorEmail }, index) => {
    const previous = versionRows[index + 1]?.version;
    const config = parseStoredConfig(version.configuration);
    return {
      id: version.id,
      versionNumber: version.versionNumber,
      name: version.name,
      description: version.description,
      changeNote: version.changeNote,
      createdAt: version.createdAt,
      authorEmail,
      configuration: config,
      changes: previous ? diffConfigs(parseStoredConfig(previous.configuration), config, recipientName) : [],
    };
  });

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-sm text-muted">
            <Link href="/profiles" className="hover:text-ink hover:underline">
              Search Profiles
            </Link>
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-[28px] leading-tight font-semibold">{profile.name}</h1>
            {profile.isDefault && <Badge tone="accent">Default</Badge>}
            {archived && <Badge>Archived</Badge>}
          </div>
          <p className="mt-1 text-sm text-muted">
            Version {profile.currentVersion}.{" "}
            <Link href={`/run?profileId=${profile.id}`} className="text-accent hover:underline">
              Run this profile
            </Link>
          </p>
        </div>
        {canEdit && (
          <ProfileActions
            profile={{ id: profile.id, name: profile.name, isDefault: profile.isDefault, archived }}
          />
        )}
      </header>

      <Panel id="editor">
        <ProfileEditor
          key={profile.currentVersion}
          profile={{
            id: profile.id,
            name: profile.name,
            description: profile.description,
            currentVersion: profile.currentVersion,
            configuration: parseStoredConfig(profile.configuration),
          }}
          recipients={toRecipientOptions(recipientViews)}
          readOnly={!canEdit || archived}
          readOnlyReason={
            !canEdit
              ? "Your role can view profiles but not change them."
              : archived
                ? "This profile is archived. Restore it to edit or run it."
                : undefined
          }
        />
      </Panel>

      <Panel
        id="versions"
        title="Version history"
        description="Every saved version, with what changed from the one before it."
      >
        <VersionHistory
          profileId={profile.id}
          currentVersion={profile.currentVersion}
          versions={versions}
          canRestore={canEdit && !archived}
        />
      </Panel>
    </div>
  );
}

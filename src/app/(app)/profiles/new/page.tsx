import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ProfileEditor } from "@/components/profiles/profile-editor";
import { toRecipientOptions } from "@/components/profiles/recipient-options";
import { Panel } from "@/components/ui/panel";
import { hasRole } from "@/lib/auth/authorization";
import { requireUser } from "@/lib/auth/current-user";
import { getDb } from "@/lib/database/client";
import { listRecipients } from "@/modules/notifications/recipients";
import { defaultProfileConfig } from "@/modules/profiles/config-schema";

export const metadata: Metadata = { title: "New search profile" };

export default async function NewProfilePage() {
  const { actor } = await requireUser();
  if (!hasRole(actor, "OPERATOR")) notFound();
  const recipients = toRecipientOptions(await listRecipients(getDb(), actor));
  // Start from the initial business defaults (editable); e-mail alerts start off until a recipient is chosen.
  const configuration = defaultProfileConfig(null);

  return (
    <div className="flex flex-col gap-6">
      <header>
        <p className="text-sm text-muted">
          <Link href="/profiles" className="hover:text-ink hover:underline">
            Search Profiles
          </Link>
        </p>
        <h1 className="text-[28px] leading-tight font-semibold">New search profile</h1>
        <p className="mt-1 max-w-prose text-sm text-muted">
          The fields start with the initial defaults. Change anything, then create the profile as version 1.
        </p>
      </header>
      <Panel id="editor">
        <ProfileEditor
          recipients={recipients}
          readOnly={false}
          profile={undefined}
          initialConfiguration={configuration}
        />
      </Panel>
    </div>
  );
}

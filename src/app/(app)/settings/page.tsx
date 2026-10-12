import type { Metadata } from "next";
import { ChangePasswordForm } from "@/components/settings/change-password-form";
import { RecipientsManager } from "@/components/settings/recipients-manager";
import { ThemeChoice } from "@/components/settings/theme-choice";
import { Panel } from "@/components/ui/panel";
import { hasRole } from "@/lib/auth/authorization";
import { requireUser } from "@/lib/auth/current-user";
import { getDb } from "@/lib/database/client";
import { listRecipients } from "@/modules/notifications/recipients";

export const metadata: Metadata = { title: "Settings" };

const ROLE_TEXT: Record<string, string> = {
  ADMIN: "Admin: everything, including the audit log",
  OPERATOR: "Operator: run the agent and change profiles and recipients",
  VIEWER: "Viewer: read-only",
};

export default async function SettingsPage() {
  const { user, actor } = await requireUser();
  const recipients = await listRecipients(getDb(), actor, true);

  return (
    <div className="flex flex-col gap-6">
      <header>
        <h1 className="text-[28px] leading-tight font-semibold">Settings</h1>
      </header>

      <Panel id="account" title="Account">
        <dl className="grid gap-x-8 gap-y-2.5 px-4 py-4 text-sm sm:grid-cols-[160px_1fr]">
          <dt className="text-muted">Email</dt>
          <dd>{user.email}</dd>
          {user.name && (
            <>
              <dt className="text-muted">Name</dt>
              <dd>{user.name}</dd>
            </>
          )}
          <dt className="text-muted">Role</dt>
          <dd>{ROLE_TEXT[user.role] ?? user.role}</dd>
        </dl>
      </Panel>

      <Panel id="password" title="Change password">
        <ChangePasswordForm />
      </Panel>

      <Panel
        id="recipients"
        title="WhatsApp recipients"
        description="Who receives lead alerts. Choose a recipient for each profile on the Search Profiles page."
      >
        <RecipientsManager recipients={recipients} canEdit={hasRole(actor, "OPERATOR")} />
      </Panel>

      <Panel id="appearance" title="Appearance">
        <ThemeChoice />
      </Panel>
    </div>
  );
}

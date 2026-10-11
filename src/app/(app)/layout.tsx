import type { ReactNode } from "react";
import { AppShell } from "@/components/layout/app-shell";
import { requireUser } from "@/lib/auth/current-user";
import { getProviders } from "@/modules/providers";

/** Names the integrations that are mocked, so mock data is never mistaken for live data. */
function demoNotice(): string | null {
  const providers = getProviders();
  const mocked = [
    providers.jobSource.getCapabilities().isMock && "the job source (no live Upwork data)",
    providers.ai.isMock && "AI scoring",
    providers.whatsapp.isMock && "WhatsApp (messages are recorded, not sent)",
  ].filter((v): v is string => Boolean(v));
  if (mocked.length === 0) return null;
  const list = mocked.length === 1 ? mocked[0] : `${mocked.slice(0, -1).join(", ")} and ${mocked.at(-1)}`;
  return `Simulated: ${list}.`;
}

export default async function AppLayout({ children }: { children: ReactNode }) {
  const { user } = await requireUser();
  return (
    <AppShell user={{ email: user.email, name: user.name, role: user.role }} demoNotice={demoNotice()}>
      {children}
    </AppShell>
  );
}

import type { ReactNode } from "react";
import { AppShell } from "@/components/layout/app-shell";
import { requireUser } from "@/lib/auth/current-user";

export default async function AppLayout({ children }: { children: ReactNode }) {
  const { user } = await requireUser();
  return <AppShell user={{ email: user.email, name: user.name, role: user.role }}>{children}</AppShell>;
}

import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { currentUser } from "@/lib/auth/current-user";
import { safeNextPath } from "@/lib/auth/login-redirect";
import { LoginForm } from "./login-form";

export const metadata: Metadata = { title: "Sign in" };

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const next = safeNextPath((await searchParams).next) ?? "/dashboard";
  if (await currentUser()) redirect(next);
  return (
    <main className="grid min-h-dvh place-items-center px-4">
      <div className="w-full max-w-sm">
        <div className="mb-6 flex items-center gap-2">
          <span
            aria-hidden
            className="grid size-8 place-items-center rounded-control bg-accent text-xs font-bold text-accent-ink"
          >
            LP
          </span>
          <span className="text-base font-semibold">LeadPilot AI</span>
        </div>
        <div className="rounded-panel border border-line bg-surface p-6">
          <h1 className="text-xl font-semibold">Sign in</h1>
          <p className="mt-1 text-sm text-muted">Use the account your administrator created for you.</p>
          <LoginForm next={next} />
        </div>
      </div>
    </main>
  );
}

"use client";

import { LogOut, Menu, Moon, Sun } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useTheme } from "next-themes";
import { useState, type ReactNode } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogTrigger, SheetContent } from "@/components/ui/dialog";
import { apiFetch } from "@/lib/http/client";
import { cn } from "@/lib/ui/cn";
import type { UserRole } from "@/types/domain";
import { NAV_ITEMS } from "./nav";

const ROLE_RANK: Record<UserRole, number> = { VIEWER: 1, OPERATOR: 2, ADMIN: 3 };

interface ShellUser {
  email: string;
  name: string | null;
  role: UserRole;
}

export function AppShell({
  user,
  demoNotice,
  children,
}: {
  user: ShellUser;
  demoNotice: string | null;
  children: ReactNode;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  return (
    <div className="min-h-dvh lg:grid lg:grid-cols-[232px_1fr]">
      <a
        href="#main"
        className="sr-only z-50 rounded-control bg-surface px-3 py-2 focus:not-sr-only focus:fixed focus:top-2 focus:left-2"
      >
        Skip to content
      </a>

      <aside className="hidden border-r border-line bg-surface lg:sticky lg:top-0 lg:flex lg:h-dvh lg:flex-col">
        <Brand />
        <Navigation role={user.role} />
        <UserFooter user={user} />
      </aside>

      <div className="flex min-w-0 flex-col">
        <div className="sticky top-0 z-30 flex items-center gap-3 border-b border-line bg-surface px-4 py-2 lg:hidden">
          <Dialog open={menuOpen} onOpenChange={setMenuOpen}>
            <DialogTrigger asChild>
              <Button variant="ghost" size="icon" aria-label="Open navigation">
                <Menu />
              </Button>
            </DialogTrigger>
            <SheetContent title="Navigation">
              <Brand />
              <Navigation role={user.role} onNavigate={() => setMenuOpen(false)} />
              <UserFooter user={user} />
            </SheetContent>
          </Dialog>
          <span className="text-sm font-semibold">LeadPilot AI</span>
        </div>

        {demoNotice && (
          <div
            role="note"
            className="border-b border-warning/30 bg-warning-soft px-4 py-2 text-[13px] text-warning lg:px-8"
          >
            <span className="font-semibold">Demo mode.</span> {demoNotice}
          </div>
        )}

        <main id="main" className="mx-auto w-full max-w-[1280px] flex-1 px-4 py-6 lg:px-8">
          {children}
        </main>
      </div>
    </div>
  );
}

function Brand() {
  return (
    <div className="flex h-14 items-center gap-2 border-b border-line px-4">
      <span
        aria-hidden
        className="grid size-7 place-items-center rounded-control bg-accent text-xs font-bold text-accent-ink"
      >
        LP
      </span>
      <span className="text-sm font-semibold">LeadPilot AI</span>
    </div>
  );
}

function Navigation({ role, onNavigate }: { role: UserRole; onNavigate?: () => void }) {
  const pathname = usePathname();
  const items = NAV_ITEMS.filter((item) => !item.minRole || ROLE_RANK[role] >= ROLE_RANK[item.minRole]);
  return (
    <nav aria-label="Main" className="flex-1 overflow-y-auto px-2 py-3">
      <ul className="flex flex-col gap-0.5">
        {items.map((item) => {
          const Icon = item.icon;
          const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
          if (item.availableIn) {
            return (
              <li key={item.href}>
                <span
                  aria-disabled="true"
                  className="flex items-center gap-2.5 rounded-control px-2.5 py-1.5 text-sm text-muted/70"
                  title={`Available in phase ${item.availableIn}`}
                >
                  <Icon aria-hidden className="size-4" />
                  <span className="flex-1">{item.label}</span>
                  <span className="text-[11px]">Soon</span>
                </span>
              </li>
            );
          }
          return (
            <li key={item.href}>
              <Link
                href={item.href}
                onClick={onNavigate}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "flex items-center gap-2.5 rounded-control px-2.5 py-1.5 text-sm text-muted hover:bg-sunken hover:text-ink",
                  active && "bg-accent-soft font-medium text-accent hover:bg-accent-soft hover:text-accent",
                )}
              >
                <Icon aria-hidden className="size-4" />
                {item.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

function UserFooter({ user }: { user: ShellUser }) {
  const router = useRouter();
  const { resolvedTheme, setTheme } = useTheme();
  const [signingOut, setSigningOut] = useState(false);
  const dark = resolvedTheme === "dark";

  async function signOut() {
    setSigningOut(true);
    try {
      await apiFetch("/api/auth/logout", { method: "POST" });
      router.replace("/login");
      router.refresh();
    } catch {
      setSigningOut(false);
      toast.error("Could not sign out. Try again.");
    }
  }

  return (
    <div className="border-t border-line p-3">
      <p className="truncate text-sm font-medium" title={user.email}>
        {user.name ?? user.email}
      </p>
      <p className="text-xs text-muted">{user.role.charAt(0) + user.role.slice(1).toLowerCase()}</p>
      <div className="mt-2 flex gap-1">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setTheme(dark ? "light" : "dark")}
          aria-label={dark ? "Switch to light theme" : "Switch to dark theme"}
        >
          {dark ? <Sun /> : <Moon />}
          {dark ? "Light" : "Dark"}
        </Button>
        <Button variant="ghost" size="sm" onClick={signOut} disabled={signingOut}>
          <LogOut />
          Sign out
        </Button>
      </div>
    </div>
  );
}

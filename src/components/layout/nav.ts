import {
  Activity,
  Bell,
  Briefcase,
  ClipboardList,
  History,
  LayoutDashboard,
  Play,
  Plug,
  Settings,
  SlidersHorizontal,
  type LucideIcon,
} from "lucide-react";
import type { UserRole } from "@/types/domain";

export interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
  minRole?: UserRole;
}

export const NAV_ITEMS: NavItem[] = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/run", label: "Run Agent", icon: Play },
  { href: "/history", label: "Search History", icon: History },
  { href: "/leads", label: "Qualified Leads", icon: Activity },
  { href: "/jobs", label: "All Jobs", icon: Briefcase },
  { href: "/profiles", label: "Search Profiles", icon: SlidersHorizontal },
  { href: "/notifications", label: "Notifications", icon: Bell },
  { href: "/integrations", label: "Integrations", icon: Plug },
  { href: "/settings", label: "Settings", icon: Settings },
  { href: "/audit", label: "Audit Logs", icon: ClipboardList, minRole: "ADMIN" },
];

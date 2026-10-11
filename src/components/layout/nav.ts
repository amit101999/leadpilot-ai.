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
  /** Pages that are not built yet are shown disabled instead of linking to a 404. */
  availableIn?: string;
  minRole?: UserRole;
}

export const NAV_ITEMS: NavItem[] = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/run", label: "Run Agent", icon: Play },
  { href: "/history", label: "Search History", icon: History, availableIn: "C2" },
  { href: "/leads", label: "Qualified Leads", icon: Activity, availableIn: "C2" },
  { href: "/jobs", label: "All Jobs", icon: Briefcase, availableIn: "C2" },
  { href: "/profiles", label: "Search Profiles", icon: SlidersHorizontal, availableIn: "C3" },
  { href: "/notifications", label: "Notifications", icon: Bell, availableIn: "C3" },
  { href: "/integrations", label: "Integrations", icon: Plug, availableIn: "C3" },
  { href: "/settings", label: "Settings", icon: Settings, availableIn: "C3" },
  { href: "/audit", label: "Audit Logs", icon: ClipboardList, availableIn: "C3", minRole: "ADMIN" },
];

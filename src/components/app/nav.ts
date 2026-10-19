import {
  BellRing,
  Calculator,
  Clapperboard,
  FileBarChart2,
  FolderHeart,
  LayoutDashboard,
  Radar,
  Settings,
  Sparkles,
  Store,
  Swords,
  TrendingUp,
  Trophy,
  type LucideIcon,
} from "lucide-react";

export interface NavItem {
  href: string;
  key: string;
  icon: LucideIcon;
  /** Extra routes that highlight this entry (tools that belong to the section). */
  also?: string[];
}

export const NAV: NavItem[] = [
  { href: "/app", key: "overview", icon: LayoutDashboard },
  { href: "/app/products", key: "products", icon: Trophy, also: ["/app/calculator"] },
  { href: "/app/ads", key: "ads", icon: Radar },
  { href: "/app/creatives", key: "creatives", icon: Clapperboard },
  { href: "/app/trends", key: "trends", icon: TrendingUp },
  { href: "/app/competitors", key: "competitors", icon: Swords },
  { href: "/app/stores", key: "stores", icon: Store },
  { href: "/app/collections", key: "collections", icon: FolderHeart },
  { href: "/app/analyst", key: "analyst", icon: Sparkles },
  { href: "/app/reports", key: "reports", icon: FileBarChart2 },
  { href: "/app/alerts", key: "alerts", icon: BellRing },
  { href: "/app/settings", key: "settings", icon: Settings },
];

/** The profit calculator lives inside "Winning Products" (header action + product pages), keeping exactly 12 sections. */
export const CALCULATOR = { href: "/app/calculator", key: "calculator", icon: Calculator };

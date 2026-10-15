"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { Bell, FlaskConical, LogOut, Menu, UserRound, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Logo } from "@/components/logo";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { SessionProvider, useSession } from "@/lib/client/session";
import { WorkspaceProvider, useWorkspace } from "@/lib/client/workspace";
import { apiFetch } from "@/lib/client/use-api";
import { useFormat } from "@/lib/format";
import { notificationParams } from "@/lib/notification-text";
import { cn } from "@/lib/cn";
import { GlobalSearch } from "./global-search";
import { LanguageSelect } from "./language-select";
import { NAV, type NavItem } from "./nav";
import { WorkspaceSwitcher } from "./workspace-switcher";

export function AppShell({ children }: { children: ReactNode }) {
  return (
    <SessionProvider>
      <WorkspaceProvider>
        <Shell>{children}</Shell>
      </WorkspaceProvider>
    </SessionProvider>
  );
}

function NavLink({ item, onNavigate }: { item: NavItem; onNavigate?: () => void }) {
  const pathname = usePathname();
  const { t } = useTranslation();
  const active = item.href === "/app" ? pathname === "/app" : [item.href, ...(item.also ?? [])].some((h) => pathname.startsWith(h));
  const Icon = item.icon;
  return (
    <Link
      href={item.href}
      onClick={onNavigate}
      aria-current={active ? "page" : undefined}
      className={cn(
        "focus-ring tap group flex items-center gap-2.5 rounded-lg px-2.5 py-[7px] text-[13px] font-medium transition-colors duration-150 active:bg-surface-3",
        active ? "bg-surface-3 text-fg hover:bg-surface-3/80" : "text-muted hover:bg-surface-2 hover:text-fg",
      )}
    >
      <Icon className={cn("size-4 shrink-0", active ? "text-accent" : "text-subtle group-hover:text-muted")} />
      <span className="truncate">{t(`nav.${item.key}`)}</span>
    </Link>
  );
}

function Sidebar({ onNavigate }: { onNavigate?: () => void }) {
  const { t } = useTranslation();
  const { session } = useSession();
  return (
    <div className="flex h-full flex-col">
      <div className="flex h-14 items-center px-4">
        <Link href="/app" onClick={onNavigate} className="focus-ring rounded-md transition-opacity hover:opacity-80 active:opacity-70">
          <Logo />
        </Link>
      </div>
      <nav className="flex-1 space-y-0.5 overflow-y-auto px-2 pb-4" aria-label={t("nav.main")}>
        {NAV.map((item) => (
          <NavLink key={item.href} item={item} onNavigate={onNavigate} />
        ))}
      </nav>
      <div className="space-y-2 border-t border-border p-3">
        <WorkspaceSwitcher />
        <LanguageSelect className="w-full sm:hidden [&_select]:w-full" testId="sidebar-language-select" />
        <Link href="/app/settings?tab=billing" onClick={onNavigate} className="focus-ring block rounded-lg border border-border bg-surface-2 p-3 transition-colors hover:border-accent/40 hover:bg-surface-3 active:bg-surface-3/70">
          <div className="flex items-center justify-between">
            <span className="text-xs text-subtle">{t("billing.currentPlan")}</span>
            <Badge tone={session?.plan === "free" ? "neutral" : "accent"}>{session ? t(`plans.${session.plan}.name`) : "…"}</Badge>
          </div>
          {session?.mode === "demo" && <p className="mt-1.5 text-[11px] leading-snug text-subtle">{t("billing.demoBillingShort")}</p>}
        </Link>
      </div>
    </div>
  );
}

function NotificationsBell() {
  const { t } = useTranslation();
  const f = useFormat();
  const { workspace, dispatch } = useWorkspace();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const unread = workspace.notifications.filter((n) => !n.read);
  useEffect(() => {
    const onClick = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, []);
  return (
    <div ref={ref} className="relative">
      <Button variant="ghost" size="icon" aria-label={t("notifications.title")} aria-expanded={open} aria-haspopup="dialog" onClick={() => setOpen((o) => !o)} className={cn(open && "bg-surface-2 text-fg")} data-testid="notifications-bell">
        <Bell />
        {unread.length > 0 && <span className="absolute right-1.5 top-1.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-accent px-1 text-[10px] font-semibold text-white">{unread.length > 9 ? "9+" : unread.length}</span>}
      </Button>
      {open && (
        <div className="absolute right-0 top-11 z-50 w-[min(92vw,380px)] rounded-xl border border-border bg-surface shadow-2xl">
          <div className="flex items-center justify-between border-b border-border px-4 py-3">
            <span className="text-sm font-semibold">{t("notifications.title")}</span>
            {unread.length > 0 && (
              <Button variant="link" size="sm" className="h-auto text-xs" onClick={() => dispatch({ op: "notifications.read", ids: unread.map((n) => n.id) }, t("notifications.markedRead"))}>
                {t("notifications.markAllRead")}
              </Button>
            )}
          </div>
          <ul className="max-h-[60vh] overflow-y-auto">
            {workspace.notifications.length === 0 ? (
              <li className="px-4 py-8 text-center text-sm text-subtle">{t("notifications.empty")}</li>
            ) : (
              workspace.notifications.slice(0, 20).map((n) => (
                <li key={n.id} className={cn("border-b border-border/60 px-4 py-3 last:border-0", !n.read && "bg-accent/[0.04]")}>
                  <Link
                    href={n.link ?? "/app/alerts"}
                    onClick={() => {
                      setOpen(false);
                      if (!n.read) dispatch({ op: "notifications.read", ids: [n.id] });
                    }}
                    className="focus-ring block rounded text-sm transition-colors hover:text-accent"
                  >
                    {t(n.key, notificationParams(n.params, f, (c) => t(`categories.${c}`)))}
                  </Link>
                  <div className="mt-1 flex items-center gap-2 text-[11px] text-subtle">
                    {f.dateTime(n.createdAt)}
                    {n.origin === "demo" && <Badge tone="demo">{t("common.demo")}</Badge>}
                  </div>
                </li>
              ))
            )}
          </ul>
          <div className="border-t border-border px-4 py-2.5">
            <Link href="/app/alerts" onClick={() => setOpen(false)} className="focus-ring rounded text-xs text-accent underline-offset-4 hover:underline">
              {t("notifications.manage")}
            </Link>
          </div>
        </div>
      )}
    </div>
  );
}

function UserMenu() {
  const { t } = useTranslation();
  const { session, refresh } = useSession();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const onClick = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, []);
  const name = session?.user?.name || session?.user?.email || t("auth.visitor");
  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className={cn("focus-ring tap flex h-9 items-center gap-2 rounded-lg px-1.5 transition-[background-color,transform] duration-150 hover:bg-surface-2 active:scale-95 motion-reduce:active:scale-100", open && "bg-surface-2")}
        aria-label={t("auth.account")}
        title={t("auth.account")}
        aria-expanded={open}
        aria-haspopup="menu"
        data-testid="user-menu"
      >
        <span className="flex size-7 items-center justify-center rounded-full bg-gradient-to-br from-accent to-accent-2 text-xs font-semibold text-white">
          {session?.user ? name.slice(0, 1).toUpperCase() : <UserRound className="size-4" />}
        </span>
      </button>
      {open && (
        <div className="absolute right-0 top-11 z-50 w-60 rounded-xl border border-border bg-surface p-1.5 shadow-2xl">
          <div className="px-2.5 py-2">
            <div className="truncate text-sm font-medium">{name}</div>
            <div className="truncate text-xs text-subtle">{session?.user?.email ?? t("auth.notSignedIn")}</div>
          </div>
          <div className="my-1 border-t border-border" />
          <Link href="/app/settings" onClick={() => setOpen(false)} className="focus-ring block rounded-md px-2.5 py-1.5 text-sm text-muted transition-colors hover:bg-surface-2 hover:text-fg active:bg-surface-3">
            {t("nav.settings")}
          </Link>
          {session?.authenticated ? (
            <Button
              variant="ghost"
              size="sm"
              className="w-full justify-start px-2.5 text-sm"
              onClick={async () => {
                await apiFetch("/api/auth/logout", { method: "POST" }).catch(() => {});
                await refresh();
                router.push("/");
              }}
            >
              <LogOut className="size-4" /> {t("auth.logout")}
            </Button>
          ) : (
            <Link href="/login" className="focus-ring block rounded-md px-2.5 py-1.5 text-sm text-muted transition-colors hover:bg-surface-2 hover:text-fg active:bg-surface-3">
              {t("auth.login")}
            </Link>
          )}
        </div>
      )}
    </div>
  );
}

function DemoBanner() {
  const { t } = useTranslation();
  const { session } = useSession();
  const f = useFormat();
  if (!session || session.data.mode !== "demo") return null;
  return (
    <div className="no-print flex flex-wrap items-center gap-x-2 gap-y-1 border-b border-warn/20 bg-warn/[0.06] px-4 py-2 text-xs text-warn sm:px-6" data-testid="demo-banner">
      <FlaskConical className="size-3.5 shrink-0" />
      <span className="font-medium">{t("demo.bannerTitle")}</span>
      <span className="text-warn/80">{t("demo.bannerText", { date: f.date(session.data.asOf) })}</span>
      <Link href="/app/settings?tab=integrations" className="focus-ring tap ml-auto rounded underline-offset-2 transition-colors hover:text-fg hover:underline">
        {t("demo.connectSources")}
      </Link>
    </div>
  );
}

function Shell({ children }: { children: ReactNode }) {
  const { t } = useTranslation();
  const [mobileOpen, setMobileOpen] = useState(false);
  const pathname = usePathname();
  useEffect(() => setMobileOpen(false), [pathname]);

  return (
    <div className="flex min-h-screen">
      <aside className="no-print sticky top-0 hidden h-screen w-64 shrink-0 border-r border-border bg-surface/60 lg:block">
        <Sidebar />
      </aside>
      {mobileOpen && (
        <div className="fixed inset-0 z-[90] lg:hidden">
          <div className="absolute inset-0 bg-black/60" onClick={() => setMobileOpen(false)} />
          <aside className="absolute inset-y-0 left-0 w-72 border-r border-border bg-surface">
            <Button variant="ghost" size="icon-sm" className="absolute right-3 top-3.5 z-10" onClick={() => setMobileOpen(false)} aria-label={t("common.close")}>
              <X className="size-5" />
            </Button>
            <Sidebar onNavigate={() => setMobileOpen(false)} />
          </aside>
        </div>
      )}
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="no-print sticky top-0 z-40 flex h-14 items-center gap-3 border-b border-border bg-bg/80 px-4 backdrop-blur-xl sm:px-6">
          <Button variant="ghost" size="icon" className="lg:hidden" onClick={() => setMobileOpen(true)} aria-label={t("nav.openMenu")}>
            <Menu />
          </Button>
          <GlobalSearch />
          <div className="ml-auto flex items-center gap-1.5">
            <LanguageSelect compact className="hidden sm:inline-flex" />
            <NotificationsBell />
            <UserMenu />
          </div>
        </header>
        <DemoBanner />
        <main className="print-full mx-auto w-full max-w-[1500px] flex-1 px-4 py-6 sm:px-6">{children}</main>
      </div>
    </div>
  );
}

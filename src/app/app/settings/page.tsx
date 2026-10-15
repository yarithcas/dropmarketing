"use client";

import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AlertTriangle, Building2, CheckCircle2, CircleDashed, Copy, CreditCard, Download, ExternalLink, FlaskConical, Link2, LogOut, Mail, Pencil, Plus, Trash2, UserMinus, UserPlus, Users, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { LanguageSelect } from "@/components/app/language-select";
import { PageHeader } from "@/components/app/bits";
import { useSwitchWorkspace } from "@/components/app/workspace-switcher";
import { PricingTable } from "@/components/marketing/pricing-table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Field, Input, Select } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { ErrorState } from "@/components/ui/states";
import { Tabs } from "@/components/ui/tabs";
import { useToast } from "@/components/ui/toast";
import { useSession } from "@/lib/client/session";
import { CURRENCIES, useCurrency, type CurrencyCode } from "@/lib/client/prefs";
import { apiFetch, useApi } from "@/lib/client/use-api";
import { errorKey } from "@/lib/client/errors";
import { useUrlState } from "@/lib/client/use-url-state";
import { useWorkspace } from "@/lib/client/workspace";
import { useFormat } from "@/lib/format";
import type { PlanId } from "@/lib/plans";
import { INVITE_ROLES, INVITE_TTL_DAYS, ORG_ROLES, type InviteRole, type OrgRole, type TeamInvitation, type TeamMember, type TeamResponse, type WorkspacesResponse } from "@/lib/team";
import { cn } from "@/lib/cn";

type Tab = "profile" | "billing" | "integrations" | "team" | "privacy";

function ProfileTab() {
  const { t } = useTranslation();
  const toast = useToast();
  const { session, refresh } = useSession();
  const [currency, setCurrency] = useCurrency();
  const [theme, setTheme] = useState<"dark" | "light">("dark");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  useEffect(() => {
    setName(session?.user?.name ?? "");
    setEmail(session?.user?.email ?? "");
    try {
      setTheme(localStorage.getItem("th_theme") === "light" ? "light" : "dark");
    } catch {}
  }, [session]);
  const applyTheme = (v: "dark" | "light") => {
    setTheme(v);
    try {
      localStorage.setItem("th_theme", v);
    } catch {}
    if (v === "light") document.documentElement.dataset.theme = "light";
    else delete document.documentElement.dataset.theme;
  };
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card>
        <CardHeader title={t("settings.preferences")} />
        <CardBody className="space-y-4">
          <Field label={t("settings.language")}>
            <LanguageSelect className="w-full [&_select]:w-full" />
          </Field>
          <Field label={t("settings.currency")} hint={t("settings.currencyHint")} htmlFor="currency">
            <Select id="currency" value={currency} onChange={(e) => setCurrency(e.target.value as CurrencyCode)}>
              {CURRENCIES.map((c) => (
                <option key={c}>{c}</option>
              ))}
            </Select>
          </Field>
          <Field label={t("settings.theme")} htmlFor="theme">
            <Select id="theme" value={theme} onChange={(e) => applyTheme(e.target.value as "dark" | "light")}>
              <option value="dark">{t("settings.themeDark")}</option>
              <option value="light">{t("settings.themeLight")}</option>
            </Select>
          </Field>
        </CardBody>
      </Card>
      <Card>
        <CardHeader title={t("settings.profile")} description={session?.mode === "demo" ? t("settings.profileDemo") : undefined} />
        <CardBody>
          <form
            className="space-y-4"
            onSubmit={async (e) => {
              e.preventDefault();
              if (session?.mode !== "demo") return;
              try {
                await apiFetch("/api/auth/demo-login", { method: "POST", body: JSON.stringify({ name, email }) });
                await refresh();
                toast(t("common.saved"));
              } catch {
                toast(t("auth.invalidEmail"), "error");
              }
            }}
          >
            <Field label={t("auth.name")} htmlFor="p-name">
              <Input id="p-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={80} disabled={session?.mode !== "demo"} />
            </Field>
            <Field label={t("auth.email")} htmlFor="p-email">
              <Input id="p-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} maxLength={120} disabled={session?.mode !== "demo"} />
            </Field>
            {session?.mode === "demo" && <Button type="submit">{t("common.save")}</Button>}
          </form>
        </CardBody>
      </Card>
    </div>
  );
}

function UsageBar({ label, used, limit }: { label: string; used: number; limit: number }) {
  const f = useFormat();
  const pct = limit ? Math.min(100, (used / limit) * 100) : 0;
  return (
    <div>
      <div className="mb-1 flex justify-between text-xs">
        <span className="text-muted">{label}</span>
        <span className="num">
          {f.number(used)} / {f.number(limit)}
        </span>
      </div>
      <div className="h-1.5 rounded-full bg-surface-3">
        <div className={cn("h-1.5 rounded-full", pct >= 90 ? "bg-critical" : pct >= 70 ? "bg-warn" : "bg-accent")} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

function BillingTab() {
  const { t } = useTranslation();
  const toast = useToast();
  const { session, refresh } = useSession();
  const { workspace } = useWorkspace();
  const url = useUrlState();
  const [busy, setBusy] = useState<PlanId | "portal" | null>(null);
  useEffect(() => {
    if (url.get("checkout") === "success") toast(t("billing.checkoutSuccess"));
    if (url.get("checkout") === "cancelled") toast(t("billing.checkoutCancelled"), "info");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  if (!session) return <Skeleton className="h-64" />;
  const e = session.entitlements;
  const demoBilling = !session.features.stripe;
  const savedItems = workspace.collections.reduce((s, c) => s + c.items.length, 0);

  const choose = async (plan: PlanId) => {
    setBusy(plan);
    try {
      if (demoBilling) {
        if (session.mode === "live") {
          toast(t("billing.notConfigured"), "error");
          return;
        }
        await apiFetch("/api/billing/demo-plan", { method: "POST", body: JSON.stringify({ plan }) });
        await refresh();
        toast(t("billing.demoSwitched", { plan: t(`plans.${plan}.name`) }));
      } else if (plan === "free") {
        const { url: portal } = await apiFetch<{ url: string }>("/api/billing/portal", { method: "POST" });
        window.location.href = portal;
      } else {
        const { url: checkout } = await apiFetch<{ url: string }>("/api/billing/checkout", { method: "POST", body: JSON.stringify({ plan }) });
        window.location.href = checkout;
      }
    } catch (e) {
      toast(t(errorKey(e)), "error");
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="space-y-4">
      {demoBilling && (
        <div className="flex gap-2 rounded-lg border border-warn/30 bg-warn/5 px-3 py-2.5 text-xs text-warn" data-testid="demo-billing">
          <FlaskConical className="size-4 shrink-0" /> {t("billing.demoMode")}
        </div>
      )}
      <div className="grid gap-4 lg:grid-cols-3">
        <Card>
          <CardHeader title={t("billing.currentPlan")} />
          <CardBody className="space-y-3">
            <div className="flex items-center gap-2">
              <span className="text-2xl font-semibold">{t(`plans.${session.plan}.name`)}</span>
              {demoBilling && <Badge tone="demo">{t("common.demo")}</Badge>}
            </div>
            <p className="text-sm text-muted">{t(`plans.${session.plan}.tagline`)}</p>
            {!demoBilling && session.plan !== "free" && (
              <Button
                variant="secondary"
                disabled={busy === "portal"}
                onClick={async () => {
                  setBusy("portal");
                  try {
                    const { url: portal } = await apiFetch<{ url: string }>("/api/billing/portal", { method: "POST" });
                    window.location.href = portal;
                  } catch (e) {
                    toast(t(errorKey(e)), "error");
                    setBusy(null);
                  }
                }}
              >
                <CreditCard /> {t("billing.manage")}
              </Button>
            )}
          </CardBody>
        </Card>
        <Card className="lg:col-span-2">
          <CardHeader title={t("billing.usage")} description={t("billing.usageDesc")} />
          <CardBody className="grid gap-4 sm:grid-cols-2">
            <UsageBar label={t("billing.meters.product_search")} used={session.usage.product_search?.used ?? 0} limit={e.productSearchesPerDay} />
            <UsageBar label={t("billing.meters.ad_search")} used={session.usage.ad_search?.used ?? 0} limit={e.adSearchesPerDay} />
            <UsageBar label={t("billing.meters.ai_query")} used={session.usage.ai_query?.used ?? 0} limit={e.aiQueriesPerDay} />
            <UsageBar label={t("billing.meters.saved")} used={savedItems} limit={e.savedItems} />
            <UsageBar label={t("billing.meters.collections")} used={workspace.collections.filter((c) => c.kind === "standard").length} limit={e.collections} />
            <UsageBar label={t("billing.meters.alerts")} used={workspace.alertRules.length} limit={e.alertRules} />
          </CardBody>
        </Card>
      </div>
      {!session.canManageBilling && (
        <p className="flex gap-2 rounded-lg border border-border bg-surface-2 px-3 py-2.5 text-xs text-muted" data-testid="billing-role">
          <Users className="size-4 shrink-0" /> {t("billing.roleRequired")}
        </p>
      )}
      <PricingTable current={session.plan} onChoose={choose} busy={busy} demo={demoBilling} />
    </div>
  );
}

interface IntegrationsResponse {
  connectors: {
    id: string;
    category: string;
    auth: string;
    envVars: string[];
    permittedKey: string;
    rateLimit: { requests: number; per: string };
    fields: string[];
    syncFrequency: string;
    retentionDays: number;
    docsUrl: string;
    configured: boolean;
    lastRun: { status: string; at: string; records: number; error: string | null } | null;
  }[];
  services: { id: string; configured: boolean; envVars: string[] }[];
}

function IntegrationsTab() {
  const { t } = useTranslation();
  const f = useFormat();
  const { data } = useApi<IntegrationsResponse>("/api/integrations");
  if (!data) return <Skeleton className="h-96" />;
  return (
    <div className="space-y-4">
      <Card>
        <CardHeader title={t("integrations.services")} description={t("integrations.servicesDesc")} />
        <ul className="divide-y divide-border/60">
          {data.services.map((s) => (
            <li key={s.id} className="flex flex-wrap items-center gap-3 px-4 py-3" data-testid="service-status">
              {s.configured ? <CheckCircle2 className="size-4 text-good" /> : <CircleDashed className="size-4 text-subtle" />}
              <span className="flex-1 text-sm font-medium">{t(`integrations.serviceNames.${s.id}`)}</span>
              <span className="text-xs text-subtle">{t(`integrations.serviceDesc.${s.id}`)}</span>
              <Badge tone={s.configured ? "good" : "neutral"}>{s.configured ? t("integrations.configured") : t("integrations.notConfigured")}</Badge>
              {!s.configured && <code className="w-full text-[11px] text-subtle">{s.envVars.join(" · ")}</code>}
            </li>
          ))}
        </ul>
      </Card>
      <Card>
        <CardHeader title={t("integrations.connectors")} description={t("integrations.connectorsDesc")} />
        <ul className="divide-y divide-border/60">
          {data.connectors.map((c) => (
            <li key={c.id} className="px-4 py-4" data-testid="connector-status">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-sm font-semibold">{t(`connectors.names.${c.id}`)}</span>
                <Badge>{t(`integrations.categories.${c.category}`)}</Badge>
                <Badge tone={c.configured ? "good" : "neutral"}>{c.configured ? t("integrations.configured") : t("integrations.notConfigured")}</Badge>
                {c.lastRun && (
                  <Badge tone={c.lastRun.status === "success" ? "good" : c.lastRun.status === "failed" ? "critical" : "neutral"}>
                    {t(`alerts.runStatus.${c.lastRun.status}`, { defaultValue: c.lastRun.status })} · {f.dateTime(c.lastRun.at)}
                  </Badge>
                )}
                {c.docsUrl.startsWith("http") && (
                  <a href={c.docsUrl} target="_blank" rel="noopener noreferrer" className="ml-auto inline-flex items-center gap-1 text-xs text-accent hover:underline">
                    {t("integrations.docs")} <ExternalLink className="size-3" />
                  </a>
                )}
              </div>
              <p className="mt-1.5 text-xs text-muted">{t(c.permittedKey)}</p>
              <dl className="mt-3 grid gap-x-6 gap-y-1.5 text-xs sm:grid-cols-2 xl:grid-cols-3">
                <div>
                  <dt className="inline text-subtle">{t("integrations.auth")}: </dt>
                  <dd className="inline">{t(`integrations.authKinds.${c.auth}`)}</dd>
                </div>
                <div>
                  <dt className="inline text-subtle">{t("integrations.rateLimit")}: </dt>
                  <dd className="inline">{c.rateLimit.requests ? t("integrations.rate", { n: c.rateLimit.requests, per: t(`integrations.per.${c.rateLimit.per}`) }) : "—"}</dd>
                </div>
                <div>
                  <dt className="inline text-subtle">{t("integrations.frequency")}: </dt>
                  <dd className="inline">{t(`integrations.frequencies.${c.syncFrequency}`)}</dd>
                </div>
                <div>
                  <dt className="inline text-subtle">{t("integrations.retention")}: </dt>
                  <dd className="inline">{c.retentionDays ? t("integrations.days", { n: c.retentionDays }) : "—"}</dd>
                </div>
                <div className="sm:col-span-2">
                  <dt className="inline text-subtle">{t("integrations.fields")}: </dt>
                  <dd className="inline font-mono text-[11px]">{c.fields.join(", ")}</dd>
                </div>
                {!c.configured && c.envVars.length > 0 && (
                  <div className="sm:col-span-2 xl:col-span-3">
                    <dt className="inline text-subtle">{t("integrations.setup")}: </dt>
                    <dd className="inline font-mono text-[11px]">{c.envVars.join(" · ")}</dd>
                  </div>
                )}
                {c.lastRun?.error && (
                  <div className="text-critical sm:col-span-3">
                    <AlertTriangle className="mr-1 inline size-3" />
                    {c.lastRun.error}
                  </div>
                )}
              </dl>
            </li>
          ))}
        </ul>
      </Card>
      <p className="text-xs text-subtle">
        {t("integrations.shopifyHint")}{" "}
        <Link href="/app/stores?tab=mine" className="text-accent hover:underline">
          {t("stores.tabs.mine")}
        </Link>
      </p>
    </div>
  );
}

const copyText = async (text: string) => {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false; // clipboard blocked: the link stays visible in the field
  }
};

type IssuedLink = { email: string; link: string; note: "emailed" | "share" | "renewed" };

/** Members, invitations and seats of the active workspace. Every action is re-checked server-side (role, plan, seats). */
function MembersSection() {
  const { t } = useTranslation();
  const f = useFormat();
  const toast = useToast();
  const { session, refresh } = useSession();
  const active = session?.workspace ?? null;
  const { data, error, reload } = useApi<TeamResponse>(active ? `/api/team?ws=${active.id}` : null);
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<InviteRole>("member");
  const [busy, setBusy] = useState<string | null>(null);
  const [issued, setIssued] = useState<IssuedLink | null>(null);
  useEffect(() => setIssued(null), [active?.id]);

  if (!active)
    return (
      <Card>
        <CardBody className="text-sm text-muted">{t("errors.codes.no_workspace")}</CardBody>
      </Card>
    );
  if (error) return <ErrorState message={t(errorKey(error))} onRetry={reload} />;
  if (!data) return <Skeleton className="h-64" />;

  const full = data.seats.used >= data.seats.limit;
  const run = async (key: string, action: () => Promise<void>, done?: string) => {
    setBusy(key);
    try {
      await action();
      if (done) toast(done);
      reload();
    } catch (e) {
      toast(t(errorKey(e)), "error");
    } finally {
      setBusy(null);
    }
  };
  const label = (m: TeamMember) => m.name || m.email || t("team.unnamed");

  const invite = () =>
    run("invite", async () => {
      const res = await apiFetch<{ link: string; emailed: boolean }>("/api/team/invitations", { method: "POST", body: JSON.stringify({ email, role }) });
      setIssued({ email: email.trim().toLowerCase(), link: res.link, note: res.emailed ? "emailed" : "share" });
      setEmail("");
      toast(t("team.inviteSent", { email: email.trim().toLowerCase() }));
    });
  const renew = (inv: TeamInvitation) =>
    run(`link:${inv.id}`, async () => {
      const res = await apiFetch<{ link: string }>(`/api/team/invitations/${inv.id}/link`, { method: "POST" });
      setIssued({ email: inv.email, link: res.link, note: "renewed" });
      if (await copyText(res.link)) toast(t("common.copied"));
    });
  const revoke = (inv: TeamInvitation) =>
    confirm(t("team.confirmRevoke", { email: inv.email })) &&
    run(`revoke:${inv.id}`, async () => {
      await apiFetch(`/api/team/invitations/${inv.id}`, { method: "DELETE" });
      if (issued?.email === inv.email) setIssued(null);
    }, t("team.revoked"));
  const changeRole = (m: TeamMember, next: OrgRole) =>
    run(`role:${m.userId}`, async () => {
      await apiFetch(`/api/team/members/${m.userId}`, { method: "PATCH", body: JSON.stringify({ role: next }) });
      if (m.self) await refresh();
    }, t("team.roleChanged"));
  const remove = (m: TeamMember) =>
    confirm(m.self ? t("team.confirmLeave", { workspace: data.workspace.name }) : t("team.confirmRemove", { name: label(m), workspace: data.workspace.name })) &&
    run(`remove:${m.userId}`, async () => {
      await apiFetch(`/api/team/members/${m.userId}`, { method: "DELETE" });
      // Leaving moves the session to another workspace.
      if (m.self) await refresh();
    }, m.self ? t("team.left") : t("team.removed"));

  return (
    <div className="space-y-4">
      <Card data-testid="team-members">
        <CardHeader
          title={t("team.membersTitle", { workspace: data.workspace.name })}
          description={t("team.membersDesc")}
          action={
            <Badge tone={full ? "warn" : "neutral"} title={t("team.seatsHint")} data-testid="team-seats">
              {t("team.seats", { used: f.number(data.seats.used), limit: f.number(data.seats.limit) })}
            </Badge>
          }
        />
        <ul className="divide-y divide-border/60">
          {data.members.map((m) => (
            <li key={m.userId} className="flex flex-wrap items-center gap-3 px-4 py-3" data-testid="team-member">
              <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-accent to-accent-2 text-xs font-semibold text-white">{label(m).slice(0, 1).toUpperCase()}</span>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5 text-sm font-medium">
                  <span className="truncate">{label(m)}</span>
                  {m.self && <Badge tone="accent">{t("team.you")}</Badge>}
                </div>
                <div className="truncate text-xs text-subtle">
                  {m.email ?? "—"} · {t("team.joined", { date: f.date(m.joinedAt) })}
                </div>
              </div>
              {m.assignableRoles.length ? (
                <Select
                  aria-label={t("team.roleLabel")}
                  value={m.role}
                  disabled={busy === `role:${m.userId}`}
                  onChange={(e) => changeRole(m, e.target.value as OrgRole)}
                  className="h-8 w-auto text-[13px]"
                  data-testid="member-role"
                >
                  {ORG_ROLES.filter((r) => r === m.role || m.assignableRoles.includes(r)).map((r) => (
                    <option key={r} value={r}>
                      {t(`team.roles.${r}`)}
                    </option>
                  ))}
                </Select>
              ) : (
                <Badge tone={m.role === "owner" ? "accent" : "neutral"}>{t(`team.roles.${m.role}`)}</Badge>
              )}
              {m.canRemove && (
                <Button size="sm" variant="ghost" disabled={busy === `remove:${m.userId}`} onClick={() => remove(m)} data-testid="remove-member">
                  {m.self ? <LogOut /> : <UserMinus />} {m.self ? t("team.leave") : t("common.remove")}
                </Button>
              )}
            </li>
          ))}
        </ul>
        {!data.teamPlan ? (
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1 border-t border-border/70 px-4 py-3 text-sm text-muted" data-testid="team-upsell">
            <Users className="size-4 text-accent" />
            <span>{t("team.businessOnly")}</span>
            <Link href="/app/settings?tab=billing" className="text-accent hover:underline">
              {t("billing.upgrade")}
            </Link>
          </div>
        ) : data.canManage ? (
          <form
            className="grid gap-3 border-t border-border/70 p-4 sm:grid-cols-[1fr_160px_auto] sm:items-end"
            onSubmit={(e) => {
              e.preventDefault();
              invite();
            }}
          >
            <Field label={t("team.inviteEmail")} htmlFor="invite-email">
              <Input id="invite-email" type="email" required maxLength={254} autoComplete="off" value={email} onChange={(e) => setEmail(e.target.value)} data-testid="invite-email" />
            </Field>
            <Field label={t("team.roleLabel")} htmlFor="invite-role">
              <Select id="invite-role" value={role} onChange={(e) => setRole(e.target.value as InviteRole)}>
                {INVITE_ROLES.map((r) => (
                  <option key={r} value={r}>
                    {t(`team.roles.${r}`)}
                  </option>
                ))}
              </Select>
            </Field>
            <Button type="submit" disabled={full || !email.trim() || busy === "invite"} data-testid="invite-submit">
              <UserPlus /> {t("team.inviteBtn")}
            </Button>
            <p className="text-[11px] text-subtle sm:col-span-3">{full ? <span className="text-warn">{t("team.seatsFull")}</span> : t("team.seatsHint")}</p>
          </form>
        ) : (
          <p className="border-t border-border/70 px-4 py-3 text-xs text-subtle">{t("team.managersOnly")}</p>
        )}
        {issued && (
          <div className="space-y-2 border-t border-border/70 bg-accent/[0.04] p-4" data-testid="invite-link">
            <p className="text-sm">{issued.note === "emailed" ? t("team.inviteEmailed", { email: issued.email }) : issued.note === "renewed" ? t("team.newLinkDone", { email: issued.email }) : t("team.inviteNotEmailed")}</p>
            <label htmlFor="invite-link-value" className="block text-xs font-medium text-muted">
              {t("team.inviteLinkLabel", { days: f.number(INVITE_TTL_DAYS) })}
            </label>
            <div className="flex gap-2">
              <Input id="invite-link-value" readOnly value={issued.link} onFocus={(e) => e.currentTarget.select()} className="font-mono text-xs" />
              <Button variant="secondary" onClick={async () => (await copyText(issued.link)) && toast(t("common.copied"))}>
                <Copy /> {t("common.copy")}
              </Button>
            </div>
            <p className="text-[11px] text-subtle">{t("team.inviteLinkHint")}</p>
          </div>
        )}
      </Card>

      {data.canManage && data.teamPlan && (
        <Card data-testid="team-invitations">
          <CardHeader title={t("team.pendingTitle")} />
          {data.invitations.length === 0 ? (
            <CardBody className="text-sm text-subtle">{t("team.pendingEmpty")}</CardBody>
          ) : (
            <ul className="divide-y divide-border/60">
              {data.invitations.map((inv) => (
                <li key={inv.id} className="flex flex-wrap items-center gap-3 px-4 py-3" data-testid="team-invitation">
                  <Mail className="size-4 shrink-0 text-subtle" />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium">{inv.email}</div>
                    <div className="text-xs text-subtle">{inv.expired ? <Badge tone="critical">{t("team.expired")}</Badge> : t("team.expires", { date: f.dateTime(inv.expiresAt) })}</div>
                  </div>
                  <Badge>{t(`team.roles.${inv.role}`)}</Badge>
                  <Button size="sm" variant="secondary" disabled={busy === `link:${inv.id}`} onClick={() => renew(inv)} title={t("team.inviteLinkHint")}>
                    <Link2 /> {t("team.newLink")}
                  </Button>
                  <Button size="sm" variant="ghost" disabled={busy === `revoke:${inv.id}`} onClick={() => revoke(inv)}>
                    <X /> {t("team.revoke")}
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </Card>
      )}
    </div>
  );
}

/** The user's workspaces: switch, rename (owners/admins) and create (Business, within the plan's limit). */
function WorkspacesSection() {
  const { t } = useTranslation();
  const f = useFormat();
  const toast = useToast();
  const router = useRouter();
  const { session, refresh } = useSession();
  const switchTo = useSwitchWorkspace();
  const { data, error, reload } = useApi<WorkspacesResponse>(`/api/workspaces?ws=${session?.workspace?.id ?? ""}`);
  const [name, setName] = useState("");
  const [editing, setEditing] = useState<{ id: string; name: string } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  if (error) return <ErrorState message={t(errorKey(error))} onRetry={reload} />;
  if (!data) return <Skeleton className="h-48" />;

  const rename = async () => {
    if (!editing?.name.trim()) return;
    setBusy(`rename:${editing.id}`);
    try {
      await apiFetch(`/api/workspaces/${editing.id}`, { method: "PATCH", body: JSON.stringify({ name: editing.name.trim() }) });
      setEditing(null);
      await refresh();
      reload();
      toast(t("workspaces.renamed"));
    } catch (e) {
      toast(t(errorKey(e)), "error");
    } finally {
      setBusy(null);
    }
  };
  const create = async () => {
    const value = name.trim();
    if (!value) return;
    setBusy("create");
    try {
      // The server makes the new workspace active.
      await apiFetch("/api/workspaces", { method: "POST", body: JSON.stringify({ name: value }) });
      setName("");
      await refresh();
      router.refresh();
      toast(t("workspaces.created", { name: value }));
    } catch (e) {
      toast(t(errorKey(e)), "error");
    } finally {
      setBusy(null);
    }
  };

  return (
    <Card data-testid="workspaces">
      <CardHeader
        title={t("workspaces.title")}
        description={t("workspaces.desc")}
        action={data.create.limit > 1 ? <Badge>{t("workspaces.usage", { used: f.number(data.create.used), limit: f.number(data.create.limit) })}</Badge> : undefined}
      />
      <ul className="divide-y divide-border/60">
        {data.workspaces.map((w) => (
          <li key={w.id} className="flex flex-wrap items-center gap-3 px-4 py-3" data-testid="workspace-row">
            <Building2 className="size-4 shrink-0 text-subtle" />
            {editing?.id === w.id ? (
              <form
                className="flex min-w-0 flex-1 gap-2"
                onSubmit={(e) => {
                  e.preventDefault();
                  rename();
                }}
              >
                <Input aria-label={t("workspaces.name")} value={editing.name} maxLength={80} autoFocus onChange={(e) => setEditing({ id: w.id, name: e.target.value })} className="h-8" />
                <Button size="sm" type="submit" disabled={!editing.name.trim() || busy === `rename:${w.id}`}>
                  {t("common.save")}
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setEditing(null)}>
                  {t("common.cancel")}
                </Button>
              </form>
            ) : (
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-medium">{w.name}</div>
                <div className="text-xs text-subtle">{t("workspaces.members", { count: w.members })}</div>
              </div>
            )}
            <Badge>{t(`team.roles.${w.role}`)}</Badge>
            <Badge tone={w.plan === "free" ? "neutral" : "accent"}>{t(`plans.${w.plan}.name`)}</Badge>
            {w.canRename && editing?.id !== w.id && (
              <Button size="icon-sm" variant="ghost" aria-label={t("workspaces.rename")} onClick={() => setEditing({ id: w.id, name: w.name })}>
                <Pencil />
              </Button>
            )}
            {w.active ? (
              <Badge tone="good">{t("workspaces.active")}</Badge>
            ) : (
              <Button
                size="sm"
                variant="secondary"
                disabled={busy === `switch:${w.id}`}
                onClick={async () => {
                  setBusy(`switch:${w.id}`);
                  await switchTo(w.id, w.name);
                  setBusy(null);
                }}
              >
                {t("workspaces.switch")}
              </Button>
            )}
          </li>
        ))}
      </ul>
      {data.create.allowed ? (
        <form
          className="space-y-2 border-t border-border/70 p-4"
          onSubmit={(e) => {
            e.preventDefault();
            create();
          }}
        >
          <Field label={t("workspaces.createTitle")} htmlFor="ws-name" hint={t("workspaces.billedHint")}>
            <div className="flex gap-2">
              <Input id="ws-name" value={name} maxLength={80} placeholder={t("workspaces.name")} onChange={(e) => setName(e.target.value)} data-testid="workspace-name" />
              <Button type="submit" disabled={!name.trim() || busy === "create"} data-testid="workspace-create">
                <Plus /> {t("common.create")}
              </Button>
            </div>
          </Field>
        </form>
      ) : (
        data.create.reason && (
          <p className="flex flex-wrap items-center gap-x-2 gap-y-1 border-t border-border/70 px-4 py-3 text-xs text-subtle" data-testid="workspace-create-blocked">
            {t(`workspaces.blocked.${data.create.reason}`)}
            {data.create.reason === "plan_required" && (
              <Link href="/app/settings?tab=billing" className="text-accent hover:underline">
                {t("billing.upgrade")}
              </Link>
            )}
          </p>
        )
      )}
    </Card>
  );
}

function TeamTab() {
  const { t } = useTranslation();
  const f = useFormat();
  const { session } = useSession();
  if (!session) return <Skeleton className="h-40" />;
  const e = session.entitlements;
  if (session.mode === "demo")
    return (
      <Card data-testid="team-demo">
        <CardHeader title={t("team.title")} description={t("team.desc", { seats: f.number(e.seats), workspaces: f.number(e.workspaces) })} />
        <CardBody className="space-y-3 text-sm">
          <div className="flex gap-2 rounded-lg border border-warn/30 bg-warn/5 px-3 py-2.5 text-xs text-warn">
            <FlaskConical className="size-4 shrink-0" /> {t("team.demoText")}
          </div>
          {session.plan !== "business" && (
            <p className="text-muted">
              {t("team.businessOnly")}{" "}
              <Link href="/app/settings?tab=billing" className="text-accent hover:underline">
                {t("billing.upgrade")}
              </Link>
            </p>
          )}
        </CardBody>
      </Card>
    );
  return (
    <div className="space-y-4">
      <MembersSection />
      <WorkspacesSection />
    </div>
  );
}

function PrivacyTab() {
  const { t } = useTranslation();
  const toast = useToast();
  const router = useRouter();
  const { session, refresh } = useSession();
  const { workspace, replace } = useWorkspace();
  const [confirmText, setConfirmText] = useState("");
  const exportData = () => {
    if (session?.mode === "live") {
      window.location.href = "/api/account/export";
      return;
    }
    const blob = new Blob([JSON.stringify({ exportedAt: new Date().toISOString(), mode: "demo", user: session?.user ?? null, workspace }, null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "trendhunter-demo-export.json";
    a.click();
  };
  const del = async () => {
    try {
      await apiFetch("/api/account/delete", { method: "POST", body: JSON.stringify({ confirm: confirmText }) });
      try {
        localStorage.removeItem("th_workspace_v1");
      } catch {}
      replace({ collections: [], watchlist: [], alertRules: [], notifications: [], alertHistory: [] });
      await refresh();
      toast(t("privacy.deleted"));
      router.push("/");
    } catch (e) {
      toast(t(errorKey(e)), "error");
    }
  };
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card>
        <CardHeader title={t("privacy.exportTitle")} description={t("privacy.exportDesc")} />
        <CardBody>
          <Button variant="secondary" onClick={exportData} data-testid="export-data">
            <Download /> {t("privacy.exportBtn")}
          </Button>
        </CardBody>
      </Card>
      <Card className="border-critical/30">
        <CardHeader title={t("privacy.deleteTitle")} description={session?.mode === "demo" ? t("privacy.deleteDemoDesc") : t("privacy.deleteDesc")} />
        <CardBody className="space-y-3">
          <Field label={t("privacy.typeDelete")} htmlFor="confirm-del">
            <Input id="confirm-del" value={confirmText} onChange={(e) => setConfirmText(e.target.value)} placeholder="DELETE" />
          </Field>
          <Button variant="danger" disabled={confirmText !== "DELETE"} onClick={del} data-testid="delete-account">
            <Trash2 /> {t("privacy.deleteBtn")}
          </Button>
        </CardBody>
      </Card>
      <Card className="lg:col-span-2">
        <CardHeader title={t("privacy.infoTitle")} />
        <CardBody className="space-y-2 text-sm text-muted">
          <p>{t("privacy.info1")}</p>
          <p>{t("privacy.info2")}</p>
          <p>{t("privacy.info3")}</p>
          <Link href="/privacy" className="inline-flex items-center gap-1 text-accent hover:underline">
            {t("legal.privacyTitle")} <ExternalLink className="size-3" />
          </Link>
        </CardBody>
      </Card>
    </div>
  );
}

function SettingsInner() {
  const { t } = useTranslation();
  const url = useUrlState();
  const tab = (url.get("tab") || "profile") as Tab;
  const tabs: Tab[] = ["profile", "billing", "integrations", "team", "privacy"];
  return (
    <div>
      <PageHeader title={t("settings.title")} description={t("settings.subtitle")} />
      <Tabs className="mb-6 flex-wrap" value={tab} onChange={(v) => url.set({ tab: v })} items={tabs.map((v) => ({ value: v, label: t(`settings.tabs.${v}`) }))} />
      {tab === "profile" && <ProfileTab />}
      {tab === "billing" && <BillingTab />}
      {tab === "integrations" && <IntegrationsTab />}
      {tab === "team" && <TeamTab />}
      {tab === "privacy" && <PrivacyTab />}
    </div>
  );
}

export default function SettingsPage() {
  return (
    <Suspense fallback={<Skeleton className="h-96" />}>
      <SettingsInner />
    </Suspense>
  );
}


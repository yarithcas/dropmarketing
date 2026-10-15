"use client";

import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AlertTriangle, CheckCircle2, CircleDashed, CreditCard, Download, ExternalLink, FlaskConical, Trash2, Users } from "lucide-react";
import { useTranslation } from "react-i18next";
import { LanguageSelect } from "@/components/app/language-select";
import { PageHeader } from "@/components/app/bits";
import { PricingTable } from "@/components/marketing/pricing-table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Field, Input, Select } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
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
            <UsageBar label={t("billing.meters.collections")} used={workspace.collections.length} limit={e.collections} />
            <UsageBar label={t("billing.meters.alerts")} used={workspace.alertRules.length} limit={e.alertRules} />
          </CardBody>
        </Card>
      </div>
      <PricingTable current={session.plan} onChoose={choose} busy={busy} demo={demoBilling} />
    </div>
  );
}

interface IntegrationsResponse {
  connectors: {
    id: string;
    category: string;
    /** False: no provider mapping yet ("not available yet"), never shown as configured. */
    available?: boolean;
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
                <Badge tone={c.configured ? "good" : "neutral"}>{c.available === false ? t("integrations.notAvailable") : c.configured ? t("integrations.configured") : t("integrations.notConfigured")}</Badge>
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
                {!c.configured && c.available !== false && c.envVars.length > 0 && (
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

function TeamTab() {
  const { t } = useTranslation();
  const { session } = useSession();
  if (!session) return <Skeleton className="h-40" />;
  const e = session.entitlements;
  return (
    <Card>
      <CardHeader title={t("team.title")} description={t("team.desc", { seats: e.seats, workspaces: e.workspaces })} />
      <CardBody className="space-y-3 text-sm">
        <div className="flex items-center gap-3 rounded-lg border border-border p-3">
          <Users className="size-4 text-accent" />
          <div className="flex-1">
            <div className="font-medium">{session.user?.name || session.user?.email || t("auth.visitor")}</div>
            <div className="text-xs text-subtle">{t("team.owner")}</div>
          </div>
        </div>
        {session.plan !== "business" ? (
          <p className="text-muted">
            {t("team.businessOnly")}{" "}
            <Link href="/app/settings?tab=billing" className="text-accent hover:underline">
              {t("billing.upgrade")}
            </Link>
          </p>
        ) : session.mode === "demo" ? (
          <p className="text-muted">{t("team.demoInvite")}</p>
        ) : (
          <p className="text-muted">{t("team.inviteSoon")}</p>
        )}
      </CardBody>
    </Card>
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


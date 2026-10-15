"use client";

import { Suspense, useState } from "react";
import Link from "next/link";
import { BellRing, CalendarClock, Database, Eye, Mail, Pause, Play, Plus, Radar, Trash2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { PageHeader, PlanGate } from "@/components/app/bits";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Dialog } from "@/components/ui/dialog";
import { Field, Input, Select } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/ui/states";
import { Tabs } from "@/components/ui/tabs";
import { useToast } from "@/components/ui/toast";
import { useSession } from "@/lib/client/session";
import { useApi } from "@/lib/client/use-api";
import { useUrlState } from "@/lib/client/use-url-state";
import { useWorkspace } from "@/lib/client/workspace";
import { useFormat, type Formatters } from "@/lib/format";
import type { MonitoringStatus } from "@/lib/monitoring";
import { notificationParams } from "@/lib/notification-text";
import { CATEGORIES, type ProductWithMetrics, type Store } from "@/lib/types";
import { ALERT_TYPES, type AlertRule, type AlertType } from "@/lib/workspace";
import { cn } from "@/lib/cn";

type T = (k: string, o?: Record<string, unknown>) => string;

const reasonText = (t: T, code: string | null | undefined) => t(`alerts.runReasons.${code ?? "unknown"}`, { defaultValue: t("alerts.runReasons.unknown") });

/** Data ingestion line: what was actually collected, never inferred from rule runs. */
function ingestionText(s: MonitoringStatus, t: T, f: Formatters) {
  if (!s.scheduler) return t("alerts.notScheduled");
  if (!s.connectors.length) return t("alerts.noConnector");
  if (!s.lastIngestion) return t("alerts.noIngestionYet");
  return t("alerts.lastIngestion", { date: f.dateTime(s.lastIngestion.at), source: t(`connectors.names.${s.lastIngestion.connector}`), n: f.number(s.lastIngestion.records) });
}

/** Rule evaluation lines: the user's latest scheduled run, with the reason when it did not evaluate. */
function evaluationText(s: MonitoringStatus, t: T, f: Formatters): string[] {
  const e = s.lastEvaluation;
  if (!s.scheduler) return [t("alerts.evaluationManualOnly")];
  if (!e) return [t("alerts.noEvaluationYet")];
  if (e.status === "running") return [t("alerts.evaluationRunning", { date: f.dateTime(e.at) })];
  if (e.status === "success") return [t("alerts.lastEvaluation", { date: f.dateTime(e.at), asOf: f.date(e.dataAsOf) }), ...(e.reason ? [reasonText(t, e.reason)] : [])];
  const lines = [t("alerts.lastEvaluationNotRun", { date: f.dateTime(e.at), status: t(`alerts.runStatus.${e.status}`), reason: reasonText(t, e.reason) })];
  if (s.lastSuccessfulEvaluation) lines.push(t("alerts.lastSuccessfulEvaluation", { date: f.dateTime(s.lastSuccessfulEvaluation.at) }));
  return lines;
}

function RuleDialog({ onClose, preset }: { onClose: () => void; preset?: Partial<AlertRule> }) {
  const { t } = useTranslation();
  const { dispatch, workspace } = useWorkspace();
  const { session } = useSession();
  const [type, setType] = useState<AlertType>(preset?.type ?? "trend_increase");
  const [name, setName] = useState(preset?.name ?? "");
  const [category, setCategory] = useState(preset?.target?.category ?? "");
  const [productId, setProductId] = useState(preset?.target?.productId ?? "");
  const [storeId, setStoreId] = useState(preset?.target?.storeId ?? "");
  const [threshold, setThreshold] = useState(String(preset?.thresholdPct ?? 30));
  const [frequency, setFrequency] = useState<AlertRule["frequency"]>("daily");
  const [email, setEmail] = useState(false);
  const { data: products } = useApi<{ items: ProductWithMetrics[] }>("/api/products/batch?ids=" + workspace.watchlist.filter((w) => w.type === "product").map((w) => w.refId).join(","));
  const { data: stores } = useApi<{ items: Store[] }>("/api/stores?pageSize=100");
  const watchedProducts = products?.items ?? [];
  const needsProduct = type === "new_advertiser" || (type === "trend_increase" && !category);
  const valid = name.trim() && (type !== "new_advertiser" || productId) && (type !== "competitor_new_products" || storeId);

  const save = async () => {
    const target: AlertRule["target"] = {};
    if (type === "trend_increase") {
      if (productId) target.productId = productId;
      else if (category) target.category = category;
    }
    if (type === "new_advertiser") target.productId = productId;
    if (type === "new_product_in_category" && category) target.category = category;
    if (type === "competitor_new_products") target.storeId = storeId;
    const ok = await dispatch(
      {
        op: "rule.create",
        rule: { name: name.trim(), type, target, thresholdPct: type === "trend_increase" ? Math.max(1, Number(threshold) || 30) : undefined, frequency, channels: { inApp: true, email } } as never,
      },
      t("alerts.created"),
    );
    if (ok) onClose();
  };

  return (
    <Dialog
      open
      onClose={onClose}
      title={t("alerts.newRule")}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            {t("common.cancel")}
          </Button>
          <Button onClick={save} disabled={!valid} disabledReason={t("alerts.ruleIncomplete")} data-testid="save-rule">
            {t("common.create")}
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <Field label={t("alerts.ruleName")} htmlFor="rule-name">
          <Input id="rule-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={160} placeholder={t("alerts.ruleNamePlaceholder")} />
        </Field>
        <Field label={t("alerts.type")} htmlFor="rule-type">
          <Select id="rule-type" value={type} onChange={(e) => setType(e.target.value as AlertType)}>
            {ALERT_TYPES.map((ty) => (
              <option key={ty} value={ty}>
                {t(`alerts.types.${ty}`)}
              </option>
            ))}
          </Select>
        </Field>
        {(type === "trend_increase" || type === "new_product_in_category") && (
          <Field label={t("filters.category")} htmlFor="rule-cat" hint={type === "trend_increase" ? t("alerts.categoryOrProduct") : undefined}>
            <Select id="rule-cat" value={category} onChange={(e) => setCategory(e.target.value)}>
              <option value="">{t("alerts.allCategories")}</option>
              {CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {t(`categories.${c}`)}
                </option>
              ))}
            </Select>
          </Field>
        )}
        {(type === "new_advertiser" || (type === "trend_increase" && needsProduct)) && (
          <Field label={t("alerts.watchedProduct")} htmlFor="rule-prod" hint={watchedProducts.length ? undefined : t("alerts.watchFirst")}>
            <Select id="rule-prod" value={productId} onChange={(e) => setProductId(e.target.value)}>
              <option value="">{type === "trend_increase" ? t("alerts.anyProduct") : t("alerts.chooseProduct")}</option>
              {watchedProducts.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </Select>
          </Field>
        )}
        {type === "competitor_new_products" && (
          <Field label={t("alerts.store")} htmlFor="rule-store">
            <Select id="rule-store" value={storeId} onChange={(e) => setStoreId(e.target.value)}>
              <option value="">{t("alerts.chooseStore")}</option>
              {(stores?.items ?? []).map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </Select>
          </Field>
        )}
        {type === "trend_increase" && (
          <Field label={t("alerts.threshold")} htmlFor="rule-th" hint={t("alerts.thresholdHint")}>
            <Input id="rule-th" type="number" min={1} max={1000} value={threshold} onChange={(e) => setThreshold(e.target.value)} />
          </Field>
        )}
        <Field label={t("alerts.frequency")} htmlFor="rule-freq">
          <Select id="rule-freq" value={frequency} onChange={(e) => setFrequency(e.target.value as AlertRule["frequency"])}>
            {(["hourly", "daily", "weekly"] as const).map((fq) => (
              <option key={fq} value={fq}>
                {t(`alerts.frequencies.${fq}`)}
              </option>
            ))}
          </Select>
        </Field>
        <div className="space-y-1.5">
          <div className="text-xs font-medium text-muted">{t("alerts.channels")}</div>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked disabled className="accent-[rgb(var(--accent))]" /> {t("alerts.inApp")}
          </label>
          <label className={cn("flex items-center gap-2 text-sm", !session?.features.email && "opacity-50")}>
            <input type="checkbox" checked={email} disabled={!session?.features.email} onChange={(e) => setEmail(e.target.checked)} className="accent-[rgb(var(--accent))]" /> {t("alerts.email")}
            {!session?.features.email && <span className="text-xs text-subtle">({t("alerts.emailNotConfigured")})</span>}
          </label>
        </div>
      </div>
    </Dialog>
  );
}

function describeTarget(r: AlertRule, t: (k: string, o?: Record<string, unknown>) => string, labels: Map<string, string>) {
  if (r.target.productId) return labels.get(r.target.productId) ?? r.target.productId;
  if (r.target.storeId) return labels.get(r.target.storeId) ?? r.target.storeId;
  if (r.target.category) return t(`categories.${r.target.category}`);
  return t("alerts.allCategories");
}

function AlertsInner() {
  const { t } = useTranslation();
  const f = useFormat();
  const toast = useToast();
  const { session } = useSession();
  const { ready, workspace, dispatch, runAlertCheck } = useWorkspace();
  const url = useUrlState();
  const tab = (url.get("tab") || "rules") as "rules" | "watchlist" | "history";
  const [creating, setCreating] = useState<Partial<AlertRule> | null>(null);
  const [checking, setChecking] = useState(false);
  const { data: status, reload: reloadStatus } = useApi<MonitoringStatus>("/api/alerts/status");
  const labels = new Map(workspace.watchlist.map((w) => [w.refId, w.label]));
  const demo = session?.mode === "demo";
  const ingesting = Boolean(status?.scheduler && status.connectors.length && status.lastIngestion);
  const evaluated = Boolean(status?.scheduler && status.lastEvaluation?.status === "success");

  const runNow = async () => {
    setChecking(true);
    const r = await runAlertCheck();
    setChecking(false);
    if (!r) return;
    reloadStatus();
    // A live check without live research data is recorded as skipped, never reported as complete.
    if (r.status === "skipped" || r.status === "failed") toast(t("alerts.checkNotRun", { reason: reasonText(t, r.reason) }), "error");
    else toast(t("alerts.checkDone", { n: r.matches }), "info");
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title={t("alerts.title")}
        description={t("alerts.subtitle")}
        actions={
          <Tabs
            value={tab}
            onChange={(v) => url.set({ tab: v === "rules" ? null : v })}
            items={[
              { value: "rules", label: t("alerts.tabs.rules"), count: workspace.alertRules.length },
              { value: "watchlist", label: t("alerts.tabs.watchlist"), count: workspace.watchlist.length },
              { value: "history", label: t("alerts.tabs.history"), count: workspace.notifications.length },
            ]}
          />
        }
      />

      <Card>
        <CardBody className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <div className="flex gap-3">
            <Database className={cn("mt-0.5 size-5 shrink-0", ingesting ? "text-good" : "text-warn")} />
            <div className="text-sm">
              <div className="font-medium">{t("alerts.monitoring")}</div>
              <div className="text-muted" data-testid="monitoring-status">
                {status ? ingestionText(status, t, f) : "…"}
              </div>
            </div>
          </div>
          <div className="flex gap-3">
            <CalendarClock className={cn("mt-0.5 size-5 shrink-0", evaluated ? "text-good" : "text-warn")} />
            <div className="text-sm">
              <div className="font-medium">{t("alerts.evaluation")}</div>
              <div className="text-muted" data-testid="evaluation-status">
                {status ? evaluationText(status, t, f).map((line) => <div key={line}>{line}</div>) : "…"}
              </div>
              {status?.scheduler && <p className="mt-1 text-[11px] text-subtle">{t("alerts.scheduleNote")}</p>}
            </div>
          </div>
          <div className="flex gap-3">
            <Mail className={cn("mt-0.5 size-5 shrink-0", status?.email ? "text-good" : "text-subtle")} />
            <div className="text-sm">
              <div className="font-medium">{t("alerts.emailDelivery")}</div>
              <div className="text-muted">{status?.email ? t("alerts.emailOn") : t("alerts.emailNotConfigured")}</div>
            </div>
          </div>
          <div className="flex items-center justify-start gap-2 xl:justify-end">
            <Button variant="secondary" onClick={runNow} loading={checking} disabled={!session?.entitlements.alerts} disabledReason={t("billing.gateTitle", { feature: t("alerts.title") })} data-testid="run-check">
              <Radar /> {demo ? t("alerts.runDemoCheck") : t("alerts.runCheck")}
            </Button>
          </div>
          {status?.failures.length ? (
            <div className="rounded-lg border border-critical/30 bg-critical/5 p-3 text-xs text-critical md:col-span-2 xl:col-span-4">
              {t("alerts.failures")}:{" "}
              {status.failures.map((x) => `${t(`connectors.names.${x.connector}`)} (${f.dateTime(x.at)} · ${t(`integrations.errorCategories.${x.category}`)})`).join(", ")}
            </div>
          ) : null}
          {demo && <p className="text-[11px] text-subtle md:col-span-2 xl:col-span-4">{t("alerts.demoNote")}</p>}
        </CardBody>
      </Card>

      {!ready ? (
        <Skeleton className="h-64 rounded-xl" />
      ) : tab === "rules" ? (
        <PlanGate feature={t("alerts.title")} allowed={session?.entitlements.alerts ?? false}>
          <Card>
            <CardHeader
              title={t("alerts.rules")}
              description={t("alerts.rulesUsage", { n: workspace.alertRules.length, max: session?.entitlements.alertRules ?? 0 })}
              action={
                <Button size="sm" onClick={() => setCreating({})} data-testid="new-rule">
                  <Plus /> {t("alerts.newRule")}
                </Button>
              }
            />
            {workspace.alertRules.length === 0 ? (
              <CardBody>
                <EmptyState icon={<BellRing />} title={t("alerts.emptyTitle")} description={t("alerts.emptyText")} />
              </CardBody>
            ) : (
              <ul className="divide-y divide-border/60">
                {workspace.alertRules.map((r) => (
                  <li key={r.id} className="flex flex-wrap items-center gap-3 px-4 py-3" data-testid="alert-rule">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 text-sm font-medium">
                        {r.name}
                        <Badge tone={r.active ? "good" : "neutral"}>{r.active ? t("alerts.active") : t("alerts.paused")}</Badge>
                      </div>
                      <div className="mt-0.5 text-xs text-subtle">
                        {t(`alerts.types.${r.type}`)} · {describeTarget(r, t, labels)}
                        {r.thresholdPct ? ` · ≥ ${f.pct(r.thresholdPct, 0, true)}` : ""} · {t(`alerts.frequencies.${r.frequency}`)} · {r.channels.email ? t("alerts.inAppEmail") : t("alerts.inApp")}
                      </div>
                      <div className="text-[11px] text-subtle">{r.lastEvaluatedAt ? t("alerts.lastEvaluated", { date: f.dateTime(r.lastEvaluatedAt) }) : t("alerts.neverEvaluated")}</div>
                    </div>
                    <Button size="sm" variant="secondary" onClick={() => dispatch({ op: "rule.update", id: r.id, active: !r.active }, r.active ? t("alerts.pausedToast") : t("alerts.resumedToast"))} data-testid="toggle-rule">
                      {r.active ? <Pause /> : <Play />} {r.active ? t("alerts.pause") : t("alerts.resume")}
                    </Button>
                    <Button size="icon-sm" variant="ghost" aria-label={t("common.delete")} onClick={() => dispatch({ op: "rule.delete", id: r.id }, t("alerts.deleted"))}>
                      <Trash2 />
                    </Button>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </PlanGate>
      ) : tab === "watchlist" ? (
        <Card>
          <CardHeader title={t("alerts.tabs.watchlist")} description={t("alerts.watchlistDesc")} />
          {workspace.watchlist.length === 0 ? (
            <CardBody>
              <EmptyState icon={<Eye />} title={t("watchlist.emptyTitle")} description={t("watchlist.emptyText")} />
            </CardBody>
          ) : (
            <ul className="divide-y divide-border/60">
              {workspace.watchlist.map((w) => (
                <li key={w.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
                  <Badge>{t(`watchlist.types.${w.type}`)}</Badge>
                  <Link
                    href={w.type === "product" ? `/app/products/${w.refId}` : w.type === "store" ? `/app/stores/${w.refId}` : `/app/products?category=${w.refId}`}
                    className="focus-ring min-w-[10rem] flex-1 truncate rounded text-sm transition-colors hover:text-accent coarse:-my-2.5 coarse:py-2.5"
                  >
                    {w.label}
                  </Link>
                  <span className="text-xs text-subtle">{f.date(w.addedAt.slice(0, 10))}</span>
                  {session?.entitlements.alerts && (
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={() =>
                        setCreating(
                          w.type === "product"
                            ? { type: "new_advertiser", name: t("alerts.presetAdvertiser", { name: w.label }), target: { productId: w.refId } }
                            : w.type === "store"
                              ? { type: "competitor_new_products", name: t("alerts.presetStore", { name: w.label }), target: { storeId: w.refId } }
                              : { type: "new_product_in_category", name: t("alerts.presetCategory", { name: w.label }), target: { category: w.refId } },
                        )
                      }
                    >
                      <BellRing /> {t("alerts.createFromWatch")}
                    </Button>
                  )}
                  <Button size="icon-sm" variant="ghost" aria-label={t("common.remove")} onClick={() => dispatch({ op: "watch.remove", id: w.id }, t("watchlist.removed"))}>
                    <Trash2 />
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </Card>
      ) : (
        <div className="grid gap-4 lg:grid-cols-[1fr_340px]">
          <Card>
            <CardHeader
              title={t("alerts.notificationHistory")}
              action={
                workspace.notifications.length ? (
                  <Button size="sm" variant="ghost" onClick={() => dispatch({ op: "notifications.clear" }, t("alerts.cleared"))}>
                    {t("alerts.clear")}
                  </Button>
                ) : null
              }
            />
            {workspace.notifications.length === 0 ? (
              <CardBody>
                <EmptyState title={t("notifications.empty")} />
              </CardBody>
            ) : (
              <ul className="divide-y divide-border/60">
                {workspace.notifications.map((n) => (
                  <li key={n.id} className="px-4 py-3">
                    {/* Notifications without a target are plain text, never a dead "#" link. */}
                    {n.link ? (
                      <Link href={n.link} className="focus-ring rounded text-sm transition-colors hover:text-accent">
                        {t(n.key, notificationParams(n.params, f, (c) => t(`categories.${c}`)))}
                      </Link>
                    ) : (
                      <span className="text-sm">{t(n.key, notificationParams(n.params, f, (c) => t(`categories.${c}`)))}</span>
                    )}
                    <div className="mt-0.5 flex items-center gap-2 text-[11px] text-subtle">
                      {f.dateTime(n.createdAt)} <Badge tone={n.origin === "demo" ? "demo" : "neutral"}>{t(`alerts.origins.${n.origin}`)}</Badge>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Card>
          <Card className="h-fit">
            <CardHeader title={t("alerts.runHistory")} />
            {workspace.alertHistory.length === 0 ? (
              <CardBody>
                <p className="text-sm text-subtle">{t("alerts.noRuns")}</p>
              </CardBody>
            ) : (
              <ul className="divide-y divide-border/60">
                {workspace.alertHistory.map((r) => (
                  <li key={r.id} className="px-4 py-2.5 text-xs">
                    <div className="flex justify-between">
                      <span>{f.dateTime(r.at)}</span>
                      <Badge tone={r.status === "success" ? "good" : r.status === "failed" ? "critical" : r.status === "skipped" ? "warn" : "neutral"}>{t(`alerts.runStatus.${r.status}`)}</Badge>
                    </div>
                    <div className="mt-0.5 text-subtle">
                      {t(`alerts.origins.${r.origin}`)} · {t("alerts.runSummary", { rules: r.rules, matches: r.matches })}
                    </div>
                    {/* Live runs store a reason code (demo runs keep the snapshot date in `message`). */}
                    {r.origin !== "demo" && r.message && <div className={cn("mt-0.5", r.status === "success" ? "text-subtle" : "text-warn")}>{reasonText(t, r.message)}</div>}
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      )}
      {creating && <RuleDialog preset={creating} onClose={() => setCreating(null)} />}
    </div>
  );
}

export default function AlertsPage() {
  return (
    <Suspense fallback={<Skeleton className="h-96" />}>
      <AlertsInner />
    </Suspense>
  );
}

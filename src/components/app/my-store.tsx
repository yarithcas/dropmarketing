"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { AlertTriangle, CheckCircle2, Link2, Loader2, Pencil, PlugZap, RefreshCw, Search, Unplug } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Dialog } from "@/components/ui/dialog";
import { Input, Select } from "@/components/ui/input";
import { Skeleton, TableSkeleton } from "@/components/ui/skeleton";
import { EmptyState, ErrorState } from "@/components/ui/states";
import { useToast } from "@/components/ui/toast";
import { Tooltip } from "@/components/ui/tooltip";
import { apiFetch, useApi } from "@/lib/client/use-api";
import { errorKey } from "@/lib/client/errors";
import { useFormat } from "@/lib/format";
import { PlanGate, ProvenanceBadge, ScoreBadge, Stat, TrendPill } from "./bits";
import { Sparkline } from "./charts";

interface Connection {
  id: string;
  shop: string;
  status: "connected" | "error" | "revoked";
  lastSyncAt: string | null;
  /** Error code (translated under errors.codes.*), never raw provider text. */
  lastError: string | null;
  scopes: string[];
  /** Beyond the plan's store limit: kept for disconnection, not synced or shown. */
  overLimit: boolean;
}

interface PerformanceRow {
  externalId: string;
  title: string;
  status: string;
  price: number | null;
  currency: string;
  inventory: number | null;
  units30: number;
  unitsPrev30: number;
  revenue30: number;
  change: number | null;
  declining: boolean;
  lowStock: boolean;
  market: { productId: string; name: string; score: number | null; trendGrowth: number | null } | null;
  matchSource: "auto" | "manual";
  stock: { date: string; inventory: number }[];
}

interface ShopifyStatus {
  mode: "live" | "mock";
  configured: boolean;
  allowed: boolean;
  storeLimit: number;
  autoSync: boolean;
  connections: Connection[];
  selectedId: string | null;
  asOf: string | null;
  marketAvailable: boolean;
  missing: string[];
  performance: PerformanceRow[];
}

const DEFAULT_SCOPES = ["read_products", "read_orders", "read_inventory"];

/**
 * Leaves for the Shopify OAuth screen. The returned promise keeps the clicked button loading while the page
 * unloads, and settles if the page is still here: restored from the back/forward cache (pageshow) or after a
 * cancelled navigation (timeout), so the button can be used again.
 */
function startInstall(shop: string) {
  window.location.href = `/api/integrations/shopify/install?shop=${encodeURIComponent(shop.trim())}`;
  return new Promise<void>((resolve) => {
    const done = () => {
      clearTimeout(timer);
      window.removeEventListener("pageshow", done);
      resolve();
    };
    const timer = setTimeout(done, 10_000);
    window.addEventListener("pageshow", done);
  });
}

export function MyStorePanel() {
  const { t } = useTranslation();
  const f = useFormat();
  const toast = useToast();
  // Outcome of the OAuth round trip (install/callback redirect back here).
  const params = useSearchParams();
  const oauthError = params.get("error");
  const oauthConnected = params.get("connected") === "1";
  const connectedShop = params.get("shop");
  const [selected, setSelected] = useState<string | null>(null);
  const { data, error, reload } = useApi<ShopifyStatus>(`/api/integrations/shopify${selected ? `?id=${encodeURIComponent(selected)}` : ""}`);
  const [shop, setShop] = useState("");
  const [busy, setBusy] = useState(false);
  const [installing, setInstalling] = useState(false);
  const [matchFor, setMatchFor] = useState<PerformanceRow | null>(null);
  // After connecting a store, show that store.
  const pickedConnected = useRef(false);
  useEffect(() => {
    if (pickedConnected.current || !data || !connectedShop) return;
    pickedConnected.current = true;
    const c = data.connections.find((x) => x.shop === connectedShop);
    if (c && c.id !== data.selectedId) setSelected(c.id);
  }, [data, connectedShop]);

  if (error) return <ErrorState onRetry={reload} />;
  if (!data)
    return (
      <Card>
        <TableSkeleton />
      </Card>
    );

  const mock = data.mode === "mock";
  const conn = data.connections.find((c) => c.id === data.selectedId) ?? null;
  const declining = data.performance.filter((p) => p.declining);
  const currencies = [...new Set(data.performance.map((p) => p.currency))];
  const revenue = data.performance.reduce((s, p) => s + p.revenue30, 0);
  const canConnectMore = !mock && data.connections.length < data.storeLimit;

  const sync = async (id: string) => {
    setBusy(true);
    try {
      await apiFetch("/api/integrations/shopify/sync", { method: "POST", body: JSON.stringify({ id }) });
      toast(t("shopify.synced"));
    } catch (e) {
      toast(t(errorKey(e)), "error");
    } finally {
      setBusy(false);
      reload(); // the outcome (including a revocation) is recorded on the connection
    }
  };
  const disconnect = async (id: string) => {
    if (!confirm(t("shopify.confirmDisconnect"))) return;
    try {
      await apiFetch("/api/integrations/shopify/disconnect", { method: "POST", body: JSON.stringify({ id }) });
      if (selected === id) setSelected(null);
      toast(t("shopify.disconnected"));
    } catch (e) {
      toast(t(errorKey(e)), "error");
    }
    reload();
  };

  const banner = oauthError ? (
    <div role="alert" className="flex items-start gap-2 rounded-lg border border-critical/30 bg-critical/5 p-3 text-sm text-critical" data-testid="shopify-oauth-error">
      <AlertTriangle className="mt-0.5 size-4 shrink-0" /> {t(errorKey(oauthError))}
    </div>
  ) : oauthConnected ? (
    <div role="status" className="flex items-start gap-2 rounded-lg border border-good/30 bg-good/5 p-3 text-sm text-good">
      <CheckCircle2 className="mt-0.5 size-4 shrink-0" /> {t("shopify.connectedOk")}
    </div>
  ) : null;

  // The plan no longer includes the integration: no data, but stores can still be disconnected.
  if (!data.allowed)
    return (
      <div className="space-y-4">
        {banner}
        <PlanGate feature={t("shopify.title")} allowed={false}>
          {null}
        </PlanGate>
        {!mock && data.connections.length > 0 && (
          <Card>
            <CardHeader title={t("shopify.planEndedTitle")} description={t("shopify.planEndedText")} />
            <ul className="divide-y divide-border/60">
              {data.connections.map((c) => (
                <li key={c.id} className="flex flex-wrap items-center gap-3 px-4 py-3 text-sm">
                  <span className="flex-1 font-medium">{c.shop}</span>
                  <Badge tone={c.status === "connected" ? "neutral" : "critical"}>{t(`shopify.status.${c.status}`)}</Badge>
                  <Button variant="ghost" size="sm" onClick={() => disconnect(c.id)}>
                    <Unplug /> {t("shopify.disconnect")}
                  </Button>
                </li>
              ))}
            </ul>
          </Card>
        )}
      </div>
    );

  return (
    <div className="space-y-4">
      {banner}
      <Card>
        <CardHeader
          title={
            <span className="flex items-center gap-2">
              <PlugZap className="size-4 text-accent" /> {t("shopify.title")}
            </span>
          }
          description={t("shopify.desc")}
          action={<Badge tone={mock ? "demo" : "good"}>{mock ? t("shopify.mockMode") : t("shopify.liveMode")}</Badge>}
        />
        <CardBody className="grid gap-4 lg:grid-cols-2">
          <div className="space-y-3">
            {data.connections.length > 1 && (
              <div className="space-y-1.5">
                <label className="block text-xs font-medium text-muted" htmlFor="shopify-store">
                  {t("shopify.selectStore")}
                </label>
                <Select id="shopify-store" value={data.selectedId ?? ""} onChange={(e) => setSelected(e.target.value)} data-testid="shopify-store-select">
                  {data.connections.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.shop}
                      {c.status !== "connected" ? ` · ${t(`shopify.status.${c.status}`)}` : ""}
                      {c.overLimit ? ` · ${t("shopify.overLimitShort")}` : ""}
                    </option>
                  ))}
                </Select>
              </div>
            )}
            <dl className="space-y-2 text-sm">
              <div className="flex justify-between gap-4">
                <dt className="text-subtle">{t("shopify.connection")}</dt>
                <dd className="flex items-center gap-1.5">
                  {conn ? (
                    conn.status === "connected" ? (
                      <>
                        <CheckCircle2 className="size-4 text-good" /> {t("shopify.connectedTo", { shop: conn.shop })}
                      </>
                    ) : (
                      <>
                        <AlertTriangle className="size-4 text-critical" /> {t(`shopify.status.${conn.status}`)}
                      </>
                    )
                  ) : (
                    t("shopify.notConnected")
                  )}
                </dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt className="text-subtle">{t("shopify.lastSync")}</dt>
                <dd>{conn?.lastSyncAt ? f.dateTime(conn.lastSyncAt) : t("shopify.never")}</dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt className="text-subtle">{t("shopify.syncStatus")}</dt>
                <dd>{conn ? (conn.lastError ? t("shopify.syncFailed") : t("shopify.syncOk")) : "—"}</dd>
              </div>
              {!mock && (
                <div className="flex justify-between gap-4">
                  <dt className="text-subtle">{t("shopify.autoSync")}</dt>
                  <dd>{data.autoSync ? t("shopify.autoSyncDaily") : t("shopify.autoSyncOff")}</dd>
                </div>
              )}
              <div className="flex justify-between gap-4">
                <dt className="text-subtle">{t("shopify.scopes")}</dt>
                <dd className="text-right text-xs">{(conn?.scopes ?? DEFAULT_SCOPES).join(", ")}</dd>
              </div>
            </dl>
            {conn?.status === "revoked" ? (
              <div role="alert" className="space-y-2 rounded-md border border-critical/30 bg-critical/5 p-3 text-xs text-critical" data-testid="shopify-revoked">
                <p>{t("shopify.revokedText", { shop: conn.shop })}</p>
                {!conn.overLimit && (
                  <Button size="sm" onClick={() => startInstall(conn.shop)} data-testid="shopify-reconnect">
                    <Link2 /> {t("shopify.reconnect")}
                  </Button>
                )}
              </div>
            ) : conn?.lastError ? (
              <p className="rounded-md border border-critical/30 bg-critical/5 p-2 text-xs text-critical">{t(errorKey(conn.lastError))}</p>
            ) : null}
            {conn?.overLimit && <p className="rounded-md border border-warn/30 bg-warn/5 p-2 text-xs text-warn">{t("shopify.overLimitText", { max: data.storeLimit })}</p>}
          </div>
          <div className="space-y-3">
            {mock ? (
              <div className="rounded-lg border border-warn/30 bg-warn/5 p-3 text-xs text-warn">
                <p className="font-medium">{t("shopify.mockTitle")}</p>
                <p className="mt-1 text-warn/80">{t("shopify.mockText")}</p>
                {data.missing.length > 0 && <p className="mt-2 font-mono text-[11px]">{data.missing.join(" · ")}</p>}
              </div>
            ) : (
              conn && (
                <div className="flex flex-wrap gap-2">
                  <Button
                    variant="secondary"
                    onClick={() => sync(conn.id)}
                    loading={busy}
                    disabled={conn.status === "revoked" || conn.overLimit}
                    disabledReason={conn.status === "revoked" ? t("shopify.revokedText", { shop: conn.shop }) : t("shopify.overLimitText", { max: data.storeLimit })}
                    data-testid="shopify-sync"
                  >
                    <RefreshCw /> {t("shopify.syncNow")}
                  </Button>
                  <Button variant="ghost" onClick={() => disconnect(conn.id)}>
                    <Unplug /> {t("shopify.disconnect")}
                  </Button>
                </div>
              )
            )}
            {canConnectMore ? (
              <form
                className="space-y-2"
                onSubmit={(e) => {
                  e.preventDefault();
                  if (!shop.trim()) return;
                  setInstalling(true);
                  startInstall(shop).then(() => setInstalling(false));
                }}
              >
                <label className="text-xs text-muted" htmlFor="shop">
                  {data.connections.length ? t("shopify.connectAnother") : t("shopify.shopDomain")}
                </label>
                <div className="flex gap-2">
                  <Input id="shop" value={shop} onChange={(e) => setShop(e.target.value)} placeholder="my-store.myshopify.com" />
                  <Button type="submit" disabled={!shop.trim()} loading={installing} disabledReason={t("shopify.enterDomain")}>
                    <Link2 /> {t("shopify.connect")}
                  </Button>
                </div>
                <p className="text-[11px] text-subtle">{t("shopify.ownStoreOnly")}</p>
              </form>
            ) : (
              !mock && <p className="text-[11px] text-subtle">{t("errors.codes.store_limit")}</p>
            )}
            {!mock && <p className="text-[11px] text-subtle">{t("shopify.storeCount", { n: data.connections.length, max: data.storeLimit })}</p>}
            <p className="text-[11px] text-subtle">{t("shopify.privacy")}</p>
          </div>
        </CardBody>
      </Card>

      {data.performance.length > 0 && (
        <>
          <div className="grid gap-3 sm:grid-cols-3">
            <Stat
              label={t("shopify.revenue30")}
              value={currencies.length === 1 ? f.currency(revenue, currencies[0]) : "—"}
              hint={mock ? t("shopify.mockDataHint") : t("shopify.fromOrders")}
            />
            <Stat label={t("shopify.products")} value={data.performance.length} hint={t("shopify.lowStockCount", { n: data.performance.filter((p) => p.lowStock).length })} />
            <Stat label={t("shopify.declining")} value={declining.length} hint={t("shopify.decliningHint")} />
          </div>
          <Card>
            <CardHeader title={t("shopify.performanceTitle")} description={t("shopify.performanceDesc")} action={<ProvenanceBadge kind={mock ? "demo" : "measured"} />} />
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-border">
                    <th className="table-th">{t("products.product")}</th>
                    <th className="table-th">{t("shopify.status.label")}</th>
                    <th className="table-th">{t("products.price")}</th>
                    <th className="table-th">{t("shopify.inventory")}</th>
                    <th className="table-th">{t("shopify.stockTrend")}</th>
                    <th className="table-th">{t("shopify.units30")}</th>
                    <th className="table-th">{t("shopify.vsPrev")}</th>
                    <th className="table-th">{t("shopify.revenue30")}</th>
                    <th className="table-th">{t("shopify.market")}</th>
                  </tr>
                </thead>
                <tbody>
                  {data.performance.map((p) => (
                    <tr key={p.externalId} className="border-b border-border/50 last:border-0">
                      <td className="table-td">
                        <span className="block max-w-[220px] truncate">{p.title}</span>
                        {p.declining && (
                          <Badge tone="critical" className="mt-1">
                            {t("shopify.decliningBadge")}
                          </Badge>
                        )}
                      </td>
                      <td className="table-td text-xs text-muted">{p.status}</td>
                      <td className="table-td num">{f.currency(p.price, p.currency)}</td>
                      <td className="table-td num">
                        {p.inventory != null ? f.number(p.inventory) : "—"}
                        {p.lowStock && <Badge tone="warn" className="ml-1.5">{t("shopify.lowStock")}</Badge>}
                      </td>
                      <td className="table-td">
                        <StockTrend points={p.stock} />
                      </td>
                      <td className="table-td num">{f.number(p.units30)}</td>
                      <td className="table-td">
                        <TrendPill pct={p.change} />
                      </td>
                      <td className="table-td num">{f.currency(p.revenue30, p.currency)}</td>
                      <td className="table-td">
                        <MarketCell row={p} available={data.marketAvailable} onEdit={() => setMatchFor(p)} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="px-4 pt-3 text-[11px] text-subtle">{t("shopify.matchNote")}</p>
            <p className="px-4 pb-3 pt-1 text-[11px] text-subtle">{t("shopify.compareNote")}</p>
          </Card>
        </>
      )}
      {!mock && data.performance.length === 0 && conn && !conn.overLimit && <EmptyState title={t("shopify.noDataTitle")} description={t("shopify.noDataText")} />}
      {matchFor && conn && (
        <MatchDialog
          row={matchFor}
          connectionId={conn.id}
          onClose={() => setMatchFor(null)}
          onSaved={() => {
            setMatchFor(null);
            reload();
          }}
        />
      )}
    </div>
  );
}

/** 30-day inventory trend from daily snapshots. */
function StockTrend({ points }: { points: { date: string; inventory: number }[] }) {
  const { t } = useTranslation();
  const f = useFormat();
  if (points.length < 2) return <span className="text-xs text-subtle">{t("shopify.noStockHistory")}</span>;
  return (
    <Tooltip content={t("shopify.stockTrendTip", { from: f.number(points[0].inventory), to: f.number(points.at(-1)!.inventory), days: points.length })}>
      <span tabIndex={0} className="focus-ring inline-flex rounded" aria-label={t("shopify.stockTrendTip", { from: f.number(points[0].inventory), to: f.number(points.at(-1)!.inventory), days: points.length })}>
        <Sparkline values={points.map((p) => p.inventory)} className="h-6 w-20" />
      </span>
    </Tooltip>
  );
}

function MarketCell({ row, available, onEdit }: { row: PerformanceRow; available: boolean; onEdit: () => void }) {
  const { t } = useTranslation();
  if (!available)
    return (
      <Tooltip content={t("shopify.noMarketDataTip")}>
        <span className="text-xs text-subtle" tabIndex={0}>
          {t("shopify.noMarketData")}
        </span>
      </Tooltip>
    );
  const manual = row.matchSource === "manual";
  return (
    <div className="flex items-center gap-1.5">
      {row.market ? (
        <Link href={`/app/products/${row.market.productId}`} className="focus-ring tap flex min-w-0 items-center gap-2 rounded text-xs transition-colors hover:text-accent">
          <ScoreBadge score={row.market.score} /> <TrendPill pct={row.market.trendGrowth} />
          <span className="max-w-[140px] truncate text-muted">{row.market.name}</span>
        </Link>
      ) : (
        <span className="text-xs text-subtle">{t("shopify.noMatch")}</span>
      )}
      {(manual || row.market) && (
        <Tooltip content={manual ? t("shopify.matchManualTip") : t("shopify.matchEstimateTip")}>
          <Badge tone={manual ? "accent" : "warn"} tabIndex={0}>
            {manual ? t("shopify.matchManual") : t("shopify.matchEstimate")}
          </Badge>
        </Tooltip>
      )}
      <Button variant="ghost" size="icon-sm" onClick={onEdit} aria-label={t("shopify.editMatch")} title={t("shopify.editMatch")} data-testid="shopify-edit-match">
        <Pencil />
      </Button>
    </div>
  );
}

/** Manual market match: pick a tracked product, "no match", or back to the automatic estimate. */
function MatchDialog({ row, connectionId, onClose, onSaved }: { row: PerformanceRow; connectionId: string; onClose: () => void; onSaved: () => void }) {
  const { t } = useTranslation();
  const toast = useToast();
  const [q, setQ] = useState("");
  const [debounced, setDebounced] = useState("");
  const [saving, setSaving] = useState<string | null>(null);
  useEffect(() => {
    const id = setTimeout(() => setDebounced(q.trim()), 250);
    return () => clearTimeout(id);
  }, [q]);
  // Empty search: suggestions for the product's own title.
  const query = (debounced || row.title).slice(0, 120);
  const { data, loading } = useApi<{ items: { id: string; name: string; category: string }[] }>(`/api/integrations/shopify/match?q=${encodeURIComponent(query)}`);
  const save = async (match: "auto" | "none" | { productId: string }) => {
    if (saving) return;
    setSaving(typeof match === "string" ? match : match.productId);
    try {
      await apiFetch("/api/integrations/shopify/match", { method: "POST", body: JSON.stringify({ id: connectionId, externalId: row.externalId, match }) });
      toast(t("shopify.matchSaved"));
      onSaved();
    } catch (e) {
      toast(t(errorKey(e)), "error");
    } finally {
      setSaving(null);
    }
  };
  return (
    <Dialog
      open
      onClose={onClose}
      title={t("shopify.matchTitle")}
      description={t("shopify.matchDesc", { title: row.title })}
      footer={
        <>
          <Button variant="ghost" onClick={() => save("auto")} loading={saving === "auto"} disabled={Boolean(saving && saving !== "auto") || row.matchSource === "auto"} disabledReason={row.matchSource === "auto" ? t("shopify.matchEstimate") : undefined}>
            {t("shopify.matchAuto")}
          </Button>
          <Button variant="secondary" onClick={() => save("none")} loading={saving === "none"} disabled={Boolean(saving && saving !== "none")}>
            {t("shopify.matchNone")}
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <p className="text-xs text-subtle">
          {t("shopify.matchCurrent")}: <span className="text-fg">{row.market ? row.market.name : t("shopify.noMatch")}</span>{" "}
          <Badge tone={row.matchSource === "manual" ? "accent" : "warn"}>{row.matchSource === "manual" ? t("shopify.matchManual") : t("shopify.matchEstimate")}</Badge>
        </p>
        <div className="relative">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-subtle" />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("shopify.matchSearch")} aria-label={t("shopify.matchSearch")} className="pl-8" />
        </div>
        {loading && !data ? (
          <Skeleton className="h-32" />
        ) : data?.items.length ? (
          <ul className="max-h-72 divide-y divide-border/60 overflow-y-auto rounded-lg border border-border">
            {data.items.map((p) => (
              <li key={p.id}>
                <button
                  type="button"
                  disabled={Boolean(saving)}
                  aria-busy={saving === p.id || undefined}
                  onClick={() => save({ productId: p.id })}
                  className="focus-ring flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-sm transition-colors hover:bg-surface-2 active:bg-surface-3 disabled:opacity-50"
                >
                  <span className="truncate">{p.name}</span>
                  <span className="flex shrink-0 items-center gap-2 text-xs text-subtle">
                    {t(`categories.${p.category}`)}
                    {saving === p.id ? <Loader2 className="size-4 animate-spin" /> : row.market?.productId === p.id && <CheckCircle2 className="size-4 text-good" />}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-subtle">{t("shopify.matchNoResults")}</p>
        )}
      </div>
    </Dialog>
  );
}

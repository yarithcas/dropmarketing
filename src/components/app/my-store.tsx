"use client";

import { useState } from "react";
import Link from "next/link";
import { AlertTriangle, CheckCircle2, Link2, PlugZap, RefreshCw, Unplug } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { TableSkeleton } from "@/components/ui/skeleton";
import { EmptyState, ErrorState } from "@/components/ui/states";
import { useToast } from "@/components/ui/toast";
import { apiFetch, useApi } from "@/lib/client/use-api";
import { useFormat } from "@/lib/format";
import { PlanGate, ProvenanceBadge, ScoreBadge, Stat, TrendPill } from "./bits";

interface ShopifyStatus {
  mode: "live" | "mock";
  configured: boolean;
  allowed: boolean;
  connections: { id: string; shop: string; status: "connected" | "error" | "revoked"; lastSyncAt: string | null; lastError: string | null; scopes: string[] }[];
  asOf: string | null;
  missing: string[];
  performance: {
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
  }[];
}

export function MyStorePanel() {
  const { t } = useTranslation();
  const f = useFormat();
  const toast = useToast();
  const { data, error, loading, reload } = useApi<ShopifyStatus>("/api/integrations/shopify");
  const [shop, setShop] = useState("");
  const [busy, setBusy] = useState(false);

  if (error) return <ErrorState onRetry={reload} />;
  if (loading || !data)
    return (
      <Card>
        <TableSkeleton />
      </Card>
    );

  const conn = data.connections[0];
  const mock = data.mode === "mock";
  const declining = data.performance.filter((p) => p.declining);
  const revenue = data.performance.reduce((s, p) => s + p.revenue30, 0);

  const sync = async () => {
    setBusy(true);
    try {
      await apiFetch("/api/integrations/shopify/sync", { method: "POST" });
      toast(t("shopify.synced"));
      reload();
    } catch (e) {
      toast((e as Error).message || t("errors.generic"), "error");
    } finally {
      setBusy(false);
    }
  };
  const disconnect = async () => {
    if (!conn || !confirm(t("shopify.confirmDisconnect"))) return;
    await apiFetch("/api/integrations/shopify/disconnect", { method: "POST", body: JSON.stringify({ id: conn.id }) }).catch(() => toast(t("errors.generic"), "error"));
    reload();
  };

  return (
    <PlanGate feature={t("shopify.title")} allowed={data.allowed}>
      <div className="space-y-4">
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
              <div className="flex justify-between gap-4">
                <dt className="text-subtle">{t("shopify.scopes")}</dt>
                <dd className="text-right text-xs">{(conn?.scopes ?? ["read_products", "read_orders", "read_inventory"]).join(", ")}</dd>
              </div>
              {conn?.lastError ? <p className="rounded-md border border-critical/30 bg-critical/5 p-2 text-xs text-critical">{conn.lastError}</p> : null}
            </dl>
            <div className="space-y-3">
              {mock ? (
                <div className="rounded-lg border border-warn/30 bg-warn/5 p-3 text-xs text-warn">
                  <p className="font-medium">{t("shopify.mockTitle")}</p>
                  <p className="mt-1 text-warn/80">{t("shopify.mockText")}</p>
                  {data.missing.length > 0 && <p className="mt-2 font-mono text-[11px]">{data.missing.join(" · ")}</p>}
                </div>
              ) : !conn ? (
                <form
                  className="space-y-2"
                  onSubmit={(e) => {
                    e.preventDefault();
                    if (shop.trim()) window.location.href = `/api/integrations/shopify/install?shop=${encodeURIComponent(shop.trim())}`;
                  }}
                >
                  <label className="text-xs text-muted" htmlFor="shop">
                    {t("shopify.shopDomain")}
                  </label>
                  <div className="flex gap-2">
                    <Input id="shop" value={shop} onChange={(e) => setShop(e.target.value)} placeholder="my-store.myshopify.com" />
                    <Button type="submit" disabled={!shop.trim()}>
                      <Link2 /> {t("shopify.connect")}
                    </Button>
                  </div>
                  <p className="text-[11px] text-subtle">{t("shopify.ownStoreOnly")}</p>
                </form>
              ) : (
                <div className="flex flex-wrap gap-2">
                  <Button variant="secondary" onClick={sync} disabled={busy}>
                    <RefreshCw className={busy ? "animate-spin" : ""} /> {t("shopify.syncNow")}
                  </Button>
                  <Button variant="ghost" onClick={disconnect}>
                    <Unplug /> {t("shopify.disconnect")}
                  </Button>
                </div>
              )}
              <p className="text-[11px] text-subtle">{t("shopify.privacy")}</p>
            </div>
          </CardBody>
        </Card>

        {data.performance.length > 0 && (
          <>
            <div className="grid gap-3 sm:grid-cols-3">
              <Stat label={t("shopify.revenue30")} value={f.currency(revenue, "EUR")} hint={mock ? t("shopify.mockDataHint") : t("shopify.fromOrders")} />
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
                          {p.inventory ?? "—"}
                          {p.lowStock && <Badge tone="warn" className="ml-1.5">{t("shopify.lowStock")}</Badge>}
                        </td>
                        <td className="table-td num">{p.units30}</td>
                        <td className="table-td">
                          <TrendPill pct={p.change} />
                        </td>
                        <td className="table-td num">{f.currency(p.revenue30, p.currency)}</td>
                        <td className="table-td">
                          {p.market ? (
                            <Link href={`/app/products/${p.market.productId}`} className="flex items-center gap-2 text-xs hover:text-accent">
                              <ScoreBadge score={p.market.score} /> <TrendPill pct={p.market.trendGrowth} />
                            </Link>
                          ) : (
                            <span className="text-xs text-subtle">{t("shopify.noMatch")}</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="px-4 py-3 text-[11px] text-subtle">{t("shopify.compareNote")}</p>
            </Card>
          </>
        )}
        {!mock && data.performance.length === 0 && conn && <EmptyState title={t("shopify.noDataTitle")} description={t("shopify.noDataText")} />}
      </div>
    </PlanGate>
  );
}

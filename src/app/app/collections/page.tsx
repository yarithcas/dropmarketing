"use client";

import { Suspense, useMemo, useState } from "react";
import Link from "next/link";
import { Columns3, Download, FolderHeart, Megaphone, Package, Pencil, Plus, Store as StoreIcon, Trash2, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { CompetitionBadge, PageHeader, ScoreBadge, Thumb, TrendPill } from "@/components/app/bits";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Dialog } from "@/components/ui/dialog";
import { Field, Input, Textarea } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/ui/states";
import { useSession } from "@/lib/client/session";
import { useApi } from "@/lib/client/use-api";
import { useUrlState } from "@/lib/client/use-url-state";
import { useWorkspace } from "@/lib/client/workspace";
import { useFormat } from "@/lib/format";
import type { ProductWithMetrics } from "@/lib/types";
import type { Collection, CollectionItem } from "@/lib/workspace";
import { cn } from "@/lib/cn";

const TYPE_ICON = { product: Package, ad: Megaphone, store: StoreIcon };
const hrefFor = (i: CollectionItem) => (i.type === "product" ? `/app/products/${i.refId}` : i.type === "ad" ? `/app/creatives?ad=${i.refId}` : `/app/stores/${i.refId}`);

function download(name: string, mime: string, content: string) {
  const blob = new Blob([content], { type: mime });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

const csvCell = (v: unknown) => {
  const s = v == null ? "" : String(v);
  // Neutralise spreadsheet formula injection and quote.
  const safe = /^[=+\-@]/.test(s) ? `'${s}` : s;
  return `"${safe.replace(/"/g, '""')}"`;
};

function ItemRow({ c, item }: { c: Collection; item: CollectionItem }) {
  const { t } = useTranslation();
  const f = useFormat();
  const { dispatch } = useWorkspace();
  const [editing, setEditing] = useState(false);
  const [note, setNote] = useState(item.note);
  const [tags, setTags] = useState(item.tags.join(", "));
  const Icon = TYPE_ICON[item.type];
  return (
    <div className="px-4 py-3" data-testid="collection-item">
      <div className="flex items-start gap-3">
        <span className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg bg-surface-3 text-subtle">
          <Icon className="size-4" />
        </span>
        <div className="min-w-0 flex-1">
          <Link href={hrefFor(item)} className="block truncate text-sm font-medium hover:text-accent">
            {item.label}
          </Link>
          <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-[11px] text-subtle">
            <span>{t(`collections.types.${item.type}`)}</span>·<span>{f.date(item.addedAt.slice(0, 10))}</span>
            {item.tags.map((tag) => (
              <Badge key={tag} className="font-normal">
                #{tag}
              </Badge>
            ))}
          </div>
          {!editing && item.note ? <p className="mt-1.5 whitespace-pre-line text-sm text-muted">{item.note}</p> : null}
          {editing && (
            <div className="mt-2 space-y-2">
              <Textarea value={note} onChange={(e) => setNote(e.target.value)} maxLength={2000} placeholder={t("collections.notePlaceholder")} aria-label={t("collections.note")} />
              <Input value={tags} onChange={(e) => setTags(e.target.value)} placeholder={t("collections.tags")} aria-label={t("collections.tags")} />
              <div className="flex gap-2">
                <Button
                  size="sm"
                  onClick={async () => {
                    const ok = await dispatch({ op: "item.update", collectionId: c.id, id: item.id, note, tags: tags.split(",").map((s) => s.trim()).filter(Boolean) }, t("common.saved"));
                    if (ok) setEditing(false);
                  }}
                >
                  {t("common.save")}
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setEditing(false)}>
                  {t("common.cancel")}
                </Button>
              </div>
            </div>
          )}
        </div>
        <div className="flex shrink-0 gap-1">
          <Button size="icon-sm" variant="ghost" onClick={() => setEditing((e) => !e)} aria-label={t("collections.editNote")}>
            <Pencil />
          </Button>
          <Button size="icon-sm" variant="ghost" onClick={() => dispatch({ op: "item.remove", collectionId: c.id, id: item.id }, t("collections.removed"))} aria-label={t("common.remove")} data-testid="remove-item">
            <Trash2 />
          </Button>
        </div>
      </div>
    </div>
  );
}

function CompareProducts({ ids, onClose }: { ids: string[]; onClose: () => void }) {
  const { t } = useTranslation();
  const f = useFormat();
  const { data } = useApi<{ items: ProductWithMetrics[] }>(`/api/products/batch?ids=${ids.join(",")}`);
  const items = ids.map((id) => data?.items.find((p) => p.id === id)).filter((p): p is ProductWithMetrics => Boolean(p));
  const rows: { label: string; render: (p: ProductWithMetrics) => React.ReactNode }[] = [
    { label: t("score.title"), render: (p) => <ScoreBadge score={p.score.overall} /> },
    { label: t("confidence.title"), render: (p) => t(`confidence.${p.score.confidence}`) },
    { label: t("products.price"), render: (p) => f.currency(p.priceEstimate, p.currency) },
    { label: t("products.margin"), render: (p) => (p.metrics.grossMargin == null ? "—" : f.pct(p.metrics.grossMargin * 100)) },
    { label: t("products.trend30"), render: (p) => <TrendPill pct={p.metrics.trendGrowth} /> },
    { label: t("products.ads"), render: (p) => p.metrics.adsObserved },
    { label: t("product.advertisers"), render: (p) => p.metrics.advertisersObserved },
    { label: t("products.stores"), render: (p) => p.metrics.storesObserved },
    { label: t("products.competition"), render: (p) => <CompetitionBadge level={p.metrics.competition} /> },
    { label: t("products.firstDetected"), render: (p) => f.date(p.firstDetected) },
    ...(["trend", "ads", "margin", "competition", "differentiation", "freshness"] as const).map((k) => ({
      label: t(`score.components.${k}`),
      render: (p: ProductWithMetrics) => p.score.components.find((c) => c.key === k)?.value ?? "—",
    })),
  ];
  return (
    <Dialog open onClose={onClose} title={t("collections.compareTitle")} size="xl">
      {!data ? (
        <Skeleton className="h-64" />
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full" data-testid="compare-products">
            <thead>
              <tr className="border-b border-border">
                <th className="table-th" />
                {items.map((p) => (
                  <th key={p.id} className="table-th normal-case tracking-normal">
                    <Link href={`/app/products/${p.id}`} className="flex items-center gap-2 text-sm font-medium text-fg hover:text-accent">
                      <Thumb category={p.category} hue={p.hue} className="size-8" />
                      <span className="max-w-[160px] whitespace-normal">{p.name}</span>
                    </Link>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.label} className="border-b border-border/50 last:border-0">
                  <td className="table-td text-xs text-subtle">{r.label}</td>
                  {items.map((p) => (
                    <td key={p.id} className="table-td num">
                      {r.render(p)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Dialog>
  );
}

function CollectionsInner() {
  const { t } = useTranslation();
  const { session } = useSession();
  const { ready, workspace, dispatch, persistence } = useWorkspace();
  const url = useUrlState();
  const [creating, setCreating] = useState(false);
  const [renaming, setRenaming] = useState<Collection | null>(null);
  const [name, setName] = useState("");
  const [desc, setDesc] = useState("");
  const [typeFilter, setTypeFilter] = useState<"all" | "product" | "ad" | "store">("all");
  const [compareIds, setCompareIds] = useState<string[]>([]);
  const [comparing, setComparing] = useState(false);
  const selectedId = url.get("c") || workspace.collections[0]?.id;
  const c = workspace.collections.find((x) => x.id === selectedId);
  const items = useMemo(() => (c ? c.items.filter((i) => typeFilter === "all" || i.type === typeFilter) : []), [c, typeFilter]);
  const productIds = (c?.items ?? []).filter((i) => i.type === "product").map((i) => i.refId);
  const canExport = session?.entitlements.exports ?? false;

  const exportCsv = async () => {
    if (!c) return;
    const res = await fetch(`/api/products/batch?ids=${productIds.join(",")}`).then((r) => r.json()).catch(() => ({ items: [] }));
    const byId = new Map<string, ProductWithMetrics>((res.items ?? []).map((p: ProductWithMetrics) => [p.id, p]));
    const header = ["type", "label", "reference", "link", "note", "tags", "added_at", "score", "est_price", "est_gross_margin_pct", "trend_30d_pct", "ads_observed", "data_kind"];
    const lines = c.items.map((i) => {
      const p = i.type === "product" ? byId.get(i.refId) : undefined;
      return [
        i.type,
        i.label,
        i.refId,
        `${location.origin}${hrefFor(i)}`,
        i.note,
        i.tags.join("|"),
        i.addedAt,
        p?.score.overall ?? "",
        p?.priceEstimate ?? "",
        p?.metrics.grossMargin == null ? "" : Math.round(p.metrics.grossMargin * 1000) / 10,
        p?.metrics.trendGrowth ?? "",
        p?.metrics.adsObserved ?? "",
        p?.source.kind ?? (session?.data.mode === "demo" ? "demo" : ""),
      ]
        .map(csvCell)
        .join(",");
    });
    download(`${c.name.replace(/[^\w-]+/g, "_")}.csv`, "text/csv;charset=utf-8", [header.join(","), ...lines].join("\n"));
  };

  if (!ready)
    return (
      <div className="grid gap-4 lg:grid-cols-[280px_1fr]">
        <Skeleton className="h-80 rounded-xl" />
        <Skeleton className="h-80 rounded-xl" />
      </div>
    );

  return (
    <div>
      <PageHeader
        title={t("collections.title")}
        description={t("collections.subtitle")}
        eyebrow={<Badge tone={persistence === "server" ? "good" : "demo"}>{persistence === "server" ? t("collections.syncedAccount") : t("collections.storedBrowser")}</Badge>}
        actions={
          <Button
            onClick={() => {
              setName("");
              setDesc("");
              setCreating(true);
            }}
            data-testid="new-collection"
          >
            <Plus /> {t("collections.new")}
          </Button>
        }
      />
      <div className="grid gap-4 lg:grid-cols-[280px_1fr]">
        <Card className="h-fit">
          <ul className="p-1.5">
            {workspace.collections.map((col) => (
              <li key={col.id}>
                <button
                  onClick={() => url.set({ c: col.id })}
                  className={cn("flex w-full items-center justify-between gap-2 rounded-lg px-3 py-2 text-left text-sm", col.id === selectedId ? "bg-surface-3 text-fg" : "text-muted hover:bg-surface-2")}
                >
                  <span className="truncate">{col.kind === "swipe" ? t("collections.swipeFile") : col.name}</span>
                  <span className="text-xs text-subtle">{col.items.length}</span>
                </button>
              </li>
            ))}
          </ul>
        </Card>
        {!c ? (
          <EmptyState icon={<FolderHeart />} title={t("collections.emptyTitle")} description={t("collections.emptyText")} />
        ) : (
          <Card>
            <CardHeader
              title={c.kind === "swipe" ? t("collections.swipeFile") : c.name}
              description={c.description || (c.kind === "swipe" ? t("collections.swipeDesc") : undefined)}
              action={
                <div className="flex flex-wrap gap-1.5">
                  <Button size="sm" variant="secondary" disabled={compareIds.length < 2} onClick={() => setComparing(true)} data-testid="compare-products-btn">
                    <Columns3 /> {t("collections.compare", { n: compareIds.length })}
                  </Button>
                  <Button size="sm" variant="secondary" onClick={exportCsv} disabled={!canExport || !c.items.length} title={canExport ? undefined : t("billing.exportLocked")} data-testid="export-csv">
                    <Download /> CSV
                  </Button>
                  <Button
                    size="sm"
                    variant="secondary"
                    disabled={!canExport || !c.items.length}
                    onClick={() => download(`${c.name.replace(/[^\w-]+/g, "_")}.json`, "application/json", JSON.stringify({ exportedAt: new Date().toISOString(), collection: c }, null, 2))}
                  >
                    <Download /> JSON
                  </Button>
                  {c.kind !== "swipe" && (
                    <Button
                      size="icon-sm"
                      variant="ghost"
                      aria-label={t("collections.rename")}
                      onClick={() => {
                        setName(c.name);
                        setDesc(c.description);
                        setRenaming(c);
                      }}
                    >
                      <Pencil />
                    </Button>
                  )}
                  <Button
                    size="icon-sm"
                    variant="ghost"
                    aria-label={t("collections.delete")}
                    onClick={() => confirm(t("collections.confirmDelete", { name: c.name })) && dispatch({ op: "collection.delete", id: c.id }, t("collections.deleted"))}
                  >
                    <Trash2 />
                  </Button>
                </div>
              }
            />
            <div className="flex flex-wrap items-center gap-2 border-b border-border/70 px-4 py-2">
              {(["all", "product", "ad", "store"] as const).map((ty) => (
                <button key={ty} onClick={() => setTypeFilter(ty)} className={cn("rounded-md px-2 py-1 text-xs", typeFilter === ty ? "bg-surface-3 text-fg" : "text-subtle hover:text-fg")}>
                  {ty === "all" ? t("common.all") : t(`collections.types.${ty}`)}
                </button>
              ))}
              {productIds.length > 1 && <span className="ml-auto text-[11px] text-subtle">{t("collections.compareHint")}</span>}
            </div>
            {items.length === 0 ? (
              <CardBody>
                <EmptyState title={t("collections.noItems")} description={t("collections.noItemsText")} action={<Link href="/app/products" className="text-sm text-accent hover:underline">{t("nav.products")}</Link>} />
              </CardBody>
            ) : (
              <ul className="divide-y divide-border/60">
                {items.map((item) => (
                  <li key={item.id} className="flex items-start">
                    {item.type === "product" ? (
                      <label className="pl-4 pt-5">
                        <span className="sr-only">{t("collections.selectCompare")}</span>
                        <input
                          type="checkbox"
                          className="accent-[rgb(var(--accent))]"
                          checked={compareIds.includes(item.refId)}
                          disabled={!compareIds.includes(item.refId) && compareIds.length >= 4}
                          onChange={() => setCompareIds((ids) => (ids.includes(item.refId) ? ids.filter((x) => x !== item.refId) : [...ids, item.refId]))}
                        />
                      </label>
                    ) : (
                      <span className="w-[29px]" />
                    )}
                    <div className="min-w-0 flex-1">
                      <ItemRow c={c} item={item} />
                    </div>
                  </li>
                ))}
              </ul>
            )}
            {!canExport && <p className="border-t border-border/70 px-4 py-2.5 text-[11px] text-subtle">{t("billing.exportLocked")}</p>}
            <p className="border-t border-border/70 px-4 py-2.5 text-[11px] text-subtle">{t("collections.exportNote")}</p>
          </Card>
        )}
      </div>

      <Dialog
        open={creating || Boolean(renaming)}
        onClose={() => {
          setCreating(false);
          setRenaming(null);
        }}
        title={renaming ? t("collections.rename") : t("collections.new")}
        footer={
          <>
            <Button
              variant="ghost"
              onClick={() => {
                setCreating(false);
                setRenaming(null);
              }}
            >
              <X /> {t("common.cancel")}
            </Button>
            <Button
              disabled={!name.trim()}
              data-testid="create-collection"
              onClick={async () => {
                const ok = renaming
                  ? await dispatch({ op: "collection.update", id: renaming.id, name: name.trim(), description: desc }, t("common.saved"))
                  : await dispatch({ op: "collection.create", name: name.trim(), description: desc, kind: "standard" }, t("collections.created"));
                if (ok) {
                  setCreating(false);
                  setRenaming(null);
                }
              }}
            >
              {renaming ? t("common.save") : t("common.create")}
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          <Field label={t("collections.name")} htmlFor="col-name">
            <Input id="col-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={160} />
          </Field>
          <Field label={t("collections.description")} htmlFor="col-desc">
            <Textarea id="col-desc" value={desc} onChange={(e) => setDesc(e.target.value)} maxLength={500} />
          </Field>
        </div>
      </Dialog>
      {comparing && <CompareProducts ids={compareIds} onClose={() => setComparing(false)} />}
    </div>
  );
}

export default function CollectionsPage() {
  return (
    <Suspense fallback={<Skeleton className="h-96" />}>
      <CollectionsInner />
    </Suspense>
  );
}

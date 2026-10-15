"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Hash, Loader2, Megaphone, Package, Search, Store as StoreIcon, TrendingUp, UserRound, type LucideIcon } from "lucide-react";
import { TrendPill } from "./bits";
import { useTranslation } from "react-i18next";
import { apiFetch } from "@/lib/client/use-api";
import { cn } from "@/lib/cn";

export interface SearchResults {
  products: { id: string; name: string; category: string; score: number | null }[];
  advertisers: { name: string; ads: number }[];
  ads: { id: string; advertiser: string; headline: string; platform: string }[];
  stores: { id: string; name: string; domain: string }[];
  niches: { kind: "category" | "tag"; value: string; products: number; growth?: number | null }[];
}

export interface SearchLink {
  group: string;
  href: string;
  label: string;
  meta: string;
  icon: LucideIcon;
  /** Only set for category niches: 30-day growth (null when history is insufficient). */
  growth?: number | null;
}

export function searchLinks(r: SearchResults): SearchLink[] {
  return [
    ...r.products.map((p) => ({ group: "products", href: `/app/products/${p.id}`, label: p.name, meta: p.category, icon: Package })),
    ...r.niches.map((n) => ({
      group: "niches",
      // Categories open the trend view (growth, emerging/declining products); tags open matching products.
      href: n.kind === "category" ? `/app/trends?category=${n.value}` : `/app/products?q=${encodeURIComponent(n.value)}`,
      label: n.value,
      meta: String(n.products),
      icon: n.kind === "category" ? TrendingUp : Hash,
      growth: n.kind === "category" ? (n.growth ?? null) : undefined,
    })),
    ...r.advertisers.map((a) => ({ group: "advertisers", href: `/app/ads?advertiser=${encodeURIComponent(a.name)}`, label: a.name, meta: String(a.ads), icon: UserRound })),
    ...r.ads.map((a) => ({ group: "ads", href: `/app/creatives?ad=${a.id}`, label: a.headline, meta: a.advertiser, icon: Megaphone })),
    ...r.stores.map((s) => ({ group: "stores", href: `/app/stores/${s.id}`, label: s.name, meta: s.domain, icon: StoreIcon })),
  ];
}

export function GlobalSearch() {
  const { t } = useTranslation();
  const router = useRouter();
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState<SearchResults | null>(null);
  const [active, setActive] = useState(-1);
  const input = useRef<HTMLInputElement>(null);
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.key === "k" && (e.metaKey || e.ctrlKey)) || (e.key === "/" && !["INPUT", "TEXTAREA", "SELECT"].includes((e.target as HTMLElement).tagName))) {
        e.preventDefault();
        input.current?.focus();
      }
    };
    const onClick = (e: MouseEvent) => !box.current?.contains(e.target as Node) && setOpen(false);
    document.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onClick);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", onClick);
    };
  }, []);

  useEffect(() => {
    if (q.trim().length < 2) {
      setResults(null);
      return;
    }
    const c = new AbortController();
    const timer = setTimeout(() => {
      setLoading(true);
      apiFetch<SearchResults>(`/api/search?q=${encodeURIComponent(q.trim())}`, { signal: c.signal })
        .then((r) => {
          setResults(r);
          setActive(-1);
        })
        .catch(() => {})
        .finally(() => setLoading(false));
    }, 180);
    return () => {
      clearTimeout(timer);
      c.abort();
    };
  }, [q]);

  const links = results ? searchLinks(results) : [];
  const go = (href: string) => {
    setOpen(false);
    router.push(href);
  };

  return (
    <div ref={box} className="relative w-full max-w-xl">
      <form
        role="search"
        onSubmit={(e) => {
          e.preventDefault();
          if (active >= 0 && links[active]) go(links[active].href);
          else if (q.trim()) go(`/app/search?q=${encodeURIComponent(q.trim())}`);
        }}
      >
        <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-subtle" />
        <input
          ref={input}
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") {
              e.preventDefault();
              setActive((a) => Math.min(links.length - 1, a + 1));
            } else if (e.key === "ArrowUp") {
              e.preventDefault();
              setActive((a) => Math.max(-1, a - 1));
            } else if (e.key === "Escape") setOpen(false);
          }}
          placeholder={t("search.placeholder")}
          aria-label={t("search.placeholder")}
          className="focus-ring h-9 w-full rounded-lg border border-border bg-surface-2 pl-9 pr-16 text-sm placeholder:text-subtle"
          data-testid="global-search"
        />
        <kbd className="pointer-events-none absolute right-2.5 top-1/2 hidden -translate-y-1/2 rounded border border-border bg-surface-3 px-1.5 py-0.5 text-[10px] text-subtle sm:block">⌘K</kbd>
      </form>
      {open && q.trim().length >= 2 && (
        <div className="absolute left-0 right-0 top-11 z-50 max-h-[70vh] overflow-y-auto rounded-xl border border-border bg-surface shadow-2xl">
          {loading && !results ? (
            <div className="flex items-center gap-2 p-4 text-sm text-subtle">
              <Loader2 className="size-4 animate-spin" /> {t("common.loading")}
            </div>
          ) : links.length === 0 ? (
            <div className="p-4 text-sm text-subtle">{t("search.noResults", { q })}</div>
          ) : (
            <ul className="py-1">
              {links.map((l, i) => {
                const first = i === 0 || links[i - 1].group !== l.group;
                const Icon = l.icon;
                return (
                  <li key={`${l.group}-${l.href}`}>
                    {first && <div className="label px-3 pb-1 pt-2">{t(`search.groups.${l.group}`)}</div>}
                    <Link
                      href={l.href}
                      onClick={() => setOpen(false)}
                      className={cn("flex items-center gap-2.5 px-3 py-2 text-sm hover:bg-surface-2", active === i && "bg-surface-2")}
                    >
                      <Icon className="size-4 shrink-0 text-subtle" />
                      <span className="truncate">{l.group === "niches" && l.label in CATEGORY_HINT ? t(`categories.${l.label}`) : l.label}</span>
                      {l.growth !== undefined ? (
                        <TrendPill pct={l.growth} className="ml-auto shrink-0" />
                      ) : (
                        <span className="ml-auto shrink-0 truncate text-xs text-subtle">{l.group === "products" ? t(`categories.${l.meta}`) : l.meta}</span>
                      )}
                    </Link>
                  </li>
                );
              })}
              <li className="border-t border-border">
                <Link href={`/app/search?q=${encodeURIComponent(q.trim())}`} onClick={() => setOpen(false)} className="block px-3 py-2 text-sm text-accent transition-colors hover:bg-surface-2 active:bg-surface-3">
                  {t("search.seeAll", { q: q.trim() })}
                </Link>
              </li>
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

const CATEGORY_HINT: Record<string, true> = {
  fitness: true, home: true, kitchen: true, beauty: true, pets: true, tech: true, outdoor: true, baby: true, fashion: true, wellness: true, auto: true, office: true,
};

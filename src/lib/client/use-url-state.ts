"use client";

import { useCallback, useMemo } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

/** URL-backed filter state: filters are shareable and survive reloads. */
export function useUrlState() {
  const sp = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();

  const get = useCallback((k: string) => sp.get(k) ?? "", [sp]);
  const getList = useCallback((k: string) => (sp.get(k) ?? "").split(",").filter(Boolean), [sp]);

  const set = useCallback(
    (patch: Record<string, string | string[] | null | undefined>, opts: { resetPage?: boolean } = { resetPage: true }) => {
      const next = new URLSearchParams(sp.toString());
      for (const [k, v] of Object.entries(patch)) {
        const val = Array.isArray(v) ? v.join(",") : v;
        if (val == null || val === "") next.delete(k);
        else next.set(k, val);
      }
      if (opts.resetPage && !("page" in patch)) next.delete("page");
      const s = next.toString();
      router.replace(s ? `${pathname}?${s}` : pathname, { scroll: false });
    },
    [sp, router, pathname],
  );

  const toggle = useCallback(
    (k: string, value: string) => {
      const cur = getList(k);
      set({ [k]: cur.includes(value) ? cur.filter((x) => x !== value) : [...cur, value] });
    },
    [getList, set],
  );

  const query = useMemo(() => sp.toString(), [sp]);
  return { get, getList, set, toggle, query, params: sp };
}

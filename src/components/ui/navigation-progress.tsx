"use client";

import { Suspense, useEffect, useState } from "react";
import { usePathname, useSearchParams } from "next/navigation";

export const NAV_START_EVENT = "th:navigation-start";

/**
 * Thin top bar shown from the moment an internal link is clicked until the new route renders, so slow
 * server navigations still give immediate feedback. Purely visual (aria-hidden); respects reduced motion.
 */
function Progress() {
  const pathname = usePathname();
  const search = useSearchParams();
  const [pending, setPending] = useState(false);

  useEffect(() => setPending(false), [pathname, search]);

  useEffect(() => {
    if (!pending) return;
    // Safety net for a navigation that never completes (cancelled, blocked): never spin forever.
    const id = setTimeout(() => setPending(false), 8_000);
    return () => clearTimeout(id);
  }, [pending]);

  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const a = (e.target as Element | null)?.closest?.("a[href]") as HTMLAnchorElement | null;
      if (!a || a.target === "_blank" || a.hasAttribute("download")) return;
      const url = new URL(a.href, location.href);
      if (url.origin !== location.origin || url.pathname.startsWith("/api/")) return;
      if (url.pathname === location.pathname && url.search === location.search) return; // same page / hash link
      setPending(true);
    };
    // Programmatic navigations (clickable cards and rows) announce themselves with this event.
    const onStart = () => setPending(true);
    // Capture phase: next/link calls preventDefault() on its own clicks before a bubbling listener would see them.
    document.addEventListener("click", onClick, true);
    window.addEventListener(NAV_START_EVENT, onStart);
    return () => {
      document.removeEventListener("click", onClick, true);
      window.removeEventListener(NAV_START_EVENT, onStart);
    };
  }, []);

  if (!pending) return null;
  return (
    <div aria-hidden className="pointer-events-none fixed inset-x-0 top-0 z-[300] h-0.5 overflow-hidden" data-testid="nav-progress">
      <div className="h-full w-1/3 animate-nav-progress rounded-full bg-gradient-to-r from-accent to-accent-2 motion-reduce:w-full motion-reduce:animate-none motion-reduce:opacity-70" />
    </div>
  );
}

export function NavigationProgress() {
  return (
    <Suspense fallback={null}>
      <Progress />
    </Suspense>
  );
}

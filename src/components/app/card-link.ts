"use client";

import { useCallback } from "react";
import { useRouter } from "next/navigation";
import type { MouseEvent } from "react";
import { NAV_START_EVENT } from "@/components/ui/navigation-progress";

/** Clicks on these keep their own behaviour inside a clickable card or row. */
const NESTED_INTERACTIVE = "a,button,input,select,textarea,label,video,audio,iframe,summary,[role=button],[role=tab],[role=checkbox],[role=link],[role=menuitem],[data-card-ignore]";

/**
 * Makes a whole card or table row open `href` on click while nested links, buttons, inputs and media keep
 * working. It complements, never replaces, a real <Link> inside the card (keyboard users and screen readers use
 * that link). Ctrl/Cmd/middle click opens a new tab; selecting text does not navigate.
 */
export function useCardNavigation() {
  const router = useRouter();
  return useCallback(
    (href: string) => {
      const go = (e: MouseEvent<HTMLElement>) => {
        if (e.defaultPrevented) return;
        const target = e.target as HTMLElement;
        // Events from portals (dialogs opened from the card) bubble through React but are not inside the card.
        if (!e.currentTarget.contains(target)) return;
        const nested = target.closest(NESTED_INTERACTIVE);
        if (nested && e.currentTarget.contains(nested) && nested !== e.currentTarget) return;
        if (window.getSelection()?.toString()) return;
        if (e.metaKey || e.ctrlKey || e.shiftKey || e.button === 1) {
          window.open(href, "_blank", "noopener");
          return;
        }
        window.dispatchEvent(new Event(NAV_START_EVENT));
        router.push(href);
      };
      return {
        onClick: go,
        onAuxClick: (e: MouseEvent<HTMLElement>) => {
          if (e.button === 1) go(e);
        },
        onMouseEnter: () => router.prefetch(href),
        "data-card-href": href,
      };
    },
    [router],
  );
}

import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

/**
 * Lightweight accessible tooltip (hover + keyboard focus). Inside a clickable card or row, a tap on the trigger
 * reveals the tooltip instead of opening the card (`data-card-ignore`).
 */
export function Tooltip({ content, children, side = "top", className }: { content: ReactNode; children: ReactNode; side?: "top" | "bottom"; className?: string }) {
  return (
    <span data-card-ignore className={cn("group/tt relative inline-flex", className)}>
      {children}
      <span
        role="tooltip"
        className={cn(
          "pointer-events-none absolute left-1/2 z-50 w-max max-w-[260px] -translate-x-1/2 rounded-md border border-border bg-surface-3 px-2.5 py-1.5 text-left text-xs font-normal normal-case leading-snug tracking-normal text-fg opacity-0 shadow-xl transition-opacity duration-150 group-focus-within/tt:opacity-100 group-hover/tt:opacity-100",
          side === "top" ? "bottom-full mb-1.5" : "top-full mt-1.5",
        )}
      >
        {content}
      </span>
    </span>
  );
}

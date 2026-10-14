"use client";

import { Check } from "lucide-react";
import { cn } from "@/lib/cn";

/** Toggle chip used for multi-select filters. */
export function Chip({ active, onClick, children, className }: { active: boolean; onClick: () => void; children: React.ReactNode; className?: string }) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={cn(
        "focus-ring inline-flex h-7 items-center gap-1 rounded-md border px-2 text-xs font-medium transition-colors",
        active ? "border-accent/50 bg-accent/15 text-fg" : "border-border bg-surface-2 text-muted hover:text-fg",
        className,
      )}
    >
      {active ? <Check className="size-3 text-accent" /> : null}
      {children}
    </button>
  );
}

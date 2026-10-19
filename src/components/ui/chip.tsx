"use client";

import { Check } from "lucide-react";
import { cn } from "@/lib/cn";

/** Toggle chip used for multi-select filters. */
export function Chip({ active, onClick, children, className, disabled, title }: { active: boolean; onClick: () => void; children: React.ReactNode; className?: string; disabled?: boolean; title?: string }) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      disabled={disabled}
      title={title}
      className={cn(
        "focus-ring tap inline-flex h-7 select-none items-center gap-1 rounded-md border px-2 text-xs font-medium transition-[color,background-color,border-color,transform] duration-150 ease-out press:scale-95 disabled:cursor-not-allowed disabled:opacity-50 motion-reduce:press:scale-100",
        active ? "border-accent/50 bg-accent/15 text-fg hov:border-accent/70 hov:bg-accent/20" : "border-border bg-surface-2 text-muted hov:border-muted/40 hov:bg-surface-3 hov:text-fg",
        className,
      )}
    >
      {active ? <Check className="size-3 text-accent" /> : null}
      {children}
    </button>
  );
}

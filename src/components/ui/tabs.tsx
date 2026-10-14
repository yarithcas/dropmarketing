"use client";

import { cn } from "@/lib/cn";

export function Tabs<T extends string>({ value, onChange, items, className }: { value: T; onChange: (v: T) => void; items: { value: T; label: string; count?: number }[]; className?: string }) {
  return (
    <div role="tablist" className={cn("inline-flex items-center gap-0.5 rounded-lg border border-border bg-surface-2 p-0.5", className)}>
      {items.map((it) => (
        <button
          key={it.value}
          role="tab"
          aria-selected={value === it.value}
          onClick={() => onChange(it.value)}
          className={cn(
            "focus-ring rounded-md px-3 py-1.5 text-[13px] font-medium transition-colors",
            value === it.value ? "bg-surface-3 text-fg shadow-sm" : "text-subtle hover:text-fg",
          )}
        >
          {it.label}
          {it.count != null ? <span className="ml-1.5 text-subtle">{it.count}</span> : null}
        </button>
      ))}
    </div>
  );
}

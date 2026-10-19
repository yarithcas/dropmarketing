"use client";

import { cn } from "@/lib/cn";

export function Tabs<T extends string>({ value, onChange, items, className }: { value: T; onChange: (v: T) => void; items: { value: T; label: string; count?: number }[]; className?: string }) {
  return (
    <div role="tablist" className={cn("inline-flex items-center gap-0.5 rounded-lg border border-border bg-surface-2 p-0.5", className)}>
      {items.map((it) => {
        const selected = value === it.value;
        return (
          <button
            key={it.value}
            type="button"
            role="tab"
            aria-selected={selected}
            onClick={() => onChange(it.value)}
            className={cn(
              "focus-ring tap select-none rounded-md px-3 py-1.5 text-[13px] font-medium transition-[color,background-color,box-shadow,transform] duration-150 ease-out press:scale-[0.97] motion-reduce:press:scale-100",
              selected ? "bg-surface-3 text-fg shadow-sm" : "text-subtle hov:bg-surface-3/60 hov:text-fg",
            )}
          >
            {it.label}
            {it.count != null ? <span className={cn("ml-1.5 tabular-nums", selected ? "text-muted" : "text-subtle")}>{it.count}</span> : null}
          </button>
        );
      })}
    </div>
  );
}

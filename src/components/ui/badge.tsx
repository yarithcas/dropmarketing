import type { HTMLAttributes } from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/cn";

const badgeVariants = cva("inline-flex items-center gap-1 whitespace-nowrap rounded-md border px-1.5 py-0.5 text-[11px] font-medium leading-none [&_svg]:size-3", {
  variants: {
    tone: {
      neutral: "border-border bg-surface-2 text-muted",
      accent: "border-accent/30 bg-accent/10 text-[#aab2ff]",
      purple: "border-accent-2/30 bg-accent-2/10 text-[#d3a9ff]",
      good: "border-good/30 bg-good/10 text-[#5fd35f]",
      warn: "border-warn/30 bg-warn/10 text-warn",
      serious: "border-serious/30 bg-serious/10 text-serious",
      critical: "border-critical/40 bg-critical/10 text-[#f07a7a]",
      demo: "border-warn/40 bg-warn/10 text-warn",
    },
  },
  defaultVariants: { tone: "neutral" },
});

export interface BadgeProps extends HTMLAttributes<HTMLSpanElement>, VariantProps<typeof badgeVariants> {}

export function Badge({ className, tone, ...props }: BadgeProps) {
  return <span className={cn(badgeVariants({ tone }), className)} {...props} />;
}

"use client";

import { forwardRef, useCallback, useEffect, useRef, useState, type ButtonHTMLAttributes, type MouseEvent } from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { Loader2 } from "lucide-react";
import { cn } from "@/lib/cn";

/**
 * Shared look for buttons and button-styled links. `hov:`/`press:` never apply to disabled, aria-disabled or
 * busy controls; `tap` grows the hit area to 40px on touch screens without changing layout. Press feedback is a
 * colour change: scaling a wide button moves its edges, so a press near them would release outside and lose the
 * click. Only icon buttons, whose edges barely move, also shrink.
 */
export const buttonVariants = cva(
  "focus-ring tap inline-flex select-none items-center justify-center gap-2 whitespace-nowrap rounded-lg text-sm font-medium transition-[color,background-color,border-color,box-shadow,transform,opacity] duration-150 ease-out disabled:cursor-not-allowed disabled:opacity-50 aria-disabled:cursor-not-allowed aria-disabled:opacity-50 aria-busy:cursor-progress [&_svg]:size-4 [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        primary:
          "bg-accent text-white shadow-[0_0_0_1px_rgb(255_255_255/0.08)_inset,0_8px_24px_-8px_rgb(var(--accent)/0.6)] hov:bg-accent/90 hov:shadow-[0_0_0_1px_rgb(255_255_255/0.12)_inset,0_10px_28px_-8px_rgb(var(--accent)/0.8)] press:bg-accent/80",
        secondary: "border border-border bg-surface-2 text-fg hov:border-muted/40 hov:bg-surface-3 press:bg-surface-3/70",
        ghost: "text-muted hov:bg-surface-2 hov:text-fg press:bg-surface-3",
        outline: "border border-border text-fg hov:border-muted/40 hov:bg-surface-2 press:bg-surface-3",
        danger: "bg-critical/90 text-white hov:bg-critical press:bg-critical/80",
        link: "h-auto px-0 text-accent underline-offset-4 hov:underline press:opacity-80",
      },
      size: {
        sm: "h-8 px-3 text-[13px]",
        md: "h-9 px-4",
        lg: "h-11 px-6 text-[15px]",
        icon: "h-9 w-9 shrink-0 press:scale-95 motion-reduce:press:scale-100",
        "icon-sm": "h-8 w-8 shrink-0 press:scale-95 motion-reduce:press:scale-100",
      },
    },
    defaultVariants: { variant: "primary", size: "md" },
  },
);

export interface ButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, "onClick">, VariantProps<typeof buttonVariants> {
  /** Shows a spinner, sets aria-busy and ignores clicks. Set automatically while an async onClick is pending. */
  loading?: boolean;
  /** Why the control is disabled; shown as a tooltip (title) and announced as its description. */
  disabledReason?: string;
  /** May return a promise: the button then shows its loading state until it settles. */
  onClick?: (e: MouseEvent<HTMLButtonElement>) => unknown;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, type = "button", loading, disabledReason, onClick, disabled, title, children, ...props }, ref) => {
    const [pending, setPending] = useState(false);
    const mounted = useRef(true);
    useEffect(() => {
      mounted.current = true;
      return () => {
        mounted.current = false;
      };
    }, []);
    const busy = Boolean(loading || pending);
    const handleClick = useCallback(
      (e: MouseEvent<HTMLButtonElement>) => {
        if (busy) {
          e.preventDefault();
          return;
        }
        const r = onClick?.(e);
        if (r && typeof (r as PromiseLike<unknown>).then === "function") {
          setPending(true);
          Promise.resolve(r).finally(() => mounted.current && setPending(false));
        }
      },
      [busy, onClick],
    );
    const iconOnly = size === "icon" || size === "icon-sm";
    // Icon-only buttons get their accessible name as a native tooltip too.
    const tip = disabled && disabledReason ? disabledReason : title ?? (iconOnly ? props["aria-label"] : undefined);
    return (
      <button
        ref={ref}
        type={type}
        className={cn(buttonVariants({ variant, size }), busy && "[&>svg:not([data-spinner])]:hidden", className)}
        disabled={disabled}
        aria-busy={busy || undefined}
        title={tip}
        onClick={handleClick}
        {...props}
      >
        {busy ? <Loader2 data-spinner className="animate-spin" aria-hidden /> : null}
        {children}
      </button>
    );
  },
);
Button.displayName = "Button";

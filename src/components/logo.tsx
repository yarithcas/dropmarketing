import { cn } from "@/lib/cn";

/** TrendHunter mark: a target reticle with a rising trend line breaking out of it. */
export function LogoMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" className={cn("size-7", className)} aria-hidden>
      <defs>
        <linearGradient id="th-g" x1="0" y1="0" x2="32" y2="32" gradientUnits="userSpaceOnUse">
          <stop stopColor="#6370ff" />
          <stop offset="1" stopColor="#a855f7" />
        </linearGradient>
      </defs>
      <rect x="1" y="1" width="30" height="30" rx="8" fill="url(#th-g)" />
      <circle cx="15" cy="17" r="8" fill="none" stroke="white" strokeOpacity=".35" strokeWidth="1.6" />
      <circle cx="15" cy="17" r="3.2" fill="none" stroke="white" strokeOpacity=".55" strokeWidth="1.6" />
      <path d="M6.5 21.5 12 16l3.5 3 9-9.5" fill="none" stroke="white" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M19.5 9.5h5.5V15" fill="none" stroke="white" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function Logo({ className, compact = false }: { className?: string; compact?: boolean }) {
  return (
    <span className={cn("inline-flex items-center gap-2", className)}>
      <LogoMark />
      {!compact && (
        <span className="text-[15px] font-semibold tracking-tight text-fg">
          Trend<span className="gradient-text">Hunter</span>
        </span>
      )}
    </span>
  );
}

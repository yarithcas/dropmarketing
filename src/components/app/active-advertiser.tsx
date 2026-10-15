"use client";

import { useId } from "react";
import { BadgeCheck, UsersRound } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/states";
import { useFormat } from "@/lib/format";
import { DEFAULT_THRESHOLDS, type AdvertiserActivity, type AdvertiserThresholds } from "@/lib/advertisers";
import { cn } from "@/lib/cn";

/** "Active advertiser" badge (lib/advertisers.ts), with the counts that make the advertiser qualify. */
export function ActiveAdvertiserBadge({ activity, className, focusable = true }: { activity?: AdvertiserActivity | null; className?: string; focusable?: boolean }) {
  const { t } = useTranslation();
  const f = useFormat();
  const tipId = useId();
  if (!activity?.qualifies) return null;
  const tip = t("activeAdvertisers.badgeTip", { count: activity.activeSinceMinDays, days: activity.minDays });
  // Left-aligned tooltip (hover + keyboard focus): the badge often sits at the left edge of a clipped card.
  // data-card-ignore: inside a clickable card a tap shows the explanation instead of opening the ad.
  return (
    <span className="group/aa relative inline-flex" data-card-ignore>
      <Badge tone="good" tabIndex={focusable ? 0 : undefined} className={cn("focus-ring", focusable && "cursor-help", className)} aria-describedby={tipId} data-testid="active-advertiser-badge">
        <BadgeCheck /> {t("activeAdvertisers.badge")}
      </Badge>
      <span
        id={tipId}
        role="tooltip"
        className="pointer-events-none absolute bottom-full left-0 z-50 mb-1.5 w-max max-w-[240px] rounded-md border border-border bg-surface-3 px-2.5 py-1.5 text-left text-xs font-normal normal-case leading-snug tracking-normal text-fg opacity-0 shadow-xl transition-opacity duration-150 group-focus-within/aa:opacity-100 group-hover/aa:opacity-100"
      >
        <span className="block font-medium">{tip}</span>
        {activity.oldestActiveFirstSeen ? (
          <span className="block text-subtle">{t("activeAdvertisers.badgeDetail", { active: activity.activeAds, date: f.date(activity.oldestActiveFirstSeen) })}</span>
        ) : null}
      </span>
    </span>
  );
}

/** Compact, non-focusable flag for advertiser lists inside links (global search); the explanation is in the title. */
export function ActiveAdvertiserFlag({ count, days, className }: { count: number; days: number; className?: string }) {
  const { t } = useTranslation();
  return (
    <Badge tone="good" className={cn("shrink-0", className)} title={t("activeAdvertisers.badgeTip", { count, days })} data-testid="active-advertiser-flag">
      <BadgeCheck /> {t("activeAdvertisers.badge")}
    </Badge>
  );
}

/** On/off switch of the active-advertiser rule ("Active advertisers only — ≥ 5 active ads for ≥ 7 days"). */
export function ActiveAdvertisersSwitch({
  checked,
  onChange,
  thresholds = DEFAULT_THRESHOLDS,
  className,
  testId = "active-advertisers-toggle",
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  thresholds?: AdvertiserThresholds;
  className?: string;
  testId?: string;
}) {
  const { t } = useTranslation();
  return (
    <label className={cn("inline-flex cursor-pointer items-center gap-2 text-sm text-fg", className)}>
      <input
        type="checkbox"
        role="switch"
        aria-checked={checked}
        className="size-4 accent-[rgb(var(--accent))]"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        data-testid={testId}
      />
      <span>{t("activeAdvertisers.toggle", { ads: thresholds.minAds, days: thresholds.minDays })}</span>
    </label>
  );
}

/** Empty state when no ad of an active advertiser matches: explains the rule, one click shows every ad. */
export function ActiveAdvertisersEmpty({ thresholds = DEFAULT_THRESHOLDS, onShowAll, className }: { thresholds?: AdvertiserThresholds; onShowAll: () => void; className?: string }) {
  const { t } = useTranslation();
  return (
    <EmptyState
      className={className}
      icon={<UsersRound />}
      title={t("activeAdvertisers.emptyTitle")}
      description={t("activeAdvertisers.emptyText", { ads: thresholds.minAds, days: thresholds.minDays })}
      action={
        <Button variant="secondary" size="sm" onClick={onShowAll} data-testid="show-all-ads">
          {t("activeAdvertisers.showAll")}
        </Button>
      }
    />
  );
}

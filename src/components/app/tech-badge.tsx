"use client";

import { BadgeCheck } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Badge } from "@/components/ui/badge";
import { Tooltip } from "@/components/ui/tooltip";
import type { Store } from "@/lib/types";

export function TechBadge({ tech }: { tech: Store["technology"] }) {
  const { t } = useTranslation();
  if (tech.platform === "unknown") return <span className="text-xs text-subtle">{t("stores.techUnknown")}</span>;
  return (
    <Tooltip content={tech.verified ? t("stores.techVerifiedTip") : t("stores.techUnverifiedTip")}>
      <Badge tone={tech.verified ? "good" : "neutral"}>
        {tech.verified && <BadgeCheck />}
        {t(`stores.platforms.${tech.platform}`)}
        {!tech.verified && ` · ${t("stores.unverified")}`}
      </Badge>
    </Tooltip>
  );
}


"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Building2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useToast } from "@/components/ui/toast";
import { errorKey } from "@/lib/client/errors";
import { useSession } from "@/lib/client/session";
import { apiFetch } from "@/lib/client/use-api";
import { cn } from "@/lib/cn";

/** POSTs the switch (the server re-checks the membership and sets the httpOnly cookie), then reloads session and workspace. */
export function useSwitchWorkspace() {
  const { t } = useTranslation();
  const toast = useToast();
  const router = useRouter();
  const { refresh } = useSession();
  return async (id: string, name: string) => {
    try {
      await apiFetch("/api/workspaces/switch", { method: "POST", body: JSON.stringify({ organizationId: id }) });
      await refresh();
      router.refresh();
      toast(t("workspaces.switched", { name }));
      return true;
    } catch (e) {
      toast(t(errorKey(e)), "error");
      return false;
    }
  };
}

/** Compact active-workspace picker. Hidden in demo mode and for users with a single workspace. */
export function WorkspaceSwitcher({ className }: { className?: string }) {
  const { t } = useTranslation();
  const { session } = useSession();
  const switchTo = useSwitchWorkspace();
  const [busy, setBusy] = useState(false);
  if (!session || session.mode !== "live" || !session.workspace || session.workspaces.length < 2) return null;
  return (
    <label className={cn("relative flex items-center", className)}>
      <span className="sr-only">{t("workspaces.switcherLabel")}</span>
      <Building2 className="pointer-events-none absolute left-2.5 size-4 text-subtle" />
      <select
        value={session.workspace.id}
        disabled={busy}
        onChange={async (e) => {
          const next = session.workspaces.find((w) => w.id === e.target.value);
          if (!next) return;
          setBusy(true);
          await switchTo(next.id, next.name);
          setBusy(false);
        }}
        className="focus-ring h-9 w-full cursor-pointer appearance-none truncate rounded-lg border border-border bg-surface-2 pl-8 pr-3 text-[13px] text-fg hover:bg-surface-3 disabled:opacity-50"
        aria-label={t("workspaces.switcherLabel")}
        data-testid="workspace-switcher"
      >
        {session.workspaces.map((w) => (
          <option key={w.id} value={w.id}>
            {w.name}
          </option>
        ))}
      </select>
    </label>
  );
}

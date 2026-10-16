"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { applyOp, EMPTY_WORKSPACE, uid, WorkspaceError, type ItemType, type Workspace, type WorkspaceOp } from "@/lib/workspace";
import { useToast } from "@/components/ui/toast";
import { useSession } from "./session";
import { ApiError, apiFetch } from "./use-api";

/**
 * Workspace store. Demo visitors keep their workspace in this browser
 * (localStorage, seeded with example collections). Signed-in users in live
 * mode persist every operation through /api/workspace (Postgres + RLS).
 */

const STORAGE_KEY = "th_workspace_v1";

interface Ctx {
  ready: boolean;
  persistence: "local" | "server";
  workspace: Workspace;
  dispatch: (op: WorkspaceOp, successMessage?: string) => Promise<boolean>;
  isSaved: (type: ItemType, refId: string) => boolean;
  watchId: (type: "product" | "store" | "category", refId: string) => string | null;
  /** Live checks also report whether rules were actually evaluated (skipped without live data). */
  runAlertCheck: () => Promise<{ matches: number; status?: "success" | "skipped" | "failed"; reason?: string | null } | null>;
  replace: (ws: Workspace) => void;
}

const WorkspaceCtx = createContext<Ctx | null>(null);

function loadLocal(): Workspace | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? { ...EMPTY_WORKSPACE, ...JSON.parse(raw) } : null;
  } catch {
    return null;
  }
}
function saveLocal(ws: Workspace) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(ws));
  } catch {
    // storage unavailable (private mode): workspace stays in memory for this tab
  }
}

export function WorkspaceProvider({ children }: { children: ReactNode }) {
  const { session } = useSession();
  const { t } = useTranslation();
  const toast = useToast();
  const [workspace, setWorkspace] = useState<Workspace>(EMPTY_WORKSPACE);
  const [ready, setReady] = useState(false);
  const wsRef = useRef(workspace);
  wsRef.current = workspace;
  const server = session?.mode === "live" && session.authenticated;

  useEffect(() => {
    if (!session) return;
    let cancelled = false;
    (async () => {
      try {
        if (server) {
          const ws = await apiFetch<Workspace>("/api/workspace");
          if (!cancelled) setWorkspace(ws);
        } else {
          const local = loadLocal();
          const ws = local ?? (await apiFetch<Workspace>("/api/workspace/seed"));
          if (!local) saveLocal(ws);
          if (!cancelled) setWorkspace(ws);
        }
      } catch {
        if (!cancelled) setWorkspace(EMPTY_WORKSPACE);
      } finally {
        if (!cancelled) setReady(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [session, server]);

  const errorMessage = useCallback(
    (code: string) => (t(`workspace.errors.${code}`, { defaultValue: "" }) as string) || t("errors.generic"),
    [t],
  );

  const dispatch = useCallback(
    async (op: WorkspaceOp, successMessage?: string) => {
      if (!session) return false;
      try {
        if (server) {
          const ws = await apiFetch<Workspace>("/api/workspace", { method: "POST", body: JSON.stringify(op) });
          setWorkspace(ws);
        } else {
          const e = session.entitlements;
          const next = applyOp(wsRef.current, op, { collections: e.collections, savedItems: e.savedItems, alertRules: e.alertRules, alerts: e.alerts, watchlists: e.watchlists });
          setWorkspace(next);
          saveLocal(next);
        }
        if (successMessage) toast(successMessage);
        return true;
      } catch (err) {
        const code = err instanceof WorkspaceError ? err.code : err instanceof ApiError ? err.code : "generic";
        toast(errorMessage(code), "error");
        return false;
      }
    },
    [session, server, toast, errorMessage],
  );

  const runAlertCheck = useCallback(async () => {
    try {
      if (server) {
        const res = await apiFetch<{ workspace: Workspace; matches: number; status: "success" | "skipped" | "failed"; reason: string | null }>("/api/alerts/evaluate", {
          method: "POST",
          body: JSON.stringify({}),
        });
        setWorkspace(res.workspace);
        return { matches: res.matches, status: res.status, reason: res.reason };
      }
      const cur = wsRef.current;
      const res = await apiFetch<{ asOf: string; since: string; matches: { ruleId: string; key: string; params: Record<string, string | number>; link: string | null }[] }>(
        "/api/alerts/evaluate",
        { method: "POST", body: JSON.stringify({ rules: cur.alertRules }) },
      );
      const now = new Date().toISOString();
      const next: Workspace = {
        ...cur,
        alertRules: cur.alertRules.map((r) => (r.active ? { ...r, lastEvaluatedAt: now } : r)),
        notifications: [
          ...res.matches.map((m) => ({ id: uid("ntf"), ruleId: m.ruleId, key: m.key, params: m.params, link: m.link, createdAt: now, read: false, origin: "demo" as const })),
          ...cur.notifications,
        ].slice(0, 200),
        alertHistory: [
          { id: uid("run"), at: now, origin: "demo" as const, rules: cur.alertRules.filter((r) => r.active).length, matches: res.matches.length, status: "success" as const, message: res.asOf },
          ...cur.alertHistory,
        ].slice(0, 50),
      };
      setWorkspace(next);
      saveLocal(next);
      return { matches: res.matches.length };
    } catch (err) {
      toast(err instanceof ApiError ? errorMessage(err.code) : t("errors.generic"), "error");
      return null;
    }
  }, [server, toast, errorMessage, t]);

  const value = useMemo<Ctx>(
    () => ({
      ready,
      persistence: server ? "server" : "local",
      workspace,
      dispatch,
      isSaved: (type, refId) => workspace.collections.some((c) => c.items.some((i) => i.type === type && i.refId === refId)),
      watchId: (type, refId) => workspace.watchlist.find((w) => w.type === type && w.refId === refId)?.id ?? null,
      runAlertCheck,
      replace: (ws) => {
        setWorkspace(ws);
        if (!server) saveLocal(ws);
      },
    }),
    [ready, server, workspace, dispatch, runAlertCheck],
  );

  return <WorkspaceCtx.Provider value={value}>{children}</WorkspaceCtx.Provider>;
}

export function useWorkspace(): Ctx {
  const v = useContext(WorkspaceCtx);
  if (!v) throw new Error("useWorkspace must be used inside WorkspaceProvider");
  return v;
}

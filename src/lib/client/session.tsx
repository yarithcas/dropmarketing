"use client";

import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import type { Entitlements, PlanId } from "@/lib/plans";
import type { OrgRole } from "@/lib/team";
import { apiFetch } from "./use-api";

export interface WorkspaceInfo {
  id: string;
  name: string;
  role: OrgRole;
  plan: PlanId;
  members: number;
}

export interface SessionInfo {
  mode: "demo" | "live";
  authenticated: boolean;
  user: { name: string; email: string } | null;
  plan: PlanId;
  entitlements: Entitlements;
  usage: Record<string, { used: number; limit: number; allowed: boolean }>;
  /** Active workspace (live mode only). */
  workspace: WorkspaceInfo | null;
  /** Every workspace the user belongs to (live mode only; empty in demo mode). */
  workspaces: WorkspaceInfo[];
  /** Owner or admin of the organization that pays for the active workspace. */
  canManageBilling: boolean;
  features: { supabase: boolean; ai: boolean; stripe: boolean; shopify: boolean; email: boolean; cron: boolean };
  data: { mode: "demo" | "live"; asOf: string; sources: string[] };
}

interface Ctx {
  session: SessionInfo | null;
  refresh: () => Promise<void>;
}

const SessionCtx = createContext<Ctx>({ session: null, refresh: async () => {} });

export function SessionProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<SessionInfo | null>(null);
  const refresh = useCallback(async () => {
    try {
      setSession(await apiFetch<SessionInfo>("/api/session"));
    } catch {
      // keep previous session; pages show their own errors
    }
  }, []);
  useEffect(() => {
    refresh();
  }, [refresh]);
  return <SessionCtx.Provider value={{ session, refresh }}>{children}</SessionCtx.Provider>;
}

export const useSession = () => useContext(SessionCtx);

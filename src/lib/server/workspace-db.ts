import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { PLANS } from "../plans";
import { WorkspaceError, type AlertRule, type Workspace, type WorkspaceOp } from "../workspace";
import type { Session } from "./session";

/** Live-mode workspace persistence. All queries run with the user's JWT, so RLS enforces ownership. */

export async function loadWorkspace(sb: SupabaseClient, userId: string): Promise<Workspace> {
  const [cols, watch, rules, notes, runs] = await Promise.all([
    sb.from("collections").select("id,name,description,kind,created_at,collection_items(id,item_type,ref_id,label,note,tags,added_at)").eq("user_id", userId).order("created_at"),
    sb.from("watchlists").select("id,item_type,ref_id,label,added_at").eq("user_id", userId).order("added_at", { ascending: false }),
    sb.from("alerts").select("*").eq("user_id", userId).order("created_at", { ascending: false }),
    sb.from("notifications").select("*").eq("user_id", userId).order("created_at", { ascending: false }).limit(200),
    sb.from("alert_runs").select("*").order("started_at", { ascending: false }).limit(20),
  ]);
  for (const r of [cols, watch, rules, notes]) if (r.error) throw r.error;
  type ItemRow = { id: string; item_type: "product" | "ad" | "store"; ref_id: string; label: string; note: string; tags: string[]; added_at: string };
  return {
    collections: (cols.data ?? []).map((c) => ({
      id: c.id,
      name: c.name,
      description: c.description,
      kind: c.kind,
      createdAt: c.created_at,
      items: ((c.collection_items ?? []) as ItemRow[])
        .map((i) => ({ id: i.id, type: i.item_type, refId: i.ref_id, label: i.label, note: i.note, tags: i.tags, addedAt: i.added_at }))
        .sort((a, b) => b.addedAt.localeCompare(a.addedAt)),
    })),
    watchlist: (watch.data ?? []).map((w) => ({ id: w.id, type: w.item_type, refId: w.ref_id, label: w.label, addedAt: w.added_at })),
    alertRules: (rules.data ?? []).map(rowToRule),
    notifications: (notes.data ?? []).map((n) => ({ id: n.id, ruleId: n.alert_id, key: n.key, params: n.params, link: n.link, createdAt: n.created_at, read: n.read, origin: n.origin })),
    alertHistory: (runs.data ?? []).map((r) => ({ id: String(r.id), at: r.started_at, origin: r.origin, rules: r.rules, matches: r.matches, status: r.status, message: r.message ?? undefined })),
  };
}

export function rowToRule(r: Record<string, unknown>): AlertRule {
  return {
    id: r.id as string,
    name: r.name as string,
    type: r.type as AlertRule["type"],
    target: (r.target ?? {}) as AlertRule["target"],
    thresholdPct: r.threshold_pct == null ? undefined : Number(r.threshold_pct),
    frequency: r.frequency as AlertRule["frequency"],
    channels: r.channels as AlertRule["channels"],
    active: r.active as boolean,
    createdAt: r.created_at as string,
    lastEvaluatedAt: (r.last_evaluated_at as string) ?? undefined,
  };
}

async function check(p: PromiseLike<{ error: { code?: string } | null }>) {
  const { error } = await p;
  if (error) throw error.code === "23505" ? new WorkspaceError("duplicate") : error;
}

export async function applyOpDb(sb: SupabaseClient, session: Session, op: WorkspaceOp): Promise<void> {
  const uid = session.id;
  const ent = PLANS[session.plan].entitlements;
  const count = async (table: string) => (await sb.from(table).select("id", { count: "exact", head: true }).eq("user_id", uid)).count ?? 0;
  switch (op.op) {
    case "collection.create":
      if ((await count("collections")) >= ent.collections) throw new WorkspaceError("limit_collections");
      return check(sb.from("collections").insert({ user_id: uid, organization_id: session.organizationId, name: op.name, description: op.description, kind: op.kind }));
    case "collection.update":
      return check(sb.from("collections").update({ ...(op.name ? { name: op.name } : {}), ...(op.description != null ? { description: op.description } : {}) }).eq("id", op.id));
    case "collection.delete":
      return check(sb.from("collections").delete().eq("id", op.id));
    case "item.add": {
      const { count: items } = await sb.from("collection_items").select("id, collections!inner(user_id)", { count: "exact", head: true }).eq("collections.user_id", uid);
      if ((items ?? 0) >= ent.savedItems) throw new WorkspaceError("limit_items");
      return check(sb.from("collection_items").insert({ collection_id: op.collectionId, item_type: op.type, ref_id: op.refId, label: op.label, note: op.note, tags: op.tags }));
    }
    case "item.update":
      return check(sb.from("collection_items").update({ ...(op.note != null ? { note: op.note } : {}), ...(op.tags ? { tags: op.tags } : {}) }).eq("id", op.id).eq("collection_id", op.collectionId));
    case "item.remove":
      return check(sb.from("collection_items").delete().eq("id", op.id).eq("collection_id", op.collectionId));
    case "watch.add":
      return check(sb.from("watchlists").insert({ user_id: uid, organization_id: session.organizationId, item_type: op.type, ref_id: op.refId, label: op.label }));
    case "watch.remove":
      return check(sb.from("watchlists").delete().eq("id", op.id));
    case "rule.create":
      if (!ent.alerts) throw new WorkspaceError("plan_required");
      if ((await count("alerts")) >= ent.alertRules) throw new WorkspaceError("limit_rules");
      return check(
        sb.from("alerts").insert({
          user_id: uid,
          organization_id: session.organizationId,
          name: op.rule.name,
          type: op.rule.type,
          target: op.rule.target,
          threshold_pct: op.rule.thresholdPct ?? null,
          frequency: op.rule.frequency,
          channels: op.rule.channels,
        }),
      );
    case "rule.update": {
      const patch: Record<string, unknown> = {};
      if (op.active != null) patch.active = op.active;
      if (op.rule?.name) patch.name = op.rule.name;
      if (op.rule?.frequency) patch.frequency = op.rule.frequency;
      if (op.rule?.thresholdPct != null) patch.threshold_pct = op.rule.thresholdPct;
      if (op.rule?.channels) patch.channels = op.rule.channels;
      if (op.rule?.target) patch.target = op.rule.target;
      return check(sb.from("alerts").update(patch).eq("id", op.id));
    }
    case "rule.delete":
      return check(sb.from("alerts").delete().eq("id", op.id));
    case "notifications.read":
      return check(sb.from("notifications").update({ read: true }).in("id", op.ids));
    case "notifications.clear":
      return check(sb.from("notifications").delete().eq("user_id", uid));
  }
}

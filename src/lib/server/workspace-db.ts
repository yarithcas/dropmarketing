import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { PLANS } from "../plans";
import { WorkspaceError, type AlertRule, type Collection, type Workspace, type WorkspaceOp } from "../workspace";
import type { Session } from "./session";

/**
 * Live-mode workspace persistence. All queries run with the user's JWT, so RLS
 * enforces ownership and team visibility. Data is scoped to the active
 * workspace (organization); `allWorkspaces` returns every row the user created
 * (GDPR export).
 */

export type WorkspaceScope = Pick<Session, "id" | "organizationId">;

const COLLECTION_FIELDS = "id,user_id,name,description,kind,visibility,created_at,collection_items(id,item_type,ref_id,label,note,tags,added_at)";

type ItemRow = { id: string; item_type: "product" | "ad" | "store"; ref_id: string; label: string; note: string; tags: string[]; added_at: string };
type CollectionRow = { id: string; user_id: string; name: string; description: string; kind: Collection["kind"]; visibility: Collection["visibility"]; created_at: string; collection_items: ItemRow[] | null };

function rowToCollection(c: CollectionRow): Collection {
  return {
    id: c.id,
    name: c.name,
    description: c.description,
    kind: c.kind,
    visibility: c.visibility ?? "private",
    createdAt: c.created_at,
    items: (c.collection_items ?? [])
      .map((i) => ({ id: i.id, type: i.item_type, refId: i.ref_id, label: i.label, note: i.note, tags: i.tags, addedAt: i.added_at }))
      .sort((a, b) => b.addedAt.localeCompare(a.addedAt)),
  };
}

/** Every member gets a swipe file in each workspace (the Creatives swipe tab reads it). */
async function ensureSwipeFile(sb: SupabaseClient, userId: string, organizationId: string): Promise<Collection | null> {
  const { data, error } = await sb.from("collections").insert({ user_id: userId, organization_id: organizationId, name: "Swipe file", kind: "swipe" }).select(COLLECTION_FIELDS).single();
  if (!error && data) return rowToCollection(data as unknown as CollectionRow);
  if (error?.code !== "23505") return null; // e.g. no longer a member: the workspace still loads
  // Created concurrently by another request.
  const { data: existing } = await sb.from("collections").select(COLLECTION_FIELDS).eq("user_id", userId).eq("organization_id", organizationId).eq("kind", "swipe").maybeSingle();
  return existing ? rowToCollection(existing as unknown as CollectionRow) : null;
}

export async function loadWorkspace(sb: SupabaseClient, scope: WorkspaceScope, opts: { allWorkspaces?: boolean } = {}): Promise<Workspace> {
  const uid = scope.id;
  const org = opts.allWorkspaces ? null : scope.organizationId;
  let cols = sb.from("collections").select(COLLECTION_FIELDS).eq("user_id", uid);
  let watch = sb.from("watchlists").select("id,item_type,ref_id,label,added_at").eq("user_id", uid);
  let rules = sb.from("alerts").select("*").eq("user_id", uid);
  let notes = sb.from("notifications").select("*").eq("user_id", uid);
  if (org) {
    cols = cols.eq("organization_id", org);
    watch = watch.eq("organization_id", org);
    rules = rules.eq("organization_id", org);
    notes = notes.eq("organization_id", org);
  }
  const [own, w, r, n, runs, shared] = await Promise.all([
    cols.order("created_at"),
    watch.order("added_at", { ascending: false }),
    rules.order("created_at", { ascending: false }),
    notes.order("created_at", { ascending: false }).limit(200),
    sb.from("alert_runs").select("*").order("started_at", { ascending: false }).limit(20),
    org ? sb.from("collections").select(COLLECTION_FIELDS).eq("organization_id", org).eq("visibility", "team").neq("user_id", uid).order("created_at") : null,
  ]);
  for (const res of [own, w, r, n, shared]) if (res?.error) throw res.error;

  const collections = ((own.data ?? []) as unknown as CollectionRow[]).map(rowToCollection);
  if (org && !collections.some((c) => c.kind === "swipe")) {
    const swipe = await ensureSwipeFile(sb, uid, org);
    if (swipe) collections.push(swipe);
  }

  // Teammates' shared collections, labelled with the creator's display name (null when unknown).
  let sharedCollections: Collection[] | undefined;
  if (shared) {
    const rows = (shared.data ?? []) as unknown as CollectionRow[];
    const owners = [...new Set(rows.map((c) => c.user_id))];
    const names = new Map<string, string | null>();
    if (owners.length) {
      const { data: profiles } = await sb.from("profiles").select("user_id,name").in("user_id", owners);
      for (const p of profiles ?? []) names.set(p.user_id as string, (p.name as string | null) ?? null);
    }
    sharedCollections = rows.map((c) => ({ ...rowToCollection(c), sharedBy: { name: names.get(c.user_id) ?? null } }));
  }

  return {
    collections,
    ...(sharedCollections ? { sharedCollections } : {}),
    watchlist: (w.data ?? []).map((x) => ({ id: x.id, type: x.item_type, refId: x.ref_id, label: x.label, addedAt: x.added_at })),
    alertRules: (r.data ?? []).map(rowToRule),
    notifications: (n.data ?? []).map((x) => ({ id: x.id, ruleId: x.alert_id, key: x.key, params: x.params, link: x.link, createdAt: x.created_at, read: x.read, origin: x.origin })),
    alertHistory: (runs.data ?? []).map((x) => ({ id: String(x.id), at: x.started_at, origin: x.origin, rules: x.rules, matches: x.matches, status: x.status, message: x.message ?? undefined })),
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
  // 42501: RLS refused the row (e.g. a teammate's read-only collection).
  if (error) throw error.code === "23505" ? new WorkspaceError("duplicate") : error.code === "42501" ? new WorkspaceError("not_found") : error;
}

export async function applyOpDb(sb: SupabaseClient, session: Session, op: WorkspaceOp): Promise<void> {
  const uid = session.id;
  const org = session.organizationId;
  if (!org) throw new WorkspaceError("not_found");
  const ent = PLANS[session.plan].entitlements;
  // Plan limits apply per member within the active workspace; the swipe file is not counted.
  const count = async (table: "collections" | "alerts") => {
    let q = sb.from(table).select("id", { count: "exact", head: true }).eq("user_id", uid).eq("organization_id", org);
    if (table === "collections") q = q.eq("kind", "standard");
    return (await q).count ?? 0;
  };
  switch (op.op) {
    case "collection.create":
      if (op.kind === "standard" && (await count("collections")) >= ent.collections) throw new WorkspaceError("limit_collections");
      return check(sb.from("collections").insert({ user_id: uid, organization_id: org, name: op.name, description: op.description, kind: op.kind }));
    case "collection.update":
      return check(
        sb
          .from("collections")
          .update({ ...(op.name ? { name: op.name } : {}), ...(op.description != null ? { description: op.description } : {}), ...(op.visibility ? { visibility: op.visibility } : {}) })
          .eq("id", op.id)
          .eq("organization_id", org),
      );
    case "collection.delete":
      return check(sb.from("collections").delete().eq("id", op.id).eq("organization_id", org));
    case "item.add": {
      // Only into the user's own collections of the active workspace (limits are counted there).
      const { data: target } = await sb.from("collections").select("id").eq("id", op.collectionId).eq("user_id", uid).eq("organization_id", org).maybeSingle();
      if (!target) throw new WorkspaceError("not_found");
      const { count: items } = await sb
        .from("collection_items")
        .select("id, collections!inner(user_id, organization_id)", { count: "exact", head: true })
        .eq("collections.user_id", uid)
        .eq("collections.organization_id", org);
      if ((items ?? 0) >= ent.savedItems) throw new WorkspaceError("limit_items");
      return check(sb.from("collection_items").insert({ collection_id: op.collectionId, item_type: op.type, ref_id: op.refId, label: op.label, note: op.note, tags: op.tags }));
    }
    case "item.update":
      return check(sb.from("collection_items").update({ ...(op.note != null ? { note: op.note } : {}), ...(op.tags ? { tags: op.tags } : {}) }).eq("id", op.id).eq("collection_id", op.collectionId));
    case "item.remove":
      return check(sb.from("collection_items").delete().eq("id", op.id).eq("collection_id", op.collectionId));
    case "watch.add":
      return check(sb.from("watchlists").insert({ user_id: uid, organization_id: org, item_type: op.type, ref_id: op.refId, label: op.label }));
    case "watch.remove":
      return check(sb.from("watchlists").delete().eq("id", op.id).eq("organization_id", org));
    case "rule.create":
      if (!ent.alerts) throw new WorkspaceError("plan_required");
      if ((await count("alerts")) >= ent.alertRules) throw new WorkspaceError("limit_rules");
      return check(
        sb.from("alerts").insert({
          user_id: uid,
          organization_id: org,
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
      return check(sb.from("alerts").update(patch).eq("id", op.id).eq("organization_id", org));
    }
    case "rule.delete":
      return check(sb.from("alerts").delete().eq("id", op.id).eq("organization_id", org));
    case "notifications.read":
      return check(sb.from("notifications").update({ read: true }).in("id", op.ids));
    case "notifications.clear":
      return check(sb.from("notifications").delete().eq("user_id", uid).eq("organization_id", org));
  }
}

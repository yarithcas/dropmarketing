import { z } from "zod";
import { CATEGORIES } from "./types";

/** User workspace: collections, watchlist, alert rules, notifications. */

export const ITEM_TYPES = ["product", "ad", "store"] as const;
export type ItemType = (typeof ITEM_TYPES)[number];

export interface CollectionItem {
  id: string;
  type: ItemType;
  refId: string;
  label: string;
  note: string;
  tags: string[];
  addedAt: string;
}

export interface Collection {
  id: string;
  name: string;
  description: string;
  /** "swipe" marks the creative swipe file. */
  kind: "standard" | "swipe";
  items: CollectionItem[];
  createdAt: string;
}

export interface WatchItem {
  id: string;
  type: "product" | "store" | "category";
  refId: string;
  label: string;
  addedAt: string;
}

export const ALERT_TYPES = ["trend_increase", "new_advertiser", "new_product_in_category", "competitor_new_products", "daily_summary"] as const;
export type AlertType = (typeof ALERT_TYPES)[number];

export interface AlertRule {
  id: string;
  name: string;
  type: AlertType;
  target: { productId?: string; category?: string; storeId?: string };
  thresholdPct?: number;
  frequency: "hourly" | "daily" | "weekly";
  channels: { inApp: boolean; email: boolean };
  active: boolean;
  createdAt: string;
  lastEvaluatedAt?: string;
}

export interface NotificationItem {
  id: string;
  ruleId: string | null;
  key: string;
  params: Record<string, string | number>;
  link: string | null;
  createdAt: string;
  read: boolean;
  /** "demo" notifications come from a manual check against the demo snapshot. */
  origin: "demo" | "scheduled" | "manual";
}

export interface AlertRun {
  id: string;
  at: string;
  origin: "demo" | "scheduled" | "manual";
  rules: number;
  matches: number;
  status: "success" | "failed" | "skipped";
  message?: string;
}

export interface Workspace {
  collections: Collection[];
  watchlist: WatchItem[];
  alertRules: AlertRule[];
  notifications: NotificationItem[];
  alertHistory: AlertRun[];
}

export const EMPTY_WORKSPACE: Workspace = { collections: [], watchlist: [], alertRules: [], notifications: [], alertHistory: [] };

const id = z.string().min(1).max(120);
const label = z.string().trim().min(1).max(160);
const note = z.string().max(2000);
const tags = z.array(z.string().trim().min(1).max(32)).max(20);

const ruleInput = z.object({
  name: label,
  type: z.enum(ALERT_TYPES),
  target: z.object({ productId: id.optional(), category: z.enum(CATEGORIES).optional(), storeId: id.optional() }),
  thresholdPct: z.number().min(1).max(1000).optional(),
  frequency: z.enum(["hourly", "daily", "weekly"]),
  channels: z.object({ inApp: z.boolean(), email: z.boolean() }),
});

/** Every workspace mutation is one of these validated operations (shared by client and server). */
export const workspaceOpSchema = z.discriminatedUnion("op", [
  z.object({ op: z.literal("collection.create"), name: label, description: z.string().max(500).default(""), kind: z.enum(["standard", "swipe"]).default("standard") }),
  z.object({ op: z.literal("collection.update"), id, name: label.optional(), description: z.string().max(500).optional() }),
  z.object({ op: z.literal("collection.delete"), id }),
  z.object({ op: z.literal("item.add"), collectionId: id, type: z.enum(ITEM_TYPES), refId: id, label, note: note.default(""), tags: tags.default([]) }),
  z.object({ op: z.literal("item.update"), collectionId: id, id, note: note.optional(), tags: tags.optional() }),
  z.object({ op: z.literal("item.remove"), collectionId: id, id }),
  z.object({ op: z.literal("watch.add"), type: z.enum(["product", "store", "category"]), refId: id, label }),
  z.object({ op: z.literal("watch.remove"), id }),
  z.object({ op: z.literal("rule.create"), rule: ruleInput }),
  z.object({ op: z.literal("rule.update"), id, active: z.boolean().optional(), rule: ruleInput.partial().optional() }),
  z.object({ op: z.literal("rule.delete"), id }),
  z.object({ op: z.literal("notifications.read"), ids: z.array(id).max(500) }),
  z.object({ op: z.literal("notifications.clear") }),
]);
export type WorkspaceOp = z.infer<typeof workspaceOpSchema>;

export function uid(prefix: string) {
  const rnd = typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID().slice(0, 8) : Math.random().toString(36).slice(2, 10);
  return `${prefix}_${Date.now().toString(36)}${rnd}`;
}

export class WorkspaceError extends Error {
  constructor(public code: "not_found" | "limit_collections" | "limit_items" | "limit_rules" | "duplicate" | "plan_required") {
    super(code);
  }
}

export interface Limits {
  collections: number;
  savedItems: number;
  alertRules: number;
  alerts: boolean;
  watchlists: boolean;
}

/** Pure reducer used for the local (demo) workspace; the live API applies the same ops in SQL. */
export function applyOp(ws: Workspace, op: WorkspaceOp, limits: Limits, now = new Date().toISOString()): Workspace {
  const findCol = (cid: string) => {
    const c = ws.collections.find((x) => x.id === cid);
    if (!c) throw new WorkspaceError("not_found");
    return c;
  };
  const totalItems = ws.collections.reduce((s, c) => s + c.items.length, 0);
  switch (op.op) {
    case "collection.create":
      if (ws.collections.length >= limits.collections) throw new WorkspaceError("limit_collections");
      return { ...ws, collections: [...ws.collections, { id: uid("col"), name: op.name, description: op.description, kind: op.kind, items: [], createdAt: now }] };
    case "collection.update":
      findCol(op.id);
      return { ...ws, collections: ws.collections.map((c) => (c.id === op.id ? { ...c, name: op.name ?? c.name, description: op.description ?? c.description } : c)) };
    case "collection.delete":
      findCol(op.id);
      return { ...ws, collections: ws.collections.filter((c) => c.id !== op.id) };
    case "item.add": {
      const c = findCol(op.collectionId);
      if (c.items.some((i) => i.type === op.type && i.refId === op.refId)) throw new WorkspaceError("duplicate");
      if (totalItems >= limits.savedItems) throw new WorkspaceError("limit_items");
      const item: CollectionItem = { id: uid("itm"), type: op.type, refId: op.refId, label: op.label, note: op.note, tags: op.tags, addedAt: now };
      return { ...ws, collections: ws.collections.map((x) => (x.id === c.id ? { ...x, items: [item, ...x.items] } : x)) };
    }
    case "item.update": {
      const c = findCol(op.collectionId);
      if (!c.items.some((i) => i.id === op.id)) throw new WorkspaceError("not_found");
      return {
        ...ws,
        collections: ws.collections.map((x) =>
          x.id === c.id ? { ...x, items: x.items.map((i) => (i.id === op.id ? { ...i, note: op.note ?? i.note, tags: op.tags ?? i.tags } : i)) } : x,
        ),
      };
    }
    case "item.remove": {
      const c = findCol(op.collectionId);
      return { ...ws, collections: ws.collections.map((x) => (x.id === c.id ? { ...x, items: x.items.filter((i) => i.id !== op.id) } : x)) };
    }
    case "watch.add":
      if (!limits.watchlists) throw new WorkspaceError("plan_required");
      if (ws.watchlist.some((w) => w.type === op.type && w.refId === op.refId)) throw new WorkspaceError("duplicate");
      if (ws.watchlist.length >= limits.savedItems) throw new WorkspaceError("limit_items");
      return { ...ws, watchlist: [{ id: uid("wch"), type: op.type, refId: op.refId, label: op.label, addedAt: now }, ...ws.watchlist] };
    case "watch.remove":
      return { ...ws, watchlist: ws.watchlist.filter((w) => w.id !== op.id) };
    case "rule.create":
      if (!limits.alerts) throw new WorkspaceError("plan_required");
      if (ws.alertRules.length >= limits.alertRules) throw new WorkspaceError("limit_rules");
      return { ...ws, alertRules: [{ id: uid("rul"), ...op.rule, active: true, createdAt: now }, ...ws.alertRules] };
    case "rule.update":
      if (!ws.alertRules.some((r) => r.id === op.id)) throw new WorkspaceError("not_found");
      // Resuming a rule needs a plan with alerts (pausing and deleting always work).
      if (op.active && !limits.alerts) throw new WorkspaceError("plan_required");
      return {
        ...ws,
        alertRules: ws.alertRules.map((r) =>
          r.id === op.id ? { ...r, ...(op.rule ?? {}), target: { ...r.target, ...(op.rule?.target ?? {}) }, channels: { ...r.channels, ...(op.rule?.channels ?? {}) }, active: op.active ?? r.active } : r,
        ),
      };
    case "rule.delete":
      return { ...ws, alertRules: ws.alertRules.filter((r) => r.id !== op.id) };
    case "notifications.read": {
      const ids = new Set(op.ids);
      return { ...ws, notifications: ws.notifications.map((n) => (ids.has(n.id) ? { ...n, read: true } : n)) };
    }
    case "notifications.clear":
      return { ...ws, notifications: [] };
  }
}

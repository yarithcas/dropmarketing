import { describe, expect, it } from "vitest";
import { applyOp, EMPTY_WORKSPACE, WorkspaceError, workspaceOpSchema, type Workspace } from "@/lib/workspace";

const limits = { collections: 2, savedItems: 2, alertRules: 1, alerts: true, watchlists: true };

describe("workspace reducer", () => {
  it("creates collections, adds, edits and removes items", () => {
    let ws: Workspace = applyOp(EMPTY_WORKSPACE, { op: "collection.create", name: "Test", description: "", kind: "standard" }, limits);
    const cid = ws.collections[0].id;
    ws = applyOp(ws, { op: "item.add", collectionId: cid, type: "product", refId: "p1", label: "P1", note: "", tags: [] }, limits);
    const iid = ws.collections[0].items[0].id;
    ws = applyOp(ws, { op: "item.update", collectionId: cid, id: iid, note: "check supplier", tags: ["test"] }, limits);
    expect(ws.collections[0].items[0]).toMatchObject({ note: "check supplier", tags: ["test"] });
    ws = applyOp(ws, { op: "item.remove", collectionId: cid, id: iid }, limits);
    expect(ws.collections[0].items).toHaveLength(0);
  });

  it("rejects duplicates and enforces plan limits", () => {
    let ws = applyOp(EMPTY_WORKSPACE, { op: "collection.create", name: "A", description: "", kind: "standard" }, limits);
    const cid = ws.collections[0].id;
    ws = applyOp(ws, { op: "item.add", collectionId: cid, type: "ad", refId: "a1", label: "A1", note: "", tags: [] }, limits);
    expect(() => applyOp(ws, { op: "item.add", collectionId: cid, type: "ad", refId: "a1", label: "A1", note: "", tags: [] }, limits)).toThrow(WorkspaceError);
    ws = applyOp(ws, { op: "item.add", collectionId: cid, type: "ad", refId: "a2", label: "A2", note: "", tags: [] }, limits);
    expect(() => applyOp(ws, { op: "item.add", collectionId: cid, type: "ad", refId: "a3", label: "A3", note: "", tags: [] }, limits)).toThrowError("limit_items");
    ws = applyOp(ws, { op: "collection.create", name: "B", description: "", kind: "standard" }, limits);
    expect(() => applyOp(ws, { op: "collection.create", name: "C", description: "", kind: "standard" }, limits)).toThrowError("limit_collections");
  });

  it("requires the alerts entitlement and supports pause/resume", () => {
    const rule = { name: "R", type: "daily_summary" as const, target: {}, frequency: "daily" as const, channels: { inApp: true, email: false } };
    expect(() => applyOp(EMPTY_WORKSPACE, { op: "rule.create", rule }, { ...limits, alerts: false })).toThrowError("plan_required");
    let ws = applyOp(EMPTY_WORKSPACE, { op: "rule.create", rule }, limits);
    ws = applyOp(ws, { op: "rule.update", id: ws.alertRules[0].id, active: false }, limits);
    expect(ws.alertRules[0].active).toBe(false);
    expect(() => applyOp(ws, { op: "rule.create", rule }, limits)).toThrowError("limit_rules");
    // After a downgrade, a paused rule cannot be resumed but can still be deleted.
    expect(() => applyOp(ws, { op: "rule.update", id: ws.alertRules[0].id, active: true }, { ...limits, alerts: false })).toThrowError("plan_required");
    expect(applyOp(ws, { op: "rule.delete", id: ws.alertRules[0].id }, { ...limits, alerts: false }).alertRules).toHaveLength(0);
  });

  it("requires the watchlists entitlement", () => {
    const op = { op: "watch.add" as const, type: "product" as const, refId: "p1", label: "P1" };
    expect(() => applyOp(EMPTY_WORKSPACE, op, { ...limits, watchlists: false })).toThrowError("plan_required");
    expect(applyOp(EMPTY_WORKSPACE, op, limits).watchlist).toHaveLength(1);
  });

  it("validates operations at the boundary", () => {
    expect(workspaceOpSchema.safeParse({ op: "collection.create", name: "" }).success).toBe(false);
    expect(workspaceOpSchema.safeParse({ op: "item.add", collectionId: "c", type: "evil", refId: "x", label: "x" }).success).toBe(false);
    expect(workspaceOpSchema.safeParse({ op: "notifications.clear" }).success).toBe(true);
  });
});

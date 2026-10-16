import { describe, expect, it } from "vitest";
import { PLANS } from "@/lib/plans";
import {
  canManageTeam,
  inviteSchema,
  inviteTokenSchema,
  maskEmail,
  pickActiveWorkspace,
  removalError,
  roleChangeError,
  seatUsage,
  teamPlanSeats,
  workspaceCreateBlock,
  type OrgRole,
} from "@/lib/team";
import { hashInviteToken, inviteExpiry, isInviteExpired, newInviteToken } from "@/lib/server/invite-token";

const ws = (id: string, role: OrgRole, joinedAt: string) => ({ id, role, joinedAt });

describe("active workspace resolution", () => {
  const list = [ws("team", "member", "2026-01-01T00:00:00Z"), ws("mine", "owner", "2026-02-01T00:00:00Z"), ws("later", "owner", "2026-03-01T00:00:00Z")];

  it("keeps the cookie choice only when it is one of the memberships", () => {
    expect(pickActiveWorkspace(list, "later")?.id).toBe("later");
    expect(pickActiveWorkspace(list, "someone-elses-org")?.id).toBe("mine");
  });

  it("falls back to the oldest owned workspace, then the oldest membership", () => {
    expect(pickActiveWorkspace(list, null)?.id).toBe("mine");
    expect(pickActiveWorkspace([ws("b", "admin", "2026-05-01T00:00:00Z"), ws("a", "member", "2026-04-01T00:00:00Z")])?.id).toBe("a");
    expect(pickActiveWorkspace([], "x")).toBeNull();
  });
});

describe("seats", () => {
  it("counts distinct members across billed workspaces plus invitations of non-members", () => {
    const members = [
      { userId: "u1", email: "Owner@Example.com" },
      { userId: "u2", email: "b@example.com" },
      // same person in a second workspace billed under the same subscription
      { userId: "u2", email: "b@example.com" },
    ];
    expect(seatUsage(members, [])).toBe(2);
    expect(seatUsage(members, ["c@example.com", "C@example.com "])).toBe(3);
    // inviting an existing member (of another billed workspace) takes no extra seat
    expect(seatUsage(members, ["owner@example.com"])).toBe(2);
  });

  it("only plans with several seats can invite", () => {
    expect(teamPlanSeats(PLANS.free.entitlements.seats)).toBe(false);
    expect(teamPlanSeats(PLANS.pro.entitlements.seats)).toBe(false);
    expect(teamPlanSeats(PLANS.business.entitlements.seats)).toBe(true);
  });
});

describe("workspace limit", () => {
  const business = PLANS.business.entitlements.workspaces;
  it("requires Business, a managing role and a free slot", () => {
    expect(workspaceCreateBlock({ limit: PLANS.pro.entitlements.workspaces, used: 1, canManageBilling: true })).toBe("plan_required");
    expect(workspaceCreateBlock({ limit: business, used: 1, canManageBilling: false })).toBe("role_required");
    expect(workspaceCreateBlock({ limit: business, used: business - 1, canManageBilling: true })).toBeNull();
    expect(workspaceCreateBlock({ limit: business, used: business, canManageBilling: true })).toBe("limit_workspaces");
  });
});

describe("roles", () => {
  it("lets owners and admins manage", () => {
    expect(canManageTeam("owner")).toBe(true);
    expect(canManageTeam("admin")).toBe(true);
    expect(canManageTeam("member")).toBe(false);
    expect(canManageTeam(null)).toBe(false);
  });

  it("guards role changes", () => {
    expect(roleChangeError({ actor: "member", target: "member", next: "admin", owners: 1 })).toBe("role_required");
    expect(roleChangeError({ actor: "admin", target: "member", next: "admin", owners: 1 })).toBeNull();
    expect(roleChangeError({ actor: "admin", target: "member", next: "owner", owners: 1 })).toBe("owner_required");
    expect(roleChangeError({ actor: "admin", target: "owner", next: "member", owners: 2 })).toBe("owner_required");
    expect(roleChangeError({ actor: "owner", target: "owner", next: "admin", owners: 1 })).toBe("last_owner");
    expect(roleChangeError({ actor: "owner", target: "owner", next: "admin", owners: 2 })).toBeNull();
  });

  it("never removes the last owner", () => {
    expect(removalError({ actor: "member", target: "member", owners: 1, self: false })).toBe("role_required");
    expect(removalError({ actor: "member", target: "member", owners: 1, self: true })).toBeNull();
    expect(removalError({ actor: "admin", target: "owner", owners: 2, self: false })).toBe("owner_required");
    expect(removalError({ actor: "owner", target: "owner", owners: 1, self: true })).toBe("last_owner");
    expect(removalError({ actor: "owner", target: "owner", owners: 2, self: false })).toBeNull();
  });
});

describe("invitations", () => {
  it("stores only a SHA-256 hash of a random token", () => {
    const a = newInviteToken();
    const b = newInviteToken();
    expect(a.token).not.toBe(b.token);
    expect(a.hash).toMatch(/^[0-9a-f]{64}$/);
    expect(a.hash).toBe(hashInviteToken(a.token));
    expect(a.hash).not.toContain(a.token);
    expect(inviteTokenSchema.safeParse({ token: a.token }).success).toBe(true);
    expect(hashInviteToken("abc")).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  });

  it("expires after 7 days", () => {
    const now = Date.parse("2026-10-01T12:00:00Z");
    expect(newInviteToken(now).expiresAt).toBe("2026-10-08T12:00:00.000Z");
    expect(isInviteExpired(inviteExpiry(now), now + 7 * 86_400_000 - 1)).toBe(false);
    expect(isInviteExpired(inviteExpiry(now), now + 7 * 86_400_000)).toBe(true);
    expect(isInviteExpired("not a date", now)).toBe(true);
  });

  it("normalizes and validates input", () => {
    expect(inviteSchema.parse({ email: "  Jane.Doe@Example.COM " })).toEqual({ email: "jane.doe@example.com", role: "member" });
    expect(inviteSchema.safeParse({ email: "jane@example.com", role: "owner" }).success).toBe(false);
    expect(inviteSchema.safeParse({ email: "not-an-email" }).success).toBe(false);
    expect(inviteTokenSchema.safeParse({ token: "short" }).success).toBe(false);
    expect(inviteTokenSchema.safeParse({ token: `${"a".repeat(40)}/../` }).success).toBe(false);
  });

  it("masks the invited address for other accounts", () => {
    expect(maskEmail("jane@example.com")).toBe("j***@example.com");
    expect(maskEmail("broken")).toBe("***");
  });
});

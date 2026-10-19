import "server-only";
import { createHash, randomBytes } from "node:crypto";
import { INVITE_TTL_DAYS } from "../team";

/**
 * Invitation tokens: 32 random bytes (base64url) that only exist in the link
 * handed to the inviter. The database stores their SHA-256 hash, so a leaked
 * table never yields a usable link.
 */

export const hashInviteToken = (token: string) => createHash("sha256").update(token, "utf8").digest("hex");

export const inviteExpiry = (now = Date.now()) => new Date(now + INVITE_TTL_DAYS * 86_400_000).toISOString();

export const isInviteExpired = (expiresAt: string, now = Date.now()) => !(new Date(expiresAt).getTime() > now);

export function newInviteToken(now = Date.now()) {
  const token = randomBytes(32).toString("base64url");
  return { token, hash: hashInviteToken(token), expiresAt: inviteExpiry(now) };
}

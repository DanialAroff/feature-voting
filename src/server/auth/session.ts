import "server-only";
import { createHash, randomBytes } from "node:crypto";
import { eq } from "drizzle-orm";
import { db } from "@/server/db";
import { sessions, users } from "@/server/db/schema";
import type { PublicUser } from "./types";

// DB-backed sessions (docs/05-decisions.md § D2). The browser holds a random
// token; the database holds only its SHA-256, so a leaked DB can't be replayed.

export const SESSION_COOKIE = "session";

const ttlDays = Number(process.env.SESSION_TTL_DAYS) || 7;
const SESSION_TTL_MS = ttlDays * 24 * 60 * 60 * 1000;

const hashToken = (token: string) => createHash("sha256").update(token).digest("hex");

export async function createSession(userId: number): Promise<{ token: string; expiresAt: Date }> {
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS);
  await db.insert(sessions).values({ id: hashToken(token), userId, expiresAt });
  return { token, expiresAt };
}

// Looks the user up on every call, so role changes and bans apply immediately.
export async function validateSessionToken(token: string | undefined): Promise<PublicUser | null> {
  if (!token) return null;
  const id = hashToken(token);
  const [row] = await db
    .select({
      expiresAt: sessions.expiresAt,
      user: { id: users.id, email: users.email, displayName: users.displayName, role: users.role },
    })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .where(eq(sessions.id, id));

  if (!row) return null;
  if (row.expiresAt.getTime() <= Date.now()) {
    await db.delete(sessions).where(eq(sessions.id, id));
    return null;
  }
  return row.user;
}

export async function invalidateSession(token: string | undefined): Promise<void> {
  if (!token) return;
  await db.delete(sessions).where(eq(sessions.id, hashToken(token)));
}

export function sessionCookieOptions(expiresAt: Date) {
  return {
    httpOnly: true, // not readable by JavaScript, so XSS can't steal it
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax" as const, // not sent on cross-site POST/PUT/DELETE
    path: "/",
    expires: expiresAt,
  };
}

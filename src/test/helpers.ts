import { sql } from "drizzle-orm";
import { NextRequest } from "next/server";
import { hashPassword } from "@/server/auth/password";
import { createSession, SESSION_COOKIE } from "@/server/auth/session";
import { db } from "@/server/db";
import { requests, users, type UserRole } from "@/server/db/schema";

export async function resetDb() {
  await db.execute(sql`
    TRUNCATE request_merges, status_changes, comments, votes, requests, sessions, users
    RESTART IDENTITY CASCADE
  `);
}

export const TEST_PASSWORD = "password123";
let cachedHash: Promise<string> | undefined;
let userSeq = 0;

export async function createUser(opts: { role?: UserRole; email?: string } = {}) {
  cachedHash ??= hashPassword(TEST_PASSWORD);
  userSeq += 1;
  const [user] = await db
    .insert(users)
    .values({
      email: opts.email ?? `user${userSeq}@test.local`,
      displayName: `User ${userSeq}`,
      passwordHash: await cachedHash,
      role: opts.role ?? "user",
    })
    .returning({ id: users.id, email: users.email, role: users.role });
  return user;
}

/** Creates a user with a live session and returns the cookie to send as them. */
export async function loginAs(role: UserRole = "user") {
  const user = await createUser({ role });
  const { token } = await createSession(user.id);
  return { user, cookie: `${SESSION_COOKIE}=${token}` };
}

/** Inserts a request row directly, for setting up list/sort scenarios. */
export async function insertRequest(
  authorId: number,
  overrides: Partial<typeof requests.$inferInsert> = {},
) {
  const [row] = await db
    .insert(requests)
    .values({ title: "A request", description: "Details", authorId, ...overrides })
    .returning();
  return row;
}

type RequestOpts = { method?: string; body?: unknown; cookie?: string; headers?: Record<string, string> };

/** Builds a NextRequest so route handlers can be called directly, no server needed. */
export function makeRequest(path: string, opts: RequestOpts = {}) {
  const headers = new Headers(opts.headers);
  headers.set("host", "localhost:3000");
  if (opts.cookie) headers.set("cookie", opts.cookie);
  let body: string | undefined;
  if (opts.body !== undefined) {
    headers.set("content-type", "application/json");
    body = typeof opts.body === "string" ? opts.body : JSON.stringify(opts.body);
  }
  return new NextRequest(new URL(path, "http://localhost:3000"), {
    method: opts.method ?? "GET",
    headers,
    body,
  });
}

export const noCtx = { params: Promise.resolve({}) };

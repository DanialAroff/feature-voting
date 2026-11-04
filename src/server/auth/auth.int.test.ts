import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, test } from "vitest";
import { POST as login } from "@/app/api/auth/login/route";
import { POST as logout } from "@/app/api/auth/logout/route";
import { GET as me } from "@/app/api/auth/me/route";
import { POST as register } from "@/app/api/auth/register/route";
import { requireAdmin } from "@/server/auth/current-user";
import { db } from "@/server/db";
import { sessions, users } from "@/server/db/schema";
import { AppError } from "@/server/http/errors";
import { createUser, loginAs, makeRequest, noCtx, resetDb, TEST_PASSWORD } from "@/test/helpers";

beforeEach(resetDb);

const post = (path: string, body: unknown, cookie?: string) =>
  makeRequest(path, { method: "POST", body, cookie });

/** Turns a Set-Cookie response into a Cookie request header. */
function sessionCookieFrom(res: Response) {
  const header = res.headers.get("set-cookie") ?? "";
  return header.split(";")[0];
}

async function whoAmI(cookie?: string) {
  const res = await me(makeRequest("/api/auth/me", { cookie }), noCtx);
  return (await res.json()).user;
}

describe("register", () => {
  const valid = { email: "New@Example.com", displayName: "New", password: "longenough" };

  test("creates a plain user, logs them in, and never returns the hash", async () => {
    const res = await register(post("/api/auth/register", valid), noCtx);
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.user).toMatchObject({ email: "new@example.com", role: "user" });
    expect(JSON.stringify(body)).not.toContain("argon2");

    const setCookie = res.headers.get("set-cookie") ?? "";
    expect(setCookie).toMatch(/HttpOnly/i);
    expect(setCookie).toMatch(/SameSite=lax/i);
    expect(await whoAmI(sessionCookieFrom(res))).toMatchObject({ email: "new@example.com" });
  });

  test("ignores a role in the body: nobody can self-register as admin", async () => {
    const res = await register(post("/api/auth/register", { ...valid, role: "admin" }), noCtx);
    expect((await res.json()).user.role).toBe("user");
  });

  test("rejects a duplicate email regardless of case with 409", async () => {
    await createUser({ email: "taken@example.com" });
    const res = await register(post("/api/auth/register", { ...valid, email: "TAKEN@example.com" }), noCtx);
    expect(res.status).toBe(409);
    const { error } = await res.json();
    expect(error.code).toBe("CONFLICT");
    expect(error.fields.email).toBeDefined();
  });

  test("returns field errors for invalid input", async () => {
    const res = await register(post("/api/auth/register", { email: "nope", displayName: "", password: "short" }), noCtx);
    expect(res.status).toBe(400);
    const { error } = await res.json();
    expect(error.code).toBe("VALIDATION_ERROR");
    expect(Object.keys(error.fields).sort()).toEqual(["displayName", "email", "password"]);
  });

  test("rejects a malformed JSON body with 400", async () => {
    const res = await register(post("/api/auth/register", "{not json"), noCtx);
    expect(res.status).toBe(400);
    expect((await res.json()).error.code).toBe("INVALID_JSON");
  });
});

describe("login", () => {
  test("succeeds with the right password, case-insensitive email", async () => {
    const user = await createUser({ email: "alice@example.com" });
    const res = await login(post("/api/auth/login", { email: "ALICE@example.com", password: TEST_PASSWORD }), noCtx);
    expect(res.status).toBe(200);
    expect(await whoAmI(sessionCookieFrom(res))).toMatchObject({ id: user.id });
  });

  test("gives the same 401 for a wrong password and an unknown email", async () => {
    await createUser({ email: "alice@example.com" });
    const wrongPassword = await login(post("/api/auth/login", { email: "alice@example.com", password: "nope-nope" }), noCtx);
    const unknownEmail = await login(post("/api/auth/login", { email: "ghost@example.com", password: "nope-nope" }), noCtx);

    expect(wrongPassword.status).toBe(401);
    expect(unknownEmail.status).toBe(401);
    expect(await wrongPassword.json()).toEqual(await unknownEmail.json());
    expect(wrongPassword.headers.get("set-cookie")).toBeNull();
  });

  test("blocks a cross-origin login attempt (CSRF)", async () => {
    await createUser({ email: "alice@example.com" });
    const req = makeRequest("/api/auth/login", {
      method: "POST",
      body: { email: "alice@example.com", password: TEST_PASSWORD },
      headers: { origin: "https://evil.example" },
    });
    expect((await login(req, noCtx)).status).toBe(403);
  });
});

describe("sessions", () => {
  test("no cookie or a forged cookie means logged out", async () => {
    expect(await whoAmI()).toBeNull();
    expect(await whoAmI("session=forged-token")).toBeNull();
  });

  test("an expired session is rejected and cleaned up", async () => {
    const { user, cookie } = await loginAs();
    await db.update(sessions).set({ expiresAt: new Date(Date.now() - 1000) }).where(eq(sessions.userId, user.id));

    expect(await whoAmI(cookie)).toBeNull();
    expect(await db.select().from(sessions).where(eq(sessions.userId, user.id))).toHaveLength(0);
  });

  test("logout revokes the session server-side and is idempotent", async () => {
    const { cookie } = await loginAs();
    const res = await logout(post("/api/auth/logout", undefined, cookie), noCtx);
    expect(res.status).toBe(204);
    // The old cookie is useless even if the browser kept it.
    expect(await whoAmI(cookie)).toBeNull();
    expect((await logout(post("/api/auth/logout", undefined, cookie), noCtx)).status).toBe(204);
  });

  test("only the hash of the token is stored", async () => {
    const { user, cookie } = await loginAs();
    const token = cookie.split("=")[1];
    const [row] = await db.select().from(sessions).where(eq(sessions.userId, user.id));
    expect(row.id).not.toBe(token);
    expect(row.id).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe("requireAdmin", () => {
  const statusFor = async (cookie?: string) => {
    try {
      await requireAdmin(makeRequest("/api/admin/anything", { cookie }));
      return 200;
    } catch (err) {
      return err instanceof AppError ? err.status : 500;
    }
  };

  test("401 for anonymous, 403 for users, passes for admins", async () => {
    expect(await statusFor()).toBe(401);
    expect(await statusFor((await loginAs("user")).cookie)).toBe(403);
    expect(await statusFor((await loginAs("admin")).cookie)).toBe(200);
  });

  test("demoting an admin takes effect immediately, without logging them out", async () => {
    const { user, cookie } = await loginAs("admin");
    expect(await statusFor(cookie)).toBe(200);
    await db.update(users).set({ role: "user" }).where(eq(users.id, user.id));
    expect(await statusFor(cookie)).toBe(403);
  });
});

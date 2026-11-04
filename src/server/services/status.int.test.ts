import { asc, eq } from "drizzle-orm";
import { beforeEach, describe, expect, test } from "vitest";
import { PUT as setStatus } from "@/app/api/requests/[id]/status/route";
import { db } from "@/server/db";
import { requests, statusChanges } from "@/server/db/schema";
import { AppError } from "@/server/http/errors";
import { createUser, insertRequest, loginAs, makeRequest, resetDb } from "@/test/helpers";
import { changeStatus } from "./status";

beforeEach(resetDb);

const ctx = (id: number | string) => ({ params: Promise.resolve({ id: String(id) }) });

function send(requestId: number | string, body: unknown, cookie?: string) {
  return setStatus(makeRequest(`/api/requests/${requestId}/status`, { method: "PUT", body, cookie }), ctx(requestId));
}

async function state(requestId: number) {
  const [row] = await db.select({ status: requests.status }).from(requests).where(eq(requests.id, requestId));
  const history = await db
    .select({ from: statusChanges.fromStatus, to: statusChanges.toStatus, actorId: statusChanges.actorId })
    .from(statusChanges)
    .where(eq(statusChanges.requestId, requestId))
    .orderBy(asc(statusChanges.id));
  return { status: row.status, history };
}

describe("authorization (only admins may change status)", () => {
  test("anonymous → 401, regular user → 403, and nothing changes", async () => {
    const author = await loginAs("user");
    const r = await insertRequest(author.user.id);

    expect((await send(r.id, { status: "planned" })).status).toBe(401);
    // Not even the request's own author.
    expect((await send(r.id, { status: "planned" }, author.cookie)).status).toBe(403);
    expect(await state(r.id)).toEqual({ status: "under_review", history: [] });
  });

  test("the service refuses non-admins even when called directly", async () => {
    const { user } = await loginAs("user");
    const r = await insertRequest(user.id);
    const asUser = { id: user.id, email: user.email, displayName: "U", role: "user" as const };
    await expect(changeStatus(asUser, r.id, "planned")).rejects.toMatchObject({ status: 403 });
    await expect(changeStatus(null, r.id, "planned")).rejects.toBeInstanceOf(AppError);
  });
});

describe("changing status", () => {
  test("an admin's change updates the request and records who did what", async () => {
    const admin = await loginAs("admin");
    const r = await insertRequest((await createUser()).id);

    const res = await send(r.id, { status: "planned" }, admin.cookie);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: "planned", changed: true });
    expect(await state(r.id)).toEqual({
      status: "planned",
      history: [{ from: "under_review", to: "planned", actorId: admin.user.id }],
    });
  });

  test("setting the current status again is a no-op with no extra history", async () => {
    const admin = await loginAs("admin");
    const r = await insertRequest((await createUser()).id);
    await send(r.id, { status: "planned" }, admin.cookie);
    const again = await send(r.id, { status: "planned" }, admin.cookie);
    expect(await again.json()).toEqual({ status: "planned", changed: false });
    expect((await state(r.id)).history).toHaveLength(1);
  });

  test("any transition is allowed, including reopening a declined request", async () => {
    const admin = await loginAs("admin");
    const r = await insertRequest((await createUser()).id, { status: "declined" });
    expect((await send(r.id, { status: "under_review" }, admin.cookie)).status).toBe(200);
  });

  test("rejects an unknown status with 400", async () => {
    const admin = await loginAs("admin");
    const r = await insertRequest((await createUser()).id);
    const res = await send(r.id, { status: "shipped" }, admin.cookie);
    expect(res.status).toBe(400);
    expect((await res.json()).error.fields.status).toBeDefined();
  });

  test("404 for unknown requests, 409 for merged ones", async () => {
    const admin = await loginAs("admin");
    const target = await insertRequest((await createUser()).id);
    const dup = await insertRequest(target.authorId, { mergedIntoId: target.id });
    expect((await send(999, { status: "planned" }, admin.cookie)).status).toBe(404);
    const merged = await send(dup.id, { status: "planned" }, admin.cookie);
    expect(merged.status).toBe(409);
    expect((await merged.json()).error.details.mergedIntoId).toBe(target.id);
  });
});

describe("concurrency", () => {
  test("two admins changing at once leave a consistent history chain", async () => {
    const a = await loginAs("admin");
    const b = await loginAs("admin");
    const r = await insertRequest((await createUser()).id);

    await Promise.all([send(r.id, { status: "planned" }, a.cookie), send(r.id, { status: "in_progress" }, b.cookie)]);

    const { status, history } = await state(r.id);
    expect(history).toHaveLength(2);
    // Without the row lock both would record "from: under_review".
    expect(history[0].from).toBe("under_review");
    expect(history[1].from).toBe(history[0].to);
    expect(status).toBe(history[1].to);
  });
});

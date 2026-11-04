import { count, eq } from "drizzle-orm";
import { beforeEach, describe, expect, test } from "vitest";
import { GET as list, POST as post } from "@/app/api/requests/[id]/comments/route";
import { db } from "@/server/db";
import { comments, requests } from "@/server/db/schema";
import { createUser, insertRequest, loginAs, makeRequest, resetDb } from "@/test/helpers";

beforeEach(resetDb);

const ctx = (id: number | string) => ({ params: Promise.resolve({ id: String(id) }) });

function send(requestId: number | string, body: unknown, cookie?: string) {
  return post(makeRequest(`/api/requests/${requestId}/comments`, { method: "POST", body, cookie }), ctx(requestId));
}

async function counts(requestId: number) {
  const [{ stored }] = await db.select({ stored: requests.commentCount }).from(requests).where(eq(requests.id, requestId));
  const [{ actual }] = await db.select({ actual: count() }).from(comments).where(eq(comments.requestId, requestId));
  return { stored, actual };
}

async function newRequest() {
  return insertRequest((await createUser()).id);
}

describe("POST /api/requests/:id/comments", () => {
  test("requires login", async () => {
    const r = await newRequest();
    expect((await send(r.id, { body: "Hi" })).status).toBe(401);
  });

  test("a user's comment is stored and counted in the same transaction", async () => {
    const { user, cookie } = await loginAs();
    const r = await newRequest();
    const res = await send(r.id, { body: "  Would love this  " }, cookie);
    expect(res.status).toBe(201);
    expect((await res.json()).comment).toMatchObject({
      kind: "user",
      body: "Would love this", // trimmed
      author: { id: user.id, role: "user" },
    });
    expect(await counts(r.id)).toEqual({ stored: 1, actual: 1 });
  });

  test("rejects empty and oversized bodies with field errors", async () => {
    const { cookie } = await loginAs();
    const r = await newRequest();
    for (const body of ["   ", "x".repeat(5001)]) {
      const res = await send(r.id, { body }, cookie);
      expect(res.status).toBe(400);
      expect((await res.json()).error.fields.body).toBeDefined();
    }
    expect(await counts(r.id)).toEqual({ stored: 0, actual: 0 });
  });

  test("404 for unknown requests, 409 with the target for merged ones", async () => {
    const { cookie } = await loginAs();
    const target = await newRequest();
    const dup = await insertRequest(target.authorId, { mergedIntoId: target.id });
    expect((await send(999, { body: "Hi" }, cookie)).status).toBe(404);
    const merged = await send(dup.id, { body: "Hi" }, cookie);
    expect(merged.status).toBe(409);
    expect((await merged.json()).error.details.mergedIntoId).toBe(target.id);
    expect(await counts(dup.id)).toEqual({ stored: 0, actual: 0 });
  });

  test("many people commenting at once are all counted", async () => {
    const r = await newRequest();
    const people = await Promise.all(Array.from({ length: 20 }, () => loginAs()));
    const responses = await Promise.all(people.map((p, i) => send(r.id, { body: `Comment ${i}` }, p.cookie)));
    expect(responses.every((res) => res.status === 201)).toBe(true);
    expect(await counts(r.id)).toEqual({ stored: 20, actual: 20 });
  });
});

describe("official responses", () => {
  test("an admin can post one", async () => {
    const admin = await loginAs("admin");
    const r = await newRequest();
    const res = await send(r.id, { body: "This is planned for Q3.", official: true }, admin.cookie);
    expect(res.status).toBe(201);
    expect((await res.json()).comment).toMatchObject({ kind: "official", author: { role: "admin" } });
  });

  test("a regular user asking for one gets 403, and nothing is posted", async () => {
    const { cookie } = await loginAs();
    const r = await newRequest();
    const res = await send(r.id, { body: "Official, trust me", official: true }, cookie);
    expect(res.status).toBe(403);
    expect(await counts(r.id)).toEqual({ stored: 0, actual: 0 });
  });

  test("an admin's normal comment stays a normal comment", async () => {
    const admin = await loginAs("admin");
    const r = await newRequest();
    const { comment } = await (await send(r.id, { body: "Just a thought" }, admin.cookie)).json();
    expect(comment.kind).toBe("user");
  });
});

describe("GET /api/requests/:id/comments", () => {
  test("is public and returns the thread oldest first, official responses included", async () => {
    const user = await loginAs();
    const admin = await loginAs("admin");
    const r = await newRequest();
    await send(r.id, { body: "First" }, user.cookie);
    await send(r.id, { body: "Official update", official: true }, admin.cookie);
    await send(r.id, { body: "Thanks!" }, user.cookie);

    const res = await list(makeRequest(`/api/requests/${r.id}/comments`), ctx(r.id));
    expect(res.status).toBe(200);
    const { comments: thread } = await res.json();
    expect(thread.map((c: { body: string; kind: string }) => [c.body, c.kind])).toEqual([
      ["First", "user"],
      ["Official update", "official"],
      ["Thanks!", "user"],
    ]);
  });

  test("404 for an unknown request", async () => {
    expect((await list(makeRequest("/api/requests/999/comments"), ctx(999))).status).toBe(404);
  });
});

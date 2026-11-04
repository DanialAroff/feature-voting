import { count, eq } from "drizzle-orm";
import { beforeEach, describe, expect, test } from "vitest";
import { DELETE as unvote, PUT as vote } from "@/app/api/requests/[id]/vote/route";
import { db } from "@/server/db";
import { requests, votes } from "@/server/db/schema";
import { createUser, insertRequest, loginAs, makeRequest, resetDb } from "@/test/helpers";

beforeEach(resetDb);

const ctx = (id: number | string) => ({ params: Promise.resolve({ id: String(id) }) });

function send(method: "PUT" | "DELETE", requestId: number | string, cookie?: string) {
  const handler = method === "PUT" ? vote : unvote;
  return handler(makeRequest(`/api/requests/${requestId}/vote`, { method, cookie }), ctx(requestId));
}

/** The invariant everything here protects: the counter equals the real rows. */
async function counts(requestId: number) {
  const [{ stored }] = await db.select({ stored: requests.voteCount }).from(requests).where(eq(requests.id, requestId));
  const [{ actual }] = await db.select({ actual: count() }).from(votes).where(eq(votes.requestId, requestId));
  return { stored, actual };
}

async function newRequest() {
  const author = await createUser();
  return insertRequest(author.id);
}

describe("authorization and lookup", () => {
  test("anonymous voting is rejected with 401", async () => {
    const r = await newRequest();
    expect((await send("PUT", r.id)).status).toBe(401);
    expect((await send("DELETE", r.id)).status).toBe(401);
  });

  test("unknown or non-numeric request ids give 404", async () => {
    const { cookie } = await loginAs();
    expect((await send("PUT", 999, cookie)).status).toBe(404);
    expect((await send("PUT", "abc", cookie)).status).toBe(404);
  });

  test("voting on a merged duplicate gives 409 with the target id", async () => {
    const { cookie } = await loginAs();
    const target = await newRequest();
    const dup = await insertRequest(target.authorId, { mergedIntoId: target.id });
    const res = await send("PUT", dup.id, cookie);
    expect(res.status).toBe(409);
    expect((await res.json()).error.details).toEqual({ mergedIntoId: target.id });
    expect(await counts(dup.id)).toEqual({ stored: 0, actual: 0 });
  });
});

describe("idempotency (R1, R6)", () => {
  test("PUT adds one vote; repeating it changes nothing", async () => {
    const { cookie } = await loginAs();
    const r = await newRequest();
    for (let i = 0; i < 3; i++) {
      const res = await send("PUT", r.id, cookie);
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ voted: true, voteCount: 1 });
    }
    expect(await counts(r.id)).toEqual({ stored: 1, actual: 1 });
  });

  test("DELETE removes the vote; repeating it never goes negative", async () => {
    const { cookie } = await loginAs();
    const r = await newRequest();
    await send("PUT", r.id, cookie);
    for (let i = 0; i < 3; i++) {
      expect(await (await send("DELETE", r.id, cookie)).json()).toEqual({ voted: false, voteCount: 0 });
    }
    expect(await counts(r.id)).toEqual({ stored: 0, actual: 0 });
  });

  test("an author can remove their automatic vote", async () => {
    const { user, cookie } = await loginAs();
    const r = await insertRequest(user.id, { voteCount: 1 });
    await db.insert(votes).values({ requestId: r.id, userId: user.id });
    expect(await (await send("DELETE", r.id, cookie)).json()).toEqual({ voted: false, voteCount: 0 });
  });

  test("one user's vote doesn't affect another's", async () => {
    const alice = await loginAs();
    const bob = await loginAs();
    const r = await newRequest();
    await send("PUT", r.id, alice.cookie);
    await send("PUT", r.id, bob.cookie);
    await send("DELETE", r.id, alice.cookie);
    expect(await counts(r.id)).toEqual({ stored: 1, actual: 1 });
  });
});

describe("concurrency (R5)", () => {
  test("many users voting at the same moment are all counted", async () => {
    const r = await newRequest();
    const voters = await Promise.all(Array.from({ length: 25 }, () => loginAs()));
    const responses = await Promise.all(voters.map((v) => send("PUT", r.id, v.cookie)));
    expect(responses.every((res) => res.status === 200)).toBe(true);
    expect(await counts(r.id)).toEqual({ stored: 25, actual: 25 });
  });

  test("one user firing the same vote in parallel ends with exactly one vote", async () => {
    const { cookie } = await loginAs();
    const r = await newRequest();
    const responses = await Promise.all(Array.from({ length: 15 }, () => send("PUT", r.id, cookie)));
    expect(responses.every((res) => res.status === 200)).toBe(true);
    expect(await counts(r.id)).toEqual({ stored: 1, actual: 1 });
  });

  test("interleaved votes and unvotes leave the counter equal to the real rows", async () => {
    const r = await newRequest();
    const voters = await Promise.all(Array.from({ length: 12 }, () => loginAs()));
    // Everyone votes, then half unvote while the others vote again, all at once.
    await Promise.all(voters.map((v) => send("PUT", r.id, v.cookie)));
    await Promise.all(voters.map((v, i) => send(i % 2 ? "DELETE" : "PUT", r.id, v.cookie)));
    expect(await counts(r.id)).toEqual({ stored: 6, actual: 6 });
  });
});

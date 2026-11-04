import { asc, count, eq } from "drizzle-orm";
import { beforeEach, describe, expect, test } from "vitest";
import { POST as merge } from "@/app/api/requests/[id]/merge/route";
import { PUT as vote } from "@/app/api/requests/[id]/vote/route";
import { GET as list } from "@/app/api/requests/route";
import { db } from "@/server/db";
import { comments, requestMerges, requests, votes } from "@/server/db/schema";
import { createUser, insertRequest, loginAs, makeRequest, noCtx, resetDb } from "@/test/helpers";
import { mergeRequests } from "./merge";

beforeEach(resetDb);

const ctx = (id: number | string) => ({ params: Promise.resolve({ id: String(id) }) });

function send(sourceId: number, targetId: unknown, cookie?: string) {
  return merge(makeRequest(`/api/requests/${sourceId}/merge`, { method: "POST", body: { targetId }, cookie }), ctx(sourceId));
}

/** Inserts votes and keeps the counter consistent, like the real vote path. */
async function addVotes(requestId: number, userIds: number[]) {
  if (userIds.length) await db.insert(votes).values(userIds.map((userId) => ({ requestId, userId })));
  await db.update(requests).set({ voteCount: userIds.length }).where(eq(requests.id, requestId));
}

async function addComment(requestId: number, authorId: number, body: string) {
  await db.insert(comments).values({ requestId, authorId, body });
  const [{ n }] = await db.select({ n: count() }).from(comments).where(eq(comments.requestId, requestId));
  await db.update(requests).set({ commentCount: n }).where(eq(requests.id, requestId));
}

async function snapshot(id: number) {
  const [r] = await db.select().from(requests).where(eq(requests.id, id));
  const voters = (await db.select({ u: votes.userId }).from(votes).where(eq(votes.requestId, id))).map((v) => v.u).sort((a, b) => a - b);
  const thread = await db.select().from(comments).where(eq(comments.requestId, id)).orderBy(asc(comments.id));
  return { ...r, voters, thread };
}

/** A duplicate pair with overlapping voters: c voted on both. */
async function scenario() {
  const [a, b, c, d] = await Promise.all([1, 2, 3, 4].map(() => createUser()));
  const target = await insertRequest(d.id, { title: "Email notifications" });
  const source = await insertRequest(a.id, { title: "Notify me on changes", description: "I want an email." });
  await addVotes(target.id, [c.id, d.id]);
  await addVotes(source.id, [a.id, b.id, c.id]);
  await addComment(source.id, b.id, "Same as the other one?");
  await addComment(target.id, d.id, "Please!");
  return { users: { a, b, c, d }, source, target };
}

describe("authorization", () => {
  test("anonymous → 401, regular user → 403, and nothing changes", async () => {
    const { source, target } = await scenario();
    const user = await loginAs("user");
    expect((await send(source.id, target.id)).status).toBe(401);
    expect((await send(source.id, target.id, user.cookie)).status).toBe(403);
    expect((await snapshot(source.id)).mergedIntoId).toBeNull();
  });

  test("the service refuses non-admins when called directly", async () => {
    const { source, target, users } = await scenario();
    const asUser = { id: users.a.id, email: users.a.email, displayName: "A", role: "user" as const };
    await expect(mergeRequests(asUser, source.id, target.id)).rejects.toMatchObject({ status: 403 });
  });
});

describe("merging preserves votes and comments", () => {
  test("voters are combined without double-counting anyone", async () => {
    const admin = await loginAs("admin");
    const { source, target, users } = await scenario();

    const res = await send(source.id, target.id, admin.cookie);
    expect(res.status).toBe(200);
    // a and b were only on the duplicate; c had voted on both.
    expect(await res.json()).toMatchObject({ movedVoteCount: 2, movedCommentCount: 1, alreadyMerged: false });

    const t = await snapshot(target.id);
    expect(t.voters).toEqual([users.a.id, users.b.id, users.c.id, users.d.id].sort((x, y) => x - y));
    expect(t.voteCount).toBe(4);
    const s = await snapshot(source.id);
    expect(s.voters).toEqual([]);
    expect(s).toMatchObject({ mergedIntoId: target.id, voteCount: 0, commentCount: 0 });
  });

  test("comments move with their origin, and the duplicate's wording is kept", async () => {
    const admin = await loginAs("admin");
    const { source, target } = await scenario();
    await send(source.id, target.id, admin.cookie);

    const { thread, commentCount } = await snapshot(target.id);
    const moved = thread.find((c) => c.body === "Same as the other one?");
    expect(moved?.originRequestId).toBe(source.id);
    const system = thread.find((c) => c.kind === "system");
    expect(system?.body).toContain("Notify me on changes");
    expect(system?.body).toContain("I want an email.");
    expect(commentCount).toBe(thread.length); // 1 original + 1 moved + 1 system
    expect(thread).toHaveLength(3);
  });

  test("an audit row records who merged what", async () => {
    const admin = await loginAs("admin");
    const { source, target } = await scenario();
    await send(source.id, target.id, admin.cookie);
    const [row] = await db.select().from(requestMerges);
    expect(row).toMatchObject({ sourceId: source.id, targetId: target.id, mergedById: admin.user.id, movedVoteCount: 2, movedCommentCount: 1 });
  });

  test("the duplicate disappears from the list", async () => {
    const admin = await loginAs("admin");
    const { source, target } = await scenario();
    await send(source.id, target.id, admin.cookie);
    const { items } = await (await list(makeRequest("/api/requests"), noCtx)).json();
    expect(items.map((r: { id: number }) => r.id)).toEqual([target.id]);
  });

  test("earlier duplicates of the source are re-pointed to the target (no chains)", async () => {
    const admin = await loginAs("admin");
    const { source, target } = await scenario();
    const older = await insertRequest(source.authorId, { mergedIntoId: source.id });
    await send(source.id, target.id, admin.cookie);
    expect((await snapshot(older.id)).mergedIntoId).toBe(target.id);
  });
});

describe("invalid merges", () => {
  test("into itself → 409; bad target id → 400; unknown requests → 404", async () => {
    const admin = await loginAs("admin");
    const { source } = await scenario();
    expect((await send(source.id, source.id, admin.cookie)).status).toBe(409);
    expect((await send(source.id, "abc", admin.cookie)).status).toBe(400);
    expect((await send(source.id, 999, admin.cookie)).status).toBe(404);
    expect((await send(999, source.id, admin.cookie)).status).toBe(404);
  });

  test("repeating the same merge is a safe no-op", async () => {
    const admin = await loginAs("admin");
    const { source, target } = await scenario();
    await send(source.id, target.id, admin.cookie);
    const before = await snapshot(target.id);
    const again = await send(source.id, target.id, admin.cookie);
    expect(again.status).toBe(200);
    expect(await again.json()).toMatchObject({ alreadyMerged: true, movedVoteCount: 0 });
    expect(await snapshot(target.id)).toEqual(before);
    expect(await db.select().from(requestMerges)).toHaveLength(1);
  });

  test("merging an already-merged source elsewhere, or into a tombstone, → 409", async () => {
    const admin = await loginAs("admin");
    const { source, target } = await scenario();
    const other = await insertRequest(target.authorId, { title: "Another one" });
    await send(source.id, target.id, admin.cookie);
    expect((await send(source.id, other.id, admin.cookie)).status).toBe(409); // source already merged
    expect((await send(other.id, source.id, admin.cookie)).status).toBe(409); // target is a tombstone
  });
});

describe("race conditions", () => {
  test("votes arriving during a merge are either moved or refused, never lost", async () => {
    const admin = await loginAs("admin");
    const { source, target } = await scenario();
    const voters = await Promise.all(Array.from({ length: 20 }, () => loginAs()));

    // Start the merge, then spread the votes out over the next ~40ms, so some
    // land before it, some while it holds its lock, and some after it commits.
    const mergeCall = send(source.id, target.id, admin.cookie);
    const voteCalls = voters.map(
      (v, i) =>
        new Promise<Response>((resolve) =>
          setTimeout(
            () => resolve(vote(makeRequest(`/api/requests/${source.id}/vote`, { method: "PUT", cookie: v.cookie }), ctx(source.id))),
            i * 2,
          ),
        ),
    );
    const [mergeRes, ...voteRes] = await Promise.all([mergeCall, ...voteCalls]);
    expect(mergeRes.status).toBe(200);

    const t = await snapshot(target.id);
    voteRes.forEach((res, i) => {
      // 200 = voted before the merge, so the vote was carried over; 409 = merge won, nothing stored.
      expect([200, 409]).toContain(res.status);
      expect(t.voters.includes(voters[i].user.id)).toBe(res.status === 200);
    });
    expect(t.voteCount).toBe(t.voters.length);
    expect((await snapshot(source.id)).voters).toEqual([]);
  });

  test("opposite merges at the same time: one wins, the other gets 409, no deadlock", async () => {
    const a = await loginAs("admin");
    const b = await loginAs("admin");
    const { source, target } = await scenario();
    const [ab, ba] = await Promise.all([send(source.id, target.id, a.cookie), send(target.id, source.id, b.cookie)]);
    expect([ab.status, ba.status].sort()).toEqual([200, 409]);
    const merges = await db.select().from(requestMerges);
    expect(merges).toHaveLength(1);
  });
});

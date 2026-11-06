import { beforeEach, describe, expect, test } from "vitest";
import { GET as stats } from "@/app/api/stats/route";
import { db } from "@/server/db";
import { comments, votes } from "@/server/db/schema";
import { createUser, insertRequest, loginAs, makeRequest, noCtx, resetDb } from "@/test/helpers";
import { getUsageStats } from "./stats";

beforeEach(resetDb);

const fetchStats = (cookie?: string) => stats(makeRequest("/api/stats", { cookie }), noCtx);
const daysAgo = (n: number) => new Date(Date.now() - n * 24 * 60 * 60 * 1000);

describe("GET /api/stats", () => {
  test("admins only: 401 anonymous, 403 users, also when calling the service directly", async () => {
    expect((await fetchStats()).status).toBe(401);
    const user = await loginAs("user");
    expect((await fetchStats(user.cookie)).status).toBe(403);
    const asUser = { id: user.user.id, email: user.user.email, displayName: "U", role: "user" as const };
    await expect(getUsageStats(asUser)).rejects.toMatchObject({ status: 403 });
  });

  test("counts are correct and leave out merged duplicates and merge notes", async () => {
    const admin = await loginAs("admin");
    const [a, b] = await Promise.all([createUser(), createUser()]);

    const planned = await insertRequest(a.id, { title: "Planned thing", status: "planned", voteCount: 2, commentCount: 1 });
    const fresh = await insertRequest(b.id, { title: "Fresh idea", voteCount: 1 });
    const old = await insertRequest(a.id, { title: "Old released", status: "released", createdAt: daysAgo(30), voteCount: 3 });
    await insertRequest(b.id, { title: "Merged dup", mergedIntoId: planned.id, createdAt: daysAgo(30) });

    await db.insert(votes).values([
      { requestId: planned.id, userId: a.id },
      { requestId: planned.id, userId: b.id },
      { requestId: fresh.id, userId: b.id },
      { requestId: old.id, userId: a.id, createdAt: daysAgo(20) },
      { requestId: old.id, userId: b.id, createdAt: daysAgo(20) },
      { requestId: old.id, userId: admin.user.id, createdAt: daysAgo(20) },
    ]);
    await db.insert(comments).values([
      { requestId: planned.id, authorId: b.id, body: "Nice" },
      { requestId: planned.id, authorId: admin.user.id, body: "Merged #4", kind: "system" },
    ]);

    const res = await fetchStats(admin.cookie);
    expect(res.status).toBe(200);
    const body = await res.json();

    expect(body.byStatus).toEqual({ under_review: 1, planned: 1, in_progress: 0, released: 1, declined: 0 });
    expect(body.totals).toEqual({ requests: 3, votes: 6, comments: 1, users: 3, mergedDuplicates: 1 });
    // This week: 2 live requests created now (the tombstone and "old" are 30 days old), 3 votes, 1 user comment.
    expect(body.last7Days).toEqual({ requests: 2, votes: 3, comments: 1 });
    expect(body.topRequests.map((r: { title: string }) => r.title)).toEqual(["Old released", "Planned thing", "Fresh idea"]);
  });

  test("an empty system returns zeros, not errors", async () => {
    const admin = await loginAs("admin");
    const body = await (await fetchStats(admin.cookie)).json();
    expect(body.totals).toEqual({ requests: 0, votes: 0, comments: 0, users: 1, mergedDuplicates: 0 });
    expect(body.byStatus.under_review).toBe(0);
    expect(body.topRequests).toEqual([]);
  });
});

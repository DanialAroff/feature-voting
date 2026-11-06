import "server-only";
import { and, count, desc, gte, isNotNull, isNull, ne, sql } from "drizzle-orm";
import { REQUEST_STATUSES } from "@/lib/requests";
import { assertAdmin } from "@/server/auth/policies";
import type { PublicUser } from "@/server/auth/types";
import { db } from "@/server/db";
import { comments, requests, users, votes, type RequestStatus } from "@/server/db/schema";

export type UsageStats = {
  generatedAt: Date;
  totals: { requests: number; votes: number; comments: number; users: number; mergedDuplicates: number };
  byStatus: Record<RequestStatus, number>;
  last7Days: { requests: number; votes: number; comments: number };
  topRequests: { id: number; title: string; status: RequestStatus; voteCount: number; commentCount: number }[];
};

const TOP_N = 5;
const weekAgo = sql`now() - interval '7 days'`;

/**
 * Admin usage statistics. All queries run in one read-only REPEATABLE READ
 * transaction, so every number comes from the same snapshot: a vote landing
 * between two queries can't make the totals disagree with each other.
 */
export async function getUsageStats(actor: PublicUser | null): Promise<UsageStats> {
  assertAdmin(actor);

  return db.transaction(
    async (tx) => {
      const live = isNull(requests.mergedIntoId); // tombstones aren't real requests any more
      const notSystem = ne(comments.kind, "system"); // merge notes aren't user activity

      const statusRows = await tx
        .select({ status: requests.status, n: count() })
        .from(requests)
        .where(live)
        .groupBy(requests.status);
      const byStatus = Object.fromEntries(REQUEST_STATUSES.map((s) => [s, 0])) as Record<RequestStatus, number>;
      for (const row of statusRows) byStatus[row.status] = row.n;

      const one = async (q: Promise<{ n: number }[]>) => (await q)[0].n;

      const totals = {
        requests: Object.values(byStatus).reduce((a, b) => a + b, 0),
        votes: await one(tx.select({ n: count() }).from(votes)),
        comments: await one(tx.select({ n: count() }).from(comments).where(notSystem)),
        users: await one(tx.select({ n: count() }).from(users)),
        mergedDuplicates: await one(tx.select({ n: count() }).from(requests).where(isNotNull(requests.mergedIntoId))),
      };

      // Activity: everything submitted this week, including requests later merged.
      const last7Days = {
        requests: await one(tx.select({ n: count() }).from(requests).where(gte(requests.createdAt, weekAgo))),
        votes: await one(tx.select({ n: count() }).from(votes).where(gte(votes.createdAt, weekAgo))),
        comments: await one(tx.select({ n: count() }).from(comments).where(and(notSystem, gte(comments.createdAt, weekAgo)))),
      };

      const topRequests = await tx
        .select({
          id: requests.id,
          title: requests.title,
          status: requests.status,
          voteCount: requests.voteCount,
          commentCount: requests.commentCount,
        })
        .from(requests)
        .where(live)
        .orderBy(desc(requests.voteCount), desc(requests.id))
        .limit(TOP_N);

      return { generatedAt: new Date(), totals, byStatus, last7Days, topRequests };
    },
    { isolationLevel: "repeatable read", accessMode: "read only" },
  );
}

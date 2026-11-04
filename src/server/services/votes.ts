import "server-only";
import { and, eq, sql } from "drizzle-orm";
import type { PublicUser } from "@/server/auth/types";
import { db } from "@/server/db";
import { requests, votes } from "@/server/db/schema";
import { mergedConflict, notFound } from "@/server/http/errors";

export type VoteState = { voted: boolean; voteCount: number };

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

// Integrity (docs/03-integrity-rules.md R1, R5, R6):
// - UNIQUE (request_id, user_id) makes a second vote impossible, even in a race.
// - The counter only moves when a row really changed, by an atomic +1/-1 in the
//   same transaction, so vote_count always equals COUNT(*) of votes.
// - PUT/DELETE describe the desired state, so retries are harmless.

/**
 * Locks the request row for the rest of the transaction. Votes on the same
 * request queue up here, and a concurrent merge (which locks the same row)
 * either finishes first, so we see the tombstone, or waits for us.
 */
async function lockLiveRequest(tx: Tx, requestId: number) {
  const [row] = await tx
    .select({ mergedIntoId: requests.mergedIntoId })
    .from(requests)
    .where(eq(requests.id, requestId))
    .for("update");
  if (!row) throw notFound("Request not found");
  if (row.mergedIntoId) throw mergedConflict(row.mergedIntoId);
}

async function currentCount(tx: Tx, requestId: number) {
  const [row] = await tx.select({ voteCount: requests.voteCount }).from(requests).where(eq(requests.id, requestId));
  return row.voteCount;
}

/** PUT: ensure the user has voted. A repeat is a no-op, not a second vote. */
export function castVote(user: PublicUser, requestId: number): Promise<VoteState> {
  return db.transaction(async (tx) => {
    await lockLiveRequest(tx, requestId);

    const inserted = await tx
      .insert(votes)
      .values({ requestId, userId: user.id })
      .onConflictDoNothing({ target: [votes.requestId, votes.userId] })
      .returning({ id: votes.id });

    if (inserted.length === 0) return { voted: true, voteCount: await currentCount(tx, requestId) };

    const [row] = await tx
      .update(requests)
      .set({ voteCount: sql`${requests.voteCount} + 1` })
      .where(eq(requests.id, requestId))
      .returning({ voteCount: requests.voteCount });
    return { voted: true, voteCount: row.voteCount };
  });
}

/** DELETE: ensure the user has not voted. Removing a missing vote is a no-op. */
export function removeVote(user: PublicUser, requestId: number): Promise<VoteState> {
  return db.transaction(async (tx) => {
    await lockLiveRequest(tx, requestId);

    const deleted = await tx
      .delete(votes)
      .where(and(eq(votes.requestId, requestId), eq(votes.userId, user.id)))
      .returning({ id: votes.id });

    if (deleted.length === 0) return { voted: false, voteCount: await currentCount(tx, requestId) };

    const [row] = await tx
      .update(requests)
      .set({ voteCount: sql`${requests.voteCount} - 1` })
      .where(eq(requests.id, requestId))
      .returning({ voteCount: requests.voteCount });
    return { voted: false, voteCount: row.voteCount };
  });
}

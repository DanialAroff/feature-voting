import "server-only";
import { and, asc, count, eq, inArray, ne, sql } from "drizzle-orm";
import { assertAdmin } from "@/server/auth/policies";
import type { PublicUser } from "@/server/auth/types";
import { db } from "@/server/db";
import { comments, requestMerges, requests, votes } from "@/server/db/schema";
import { conflict, notFound } from "@/server/http/errors";

export type MergeResult = {
  sourceId: number;
  targetId: number;
  movedVoteCount: number; // voters who were only on the duplicate
  movedCommentCount: number;
  alreadyMerged: boolean; // true when this exact merge had already happened (safe retry)
};

/**
 * Merges a duplicate (source) into the request to keep (target), preserving
 * votes and comments (business rule). Full design: docs/05-decisions.md § D6.
 * Everything happens in one transaction, so a failure leaves both untouched.
 */
export async function mergeRequests(actor: PublicUser | null, sourceId: number, targetId: number): Promise<MergeResult> {
  const admin = assertAdmin(actor);
  if (sourceId === targetId) throw conflict("A request can't be merged into itself");

  return db.transaction(async (tx) => {
    // 1. Lock both rows, always in id order. Two opposite merges running at
    //    once (A→B and B→A) then queue instead of deadlocking. Votes and
    //    comments lock the same rows, so none can slip in mid-merge.
    const rows = await tx
      .select({ id: requests.id, title: requests.title, description: requests.description, mergedIntoId: requests.mergedIntoId })
      .from(requests)
      .where(inArray(requests.id, [sourceId, targetId]))
      .orderBy(asc(requests.id))
      .for("update");
    const source = rows.find((r) => r.id === sourceId);
    const target = rows.find((r) => r.id === targetId);
    if (!source) throw notFound(`Request #${sourceId} not found`);
    if (!target) throw notFound(`Request #${targetId} not found`);

    // 2. No chains: only live requests take part.
    if (source.mergedIntoId === targetId) {
      return { sourceId, targetId, movedVoteCount: 0, movedCommentCount: 0, alreadyMerged: true };
    }
    if (source.mergedIntoId) throw conflict(`Request #${sourceId} was already merged into #${source.mergedIntoId}`);
    if (target.mergedIntoId) throw conflict(`Request #${targetId} was itself merged into #${target.mergedIntoId}; merge into that one instead`);

    // 3. Votes: copy to the target, skipping people who already voted there,
    //    so someone who voted on both ends up with exactly one vote.
    const moved = await tx.execute<{ id: number }>(sql`
      INSERT INTO ${votes} (request_id, user_id, created_at)
      SELECT ${targetId}, user_id, created_at FROM ${votes} WHERE request_id = ${sourceId}
      ON CONFLICT (request_id, user_id) DO NOTHING
      RETURNING id
    `);
    await tx.delete(votes).where(eq(votes.requestId, sourceId));

    // 4. Comments: move the whole thread, remembering where each came from.
    const movedComments = await tx
      .update(comments)
      .set({ requestId: targetId, originRequestId: sql`coalesce(${comments.originRequestId}, ${sourceId})` })
      .where(eq(comments.requestId, sourceId))
      .returning({ id: comments.id });

    // 5. Keep the duplicate's wording on the target, so nothing said is lost.
    await tx.insert(comments).values({
      requestId: targetId,
      authorId: admin.id,
      kind: "system",
      originRequestId: sourceId,
      body: `Merged #${sourceId} "${source.title}" into this request.\n\n${source.description}`,
    });

    // 6. Recompute the target's counters from the rows (safer than adding deltas).
    const [{ voteCount }] = await tx.select({ voteCount: count() }).from(votes).where(eq(votes.requestId, targetId));
    const [{ commentCount }] = await tx.select({ commentCount: count() }).from(comments).where(eq(comments.requestId, targetId));
    await tx.update(requests).set({ voteCount, commentCount, updatedAt: new Date() }).where(eq(requests.id, targetId));

    // 7. The duplicate becomes a tombstone that redirects to the target.
    await tx
      .update(requests)
      .set({ mergedIntoId: targetId, voteCount: 0, commentCount: 0, updatedAt: new Date() })
      .where(eq(requests.id, sourceId));
    // Earlier duplicates of the source now point straight at the target (one hop, never a chain).
    await tx
      .update(requests)
      .set({ mergedIntoId: targetId })
      .where(and(eq(requests.mergedIntoId, sourceId), ne(requests.id, targetId)));

    // 8. Audit trail; also powers "Merged from #N" on the target.
    await tx.insert(requestMerges).values({
      sourceId,
      targetId,
      mergedById: admin.id,
      movedVoteCount: moved.length,
      movedCommentCount: movedComments.length,
    });

    return { sourceId, targetId, movedVoteCount: moved.length, movedCommentCount: movedComments.length, alreadyMerged: false };
  });
}

/** Requests merged into this one, for the "Merged from" line on the detail page. */
export function getMergedFrom(targetId: number) {
  return db
    .select({ id: requests.id, title: requests.title, mergedAt: requestMerges.createdAt })
    .from(requestMerges)
    .innerJoin(requests, eq(requests.id, requestMerges.sourceId))
    .where(eq(requestMerges.targetId, targetId))
    .orderBy(asc(requestMerges.createdAt));
}

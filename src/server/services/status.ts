import "server-only";
import { asc, eq } from "drizzle-orm";
import { assertAdmin } from "@/server/auth/policies";
import type { PublicUser } from "@/server/auth/types";
import { db } from "@/server/db";
import { requests, statusChanges, users, type RequestStatus } from "@/server/db/schema";
import { mergedConflict, notFound } from "@/server/http/errors";

export type StatusChangeEntry = {
  id: number;
  fromStatus: RequestStatus;
  toStatus: RequestStatus;
  createdAt: Date;
  actor: { id: number; displayName: string };
};

/**
 * Admin-only status change (business rule: only administrators may change a
 * request's status). The status update and its history row commit together.
 * Setting the current status again is a no-op, so retries add no history.
 */
export async function changeStatus(
  actor: PublicUser | null,
  requestId: number,
  status: RequestStatus,
): Promise<{ status: RequestStatus; changed: boolean }> {
  // Checked here as well as in the route, so no future caller can skip it.
  const admin = assertAdmin(actor);

  return db.transaction(async (tx) => {
    // Lock: two admins changing the same request at once are serialized, so
    // the second one records the first one's result as its "from".
    const [current] = await tx
      .select({ status: requests.status, mergedIntoId: requests.mergedIntoId })
      .from(requests)
      .where(eq(requests.id, requestId))
      .for("update");
    if (!current) throw notFound("Request not found");
    if (current.mergedIntoId) throw mergedConflict(current.mergedIntoId);
    if (current.status === status) return { status, changed: false };

    await tx.update(requests).set({ status, updatedAt: new Date() }).where(eq(requests.id, requestId));
    await tx.insert(statusChanges).values({
      requestId,
      actorId: admin.id,
      fromStatus: current.status,
      toStatus: status,
    });
    return { status, changed: true };
  });
}

/** Public progress timeline, oldest first. */
export function getStatusHistory(requestId: number): Promise<StatusChangeEntry[]> {
  return db
    .select({
      id: statusChanges.id,
      fromStatus: statusChanges.fromStatus,
      toStatus: statusChanges.toStatus,
      createdAt: statusChanges.createdAt,
      actor: { id: users.id, displayName: users.displayName },
    })
    .from(statusChanges)
    .innerJoin(users, eq(users.id, statusChanges.actorId))
    .where(eq(statusChanges.requestId, requestId))
    .orderBy(asc(statusChanges.createdAt), asc(statusChanges.id));
}

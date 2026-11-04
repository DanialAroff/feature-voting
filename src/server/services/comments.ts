import "server-only";
import { asc, eq, sql } from "drizzle-orm";
import type { CreateCommentInput } from "@/lib/validation/comments";
import { assertAdmin } from "@/server/auth/policies";
import type { PublicUser } from "@/server/auth/types";
import { db } from "@/server/db";
import { comments, requests, users, type Comment, type UserRole } from "@/server/db/schema";
import { mergedConflict, notFound } from "@/server/http/errors";

export type CommentView = {
  id: number;
  kind: Comment["kind"];
  body: string;
  createdAt: Date;
  originRequestId: number | null; // set when a merge moved it here
  author: { id: number; displayName: string; role: UserRole };
};

const commentColumns = {
  id: comments.id,
  kind: comments.kind,
  body: comments.body,
  createdAt: comments.createdAt,
  originRequestId: comments.originRequestId,
  author: { id: users.id, displayName: users.displayName, role: users.role },
};

/**
 * Adds a comment, or an official response when an admin asks for one (D3).
 * Same integrity pattern as votes: lock the request row, insert, and move the
 * denormalized counter atomically in the same transaction.
 */
export async function addComment(user: PublicUser, requestId: number, input: CreateCommentInput): Promise<CommentView> {
  if (input.official) assertAdmin(user);

  const id = await db.transaction(async (tx) => {
    const [request] = await tx
      .select({ mergedIntoId: requests.mergedIntoId })
      .from(requests)
      .where(eq(requests.id, requestId))
      .for("update");
    if (!request) throw notFound("Request not found");
    if (request.mergedIntoId) throw mergedConflict(request.mergedIntoId);

    const [created] = await tx
      .insert(comments)
      .values({ requestId, authorId: user.id, body: input.body, kind: input.official ? "official" : "user" })
      .returning({ id: comments.id });
    await tx
      .update(requests)
      .set({ commentCount: sql`${requests.commentCount} + 1` })
      .where(eq(requests.id, requestId));
    return created.id;
  });

  const [view] = await db
    .select(commentColumns)
    .from(comments)
    .innerJoin(users, eq(users.id, comments.authorId))
    .where(eq(comments.id, id));
  return view;
}

/** The whole thread, oldest first. Official responses are part of it. */
export function listComments(requestId: number): Promise<CommentView[]> {
  return db
    .select(commentColumns)
    .from(comments)
    .innerJoin(users, eq(users.id, comments.authorId))
    .where(eq(comments.requestId, requestId))
    .orderBy(asc(comments.createdAt), asc(comments.id));
}

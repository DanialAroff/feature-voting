import "server-only";
import { and, count, desc, eq, ilike, isNull, or, sql, type SQL } from "drizzle-orm";
import { PAGE_SIZE, type RequestSort } from "@/lib/requests";
import type { CreateRequestInput, ListQuery } from "@/lib/validation/requests";
import type { PublicUser } from "@/server/auth/types";
import { db } from "@/server/db";
import { requests, users, votes, type RequestStatus } from "@/server/db/schema";

export type RequestSummary = {
  id: number;
  title: string;
  status: RequestStatus;
  voteCount: number;
  commentCount: number;
  createdAt: Date;
  author: { id: number; displayName: string };
  hasVoted: boolean;
};

export type RequestDetail = RequestSummary & {
  description: string;
  updatedAt: Date;
  mergedIntoId: number | null;
};

export type RequestPage = {
  items: RequestSummary[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
};

// "Did the viewer vote?" as a correlated EXISTS, served by votes_request_user_uq.
function hasVotedColumn(viewerId: number | null) {
  return viewerId
    ? sql<boolean>`exists (select 1 from ${votes} where ${votes.requestId} = ${requests.id} and ${votes.userId} = ${viewerId})`
    : sql<boolean>`false`;
}

function summaryColumns(viewerId: number | null) {
  return {
    id: requests.id,
    title: requests.title,
    status: requests.status,
    voteCount: requests.voteCount,
    commentCount: requests.commentCount,
    createdAt: requests.createdAt,
    author: { id: users.id, displayName: users.displayName },
    hasVoted: hasVotedColumn(viewerId),
  };
}

// id is the tiebreak, so paging is stable when counts or timestamps are equal.
const ORDER: Record<RequestSort, SQL[]> = {
  top: [desc(requests.voteCount), desc(requests.id)],
  new: [desc(requests.createdAt), desc(requests.id)],
  comments: [desc(requests.commentCount), desc(requests.id)],
};

// Treat the user's text literally: "%" and "_" are LIKE wildcards otherwise.
const likePattern = (q: string) => `%${q.replace(/[\\%_]/g, "\\$&")}%`;

export async function listRequests(query: ListQuery, viewerId: number | null): Promise<RequestPage> {
  const where = and(
    isNull(requests.mergedIntoId), // merged duplicates are tombstones, never listed
    query.status ? eq(requests.status, query.status) : undefined,
    query.q ? or(ilike(requests.title, likePattern(query.q)), ilike(requests.description, likePattern(query.q))) : undefined,
  );

  const [items, [{ total }]] = await Promise.all([
    db
      .select(summaryColumns(viewerId))
      .from(requests)
      .innerJoin(users, eq(users.id, requests.authorId))
      .where(where)
      .orderBy(...ORDER[query.sort])
      .limit(PAGE_SIZE)
      .offset((query.page - 1) * PAGE_SIZE),
    db.select({ total: count() }).from(requests).where(where),
  ]);

  return { items, page: query.page, pageSize: PAGE_SIZE, total, totalPages: Math.max(1, Math.ceil(total / PAGE_SIZE)) };
}

export async function getRequest(id: number, viewerId: number | null): Promise<RequestDetail | null> {
  const [row] = await db
    .select({
      ...summaryColumns(viewerId),
      description: requests.description,
      updatedAt: requests.updatedAt,
      mergedIntoId: requests.mergedIntoId,
    })
    .from(requests)
    .innerJoin(users, eq(users.id, requests.authorId))
    .where(eq(requests.id, id));
  return row ?? null;
}

// Request + the author's own vote (D4) commit together or not at all.
export async function createRequest(author: PublicUser, input: CreateRequestInput): Promise<RequestDetail> {
  const id = await db.transaction(async (tx) => {
    const [created] = await tx
      .insert(requests)
      // Status and author come from the server, never from the request body.
      .values({ title: input.title, description: input.description, authorId: author.id, voteCount: 1 })
      .returning({ id: requests.id });
    await tx.insert(votes).values({ requestId: created.id, userId: author.id });
    return created.id;
  });
  return (await getRequest(id, author.id))!;
}

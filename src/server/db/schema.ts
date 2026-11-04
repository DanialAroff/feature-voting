// Database schema. Integrity rules from docs/03-integrity-rules.md are enforced here
// as constraints, not only in application code.
import { relations, sql } from "drizzle-orm";
import {
  check,
  index,
  integer,
  pgEnum,
  pgTable,
  text,
  timestamp,
  unique,
  uniqueIndex,
  type AnyPgColumn,
} from "drizzle-orm/pg-core";

// ── Enums ────────────────────────────────────────────────────────────────────

export const userRole = pgEnum("user_role", ["user", "admin"]);

export const requestStatus = pgEnum("request_status", [
  "under_review",
  "planned",
  "in_progress",
  "released",
  "declined",
]);

// "official" = admin response (D3); "system" = generated note, e.g. on merge (D6).
export const commentKind = pgEnum("comment_kind", ["user", "official", "system"]);

const createdAt = () => timestamp({ withTimezone: true }).notNull().defaultNow();

// ── Users & sessions (D2) ────────────────────────────────────────────────────

export const users = pgTable(
  "users",
  {
    id: integer().primaryKey().generatedAlwaysAsIdentity(),
    email: text().notNull(),
    displayName: text().notNull(),
    passwordHash: text().notNull(),
    role: userRole().notNull().default("user"),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("users_email_lower_uq").on(sql`lower(${t.email})`)],
);

export const sessions = pgTable(
  "sessions",
  {
    // SHA-256 of the cookie token; the raw token is never stored.
    id: text().primaryKey(),
    userId: integer()
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    expiresAt: timestamp({ withTimezone: true }).notNull(),
    createdAt: createdAt(),
  },
  (t) => [index("sessions_user_id_idx").on(t.userId)],
);

// ── Feature requests ─────────────────────────────────────────────────────────

export const requests = pgTable(
  "requests",
  {
    id: integer().primaryKey().generatedAlwaysAsIdentity(),
    title: text().notNull(),
    description: text().notNull(),
    status: requestStatus().notNull().default("under_review"),
    authorId: integer()
      .notNull()
      .references(() => users.id),
    // Non-null = tombstone of a merged duplicate (D6).
    mergedIntoId: integer().references((): AnyPgColumn => requests.id),
    // Denormalized counters, only changed atomically in the same transaction
    // as the vote/comment row (D5).
    voteCount: integer().notNull().default(0),
    commentCount: integer().notNull().default(0),
    createdAt: createdAt(),
    updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check("requests_vote_count_nonneg", sql`${t.voteCount} >= 0`),
    check("requests_comment_count_nonneg", sql`${t.commentCount} >= 0`),
    check("requests_not_merged_into_self", sql`${t.mergedIntoId} <> ${t.id}`),
    check("requests_title_length", sql`char_length(${t.title}) between 3 and 120`),
    check("requests_description_length", sql`char_length(${t.description}) between 1 and 5000`),
    // List page: live requests by status, sorted by votes or recency.
    index("requests_live_votes_idx")
      .on(t.voteCount.desc(), t.id.desc())
      .where(sql`${t.mergedIntoId} is null`),
    index("requests_live_created_idx")
      .on(t.createdAt.desc())
      .where(sql`${t.mergedIntoId} is null`),
    index("requests_status_idx").on(t.status),
    index("requests_author_id_idx").on(t.authorId),
    index("requests_merged_into_id_idx").on(t.mergedIntoId),
  ],
);

// ── Votes (R1, R5, R6) ───────────────────────────────────────────────────────

export const votes = pgTable(
  "votes",
  {
    id: integer().primaryKey().generatedAlwaysAsIdentity(),
    requestId: integer()
      .notNull()
      .references(() => requests.id, { onDelete: "cascade" }),
    userId: integer()
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    createdAt: createdAt(),
  },
  // The one-vote-per-user rule lives in the database, so races and retries
  // cannot create duplicates whatever the application does.
  (t) => [
    unique("votes_request_user_uq").on(t.requestId, t.userId),
    index("votes_user_id_idx").on(t.userId),
  ],
);

// ── Comments (incl. official responses, D3) ──────────────────────────────────

export const comments = pgTable(
  "comments",
  {
    id: integer().primaryKey().generatedAlwaysAsIdentity(),
    requestId: integer()
      .notNull()
      .references(() => requests.id, { onDelete: "cascade" }),
    authorId: integer()
      .notNull()
      .references(() => users.id),
    kind: commentKind().notNull().default("user"),
    body: text().notNull(),
    // Set when the comment was moved here by a merge: "originally on #N".
    originRequestId: integer().references(() => requests.id),
    createdAt: createdAt(),
  },
  (t) => [
    check("comments_body_length", sql`char_length(${t.body}) between 1 and 5000`),
    index("comments_request_created_idx").on(t.requestId, t.createdAt),
  ],
);

// ── Audit: status history & merges ───────────────────────────────────────────

export const statusChanges = pgTable(
  "status_changes",
  {
    id: integer().primaryKey().generatedAlwaysAsIdentity(),
    requestId: integer()
      .notNull()
      .references(() => requests.id, { onDelete: "cascade" }),
    actorId: integer()
      .notNull()
      .references(() => users.id),
    fromStatus: requestStatus().notNull(),
    toStatus: requestStatus().notNull(),
    createdAt: createdAt(),
  },
  (t) => [index("status_changes_request_idx").on(t.requestId, t.createdAt)],
);

export const requestMerges = pgTable(
  "request_merges",
  {
    id: integer().primaryKey().generatedAlwaysAsIdentity(),
    // Unique: a request can only be merged away once (no chains, D6).
    sourceId: integer()
      .notNull()
      .unique("request_merges_source_uq")
      .references(() => requests.id),
    targetId: integer()
      .notNull()
      .references(() => requests.id),
    mergedById: integer()
      .notNull()
      .references(() => users.id),
    movedVoteCount: integer().notNull(),
    movedCommentCount: integer().notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    check("request_merges_not_self", sql`${t.sourceId} <> ${t.targetId}`),
    index("request_merges_target_idx").on(t.targetId),
  ],
);

// ── Relations (for Drizzle's relational query API) ───────────────────────────

export const usersRelations = relations(users, ({ many }) => ({
  requests: many(requests),
  votes: many(votes),
  comments: many(comments),
  sessions: many(sessions),
}));

export const sessionsRelations = relations(sessions, ({ one }) => ({
  user: one(users, { fields: [sessions.userId], references: [users.id] }),
}));

export const requestsRelations = relations(requests, ({ one, many }) => ({
  author: one(users, { fields: [requests.authorId], references: [users.id] }),
  mergedInto: one(requests, {
    fields: [requests.mergedIntoId],
    references: [requests.id],
    relationName: "merged",
  }),
  mergedFrom: many(requestMerges, { relationName: "mergeTarget" }),
  votes: many(votes),
  comments: many(comments, { relationName: "requestComments" }),
  statusChanges: many(statusChanges),
}));

export const votesRelations = relations(votes, ({ one }) => ({
  request: one(requests, { fields: [votes.requestId], references: [requests.id] }),
  user: one(users, { fields: [votes.userId], references: [users.id] }),
}));

export const commentsRelations = relations(comments, ({ one }) => ({
  request: one(requests, {
    fields: [comments.requestId],
    references: [requests.id],
    relationName: "requestComments",
  }),
  author: one(users, { fields: [comments.authorId], references: [users.id] }),
}));

export const statusChangesRelations = relations(statusChanges, ({ one }) => ({
  request: one(requests, { fields: [statusChanges.requestId], references: [requests.id] }),
  actor: one(users, { fields: [statusChanges.actorId], references: [users.id] }),
}));

export const requestMergesRelations = relations(requestMerges, ({ one }) => ({
  source: one(requests, { fields: [requestMerges.sourceId], references: [requests.id] }),
  target: one(requests, {
    fields: [requestMerges.targetId],
    references: [requests.id],
    relationName: "mergeTarget",
  }),
  mergedBy: one(users, { fields: [requestMerges.mergedById], references: [users.id] }),
}));

// ── Types ────────────────────────────────────────────────────────────────────

export type User = typeof users.$inferSelect;
export type Request = typeof requests.$inferSelect;
export type Vote = typeof votes.$inferSelect;
export type Comment = typeof comments.$inferSelect;
export type RequestStatus = (typeof requestStatus.enumValues)[number];
export type UserRole = (typeof userRole.enumValues)[number];

# 06 — Database Design: Choices, Pros & Cons

Source of truth: `src/server/db/schema.ts`. Generated SQL: `drizzle/0000_init.sql`.
Related decisions: D2 (sessions), D3 (official response), D5 (votes), D6 (merge), D7 (Drizzle) in
[05-decisions.md](05-decisions.md).

## Overview

```
users ─┬─< sessions
       ├─< requests ─┬─< votes >── users          UNIQUE (request_id, user_id)
       │             ├─< comments >── users       kind: user | official | system
       │             ├─< status_changes >── users
       │             └── merged_into_id ──> requests (self-reference, tombstone)
       └─< request_merges (source_id UNIQUE, target_id) ──> requests
```

---

## 1. Enforce integrity in the database, not only in application code

**Choice.** UNIQUE constraints, CHECK constraints and foreign keys back up every business rule
that can be expressed in SQL. The service layer validates as well, giving friendly errors.

| Constraint | Protects |
| --- | --- |
| `votes_request_user_uq` UNIQUE (request_id, user_id) | One vote per user (R1), retries (R6), races (R5) |
| `requests_vote_count_nonneg`, `requests_comment_count_nonneg` | Counter drift going negative |
| `requests_not_merged_into_self`, `request_merges_not_self` | Self-merge |
| `request_merges_source_uq` UNIQUE (source_id) | A request merged away twice |
| `requests_title_length`, `requests_description_length`, `comments_body_length` | Oversized or empty text |
| `users_email_lower_uq` | Duplicate accounts by email case |

**Pros.**
- Correct even with app bugs, race conditions, retries, scripts, or a second service writing to the DB later.
- The rules can be read straight from the migration file, which supports "make integrity visible".
- Concurrency-safe for free: Postgres serializes the unique check, so no app-level locking is needed for votes.

**Cons.**
- Rules are duplicated: Zod limits in the API and CHECKs in the DB must be kept in sync.
- Constraint violations are low-level errors that the service must map to 400/409 responses.
- Changing a rule needs a migration, not just a code change.

**Alternative rejected.** Application-only checks (`SELECT` then `INSERT`). This races: two
concurrent requests both see "no vote yet" and both insert.

---

## 2. Integer identity primary keys

**Choice.** `integer GENERATED ALWAYS AS IDENTITY` for every table except `sessions`.

**Pros.**
- Small (4 bytes) and fast to index and join.
- Human-friendly request numbers (`#34`), which suit a feedback board and the "merged from #12" UI.
- `GENERATED ALWAYS` stops the app from accidentally writing its own IDs.

**Cons.**
- Guessable and enumerable: IDs reveal roughly how many requests or users exist, and allow walking `/requests/1..N`. That's acceptable here because requests are public anyway. User IDs are never exposed in URLs.
- `integer` caps at about 2.1 billion. Fine for this domain; it can be widened to `bigint` with a migration.
- Gaps appear after rolled-back transactions. This is harmless but surprises people.

**Alternative.** UUID v7: not guessable, generatable on the client, safe across shards. It's larger,
less readable, and has no benefit for a single database.

---

## 3. Postgres enums for status, role and comment kind

**Choice.** `pgEnum` for `request_status`, `user_role` and `comment_kind`.

**Pros.**
- Invalid values are impossible at the DB level.
- Drizzle infers TypeScript union types from the enum, so the code and DB share one definition.
- Compact storage.

**Cons.**
- Adding a value needs a migration (`ALTER TYPE … ADD VALUE`). Removing or renaming a value is painful.
- No room for per-status metadata (colour, order, label).

**Alternatives.**
- *Lookup table* (`statuses(id, label, sort_order)`): flexible and admin-editable, but needs joins and
  is overkill for a fixed, brief-defined set.
- *`text` + CHECK constraint*: easier to change, but loses the enum's type inference.

---

## 4. Denormalized `vote_count` and `comment_count`

**Choice.** Counters stored on `requests` and changed atomically (`SET vote_count = vote_count + 1`)
in the same transaction as the vote or comment insert, only when a row really changed. Merge
recomputes the counters from `COUNT(*)`.

**Pros.**
- Sorting by most votes is an index scan (`requests_live_votes_idx`), not a `GROUP BY` over all votes.
- The list page reads one table, with no join or aggregate per row.

**Cons.**
- Two sources of truth that can drift if any write path forgets the counter. Mitigations: a single
  service function per write, the non-negative CHECK, and an integration test asserting
  `vote_count = COUNT(*)`.
- A very popular request concentrates updates on one row (lock contention under heavy concurrent voting).
  Scaling path: sharded counters or async aggregation.

**Alternative.** Always `COUNT(*)`: always correct, and simple at small scale, but sorting gets
slow as votes grow.

---

## 5. Merged requests are tombstones (`merged_into_id`)

**Choice.** A merged duplicate stays in `requests`, with `merged_into_id` pointing to the target.
Live queries filter `WHERE merged_into_id IS NULL`.

**Pros.**
- Old links and bookmarks still resolve and redirect to the target.
- Preserves history and audit, and makes a future un-merge possible.
- One self-referencing FK; no extra table needed to answer "where did #12 go?".

**Cons.**
- Every live query must remember the filter. Partial indexes help with performance, but forgetting the filter shows duplicates.
- Tombstone rows take space forever (negligible).

**Alternatives.** Hard-delete the source (breaks links, loses history), or a separate status value
`merged` (mixes a lifecycle state with an identity relationship, and the brief fixes the statuses).

---

## 6. Separate `request_merges` audit table

**Choice.** One row per merge: source, target, who, when, and how many votes and comments moved.
`source_id` is UNIQUE.

**Pros.**
- Powers "Merged from #12, #34" on the target page with a single indexed lookup.
- Audit trail for admins and for discussion.
- The UNIQUE source enforces "merged away at most once" in the DB.

**Cons.**
- Partly redundant with `requests.merged_into_id`; both are written in the same transaction.
- Moved counts are a snapshot, not enough to replay an un-merge (that would need the moved row IDs).

---

## 7. Comments: one table, `kind` enum, `origin_request_id`

**Choice.** User comments, official admin responses and system notes share `comments`, told apart by
`kind`. Comments moved by a merge keep `origin_request_id`.

**Pros.**
- One query renders the whole thread, and `comment_count` stays meaningful.
- Official responses keep their history (several updates over time).
- Merge provenance ("originally on #12") without copying rows.

**Cons.**
- "Latest official response" needs a filtered query (`kind = 'official' ORDER BY created_at DESC LIMIT 1`).
- System comments still need an `author_id`. We use the admin who performed the merge.
- Whether system comments count in `comment_count` is a product choice (decide in the service).

**Alternative.** A `requests.official_response` column: simpler to render, but no history and a
separate edit flow.

---

## 8. `status_changes` history table

**Choice.** Every status change inserts a row (from, to, actor, time) in the same transaction.

**Pros.**
- Gives users a "follow progress" timeline.
- Accountability: shows which admin changed what.
- Feeds stats (e.g. time from Under Review to Released).

**Cons.**
- Extra write per change (trivial).
- Only covers status. A general audit log for all admin actions is deferred.

---

## 9. Sessions store a hash of the token

**Choice.** `sessions.id` = SHA-256 of a random cookie token. The raw token exists only in the cookie.

**Pros.**
- A leaked DB dump or backup can't be used to hijack sessions.
- Revocation is a `DELETE`. `ON DELETE CASCADE` from users removes the sessions of deleted users.

**Cons.**
- One indexed lookup per authenticated request.
- Expired rows need periodic cleanup (deferred: a cron job, or delete-on-read).

---

## 10. Case-insensitive email via a `lower(email)` unique index

**Choice.** Unique expression index on `lower(email)`. Emails are stored as entered.

**Pros.** Blocks `A@x.com` vs `a@x.com` duplicates without an extension.

**Cons.**
- Lookups must use `lower(email) = lower($1)` to hit the index. The repository function must do this consistently.

**Alternative.** The `citext` column type. It's cleaner to query but needs a Postgres extension.

---

## 11. Foreign key delete behaviour

**Choice.**
- `CASCADE` from requests to votes, comments and status_changes.
- `CASCADE` from users to sessions and votes.
- `NO ACTION` (block the delete) from users to requests and comments, and on merge references.

**Pros.**
- Can't orphan content.
- Deleting a user can't silently erase other people's discussions.

**Cons.**
- Deleting a user who authored content fails. A real product needs soft-delete or anonymisation
  ("deleted user"), which is deferred.
- Cascading votes on user delete changes request counters. The service must recompute them, or
  soft-delete must be used instead.

---

## 12. Indexes

| Index | Serves |
| --- | --- |
| `requests_live_votes_idx` (vote_count DESC, id DESC) WHERE not merged | List sorted by top votes, with a stable tiebreak |
| `requests_live_created_idx` (created_at DESC) WHERE not merged | List sorted by newest |
| `requests_status_idx` | Status filter and stats |
| `comments_request_created_idx` (request_id, created_at) | Detail page thread in order |
| `status_changes_request_idx`, `request_merges_target_idx` | Detail page timeline and "merged from" |
| `votes_request_user_uq` (also an index) | Vote lookup and "did I vote?" |
| `votes_user_id_idx`, `requests_author_id_idx`, `sessions_user_id_idx` | FK lookups, "my requests" |

**Pros.**
- Partial indexes stay small (no tombstones) and match the exact list queries.

**Cons.**
- Each index slows writes slightly and must match query shape. A status filter combined with a vote sort may want a
  composite `(status, vote_count DESC)` later; add it once `EXPLAIN` shows the need.
- **No search index yet.** Search uses `ILIKE`, which does a sequential scan. Fine for thousands
  of rows. The scaling path is a `pg_trgm` GIN index or a generated `tsvector` column with a GIN
  index, then a dedicated search engine.

---

## 13. Other conventions

| Choice | Pros | Cons |
| --- | --- | --- |
| `timestamptz` everywhere | Unambiguous instants, no time-zone bugs | None worth noting |
| snake_case columns via Drizzle `casing` | Idiomatic SQL, camelCase in TS, no manual name mapping | The setting must match in both the client and drizzle-kit config |
| Generated SQL migrations committed to git | Reviewable, repeatable, same on every machine (brief requirement) | Must never edit an applied migration; fix forward with a new one |
| Separate `feature_voting_test` database | Tests can truncate freely without touching dev data | Must run migrations against it too |
| `updated_at` maintained by the app, not a trigger | No hidden DB logic | Easy to forget on an update path |

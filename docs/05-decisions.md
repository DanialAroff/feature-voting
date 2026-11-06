# 05 — Decision Log

Each entry: decision, why, and rejected alternatives. This feeds the "Architecture & trade-offs"
section of the README (15% of the grade).

---

## D1. Next.js (App Router) + Postgres, with an explicit REST API

**Decision.** One Next.js app. Pages are server components that call a **service layer**
(`src/server/services/*`) directly for reads. All **mutations go through Route Handlers**
(`app/api/**/route.ts`) that call the same services.

```
app/(pages)          → server components (read via services) + client components (mutate via fetch)
app/api/**/route.ts  → thin HTTP layer: parse (Zod) → auth → service → map errors
src/server/services  → business rules, authorization, transactions
src/server/db        → Drizzle schema, client, migrations
```

**Why.**
- The brief asks for "a consistent backend interface". Route Handlers give a real, testable,
  documentable HTTP API.
- Server Actions only support POST, which conflicts with idempotent `PUT`/`DELETE` vote semantics (D5).
- Putting rules in services, not routes or components, means a new route can't skip them, and
  they can be unit/integration tested without HTTP.

**Rejected.**
- *Server Actions for everything:* less code, but no explicit API contract, POST-only, harder to
  show idempotency.
- *Separate backend (NestJS/Fastify):* cleaner split, but costs ~1h of the timebox in duplicate
  setup. Listed as a scaling path: the service layer can be lifted out unchanged.

ORM choice is its own decision. See D7.

---

## D2. Auth: database sessions + httpOnly cookie, not JWT

**Decision.** On login, create a row in `sessions (id, user_id, token_hash, expires_at)`, set an
opaque random token in a cookie with `HttpOnly; Secure; SameSite=Lax; Path=/`. Each request
looks up the session and loads the user (including the **current** role). Passwords hashed with
argon2id (or bcrypt).

**Why a session cookie is enough, and better here.**
- The security comes from **where the token is stored** (an httpOnly cookie that JavaScript can't
  read, so XSS can't steal it), not from the token being a JWT. A JWT in localStorage is *less*
  secure than a session cookie.
- **Revocation:** logout, ban, or demoting an admin takes effect immediately. A JWT stays valid
  until it expires unless you add a denylist, and a denylist is a session table again.
- **Role freshness:** "only admins may change status" is checked against the DB role, not a
  claim frozen in a token.
- One web client on one domain, so stateless tokens buy nothing. The cost is one indexed
  lookup per request, which is negligible.

**CSRF.** `SameSite=Lax` blocks cross-site POST/PUT/DELETE with the cookie. Also check the
`Origin` header on mutating routes. Both are cheap and easy to talk through.

**Rejected.**
- *JWT:* suits multiple services, mobile clients, or third-party API consumers. Mention it as the
  path if a public API or mobile app is added (short-lived access JWT + rotating refresh token).
- *Auth.js Credentials provider:* it forces the JWT session strategy for credentials, and hides
  the authz mechanics we want to show. *Better Auth* is a reasonable fallback if time gets tight.

---

## D3. Official response = flagged comment

**Decision.** `comments.kind` enum: `user` (default), `official`, `system`. Only admins can
create `official` (enforced in the service). `system` is generated, e.g. the merge note in D6.
An enum rather than an `is_official` boolean so the merge's system comment doesn't need a
second flag. The UI pins the latest official comment at the top of the detail page
with a distinct style, and also shows it in its place in the thread.

**Why.** One table and one endpoint. It keeps history (several official updates over time) and
the comment count stays consistent.

**Rejected.** A dedicated `requests.official_response` column. It's simpler to render but keeps
no history, needs a separate endpoint, and needs separate merge handling.

---

## D4. Author auto-votes (Reddit-style)

**Decision.** Creating a request inserts the request **and** the author's vote in the same
transaction, so a new request starts with `vote_count = 1`.

**Notes.**
- It's an ordinary vote row, so the author can remove it, and every integrity rule applies
  unchanged.
- It barely skews ranking because every request gets exactly +1. Sorting is unaffected relative
  to other requests.
- Merge dedupe (D6) handles the case where the author of the source also voted on the target.

---

## D5. Votes are idempotent state, not a toggle

**Decision.** `PUT /api/requests/:id/vote` (ensure voted) and `DELETE /api/requests/:id/vote`
(ensure not voted). Both return `{ voted, voteCount }`.

```sql
-- PUT, inside a transaction
INSERT INTO votes (request_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING RETURNING id;
-- only if a row was returned:
UPDATE requests SET vote_count = vote_count + 1 WHERE id = $1;
```

**Why.** A retried PUT stays a no-op, while a retried toggle would flip the vote back. The
UNIQUE constraint makes duplicate votes impossible even under a race. The atomic `+1`/`-1` only
runs when a row actually changed, so the count stays correct under concurrency.

**Rejected.** `POST /toggle` (not idempotent). Computing `COUNT(*)` on every list read is correct
but slow at scale for sorting. A denormalized count plus a reconciliation test is the trade-off
we take.

---

## D6. Merge duplicates: tombstone + redirect + provenance

Your instinct ("see the merged request IDs on the merged version") is right. Here it is fully
specified:

**Data.**
- `requests.merged_into_id` (nullable FK). A non-null value means the request is a tombstone.
- `request_merges (id, source_id, target_id, merged_by, merged_at, moved_vote_count,
  moved_comment_count)` stores the audit trail and powers "Merged from #12, #34" on the target.
- `comments.origin_request_id` lets moved comments show "originally posted on #12".

**Transaction (admin-only).**
1. Validate: source ≠ target, neither is already merged (no chains). Otherwise 409.
2. `SELECT … FOR UPDATE` both rows, **ordered by id** to avoid deadlocks between concurrent merges.
3. Move votes: `INSERT INTO votes (target, user) SELECT target, user FROM votes WHERE request_id = source ON CONFLICT DO NOTHING`, then delete the source votes. Users who voted on both end up with one vote.
4. Move comments: `UPDATE comments SET request_id = target, origin_request_id = COALESCE(origin_request_id, source)`.
5. Insert a **system comment** on the target that keeps the source's title and description,
   so the duplicate's wording isn't lost.
6. Recompute the target's `vote_count` and `comment_count` from `COUNT(*)`. Recomputing here is
   safer than adding up deltas.
7. Set `source.merged_into_id = target`, zero its counts, and write a `request_merges` row.

**Behaviour after merge.**
- The list hides tombstones (`WHERE merged_into_id IS NULL`).
- `/requests/12` redirects to `/requests/34` with a notice saying it was merged.
- Voting or commenting on a tombstone returns 409 with `{ mergedIntoId }`. The frontend uses
  it to redirect.
- The target's status is unchanged, so the admin decides it separately.

**Why tombstone instead of delete.** Old links and bookmarks keep working, the audit trail
stays, and it leaves room for un-merge later.

**Race conditions and how they're handled.**

| Scenario | Outcome |
| --- | --- |
| Vote on the source while it's being merged | The vote path takes the request row lock too (`UPDATE requests … WHERE id = $1 AND merged_into_id IS NULL`). It either commits before the merge, and the vote gets moved, or it waits for the merge, sees the tombstone and returns 409. No vote is lost or stranded. |
| Two admins merge the same source at once | The second transaction blocks on the row lock, then re-checks `merged_into_id` and gets 409. |
| A → B and B → A at the same time | Both lock in id order, so one waits; the second sees a tombstone and gets 409. No deadlock. |
| Comment on the source during a merge | Same pattern as voting: lock, check for tombstone, then insert. |

**Tests.**
- Overlapping voters are deduped and the target count equals the number of distinct voters.
- Every source comment ends up on the target with `origin_request_id` set.
- The system comment keeps the source's title and description.
- The source is a tombstone with zero counts and is hidden from the list.
- Self-merge, merging into a tombstone, and merging an already-merged source each return 409.
- A non-admin gets 403.
- A vote racing a merge ends as either a moved vote or a 409, never a lost vote.

**As implemented** (`src/server/services/merge.ts`), two additions to the design above:
- **Repeating the same merge** (source already merged into *this* target) returns 200 with
  `alreadyMerged: true` and changes nothing, so a retried request is safe. Merging it elsewhere is still 409.
- **Requests previously merged into the source are re-pointed to the target**, so redirects are always one hop.

The concurrency tests were checked against deliberately broken code:
- Locking source-then-target instead of in id order gave `deadlock detected`.
- Removing the vote path's row lock stranded votes on the tombstone (5 out of 5 runs).

**Deferred (document).** Un-merge would need the moved vote and comment IDs recorded per merge
and is out of timebox. Merge suggestions (similar-title detection) and notifying the source's
voters are also deferred.

**Rejected.** Deleting the source (breaks links, loses history). A many-to-many "linked
duplicates" relationship without moving votes (votes stay split, which defeats the purpose).

---

## D7. Drizzle ORM (+ drizzle-kit migrations)

**Decision.** Drizzle for the schema, queries and transactions. drizzle-kit generates SQL
migration files that are committed and applied with one command.

**Why.**
- **The integrity work is SQL-shaped.** Votes and merges rely on `INSERT … ON CONFLICT DO NOTHING
  RETURNING`, atomic `SET vote_count = vote_count + 1`, `SELECT … FOR UPDATE`, and
  `INSERT … SELECT`. Drizzle supports all of these directly (`.onConflictDoNothing()`,
  `.returning()`, `.for('update')`, `sql\`\``) without falling back to raw strings.
- **What the code says is what runs.** Drizzle is a thin, typed layer over SQL, so a reviewer can
  read the query and see where the transaction starts and where the lock is taken. That makes
  "make integrity visible" easier to satisfy.
- **Migrations you can read.** drizzle-kit writes plain `.sql` files, so constraints like
  `UNIQUE (request_id, user_id)`, the foreign keys and the indexes can be reviewed in the PR and
  linked from the README.
- **Fits Next.js.** No separate engine binary and no code-generation step to run before the build.
  It's light at startup and works in serverless and edge-adjacent runtimes.
- **Types end to end.** Inferred row types plus `drizzle-zod` give one source for the DB schema
  and the API validation schemas.

**Rejected.**
- *Prisma:* the most popular option and very productive for CRUD. But `upsert` isn't a true
  `ON CONFLICT DO NOTHING` and can race under concurrency. Row locks (`FOR UPDATE`) and
  conditional counter updates need `$queryRaw`, which drops type safety exactly where
  correctness matters most. It also adds a generate step and a query-engine binary.
- *Raw SQL (`pg` / `postgres.js`):* maximum control, but no type inference, and migrations need
  a separate tool. More boilerplate than the timebox allows.
- *Kysely:* an equally good typed query builder, but it has no schema or migration generation of
  its own, so it needs more setup for the same result.

**Trade-offs we accept.** Drizzle has a smaller ecosystem and fewer guides than Prisma, and
relational queries are less magical, so some joins are written by hand. Both are acceptable
for a small schema.

---

## D8. `Idempotency-Key` for POST endpoints (planned, not built yet)

**Status:** deferred, and documented as a known gap in the README. This entry is the design to build when there's time.

### The problem

Most writes in this API are idempotent by design, so a repeated request is harmless:

| Endpoint | Verb | Repeat-safe? |
| --- | --- | --- |
| Vote / unvote | PUT / DELETE | ✅ Desired state (D5) |
| Change status | PUT | ✅ Same status → `changed: false`, no extra history |
| Edit request | PATCH | ✅ Same values → same result |
| Merge | POST | ✅ Repeating the same merge → `alreadyMerged: true` |
| **Create request** | **POST** | ❌ Each call inserts a new row |
| **Add comment** | **POST** | ❌ Each call inserts a new row |

Creating something new isn't naturally idempotent. If the *same* POST reaches the server twice, two
identical requests (or comments) are created.

### Why this project can actually hit it

Disabling the submit button while the request is pending only stops a **double click**. It doesn't stop
**the same request arriving twice**, which happens when:

- the network is slow, so the browser or a proxy gives up waiting and the user presses Submit again, but the
  first request *did* reach the server and was saved;
- a mobile connection drops and reconnects, and the request is resent;
- a future client (mobile app, integration, script) retries automatically after a timeout, which is good
  practice for clients and exactly what turns a timeout into a duplicate.

Each duplicate feature request splits votes and discussion across two copies. An admin then has to merge
them by hand, which is the very problem this product exists to solve. Duplicate comments are just noise.
The brief's spirit, "repeated API requests must not accidentally create duplicate votes", applies equally
to duplicate requests.

### The design

The client makes a random key **once per user action** (when the form is submitted, not per network
attempt) and sends it with every attempt of that action:

```
POST /api/requests
Idempotency-Key: 3b0f7c2e-8a1d-4d6e-9b5a-2f4c1e0a7d93
{ "title": "Dark mode", "description": "…" }
```

New table:

```sql
CREATE TABLE idempotency_keys (
  user_id       integer NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  key           text    NOT NULL,              -- the client's UUID
  request_hash  text    NOT NULL,              -- SHA-256 of method + path + body
  status_code   integer NOT NULL,
  response_body jsonb   NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, key)                   -- scoped per user: keys can't collide across users
);
```

Server flow, **in the same transaction as the create**:

1. `INSERT INTO idempotency_keys (user_id, key, request_hash, …) … ON CONFLICT DO NOTHING`.
2. **Inserted (first time):** create the request as normal, store the response (status + body) on the key row,
   commit, and return it.
3. **Conflict (key seen before):**
   - **Same `request_hash`:** return the **stored response** (same 201 and same request id). Nothing new is created.
   - **Different `request_hash`:** the client reused a key for a different payload, which is a client bug.
     Return **422** (Unprocessable Entity), never silently pick one.
4. **Concurrent duplicates** (both attempts arrive at the same moment): the primary key makes the second
   insert wait for the first transaction. After it commits, the second sees the row and replays the stored response.
   This is the same "let the database's uniqueness decide" principle as votes.
5. **Expiry:** keys older than 24 hours are deleted by a cleanup job. Retries happen within seconds or
   minutes, so a day is generous.

Client side (`RequestForm`, `CommentForm`): create the key with `crypto.randomUUID()` when the user
submits, keep it while that submission is in flight or being retried, and make a new one for the next submission.

**Optional:** if the header is missing, behave as today. That keeps curl and older clients working.

### Alternatives considered

| Option | Why not (alone) |
| --- | --- |
| Disable the button while pending (what we do now) | Only stops double clicks, not network-level repeats |
| Dedupe by content ("same user, same title, last 60 s") | Guesses at intent: blocks genuine re-posts, misses near-duplicates, the window is arbitrary |
| Unique constraint on `(author_id, title)` | Wrong rule: users may legitimately reuse a title later |
| Client generates the request's ID (UUID primary key) | Also works, but needs UUID ids instead of our readable integers (`#34`), a bigger schema change |

### Cost

- One table and a cleanup job.
- About 40 lines of shared helper code, usable by any POST route (`withIdempotency(user, key, hash, () => create())`).
- A header on two client calls.
- Stored responses take a little space, limited by the 24-hour expiry.

**Interview line:** "Every write is idempotent except create, where it can't be by nature. The standard
fix is an Idempotency-Key (Stripe's model): the client sends one key per user action, and the server stores
the first response under that key and replays it for repeats. It's designed but deferred, because the button
guard covers the common double-click case in a demo."

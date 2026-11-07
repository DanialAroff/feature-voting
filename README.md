# Feature Voting

A product-feedback platform: users submit feature requests, vote and follow progress; admins
triage and move requests through **Under Review → Planned → In Progress → Released / Declined**.

Built as a senior full-stack take-home. The goal was **one production-minded vertical slice**
with visible integrity guarantees, not every feature half-done. Scope is stated plainly
[below](#scope).

**Stack:** Next.js 16 (App Router, TypeScript) · PostgreSQL 17 · Drizzle ORM · Zod · TanStack Query ·
Tailwind · Vitest · Playwright · Docker Compose

---

## Quick start

**Prerequisites:** Docker Desktop, plus Node.js 24 if you want the dev server and tests on your machine.

### Option A: local development (recommended)

```bash
cp .env.example .env        # local-only settings, no secrets
npm ci
npm run db:up               # Postgres in Docker (dev + test databases)
npm run db:migrate          # apply migrations
npm run db:seed             # demo data (wipes and reloads the dev database)
npm run dev                 # http://localhost:3000
```

### Option B: everything in Docker (no Node needed)

```bash
docker compose up -d db
docker compose run --rm tools                   # apply migrations
docker compose run --rm tools npm run db:seed   # demo data
docker compose --profile app up --build         # production build at http://localhost:3000
```

Use `APP_PORT=3010 docker compose --profile app up --build` if port 3000 is taken.

### Demo accounts

All demo passwords are `password123`. These are local demo credentials only.

| Email | Role |
| --- | --- |
| `admin@example.com` | Admin: status changes, merging, official responses, review queue, usage stats |
| `alice@example.com`, `bob@example.com`, `carol@example.com`, `danial@example.com` | User |

You can also register a new account at `/register`. Self-registration always creates a plain user.

---

## Tests

```bash
npm test              # everything (Postgres must be running: npm run db:up)
npm run test:unit     # pure logic + React components (jsdom), no database
npm run test:int      # integration tests against the real feature_voting_test database
npm run test:e2e      # Playwright: builds the app, serves it on :3100 and drives Chromium
npm run typecheck && npm run lint && npm run build
```

First e2e run only: `npx playwright install chromium`.

- **93 Vitest tests + 15 Playwright tests**, focused on the business rules and how they fail, not on coverage numbers.
- **Integration tests run against a real Postgres.** The test database is separate, migrated once per
  run, and truncated before each test.
- **No HTTP server needed.** Route handlers are called directly with a constructed `NextRequest`,
  so every test exercises the real HTTP contract: status codes, the error format and cookies.
- **Uniqueness, row locks and concurrency** are what's under test, and an in-memory fake can't be trusted
  with them.

| Area | What is proven |
| --- | --- |
| Voting | One vote per user; repeated PUT/DELETE are no-ops; 25 parallel voters → count 25; 15 parallel PUTs from one user → 1 vote; interleaved vote/unvote → `vote_count = COUNT(*)`; 404 / 409 (merged) |
| Status | 401 anonymous, 403 user (even the author, even calling the service directly); history row per change; same-status no-op; concurrent admins produce a consistent from→to chain |
| Auth | Session cookie flags; same 401 for wrong password vs unknown email; expired and forged sessions rejected; logout revokes server-side; demoted admin loses access immediately; CSRF Origin check; no self-registration as admin |
| Merge | 401/403 (incl. direct service call); overlapping voters counted once; comments moved with origin; duplicate's wording kept as a system comment; audit row; tombstone hidden from list; earlier duplicates re-pointed; self/unknown/already-merged/into-tombstone rejected; repeat = safe no-op; votes during a merge are moved or refused, never lost; opposite merges at once → one 200, one 409, no deadlock |
| Comments | 401 anonymous; trimmed and length-checked; 20 parallel comments → count 20; official response admin-only (403 for users, nothing saved); public thread oldest first; 404 / 409 (merged) |
| Requests | Server-side validation; author auto-vote in the same transaction; status/author can't be injected; search (wildcards escaped), filter, sort with stable tiebreak, paging; merged duplicates hidden |
| Stats | Admin only (401/403, incl. direct service call); merged duplicates and merge notes excluded; 7-day window; top ordering; empty system returns zeros |
| Editing | Author edits own (200); another user → 403 with nothing changed; anonymous → 401; admin can moderate; partial updates; status/author/counts not editable through the body; 400 / 404 / 409 (merged) |
| UI | Vote button: optimistic update, rollback with alert, DELETE on unvote, merged redirect, logged-out login link, rapid clicks send one request at a time and end on the last click |
| End to end (Playwright) | Register / log out / log in; wrong password; protected page → login → back; stats admin-only; browse + status filter logged out; submit → own vote → found by search; field errors; vote/unvote survives reload; rapid clicks agree with the server; comment + pinned official response; admin status change + timeline; merge combines voters and redirects the old link; edit own vs someone else's |

**E2E tests have their own database.** `feature_voting_e2e` is created if missing, migrated and re-seeded on
every run, and setup refuses to run against `DATABASE_URL` or `TEST_DATABASE_URL`. They run against a
production build (`next build && next start`), not the dev server. Each test creates its own requests
or users, so tests don't depend on each other and run in parallel.

**The e2e suite led to a real fix.** The vote button used to send a PUT and a DELETE in parallel on a
quick vote-then-unvote. The server applies them in arrival order, which isn't always the order they
were sent, so the vote could end opposite to the last click while the UI showed the click. Now one
request is in flight at a time, and a follow-up is sent only if the latest intent still differs from
what the server confirmed. The unit test for it fails against the old component (4 parallel requests
instead of 2 in sequence).

**The concurrency tests have been checked against broken code.** I deliberately broke the vote
service the classic way: no row lock, and the count updated as read, then +1 in app code. The
"25 parallel voters" test then failed with `{ stored: 3, actual: 25 }`. Similar results for the other locks:

| Lock removed | What the test then caught |
| --- | --- |
| Status-change lock | Concurrent-admins test failed 3 out of 3 runs |
| Merge's id-ordered locking (source then target instead) | `deadlock detected` |
| Vote path's row lock | Merge race test failed 5 out of 5 runs: votes returned 200 but were stranded on the duplicate |

---

## Scope

| Feature | Status | Notes |
| --- | --- | --- |
| Register / login / logout, user + admin roles | ✅ Complete | DB-backed sessions, httpOnly cookie |
| Browse with search, status filter, sort, pagination | ✅ Complete | Filters live in the URL (shareable; works without JS) |
| Submit request, view details | ✅ Complete | Author auto-votes (Reddit-style) |
| Vote / remove vote, counts | ✅ Complete | Idempotent, concurrency-safe, optimistic UI |
| Progress via status model | ✅ Complete | Status badge and public progress timeline |
| Admin: review and change status | ✅ Complete | Review queue link, status control, history |
| Comments, comment counts | ✅ Complete | Thread on the detail page; counter updated in the same transaction |
| Official admin response | ✅ Complete | Admin-only `kind = 'official'` comment, pinned under the title; keeps history |
| Merge duplicates | ✅ Complete | Admin merge with preview and confirm; votes deduped, comments moved, duplicate's wording kept; tombstone redirects. Design: [D6](docs/05-decisions.md) |
| Edit own request | ✅ Complete | Title and description; author or admin only; Edit link shown only to them |
| Usage statistics | ✅ Complete | Admin page `/admin/stats`: totals, last 7 days, requests by status, most-voted; one consistent DB snapshot |
| E2E tests | ✅ Complete | Playwright, 15 user journeys against a production build and its own database |
| Rate limiting, idempotency keys on create, real-time updates, notifications, caching, CI | ❌ Deferred | See [next steps](#next-steps) |

---

## Integrity: how the business rules are enforced

Every rule is enforced **on the server and, where SQL can express it, in the database**. The UI
only hides what you can't do.

| Business rule | Enforcement | Where |
| --- | --- | --- |
| A user may vote only once per request | `UNIQUE (request_id, user_id)` + `INSERT … ON CONFLICT DO NOTHING` | `schema.ts`, `services/votes.ts` |
| Concurrent votes must not produce incorrect totals | One transaction: `SELECT … FOR UPDATE` on the request, then `vote_count = vote_count + 1` **only if a row was inserted**. The DB does the arithmetic; the app never reads the count, adds one and writes it back | `services/votes.ts` |
| Repeated API requests must not create duplicate votes | Votes are state, not a toggle: `PUT /vote` = "voted", `DELETE /vote` = "not voted". Retries are no-ops, and the unique constraint backs it up | `api/requests/[id]/vote/route.ts` |
| Only administrators may change status | `requireAdmin` in the route **and** `assertAdmin` in the service. Role is read from the DB on every request | `services/status.ts`, `auth/policies.ts` |
| Only administrators may post official responses (implied by the brief's admin role) | `assertAdmin` in the service when `official: true`. A non-admin gets 403, not a silent downgrade | `services/comments.ts` |
| Merging must preserve votes and comments | One admin-only transaction: locks both rows **in id order** (no deadlock between opposite merges); `INSERT … SELECT … ON CONFLICT DO NOTHING` moves votes, so overlapping voters count once; moves comments keeping `origin_request_id`; adds a system comment with the duplicate's text; recomputes counts from rows; leaves a redirecting tombstone; writes an audit row. Votes and comments lock the same row, so none can slip in mid-merge | `services/merge.ts`, [D6](docs/05-decisions.md) |
| A user cannot edit another user's request | `assertCanEditRequest` (author or admin) runs **inside the transaction against the locked row**, so the check and the write see the same data. Only title and description are accepted; anything else in the body is ignored | `services/requests.ts`, `auth/policies.ts` |

**Transactions**
- **Create request** inserts the request and the author's vote.
- **Vote and unvote** lock the row, then change the vote row and the counter together.
- **Comment** locks the row, then inserts the comment and adds 1 to `comment_count`.
- **Merge** locks both rows, then does everything in the merge row above, all or nothing.
- **Stats** read everything in one read-only `REPEATABLE READ` transaction, so all the numbers come
  from the same snapshot, even while votes are coming in.
- **Status change** locks the row, then updates the status and inserts a history row.

**Defence in depth in the schema**
- CHECK constraints keep counters non-negative and enforce text lengths.
- A request can't be merged into itself.
- Emails are unique regardless of case.
- Foreign keys everywhere.

**Security**
- argon2id password hashes.
- The session token lives in an httpOnly, SameSite=Lax cookie, and the database stores only its SHA-256.
- An Origin check on every mutating request.
- The same error for a wrong password and an unknown email (with a dummy hash check, so timing doesn't leak which emails exist).
- Zod validation on every input.
- `?next=` redirects only allow local paths.
- User content is rendered as text (React escaping), so it can't inject HTML.
- The `PublicUser` type means password hashes never leave the server.

---

## Architecture

```
Browser ── pages & components (src/app, src/components)
   │          fetch via src/lib/api-client.ts            ← shared Zod schemas in src/lib/validation
   ▼
Route handlers (src/app/api/**/route.ts)  ~10 lines each: parse → authorize → call service → JSON
   ▼
Services (src/server/services)            business rules, authorization, transactions
   ▼
Drizzle + Postgres (src/server/db)        constraints are the final guard
```

- **Reads:** Server Components call services directly (no HTTP hop to itself).
- **Writes:** go through the JSON API, so there is one explicit, tested contract. Both paths use the same services.
- **Errors:** everything is thrown as `AppError` and turned into one shape:
  `{ error: { code, message, fields?, details? } }`.
- **Next.js 16 with Cache Components:** each page's static shell is pre-rendered. Anything that
  reads the session or the URL streams in behind `<Suspense>`.

### Key decisions (alternatives considered in [docs/05-decisions.md](docs/05-decisions.md))

| Decision | Instead of | Why |
| --- | --- | --- |
| Route Handlers for mutations | Server Actions | Explicit, testable API; Server Actions are POST-only, which breaks idempotent PUT/DELETE |
| DB sessions + httpOnly cookie | JWT | Instant revocation and role changes; the cookie, not the token format, is what stops XSS theft |
| PUT/DELETE vote | `POST /toggle` | A retried toggle flips the vote back |
| Denormalized `vote_count` | `COUNT(*)` per read | Index-backed "most votes" sort; kept correct by atomic updates in the same transaction |
| Drizzle | Prisma | First-class `ON CONFLICT`, `FOR UPDATE` and atomic SQL updates, with types; plain SQL migrations |
| Merged = tombstone + redirect | Delete the duplicate | Old links keep working; history kept; un-merge possible |
| Official response = comment `kind` | Separate column | Keeps history; one thread; one counter |

More detail: [database design](docs/06-database-design.md) · [codebase guide](docs/07-codebase-guide.md) ·
[integrity rules](docs/03-integrity-rules.md) · [requirements](docs/01-requirements.md).

### Assumptions

- **One product board, one web client on one domain.** Hence cookies, not tokens.
- **Any status can move to any other** (e.g. reopening a Declined request). The brief defines
  statuses, not a workflow.
- **Every request starts with its author's vote.** It's an ordinary vote, so the author can remove it.
- **Requests are public to read.** Voting, creating and admin actions require login.

### Known limitations

- **No rate limiting** on login or writes.
- **No idempotency key on `POST /api/requests` or comments.** The submit buttons are disabled while
  pending, but a network-level retry could still create a duplicate. The fix is designed in
  [D8](docs/05-decisions.md): an `Idempotency-Key` header, with the server replaying the first response for repeats.
- **Comments can't be edited or deleted yet.**
- **Merges can't be undone from the UI.** The audit row records counts but not the moved row IDs
  that an un-merge would need. Admins also pick the target by number; there are no automatic
  duplicate suggestions.
- **Search is `ILIKE`.** Fine for thousands of rows; it does a sequential scan beyond that.
- **Sessions have a fixed 7-day expiry.** No sliding renewal, and no cleanup job for expired rows
  (they're deleted when next used).
- **A hot request serializes its voters** on one row lock. This is correct, but limits throughput on a viral request.
- **A missing request's page returns HTTP 200** with the not-found UI (and `noindex`), because the
  static shell streams before the lookup. The API returns a real 404.
- **Deleting a user who authored content is blocked by foreign keys.** This needs soft-delete or anonymisation.

### Next steps

1. **Product follow-ups:**
   - optionally lock editing once a request is Planned, so voters' intent isn't changed under them
   - richer stats: trends over time, time from Under Review to Released (from `status_changes`), charts
2. **Hardening:**
   - rate limiting (login, writes)
   - `Idempotency-Key` on create request and comment ([D8](docs/05-decisions.md))
   - a session cleanup job
   - an audit log for admin actions
3. **Delivery:**
   - CI (typecheck, lint, unit, integration and e2e tests against a Postgres service)
   - e2e in Firefox and WebKit, plus mobile viewports
   - an OpenAPI spec generated from the Zod schemas
4. **Scale, when needed:**
   - `pg_trgm` or a tsvector search index
   - a composite `(status, vote_count)` index
   - cached list pages with tag invalidation on writes
   - sharded or async vote counters for hot requests
   - read replicas
5. **Observability:**
   - structured logs with request IDs
   - metrics on error rates and vote latency
   - tracing around DB transactions

---

## Project layout

```
src/app/            pages, layouts and API route handlers (App Router)
src/components/     UI components (ui/, auth/, requests/, layout/)
src/lib/            shared by browser and server: validation schemas, API client, constants
src/server/         server only: db/, auth/, http/ (error envelope, route wrapper), services/
src/test/           integration test setup and helpers
e2e/                Playwright specs, global setup (e2e database) and helpers
drizzle/            generated SQL migrations
scripts/seed.ts     demo data
docs/               requirements, priorities, decisions, DB design, codebase guide
```

## Time spent

About **4 h 30 min of active building time**:

| Session | Work | Time |
| --- | --- | --- |
| 4 Nov (into the early hours of 5 Nov), several sittings | Planning docs, scaffold, schema, auth, requests, voting, status, README, comments, merge | ≈ 4 h (estimated from commit and file timestamps) |
| 5 Nov, 07:03–07:10 | Edit own request | 7 min |
| 6 Nov, 07:56–08:04 | Usage stats | 8 min |
| 7 Nov, 09:25–09:38 | Playwright e2e suite (15 tests) and the vote-button ordering fix it led to | 13 min |
| 7 Nov, 09:25–09:38 | Playwright e2e suite (15 tests) and the vote-button ordering fix it led to | 13 min |

Separate study sessions spent going through the design decisions aren't counted. That includes the planning and design docs in `docs/`.

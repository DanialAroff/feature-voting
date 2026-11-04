# Feature Voting

A product-feedback platform: users submit feature requests, vote and follow progress; admins
triage and move requests through **Under Review → Planned → In Progress → Released / Declined**.

Built as a senior full-stack take-home. The goal was **one production-minded vertical slice**
with visible integrity guarantees, not every feature half-done. Scope is stated plainly
[below](#scope).

**Stack:** Next.js 16 (App Router, TypeScript) · PostgreSQL 17 · Drizzle ORM · Zod · TanStack Query ·
Tailwind · Vitest · Docker Compose

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
| `admin@example.com` | Admin: status changes, review queue |
| `alice@example.com`, `bob@example.com`, `carol@example.com`, `danial@example.com` | User |

You can also register a new account at `/register`. Self-registration always creates a plain user.

---

## Tests

```bash
npm test              # everything (Postgres must be running: npm run db:up)
npm run test:unit     # pure logic + React components (jsdom), no database
npm run test:int      # integration tests against the real feature_voting_test database
npm run typecheck && npm run lint && npm run build
```

- **58 tests**, focused on the business rules and how they fail, not on coverage numbers.
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
| Requests | Server-side validation; author auto-vote in the same transaction; status/author can't be injected; search (wildcards escaped), filter, sort with stable tiebreak, paging; merged duplicates hidden |
| UI | Vote button: optimistic update, rollback with alert, DELETE on unvote, merged redirect, logged-out login link |

**The concurrency tests have been checked against broken code.** I deliberately broke the vote
service the classic way: no row lock, and the count updated as read, then +1 in app code. The
"25 parallel voters" test then failed with `{ stored: 3, actual: 25 }`. Removing the status-change
lock made the concurrent-admins test fail 3 out of 3 runs.

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
| Comments, comment counts | ⏳ Partial | Schema, counters and UI counts exist; no endpoint or UI to post yet |
| Official admin response | ⏳ Partial | Modelled as `comments.kind = 'official'`; blocked on comments |
| Merge duplicates | ⏳ Partial | Designed and backed by schema and locking (tombstones, redirects, 409s already work); merge operation not built. Full design: [docs/05-decisions.md § D6](docs/05-decisions.md) |
| Edit own request | ❌ Deferred | Ownership policy planned (`author_id = user.id` or admin) |
| Usage statistics | ❌ Deferred | Plain SQL aggregates over `requests`, `votes` and `status_changes` |
| Rate limiting, idempotency keys on create, real-time updates, notifications, caching, E2E tests, CI | ❌ Deferred | See [next steps](#next-steps) |

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
| Merging must preserve votes and comments | Designed, not built: one transaction locks both rows in id order, moves comments, moves votes with `ON CONFLICT DO NOTHING` (dedupes overlapping voters), recomputes counts, leaves a tombstone | [D6](docs/05-decisions.md) |
| A user cannot edit another user's request | Deferred, with editing | — |

**Transactions**
- **Create request** inserts the request and the author's vote.
- **Vote and unvote** lock the row, then change the vote row and the counter together.
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
- **No idempotency key on `POST /api/requests`.** The submit button is disabled while pending, but
  a network-level retry could still create a duplicate request.
- **Search is `ILIKE`.** Fine for thousands of rows; it does a sequential scan beyond that.
- **Sessions have a fixed 7-day expiry.** No sliding renewal, and no cleanup job for expired rows
  (they're deleted when next used).
- **A hot request serializes its voters** on one row lock. This is correct, but limits throughput on a viral request.
- **A missing request's page returns HTTP 200** with the not-found UI (and `noindex`), because the
  static shell streams before the lookup. The API returns a real 404.
- **Deleting a user who authored content is blocked by foreign keys.** This needs soft-delete or anonymisation.

### Next steps

1. **Finish the slice:**
   - comments plus official responses (schema is ready)
   - the merge transaction (designed in D6, with tests for deduped voters and moved comments)
   - edit own request (ownership policy)
   - usage stats
2. **Hardening:**
   - rate limiting (login, writes)
   - `Idempotency-Key` on create
   - a session cleanup job
   - an audit log for admin actions
3. **Delivery:**
   - CI (typecheck, lint, unit and integration tests against a Postgres service)
   - Playwright E2E for the vote and status flows
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
drizzle/            generated SQL migrations
scripts/seed.ts     demo data
docs/               requirements, priorities, decisions, DB design, codebase guide
```

## Time spent

About **3.5 hours of active work**, estimated from commit and file timestamps. Working sessions
were spread across one day with breaks. That includes the planning and design docs in `docs/`.

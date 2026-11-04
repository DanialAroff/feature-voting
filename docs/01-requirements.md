# 01 — Requirements

All requirements from the brief, numbered for reference in commits, tests, and the README.
Priority tags (`P0`/`P1`/`P2`) are defined in [02-priorities.md](02-priorities.md).

## Domain model (minimum)

| Entity | Key fields | Notes |
| --- | --- | --- |
| `User` | id, email, password_hash, display_name, role (`user` \| `admin`), created_at | Two roles minimum |
| `Session` | id, user_id, token_hash, expires_at, created_at | DB-backed sessions (D2) |
| `FeatureRequest` | id, title, description, status, author_id, merged_into_id (nullable), vote_count, comment_count, created_at, updated_at | `merged_into_id` marks a tombstone; counts are denormalized |
| `Vote` | id, request_id, user_id, created_at | **UNIQUE (request_id, user_id)** |
| `Comment` | id, request_id, author_id, kind (`user` \| `official` \| `system`), body, origin_request_id (nullable), created_at | Official response = comment with kind `official` (D3) |
| `RequestMerge` | id, source_id, target_id, merged_by, merged_at, moved_vote_count, moved_comment_count | Merge audit + "merged from" list (D6) |
| `StatusChange` | id, request_id, actor_id, from_status, to_status, created_at | Cheap to add; powers "follow progress" timeline and stats |

Schema source: `src/server/db/schema.ts`; generated SQL: `drizzle/0000_init.sql`.

**Statuses (fixed enum):** `UNDER_REVIEW` (default) → `PLANNED` → `IN_PROGRESS` → `RELEASED`, plus `DECLINED`.

## User-facing requirements

| ID | Requirement | Acceptance criteria | Priority |
| --- | --- | --- | --- |
| U1 | Browse feature requests with **search, filter, sort** | List is paginated; text search on title/description; filter by status; sort by most votes / newest / most comments; params live in URL query string | P0 (search/filter/sort basic), P1 (polish) |
| U2 | **Submit** a new request | Authenticated only; server-side validation (title length, description length); new request starts as `Under Review`; author auto-votes (optional, document choice) | P0 |
| U3 | View request **details** | Shows title, description, author, status, vote count, comments, official response, status history | P0 |
| U4 | **Vote** and **remove** vote | One vote per user per request; toggle is idempotent; count is correct under concurrency; UI reflects "you voted" | P0 |
| U5 | Add **comments**; display vote & comment counts | Authenticated; validated body; counts on list and detail | P1 |
| U6 | Show **progress** via status model | Status badge on list/detail; status filter; optional timeline from status history | P0 (badge), P1 (timeline) |
| U7 | Edit own request | User may edit only their own request (business rule); admins may as well | P1 |

## Admin requirements

| ID | Requirement | Acceptance criteria | Priority |
| --- | --- | --- | --- |
| A1 | Review requests and **change status** | Admin-only endpoint; validates enum; records status change (who/when); non-admin gets 403 | P0 |
| A2 | **Merge duplicates** preserving activity | Source's votes and comments move to target in one transaction; a user who voted on both ends up with one vote; source marked merged & redirects to target; counts recomputed | P1 |
| A3 | Add **official response** | Admin-only; visibly distinguished in UI; one per request (or latest wins — document) | P1 |
| A4 | Show **usage statistics** | Small set, e.g. total requests by status, total votes, top-voted requests, new requests last 7/30 days, active users | P1 |

## Technical requirements

| ID | Requirement | What "done" means |
| --- | --- | --- |
| T1 | Frontend: clear component boundaries, thoughtful state management, usable feedback states | Server state via a query cache (e.g. TanStack Query); loading / empty / error / success states on every async view; forms show field-level validation errors |
| T2 | API: consistent interface, server-side validation & authorization | Uniform error envelope, consistent status codes, schema validation on every input, auth middleware + role guard |
| T3 | Data: relational DB, repeatable migrations | Postgres + migration tool; `migrate up` from empty DB works; seed script |
| T4 | Identity: auth with `user` and `admin` roles | Login/register; seeded admin account; role checked server-side |
| T5 | Tests: business logic + failure paths | See [03-integrity-rules.md](03-integrity-rules.md) test matrix |
| T6 | Local setup: Docker | `docker compose up` brings up DB (+ API + web ideally) |
| T7 | Docs: setup, architecture, assumptions, trade-offs, limitations | README + ARCHITECTURE notes |

## Optional extensions (only if they strengthen the slice)

| Group | Options | Recommendation |
| --- | --- | --- |
| User experience | Optimistic updates, real-time activity, accessibility | **Optimistic voting with rollback** — cheap, demonstrates state-management depth. Accessibility basics should be in regardless. |
| Trust & control | Audit log, rate limiting, request dedup, API idempotency | **Idempotent vote API** is effectively required by business rules; status-change audit log is near-free. Simple rate limit on write endpoints if time allows. |
| Platform | Caching, background notifications, feature flags | Defer; describe in architecture notes. |
| Engineering system | OpenAPI docs, E2E tests, CI pipeline, metrics, tracing | **CI (lint + test)** and **OpenAPI** if generated cheaply from schemas. Defer E2E/tracing to notes. |

## Decisions

All decided — rationale and rejected alternatives in [05-decisions.md](05-decisions.md).

1. **Stack:** Next.js (App Router, TypeScript) + Postgres, Drizzle ORM + drizzle-kit migrations, Zod, Vitest.
2. **Auth:** server-side sessions in Postgres, opaque token in an httpOnly cookie (not JWT).
3. **Official response:** comment with `kind = 'official'` (admin-only).
4. **Author auto-vote:** yes, Reddit-style — a normal, removable vote row created in the same transaction as the request.
5. **Merge:** source kept as a read-only tombstone pointing to the target; target lists "merged from #…"; votes moved with dedupe, comments moved with origin preserved.

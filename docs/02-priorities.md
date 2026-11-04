# 02 — Priorities & Time Budget

The brief's own guidance:

> **Core first:** authentication, request creation and browsing, vote integrity, admin status changes.
> **Then deepen:** comments, merging, statistics, performance, operational concerns.
> **Depth beats breadth.** Optional work should strengthen the completed slice, not replace correctness.

## Priority tiers

### P0 — Must ship (the vertical slice). If only this ships, the submission is still credible.

| # | Item | Why it's P0 |
| --- | --- | --- |
| 1 | Repo scaffold, Docker Compose (Postgres), migrations, seed (admin + users + sample requests) | Required deliverable; everything else depends on it |
| 2 | Auth: register/login/logout, `user` / `admin` roles, server-side guards | Core-first per brief; gates all writes |
| 3 | Create request + list (paginate, search, status filter, sort) + detail | Core-first; first thing a reviewer clicks |
| 4 | Vote / unvote with **DB uniqueness, transactional count, idempotent API** | Three of six business rules live here; the most-scrutinized piece |
| 5 | Admin status change (admin-only, validated enum, recorded history) | Core-first; second most-scrutinized authorization rule |
| 6 | Tests for vote integrity (incl. concurrency), authorization (403s), validation failures | Testing = 10% and directly proves integrity |
| 7 | Frontend feedback states: loading / empty / error / disabled-while-pending | Frontend = 20%; cheap to do right from the start |
| 8 | README: setup, run, test, scope (complete / partial / deferred) | Required; reviewer can't grade what they can't run |

### P1 — Should ship (deepen). Do in this order; stop when time runs out.

1. **Comments** + counts on list/detail (small, completes the user story).
2. **Merge duplicates** — transactional move of votes (dedupe overlaps) and comments, recompute counts, mark source merged. Plus tests. *High signal for "transactions" discussion.*
3. **Official response** (admin-only, visually distinct).
4. **Edit own request** with ownership check + test.
5. **Admin stats** — 4–5 aggregate numbers + top-voted list. Plain SQL aggregates are fine.
6. **Optimistic vote toggle** with rollback on error.
7. **Architecture notes** (can be written incrementally; must exist by the end).

### P2 — Nice to have (only if P0+P1 are solid)

- Status history timeline on the detail page.
- Rate limiting on write endpoints.
- CI workflow (lint + typecheck + test).
- OpenAPI spec (generated from validation schemas if the stack makes it cheap).
- Accessibility pass (keyboard nav, focus management, aria-pressed on vote button, contrast).

### Deferred — Explicitly document, do not build

Real-time updates (WebSocket/SSE), email/background notifications, caching layer (Redis),
feature flags, E2E tests, metrics/tracing, full-text search engine, multi-tenant boards,
OAuth/SSO, attachments. For each, write one or two sentences in the architecture notes on
*how* you'd add it and *what would trigger the need*.

## Time budget (target 7h, hard stop 8h)

| Block | Hours | Output |
| --- | --- | --- |
| Setup: scaffold, Docker, DB schema, migrations, seed | 0.75 | `docker compose up` + migrated DB |
| Auth + role guards (API + UI) | 0.75 | Login/register, admin seed |
| Requests: create / list / search / filter / sort / detail (API + UI) | 1.5 | Browsable app |
| Voting with integrity + tests | 1.0 | Correct under concurrency, idempotent |
| Admin status change + tests | 0.5 | Admin panel v1 |
| Comments + official response | 0.5 | |
| Merge duplicates + tests | 0.75 | |
| Stats | 0.25 | |
| Polish: feedback states, optimistic vote, a11y basics | 0.5 | |
| README + ARCHITECTURE + clean-setup verification | 0.5 | Handoff-ready |
| **Total** | **7.0** | 1h buffer |

**Checkpoint rule:** at ~4h, P0 must be done and committed. If not, cut P1 scope (stats and
official response first) rather than extending the timebox.

## Things that look valuable but aren't (for this brief)

- Fancy UI design / component library theming — graded on architecture, state, a11y, not looks.
- Many features half-done — "a focused submission with explicit trade-offs is preferred".
- Microservices / queues — over-engineering; mention as a scaling path instead.

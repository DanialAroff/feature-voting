# 04 — Submission Checklist & Discussion Prep

## Required deliverables

- [ ] Frontend and backend source code
- [ ] Database schema and migrations (repeatable from an empty DB)
- [ ] Automated tests for key business rules
- [ ] Docker-based local setup
- [ ] `.env.example` with **no secrets**
- [ ] README: prerequisites, setup, run, test commands, seeded credentials (demo-only)
- [ ] Architecture notes: choices, assumptions, trade-offs, limitations, next steps

## Submission instructions (from the brief)

1. [ ] Share repo link with access enabled (or ZIP if requested)
2. [ ] Include Git history — commit in meaningful steps, not one big commit
3. [ ] Exact steps for app, database, and tests
4. [ ] Scope table: **complete / partial / deferred**
5. [ ] Design: important decisions, **rejected alternatives**, known risks, next production steps
6. [ ] Clean handoff: fresh clone → follow README → works; no credentials or private data committed

## Clean-setup verification (do this last)

- [ ] Fresh clone into a new directory
- [ ] `cp .env.example .env` → `docker compose up` → app reachable
- [ ] Migrations + seed run automatically or with one documented command
- [ ] Test command passes from clean state
- [ ] `git log` / `git grep` for secrets, tokens, personal data
- [ ] Hours spent noted in README (shows timebox respect)

## README outline

1. What this is (one paragraph) + screenshots/GIF (optional)
2. Quick start (prereqs, commands, demo accounts)
3. Running tests
4. Scope: complete / partial / deferred
5. **Integrity**: authorization, transactions, uniqueness, concurrency, idempotency (condensed from `03-integrity-rules.md`)
6. Link to architecture notes

## Architecture notes outline

- System overview diagram (web → API → Postgres)
- Frontend architecture: routing, component boundaries, server-state vs UI-state, feedback states
- API design: resource layout, error envelope, validation, auth
- Data model + indexes (e.g. `votes(request_id,user_id)` unique, `requests(status, vote_count)`, text search index)
- Key decisions with **rejected alternatives** (e.g. PUT/DELETE vs toggle; denormalized counts vs `COUNT(*)`; session cookie vs JWT; merge strategy)
- Assumptions
- Limitations & known risks
- Scaling path & next production steps (caching, read replicas, search engine, notifications queue, observability, rate limiting, CI/CD)

## Evaluation focus

| Area | Weight | What good looks like | Where we earn it |
| --- | --- | --- | --- |
| Functional correctness | 15% | Chosen slice behaves reliably | P0 solid before P1 |
| Frontend | 20% | UI architecture, state, a11y, performance | Query cache, URL-driven filters, feedback states, optimistic vote, semantic HTML |
| Backend | 20% | Consistent API, integrity, authz, error handling | Service-layer authz, constraints, transactions, uniform errors |
| Code quality | 15% | Readable structure, maintainable abstractions | Layered (routes → services → repo), small modules, typed |
| Testing | 10% | Risk-focused coverage | Integrity test matrix against real Postgres |
| Architecture & trade-offs | 15% | Boundaries, scale, alternatives | Architecture notes |
| Security & readiness | 5% | Threats, operation, safe delivery | Hashed passwords, httpOnly cookies, input validation, no secrets, rate limit note |

## Discussion topics to prepare

Be ready to talk through, with concrete references to your code:

- **Frontend architecture** — why this state split; how lists stay in sync after a vote
- **API & data model** — resource design, indexes, denormalization
- **Authorization** — where checks live and why
- **Transaction boundaries** — especially merge
- **Race conditions** — concurrent votes, concurrent merges, vote during merge
- **Caching** — what you'd cache (list pages, stats) and how you'd invalidate
- **Observability** — structured logs, request IDs, metrics you'd add first
- **Security** — authn, CSRF (if cookies), XSS in user content, rate limiting, enumeration
- **Deployment** — container images, migrations in CI/CD, zero-downtime migration strategy
- **Scaling bottlenecks** — hot requests with many votes, search, stats aggregation
- **Accessibility** — keyboard, screen-reader labels, focus, contrast
- **Performance** — pagination, N+1 avoidance, bundle size

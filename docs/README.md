# Project Docs — Feature Request & Voting Platform

Source brief: *Senior Full-Stack Developer Take-Home Assessment* (5 pages).

## TL;DR

Build a simplified product-feedback platform (think Canny / UserVoice) where users submit
feature requests, vote, comment, and follow progress; admins triage, change status, merge
duplicates, respond officially, and see stats.

- **Timebox:** 6–8 hours. Respecting it is graded implicitly ("a focused submission with explicit
  trade-offs is preferred to a larger, unfinished build").
- **Focus:** architecture and judgment. Depth beats breadth.
- **Shape:** one production-quality vertical slice, with user + admin flows, plus written
  reasoning about what was deferred and how it would evolve.

## Documents

| File | Purpose |
| --- | --- |
| [01-requirements.md](01-requirements.md) | Every requirement from the brief, numbered, with acceptance criteria |
| [02-priorities.md](02-priorities.md) | What to build first, what to defer, and the hour-by-hour budget |
| [03-integrity-rules.md](03-integrity-rules.md) | Each business rule → how it is enforced → how it is tested |
| [04-submission-checklist.md](04-submission-checklist.md) | Deliverables, handoff checks, evaluation weights, discussion prep |
| [05-decisions.md](05-decisions.md) | Decision log: stack, auth, official response, auto-vote, vote API, merge design, Drizzle ORM (with rejected alternatives) |
| [06-database-design.md](06-database-design.md) | Database design choices with pros, cons and alternatives |

## Evaluation weights (drive every prioritization call)

| Area | Weight |
| --- | --- |
| Frontend implementation | 20% |
| Backend implementation | 20% |
| Functional correctness | 15% |
| Code quality | 15% |
| Architecture & trade-offs | 15% |
| Testing | 10% |
| Security & readiness | 5% |

Note that 30% (architecture + parts of backend/testing) is earned through **written reasoning and
visible integrity**, not feature count.

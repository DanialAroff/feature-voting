# 03 — Business Rules, Enforcement & Tests

> "Make integrity visible. Your implementation and README should show how authorization,
> transactions, uniqueness, and concurrency are handled for the slice you complete."

Every rule must be enforced **at the database or server layer**, never only in the UI.
The README should contain a condensed version of this table.

## Rule → mechanism → test

| # | Business rule | Enforcement (defense in depth) | Tests |
| --- | --- | --- | --- |
| R1 | A user may vote only once per request | `UNIQUE (request_id, user_id)` on `votes`; insert with `ON CONFLICT DO NOTHING` | Voting twice leaves exactly one row; count = 1 |
| R2 | Only admins may change status | Role guard on route + service-level check; status validated against enum | User → 403; anonymous → 401; admin → 200; invalid status → 400 |
| R3 | Merging preserves votes and comments | Full design in [05-decisions.md § D6](05-decisions.md). Single DB transaction: move comments; move votes skipping users who already voted on target; mark source `merged_into_id`; recompute target counts; lock both rows (`SELECT … FOR UPDATE`, consistent order by id) | After merge: target votes = distinct union of voters; all comments present on target; source flagged; merge into self / already-merged → 400/409 |
| R4 | A user cannot edit another user's request | Ownership check in service (`author_id = currentUser.id` or admin) | Other user → 403; owner → 200 |
| R5 | Concurrent votes must not produce incorrect totals | Count either derived (`COUNT(*)`) or denormalized and updated **in the same transaction** as the insert/delete, only when a row was actually inserted/deleted (`vote_count = vote_count + 1` atomic update — never read-modify-write in app code) | Fire N parallel vote requests from N users → count = N; fire N parallel from one user → count = 1; parallel vote/unvote → count matches `COUNT(*)` |
| R6 | Repeated API requests must not duplicate votes | Model vote as **idempotent PUT/DELETE** (`PUT /requests/:id/vote`, `DELETE /requests/:id/vote`) rather than toggle-POST; uniqueness constraint backs it up. Planned for the non-idempotent POSTs (create request/comment): `Idempotency-Key` header, see [D8](05-decisions.md) | Same PUT ×3 → one vote, 200 each time; DELETE when not voted → 200 `{ voted: false }` (no error, no negative count) |

## Why PUT/DELETE instead of a toggle

A `POST /toggle-vote` is not idempotent: a client retry after a timeout flips the vote back.
`PUT` (ensure voted) and `DELETE` (ensure not voted) describe desired state, so retries are safe
and the frontend's optimistic update maps cleanly to the intended final state.

## Transaction boundaries (be ready to discuss)

| Operation | Transaction scope |
| --- | --- |
| Vote / unvote | Insert-or-noop vote row + conditional counter update |
| Comment create | Insert comment + increment `comment_count` |
| Status change | Update status + insert status-history row |
| Merge | Lock source & target → move comments → move non-duplicate votes → delete duplicate votes → recompute counts → mark source merged → insert audit row |

## Authorization model

- Authentication middleware attaches `currentUser` (or rejects with 401).
- Authorization in the **service layer** (not just routes) so it's unit-testable and cannot be
  bypassed by a new route.
- Policy helpers: `canEditRequest(user, request)`, `requireAdmin(user)`.
- Merged/source requests become read-only (no new votes/comments) — return 409 with a pointer
  to the target.

## Validation & error envelope

- Schema validation on every body/query param (e.g. Zod), shared with the frontend where possible.
- Uniform error shape, e.g. `{ "error": { "code": "FORBIDDEN", "message": "...", "details": [...] } }`.
- Status codes: 400 validation, 401 unauthenticated, 403 forbidden, 404 not found,
  409 conflict (merged / invalid state), 429 rate limited (if implemented).

## Minimum test suite (risk-focused)

1. Vote uniqueness (sequential repeat).
2. Vote concurrency (parallel, many users and same user).
3. Unvote idempotency and no negative counts.
4. Status change authorization (user/anon/admin) + enum validation.
5. Edit ownership.
6. Merge: overlapping voters deduped, comments preserved, counts correct, invalid merges rejected.
7. Validation failures return the uniform error envelope.
8. (Frontend, optional) vote button optimistic update + rollback on error.

Integration tests against a real Postgres (Docker / testcontainers) — concurrency and
constraint behavior can't be trusted with an in-memory fake.

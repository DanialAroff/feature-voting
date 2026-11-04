# 07 — Codebase Guide

How the code is organised, how a request flows through it, and what every file does.
This guide covers everything up to and including step 8 (admin status changes). Extend it as features land.

## 1. The layers

The code is split by **responsibility**. Each layer only calls the one below it.

```
Browser
  │
  ▼
src/app/**/page.tsx, src/components/**    UI: what the user sees
  │   (fetch via src/lib/api-client.ts)
  ▼
src/app/api/**/route.ts                   HTTP: parse input → check auth → call service → send JSON
  │   (wrapped by src/server/http/handler.ts)
  ▼
src/server/services/**                    Business rules: what is allowed, in which transaction
  │   (uses src/server/auth/policies.ts for permission rules)
  ▼
src/server/db/**                          Data: schema, connection, Postgres error helpers
  │
  ▼
Postgres (Docker)                         Final guard: UNIQUE / CHECK / FK constraints
```

Why it matters:
- **Routes stay thin.** All they do is translate HTTP to a function call and back. A reviewer
  reading a route sees the whole contract in about 10 lines.
- **Business rules live in services**, so they can't be bypassed by adding a new route, and can be
  tested without HTTP.
- **`src/lib/` is shared** by the browser and the server (validation schemas, the API client).
  **`src/server/` is server-only.** Most of its files start with `import "server-only"`, which makes the build
  fail if a browser component imports them by accident (e.g. leaking the DB client).

## 2. Folder map

```
src/
├─ app/                          Next.js App Router: URLs map to folders
│  ├─ layout.tsx                 Root HTML shell: fonts, <Providers>, <SiteHeader>
│  ├─ providers.tsx              Client-side TanStack Query provider
│  ├─ page.tsx                   "/" (placeholder until step 6)
│  ├─ (auth)/                    Route group: "(auth)" does NOT appear in the URL
│  │  ├─ layout.tsx              Narrow centred column for auth pages
│  │  ├─ login/page.tsx          "/login"
│  │  └─ register/page.tsx       "/register"
│  └─ api/auth/
│     ├─ register/route.ts       POST /api/auth/register
│     ├─ login/route.ts          POST /api/auth/login
│     ├─ logout/route.ts         POST /api/auth/logout
│     └─ me/route.ts             GET  /api/auth/me
│
├─ components/                   React components (no business logic)
│  ├─ ui/button.tsx, field.tsx   Generic accessible building blocks
│  ├─ auth/auth-form.tsx         Login + register form (one component, two modes)
│  ├─ auth/logout-button.tsx
│  └─ layout/site-header.tsx     Header; user menu streams in behind <Suspense>
│
├─ lib/                          Shared by browser AND server
│  ├─ validation/auth.ts         Zod schemas: the single definition of "valid input"
│  └─ api-client.ts              fetch wrapper → throws ApiError with field errors
│
├─ server/                       Server only
│  ├─ db/
│  │  ├─ schema.ts               Tables, enums, constraints, indexes (source of truth)
│  │  ├─ index.ts                The shared connection pool (`db`)
│  │  └─ errors.ts               isUniqueViolation(): recognise Postgres error 23505
│  ├─ http/
│  │  ├─ errors.ts               AppError + helpers: unauthenticated(), forbidden()…
│  │  └─ handler.ts              route() wrapper, parseJson(), errorResponse(), CSRF check
│  ├─ auth/
│  │  ├─ password.ts             argon2id hash/verify
│  │  ├─ session.ts              create / validate / invalidate sessions, cookie options
│  │  ├─ current-user.ts         "who is calling?" for routes and for pages
│  │  ├─ policies.ts             assertAuthenticated(), assertAdmin(): pure rules
│  │  └─ types.ts                PublicUser: the only user shape sent to clients
│  └─ services/
│     └─ auth.ts                 registerUser(), authenticate()
│
└─ test/                         Integration-test plumbing
   ├─ env.ts                     Points DATABASE_URL at the test DB before anything loads
   ├─ global-setup.ts            Runs migrations on the test DB once per test run
   └─ helpers.ts                 resetDb(), createUser(), loginAs(), makeRequest()

scripts/seed.ts                  npm run db:seed: demo data
drizzle/                         Generated SQL migrations (never edit applied ones)
```

**Naming conventions**
- `*.test.ts(x)`: unit tests, no database (Vitest "unit" project).
- `*.int.test.ts`: integration tests against real Postgres (Vitest "integration" project).

## 3. Walkthrough: what happens when you log in

1. **Browser.** `auth-form.tsx` handles the submit:
   - It reads the form fields and validates them with `loginSchema` (from `lib/validation/auth.ts`).
     If they're invalid, it shows the errors and stops. No request is sent.
   - Otherwise it calls `api("/api/auth/login", "POST", data)` through a TanStack Query `useMutation`.
     `isPending` disables the button and shows "Logging in…".

2. **HTTP layer.** `app/api/auth/login/route.ts` is wrapped in `route(...)` from `server/http/handler.ts`.
   The wrapper does two things:
   - Checks the `Origin` header. If another website is posting, it responds 403 (CSRF defence).
   - Runs the handler in try/catch, so any thrown error becomes the standard JSON error.

3. **Handler body.** Three lines:
   ```ts
   const input = await parseJson(req, loginSchema);   // 400 if bad JSON or invalid fields
   const user  = await authenticate(input);           // 401 if wrong email/password
   const { token, expiresAt } = await createSession(user.id);
   ```
   It then sets the cookie on the response and returns `{ user }`.

4. **Service.** `authenticate()` in `server/services/auth.ts`:
   - Looks up the user by `lower(email)`.
   - Verifies the password with argon2. If the email doesn't exist, it verifies against a
     dummy hash anyway, so the response takes the same time and doesn't leak which emails exist.
   - Throws the *same* 401 message for "no such user" and "wrong password".

5. **Session.** `createSession()` in `server/auth/session.ts`:
   - Generates 32 random bytes as the token.
   - Stores **SHA-256(token)** in `sessions`, with an expiry 7 days out.
   - Returns the raw token, which only ever exists in the cookie.

6. **Back in the browser**, `onSuccess`:
   - `router.push(next)` navigates to `?next=` if it's a safe local path (`safeRedirect`), else `/`.
   - `router.refresh()` re-renders the server components so the header now shows your name.

## 4. Walkthrough: how a later request knows who you are

There are **two entry points**, because Next.js has two kinds of server code.

| Where | Function | Reads the cookie from | Why |
| --- | --- | --- | --- |
| Route handlers (`route.ts`) | `getUserFromRequest(req)`, `requireUser(req)`, `requireAdmin(req)` | `req.cookies` | Tests can build a fake `NextRequest` and call the handler directly, with no server needed |
| Server components (pages, header) | `getCurrentUser()` | `cookies()` from `next/headers` | Pages don't receive a request object; wrapped in React `cache()` so it runs once per render |

Both end in `validateSessionToken(token)`:
1. Hashes the token and joins `sessions` with `users`.
2. If there's no row, returns `null`. If the session has expired, deletes the row and returns `null`.
3. Otherwise returns `{ id, email, displayName, role }`, with the **role fresh from the DB**.

Permission checks are tiny pure functions in `policies.ts`:
```ts
assertAuthenticated(user)  // null → throws 401
assertAdmin(user)          // null → 401, role "user" → 403
```
A future admin route will start with `const admin = await requireAdmin(req);` and nothing more.

## 5. Errors: one shape everywhere

Anything thrown inside `route(...)` is converted by `errorResponse()`:

| Thrown | Status | Body `error.code` |
| --- | --- | --- |
| `ZodError` (validation) | 400 | `VALIDATION_ERROR`, with `fields: { email: ["…"] }` |
| bad JSON (from `parseJson`) | 400 | `INVALID_JSON` |
| `unauthenticated()` | 401 | `UNAUTHENTICATED` |
| `forbidden()` | 403 | `FORBIDDEN` |
| `notFound()` | 404 | `NOT_FOUND` |
| `conflict()` (e.g. email taken) | 409 | `CONFLICT` |
| anything else | 500 | `INTERNAL` (details logged server-side, never sent) |

On the browser side, `api-client.ts` turns that into an `ApiError` with `.status`, `.code` and
`.fields`. `AuthForm` puts `fields` errors next to each input, and other errors in a banner at the top.

**Next.js gotcha.** `route()` calls `unstable_rethrow(err)` before handling an error. Next uses
thrown errors internally (to bail out of pre-rendering, and for `redirect()` and `notFound()`). Catching
them would turn them into fake 500s. The production build caught exactly this bug.

## 6. Next.js 16 specifics you'll see

- **`proxy.ts` replaces `middleware.ts`.** We don't use it. The docs say not to rely on it for
  authorization, so every route checks auth itself.
- **`cacheComponents: true`** (in `next.config.ts`): pages are pre-rendered as a static shell where
  possible. Anything reading request data (cookies, `?next=`) must sit inside `<Suspense>`. That's why:
  - `SiteHeader` is static, but `<UserMenu>` (which reads the session) is wrapped in `<Suspense>`.
  - The login and register pages wrap `<AuthForm>` in `<Suspense>`, because it reads `useSearchParams()`.
- **`cookies()` is async.** Use `await cookies()`.
- **`LayoutProps<"/">` / `RouteContext<"/x/[id]">`** are global types Next generates for typed routes.

## 7. Security decisions in this step (and where they live)

| Threat | Defence | File |
| --- | --- | --- |
| Session theft via XSS | httpOnly cookie; JS can't read it | `session.ts` → `sessionCookieOptions` |
| CSRF (another site posting as you) | `SameSite=Lax` + Origin check on mutations | `session.ts`, `handler.ts` |
| DB leak → session hijack | Only SHA-256 of the token stored | `session.ts` |
| Password leak | argon2id with per-hash salt | `password.ts` |
| Account enumeration | Same 401 message + dummy-hash timing | `services/auth.ts` |
| Self-promotion to admin | Role never read from input | `services/auth.ts` → `registerUser` |
| Stale admin rights | Role re-read from DB every request | `session.ts` → `validateSessionToken` |
| Open redirect via `?next=` | Only relative `/path` accepted | `api-client.ts` → `safeRedirect` |
| Leaking password hash | `PublicUser` type, explicit column lists | `types.ts`, `services/auth.ts` |
| Duplicate accounts in a race | Unique index decides, mapped to 409 | `schema.ts`, `db/errors.ts` |

Deferred: rate limiting on login, sliding session renewal, expired-session cleanup job.

## 8. How the tests work

- `npm run test:unit` covers pure logic (`password.test.ts`, `policies.test.ts`).
- `npm run test:int` covers real Postgres (`auth.int.test.ts`). Before it runs:
  1. `global-setup.ts` migrates `feature_voting_test`.
  2. `env.ts` swaps `DATABASE_URL` to the test DB, so `@/server/db` connects there.
  3. Each test calls `resetDb()` (TRUNCATE) in `beforeEach`. Files run one at a time.
- **Calling a route without a server:**
  ```ts
  const res = await login(makeRequest("/api/auth/login", { method: "POST", body }), noCtx);
  expect(res.status).toBe(200);
  ```
  `loginAs("admin")` creates a user plus a session and gives you the `cookie` string to send.

## 9. Recipe: adding a new endpoint (you'll see this pattern from step 6 on)

1. **Schema.** Add a Zod schema in `src/lib/validation/<feature>.ts` (shared with the form).
2. **Service.** Add a function in `src/server/services/<feature>.ts` with the business rules,
   permission checks (via `policies.ts`) and `db.transaction(...)` where several writes must
   succeed together.
3. **Route.** Add `src/app/api/<path>/route.ts`:
   ```ts
   export const POST = route(async (req) => {
     const user  = await requireUser(req);
     const input = await parseJson(req, createThingSchema);
     return Response.json({ thing: await createThing(user, input) }, { status: 201 });
   });
   ```
4. **Test.** Add `*.int.test.ts` next to the service: happy path, 401, 403, 400, and the
   business rule's edge case.
5. **UI.** Call it with `api(...)` inside `useMutation` / `useQuery`, and show pending and error states.

## 10. Feature requests (step 6)

**Files**

| File | Role |
| --- | --- |
| `lib/requests.ts` | Status labels, sort options, page size: shared vocabulary |
| `lib/validation/requests.ts` | `createRequestSchema`, `listQuerySchema` (lenient: bad URL values fall back to defaults), `requestIdSchema` |
| `server/services/requests.ts` | `listRequests`, `getRequest`, `createRequest` |
| `app/api/requests/route.ts` | `GET` list, `POST` create |
| `app/api/requests/[id]/route.ts` | `GET` one (404 if missing; merged ones include `mergedIntoId`) |
| `app/page.tsx` | List page: static heading, with filters and results streaming in behind `<Suspense>` |
| `app/requests/[id]/page.tsx` | Detail page; redirects merged duplicates to their target |
| `app/requests/new/page.tsx` | Create page; redirects to `/login?next=…` if logged out |
| `components/requests/*` | `RequestFilters` (client), `RequestList` (server), `StatusBadge`, `NewRequestForm` |
| `app/not-found.tsx`, `app/error.tsx` | Shared 404 and "something went wrong / Try again" states |

**Two ways to read data**
- **Pages call services directly** (`RequestList` calls `listRequests()`). There's no HTTP round trip from the
  server to itself, and the data is fully typed.
- **The JSON API exists for mutations and other clients** (and the integration tests). Both paths go
  through the same service, so the rules can't diverge.

**List query details**
- **Merged tombstones are always excluded** (`merged_into_id IS NULL`).
- **Search** is `ILIKE` on title and description. `%` and `_` are escaped, so the user's text is matched literally.
- **Sort:** `top` (votes), `new` (created_at) or `comments`, always with `id DESC` as a tiebreak, so paging
  never shows the same row twice.
- **Totals:** a second `COUNT(*)` query with the same `WHERE`, run in parallel (`Promise.all`).
- **`hasVoted`** is a correlated `EXISTS` on votes, served by the unique index.

**Create** inserts the request and the author's vote in **one transaction**, with `vote_count = 1`
(decision D4). Status and author always come from the server, never from the body.

**Filters live in the URL.** `RequestFilters` is a `next/form` GET form:
- Results are shareable and bookmarkable, and the back button works.
- It works without JavaScript.
- Changing a filter drops `?page`, so results restart at page 1.

**Known limitation.** A missing request's *page* returns HTTP 200 with the not-found UI (plus
`noindex`). The static shell streams before the DB lookup runs. The *API* returns a real 404.

## 11. Voting (step 7)

**Files**

| File | Role |
| --- | --- |
| `server/services/votes.ts` | `castVote` (PUT) and `removeVote` (DELETE): the integrity-critical code |
| `app/api/requests/[id]/vote/route.ts` | `PUT` and `DELETE` → `{ voted, voteCount }` |
| `components/requests/vote-button.tsx` | Optimistic toggle used in the list and on the detail page |
| `server/services/votes.int.test.ts` | Idempotency and concurrency tests against real Postgres |
| `components/requests/vote-button.test.tsx` | Optimistic update, rollback, DELETE, merged redirect, logged-out link |

**One vote, step by step** (`castVote`, all in one transaction):
1. `SELECT … FROM requests WHERE id = $1 FOR UPDATE` locks the request row:
   - Votes on the same request queue here.
   - A concurrent merge (which locks the same row) either finishes first, so we see the tombstone and
     return 409, or waits for us, so our vote gets moved with the rest.
   - A missing row gives 404.
2. `INSERT INTO votes … ON CONFLICT (request_id, user_id) DO NOTHING RETURNING id`. If a row comes
   back, this is a new vote. If not, the user had already voted, so it's a no-op.
3. Only for a new vote: `UPDATE requests SET vote_count = vote_count + 1`. The database does the
   arithmetic; the app never reads the count, adds one and writes it back.

`removeVote` mirrors it with `DELETE … RETURNING` and `- 1`. Removing a vote that doesn't exist is a no-op.

**Proof the tests are meaningful.** I temporarily broke `castVote` the classic way: no row lock,
and the count updated as read, then `+ 1` in app code. The concurrency test then failed with
**`{ stored: 3, actual: 25 }`**: 25 simultaneous voters, but 22 updates lost. With the real code it's
`{ stored: 25, actual: 25 }`. Every vote test checks that `vote_count` equals `COUNT(*)` of the vote rows.

**Optimistic UI** (`VoteButton`):
- **On click:** the button flips instantly (`onMutate`), sending the *desired* state (PUT or DELETE).
- **On success:** shows the server's `{ voted, voteCount }`, which includes other people's votes.
- **On error:** rolls back to the last state the server confirmed and shows an inline `role="alert"` message.
  A 409 for a merged request navigates to the target instead.
- **Rapid clicks:** each click gets a sequence number, and only the latest response updates the UI, so a
  slow older response can't overwrite a newer click. PUT and DELETE are idempotent, so the server
  ends up in the state of the last click.
- **`key={voteCount-hasVoted}`** re-seeds the local state when the server sends fresh numbers.
- **Accessibility:** `aria-pressed` gives the on/off state, and `aria-label` says "Remove your vote (4 votes)".
- **Logged out:** the button is a link to `/login?next=<this page>`.

**API errors now carry `details`.** For example, a 409 on a merged request returns
`error.details.mergedIntoId`, and the client follows it.

## 12. Admin status changes (step 8)

**Files**

| File | Role |
| --- | --- |
| `server/services/status.ts` | `changeStatus` (admin only, transactional) and `getStatusHistory` |
| `app/api/requests/[id]/status/route.ts` | `PUT { status }` → `{ status, changed }` |
| `components/requests/status-control.tsx` | Admin-only select + "Update status" on the detail page |
| `components/requests/status-timeline.tsx` | Public "Progress" timeline from `status_changes` |
| `components/layout/site-header.tsx` | Admins get a "Review queue" link (`/?status=under_review&sort=new`) |
| `server/services/status.int.test.ts` | Authorization, history, no-op repeats, 400/404/409, concurrent admins |

**Authorization is checked twice, on purpose.**
1. The route starts with `requireAdmin(req)`: 401 when logged out, 403 for regular users (including the author).
2. The service starts with `assertAdmin(actor)`, so even a future route, script or job that calls
   `changeStatus` directly can't skip the rule. A test calls the service directly as a regular user
   and expects 403.

Hiding `StatusControl` from non-admins is only a convenience. The API is what enforces the rule.

**One transaction:**
1. `SELECT status … FOR UPDATE` locks the row. Unknown → 404; merged → 409 with `mergedIntoId`.
2. If the new status equals the current one, return `{ changed: false }` with no history row. PUT stays idempotent.
3. Otherwise `UPDATE requests SET status, updated_at` and `INSERT status_changes (from, to, actor)`.

**Why the lock matters here.** Two admins change the same request at the same moment. Without the
lock, both read "Under Review" and both record `from: under_review`, so the history contradicts itself.
With it, the second waits and records the first one's result as its `from`. I confirmed the test fails
without the lock (3 out of 3 runs) and passes with it.

**Any transition is allowed** (e.g. reopening a Declined request). The brief defines statuses, not a
workflow. A strict state machine is a possible extension and is listed as deferred.

**Not optimistic, unlike voting.** A status change is rare, deliberate and public, so the control
waits for the server. Then `router.refresh()` re-renders the badge and the timeline from the server.

## 13. Commands

| Command | Does |
| --- | --- |
| `npm run db:up` | Start Postgres in Docker |
| `npm run db:migrate` | Apply migrations to the dev DB |
| `npm run db:seed` | Reset the dev DB to demo data (`admin@example.com` / `password123`) |
| `npm run dev` | Dev server at http://localhost:3000 |
| `npm test` | Unit + integration tests |
| `npm run typecheck` / `npm run lint` / `npm run build` | Static checks / production build |
| `npm run db:studio` | Browse tables in the browser |

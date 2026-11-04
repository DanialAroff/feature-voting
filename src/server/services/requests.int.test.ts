import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, test } from "vitest";
import { GET as getOne, PATCH as patch } from "@/app/api/requests/[id]/route";
import { GET as list, POST as create } from "@/app/api/requests/route";
import { db } from "@/server/db";
import { votes } from "@/server/db/schema";
import { createUser, insertRequest, loginAs, makeRequest, noCtx, resetDb } from "@/test/helpers";

beforeEach(resetDb);

const valid = { title: "Dark mode", description: "Please add a dark theme." };

async function listWith(params: Record<string, string> = {}, cookie?: string) {
  const qs = new URLSearchParams(params).toString();
  const res = await list(makeRequest(`/api/requests?${qs}`, { cookie }), noCtx);
  expect(res.status).toBe(200);
  return res.json();
}

const idCtx = (id: string | number) => ({ params: Promise.resolve({ id: String(id) }) });

describe("POST /api/requests", () => {
  test("requires login", async () => {
    const res = await create(makeRequest("/api/requests", { method: "POST", body: valid }), noCtx);
    expect(res.status).toBe(401);
  });

  test("validates input server-side", async () => {
    const { cookie } = await loginAs();
    const res = await create(makeRequest("/api/requests", { method: "POST", body: { title: "x", description: "  " }, cookie }), noCtx);
    expect(res.status).toBe(400);
    const { error } = await res.json();
    expect(Object.keys(error.fields).sort()).toEqual(["description", "title"]);
  });

  test("creates an Under Review request with the author's own vote", async () => {
    const { user, cookie } = await loginAs();
    const res = await create(makeRequest("/api/requests", { method: "POST", body: valid, cookie }), noCtx);
    expect(res.status).toBe(201);
    const { request } = await res.json();
    expect(request).toMatchObject({
      title: "Dark mode",
      status: "under_review",
      voteCount: 1,
      hasVoted: true,
      author: { id: user.id },
    });
    // Counter and vote row agree.
    expect(await db.select().from(votes).where(eq(votes.requestId, request.id))).toHaveLength(1);
  });

  test("ignores status and author in the body", async () => {
    const { user, cookie } = await loginAs();
    const other = await createUser();
    const body = { ...valid, status: "released", authorId: other.id };
    const { request } = await (await create(makeRequest("/api/requests", { method: "POST", body, cookie }), noCtx)).json();
    expect(request.status).toBe("under_review");
    expect(request.author.id).toBe(user.id);
  });
});

describe("GET /api/requests", () => {
  test("hides merged duplicates", async () => {
    const author = await createUser();
    const target = await insertRequest(author.id, { title: "Target" });
    await insertRequest(author.id, { title: "Duplicate", mergedIntoId: target.id });
    const { items, total } = await listWith();
    expect(items.map((r: { title: string }) => r.title)).toEqual(["Target"]);
    expect(total).toBe(1);
  });

  test("filters by status", async () => {
    const author = await createUser();
    await insertRequest(author.id, { title: "Planned one", status: "planned" });
    await insertRequest(author.id, { title: "Under review one" });
    const { items } = await listWith({ status: "planned" });
    expect(items.map((r: { title: string }) => r.title)).toEqual(["Planned one"]);
  });

  test("searches title and description case-insensitively", async () => {
    const author = await createUser();
    await insertRequest(author.id, { title: "Dark mode", description: "Theme" });
    await insertRequest(author.id, { title: "Export", description: "Download as CSV" });
    await insertRequest(author.id, { title: "Shortcuts", description: "Keyboard" });
    expect((await listWith({ q: "DARK" })).items).toHaveLength(1);
    expect((await listWith({ q: "csv" })).items[0].title).toBe("Export");
  });

  test("treats % and _ in search literally", async () => {
    const author = await createUser();
    await insertRequest(author.id, { title: "Show 100% of items" });
    await insertRequest(author.id, { title: "Something else" });
    expect((await listWith({ q: "%" })).items).toHaveLength(1);
    expect((await listWith({ q: "_" })).items).toHaveLength(0);
  });

  test("sorts by votes, newest and comments, with id as a stable tiebreak", async () => {
    const author = await createUser();
    const a = await insertRequest(author.id, { title: "Alpha", voteCount: 5, commentCount: 0, createdAt: new Date("2026-01-01") });
    const b = await insertRequest(author.id, { title: "Bravo", voteCount: 1, commentCount: 9, createdAt: new Date("2026-03-01") });
    const c = await insertRequest(author.id, { title: "Charlie", voteCount: 5, commentCount: 2, createdAt: new Date("2026-02-01") });
    const ids = async (sort: string) => (await listWith({ sort })).items.map((r: { id: number }) => r.id);
    expect(await ids("top")).toEqual([c.id, a.id, b.id]);
    expect(await ids("new")).toEqual([b.id, c.id, a.id]);
    expect(await ids("comments")).toEqual([b.id, c.id, a.id]);
  });

  test("paginates with totals", async () => {
    const author = await createUser();
    for (let i = 0; i < 25; i++) await insertRequest(author.id, { title: `Request ${i}` });
    const p1 = await listWith({ page: "1" });
    const p2 = await listWith({ page: "2" });
    expect(p1.items).toHaveLength(20);
    expect(p2.items).toHaveLength(5);
    expect(p1).toMatchObject({ total: 25, totalPages: 2, pageSize: 20 });
    const overlap = p1.items.filter((r: { id: number }) => p2.items.some((s: { id: number }) => s.id === r.id));
    expect(overlap).toHaveLength(0);
  });

  test("falls back to defaults for invalid query values", async () => {
    const author = await createUser();
    await insertRequest(author.id);
    const body = await listWith({ status: "bogus", sort: "nope", page: "-3" });
    expect(body.page).toBe(1);
    expect(body.items).toHaveLength(1);
  });

  test("reports hasVoted per viewer", async () => {
    const { user, cookie } = await loginAs();
    const r = await insertRequest(user.id, { voteCount: 1 });
    await db.insert(votes).values({ requestId: r.id, userId: user.id });
    expect((await listWith({}, cookie)).items[0].hasVoted).toBe(true);
    expect((await listWith()).items[0].hasVoted).toBe(false);
  });
});

describe("GET /api/requests/:id", () => {
  test("returns the request with its description", async () => {
    const author = await createUser();
    const r = await insertRequest(author.id, { description: "Full text" });
    const res = await getOne(makeRequest(`/api/requests/${r.id}`), idCtx(r.id));
    expect(res.status).toBe(200);
    expect((await res.json()).request).toMatchObject({ id: r.id, description: "Full text", mergedIntoId: null });
  });

  test("404 for unknown and non-numeric ids", async () => {
    expect((await getOne(makeRequest("/api/requests/999"), idCtx(999))).status).toBe(404);
    expect((await getOne(makeRequest("/api/requests/abc"), idCtx("abc"))).status).toBe(404);
  });

  test("exposes mergedIntoId for a merged duplicate", async () => {
    const author = await createUser();
    const target = await insertRequest(author.id);
    const dup = await insertRequest(author.id, { mergedIntoId: target.id });
    const { request } = await (await getOne(makeRequest(`/api/requests/${dup.id}`), idCtx(dup.id))).json();
    expect(request.mergedIntoId).toBe(target.id);
  });
});

describe("PATCH /api/requests/:id (a user cannot edit another user's request)", () => {
  const edit = (id: number | string, body: unknown, cookie?: string) =>
    patch(makeRequest(`/api/requests/${id}`, { method: "PATCH", body, cookie }), idCtx(id));

  async function current(id: number) {
    const { request } = await (await getOne(makeRequest(`/api/requests/${id}`), idCtx(id))).json();
    return request;
  }

  test("the author can edit their own request", async () => {
    const { user, cookie } = await loginAs();
    const r = await insertRequest(user.id, { title: "Old title", description: "Old text" });
    const res = await edit(r.id, { title: "New title", description: "New text" }, cookie);
    expect(res.status).toBe(200);
    expect((await res.json()).request).toMatchObject({ title: "New title", description: "New text" });
  });

  test("another user gets 403 and nothing changes", async () => {
    const author = await createUser();
    const other = await loginAs();
    const r = await insertRequest(author.id, { title: "Original" });
    const res = await edit(r.id, { title: "Hijacked" }, other.cookie);
    expect(res.status).toBe(403);
    expect((await current(r.id)).title).toBe("Original");
  });

  test("anonymous gets 401", async () => {
    const r = await insertRequest((await createUser()).id);
    expect((await edit(r.id, { title: "Nope nope" })).status).toBe(401);
  });

  test("an admin can edit any request (moderation)", async () => {
    const admin = await loginAs("admin");
    const r = await insertRequest((await createUser()).id, { title: "Typo titel" });
    expect((await edit(r.id, { title: "Typo title" }, admin.cookie)).status).toBe(200);
  });

  test("partial updates keep the other field", async () => {
    const { user, cookie } = await loginAs();
    const r = await insertRequest(user.id, { title: "Keep me", description: "Old text" });
    await edit(r.id, { description: "New text" }, cookie);
    expect(await current(r.id)).toMatchObject({ title: "Keep me", description: "New text" });
  });

  test("status, author and counts can't be changed through an edit", async () => {
    const { user, cookie } = await loginAs();
    const other = await createUser();
    const r = await insertRequest(user.id, { voteCount: 0 });
    await edit(r.id, { title: "Fine title", status: "released", authorId: other.id, voteCount: 999 }, cookie);
    expect(await current(r.id)).toMatchObject({ status: "under_review", author: { id: user.id }, voteCount: 0 });
  });

  test("validates input: empty body, too-short title", async () => {
    const { user, cookie } = await loginAs();
    const r = await insertRequest(user.id);
    expect((await edit(r.id, {}, cookie)).status).toBe(400);
    const short = await edit(r.id, { title: "x" }, cookie);
    expect(short.status).toBe(400);
    expect((await short.json()).error.fields.title).toBeDefined();
  });

  test("404 for unknown requests, 409 for merged ones", async () => {
    const { user, cookie } = await loginAs();
    const target = await insertRequest(user.id);
    const dup = await insertRequest(user.id, { mergedIntoId: target.id });
    expect((await edit(999, { title: "Whatever" }, cookie)).status).toBe(404);
    expect((await edit(dup.id, { title: "Whatever" }, cookie)).status).toBe(409);
  });
});

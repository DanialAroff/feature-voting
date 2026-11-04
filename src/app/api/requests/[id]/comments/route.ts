import { createCommentSchema } from "@/lib/validation/comments";
import { requestIdSchema } from "@/lib/validation/requests";
import { requireUser } from "@/server/auth/current-user";
import { notFound } from "@/server/http/errors";
import { parseJson, route } from "@/server/http/handler";
import { addComment, listComments } from "@/server/services/comments";
import { getRequest } from "@/server/services/requests";

type Ctx = RouteContext<"/api/requests/[id]/comments">;

async function parseId(ctx: Ctx) {
  const parsed = requestIdSchema.safeParse((await ctx.params).id);
  if (!parsed.success) throw notFound("Request not found");
  return parsed.data;
}

// GET /api/requests/:id/comments → 200 { comments } (public), 404 if the request doesn't exist
export const GET = route(async (_req, ctx: Ctx) => {
  const id = await parseId(ctx);
  if (!(await getRequest(id, null))) throw notFound("Request not found");
  return Response.json({ comments: await listComments(id) });
});

// POST /api/requests/:id/comments { body, official? } → 201 { comment }
// official: true is admin-only (403 otherwise).
export const POST = route(async (req, ctx: Ctx) => {
  const user = await requireUser(req);
  const id = await parseId(ctx);
  const input = await parseJson(req, createCommentSchema);
  return Response.json({ comment: await addComment(user, id, input) }, { status: 201 });
});

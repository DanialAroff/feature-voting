import { requestIdSchema } from "@/lib/validation/requests";
import { requireUser } from "@/server/auth/current-user";
import { notFound } from "@/server/http/errors";
import { route } from "@/server/http/handler";
import { castVote, removeVote } from "@/server/services/votes";

type Ctx = RouteContext<"/api/requests/[id]/vote">;

async function parseId(ctx: Ctx) {
  const parsed = requestIdSchema.safeParse((await ctx.params).id);
  if (!parsed.success) throw notFound("Request not found");
  return parsed.data;
}

// Idempotent by design (docs/05-decisions.md § D5): PUT = "I have voted",
// DELETE = "I have not voted". Retrying either one is safe; a toggle wouldn't be.

// PUT /api/requests/:id/vote → 200 { voted: true, voteCount }
export const PUT = route(async (req, ctx: Ctx) => {
  const user = await requireUser(req);
  return Response.json(await castVote(user, await parseId(ctx)));
});

// DELETE /api/requests/:id/vote → 200 { voted: false, voteCount }
export const DELETE = route(async (req, ctx: Ctx) => {
  const user = await requireUser(req);
  return Response.json(await removeVote(user, await parseId(ctx)));
});

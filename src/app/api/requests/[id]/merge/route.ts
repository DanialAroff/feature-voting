import { mergeRequestSchema, requestIdSchema } from "@/lib/validation/requests";
import { requireAdmin } from "@/server/auth/current-user";
import { notFound } from "@/server/http/errors";
import { parseJson, route } from "@/server/http/handler";
import { mergeRequests } from "@/server/services/merge";

// POST /api/requests/:id/merge { targetId } → 200 MergeResult
// Merges request :id (the duplicate) into targetId (the one to keep). Admin only.
// Repeating the same merge returns 200 with alreadyMerged: true (safe retry).
export const POST = route(async (req, ctx: RouteContext<"/api/requests/[id]/merge">) => {
  const admin = await requireAdmin(req);
  const parsed = requestIdSchema.safeParse((await ctx.params).id);
  if (!parsed.success) throw notFound("Request not found");
  const { targetId } = await parseJson(req, mergeRequestSchema);
  return Response.json(await mergeRequests(admin, parsed.data, targetId));
});

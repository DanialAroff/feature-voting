import { requestIdSchema } from "@/lib/validation/requests";
import { getUserFromRequest } from "@/server/auth/current-user";
import { notFound } from "@/server/http/errors";
import { route } from "@/server/http/handler";
import { getRequest } from "@/server/services/requests";

// GET /api/requests/:id → 200 { request } | 404. A merged request is returned
// with mergedIntoId set, so clients can follow it to the target.
export const GET = route(async (req, ctx: RouteContext<"/api/requests/[id]">) => {
  const parsed = requestIdSchema.safeParse((await ctx.params).id);
  if (!parsed.success) throw notFound("Request not found");
  const viewer = await getUserFromRequest(req);
  const request = await getRequest(parsed.data, viewer?.id ?? null);
  if (!request) throw notFound("Request not found");
  return Response.json({ request });
});

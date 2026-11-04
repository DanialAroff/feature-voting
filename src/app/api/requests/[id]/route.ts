import { requestIdSchema, updateRequestSchema } from "@/lib/validation/requests";
import { getUserFromRequest, requireUser } from "@/server/auth/current-user";
import { notFound } from "@/server/http/errors";
import { parseJson, route } from "@/server/http/handler";
import { getRequest, updateRequest } from "@/server/services/requests";

type Ctx = RouteContext<"/api/requests/[id]">;

async function parseId(ctx: Ctx) {
  const parsed = requestIdSchema.safeParse((await ctx.params).id);
  if (!parsed.success) throw notFound("Request not found");
  return parsed.data;
}

// GET /api/requests/:id → 200 { request } | 404. A merged request is returned
// with mergedIntoId set, so clients can follow it to the target.
export const GET = route(async (req, ctx: Ctx) => {
  const viewer = await getUserFromRequest(req);
  const request = await getRequest(await parseId(ctx), viewer?.id ?? null);
  if (!request) throw notFound("Request not found");
  return Response.json({ request });
});

// PATCH /api/requests/:id { title?, description? } → 200 { request }
// Author or admin only (403 otherwise); 409 if the request was merged.
export const PATCH = route(async (req, ctx: Ctx) => {
  const user = await requireUser(req);
  const id = await parseId(ctx);
  const input = await parseJson(req, updateRequestSchema);
  return Response.json({ request: await updateRequest(user, id, input) });
});

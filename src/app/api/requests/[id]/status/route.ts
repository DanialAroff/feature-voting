import { requestIdSchema, updateStatusSchema } from "@/lib/validation/requests";
import { requireAdmin } from "@/server/auth/current-user";
import { notFound } from "@/server/http/errors";
import { parseJson, route } from "@/server/http/handler";
import { changeStatus } from "@/server/services/status";

// PUT /api/requests/:id/status { status } → 200 { status, changed }
// Admin only: 401 when logged out, 403 for regular users (including the author).
export const PUT = route(async (req, ctx: RouteContext<"/api/requests/[id]/status">) => {
  const admin = await requireAdmin(req);
  const parsed = requestIdSchema.safeParse((await ctx.params).id);
  if (!parsed.success) throw notFound("Request not found");
  const { status } = await parseJson(req, updateStatusSchema);
  return Response.json(await changeStatus(admin, parsed.data, status));
});

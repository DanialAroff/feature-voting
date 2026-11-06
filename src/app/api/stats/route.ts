import { requireAdmin } from "@/server/auth/current-user";
import { route } from "@/server/http/handler";
import { getUsageStats } from "@/server/services/stats";

// GET /api/stats → 200 UsageStats. Admin only (401 anonymous, 403 users).
export const GET = route(async (req) => {
  const admin = await requireAdmin(req);
  return Response.json(await getUsageStats(admin));
});

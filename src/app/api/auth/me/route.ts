import { getUserFromRequest } from "@/server/auth/current-user";
import { route } from "@/server/http/handler";

// GET /api/auth/me → 200 { user } (user is null when logged out).
export const GET = route(async (req) => {
  return Response.json({ user: await getUserFromRequest(req) });
});

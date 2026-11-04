import { createRequestSchema, listQuerySchema } from "@/lib/validation/requests";
import { getUserFromRequest, requireUser } from "@/server/auth/current-user";
import { parseJson, route } from "@/server/http/handler";
import { createRequest, listRequests } from "@/server/services/requests";

// GET /api/requests?q=&status=&sort=top|new|comments&page= → 200 { items, page, pageSize, total, totalPages }
export const GET = route(async (req) => {
  const query = listQuerySchema.parse(Object.fromEntries(req.nextUrl.searchParams));
  const viewer = await getUserFromRequest(req);
  return Response.json(await listRequests(query, viewer?.id ?? null));
});

// POST /api/requests { title, description } → 201 { request }
export const POST = route(async (req) => {
  const user = await requireUser(req);
  const input = await parseJson(req, createRequestSchema);
  return Response.json({ request: await createRequest(user, input) }, { status: 201 });
});

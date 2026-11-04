import { NextResponse } from "next/server";
import { invalidateSession, SESSION_COOKIE } from "@/server/auth/session";
import { route } from "@/server/http/handler";

// POST /api/auth/logout → 204. Idempotent: logging out twice is fine.
export const POST = route(async (req) => {
  await invalidateSession(req.cookies.get(SESSION_COOKIE)?.value);
  const res = new NextResponse(null, { status: 204 });
  res.cookies.delete(SESSION_COOKIE);
  return res;
});

import { NextResponse } from "next/server";
import { loginSchema } from "@/lib/validation/auth";
import { createSession, SESSION_COOKIE, sessionCookieOptions } from "@/server/auth/session";
import { parseJson, route } from "@/server/http/handler";
import { authenticate } from "@/server/services/auth";

// POST /api/auth/login → 200 { user } and a session cookie; 401 on bad credentials.
export const POST = route(async (req) => {
  const input = await parseJson(req, loginSchema);
  const user = await authenticate(input);
  const { token, expiresAt } = await createSession(user.id);

  const res = NextResponse.json({ user });
  res.cookies.set(SESSION_COOKIE, token, sessionCookieOptions(expiresAt));
  return res;
});

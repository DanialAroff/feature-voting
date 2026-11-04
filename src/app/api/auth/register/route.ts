import { NextResponse } from "next/server";
import { registerSchema } from "@/lib/validation/auth";
import { createSession, SESSION_COOKIE, sessionCookieOptions } from "@/server/auth/session";
import { parseJson, route } from "@/server/http/handler";
import { registerUser } from "@/server/services/auth";

// POST /api/auth/register → 201 { user }, and logs the new user in.
export const POST = route(async (req) => {
  const input = await parseJson(req, registerSchema);
  const user = await registerUser(input);
  const { token, expiresAt } = await createSession(user.id);

  const res = NextResponse.json({ user }, { status: 201 });
  res.cookies.set(SESSION_COOKIE, token, sessionCookieOptions(expiresAt));
  return res;
});

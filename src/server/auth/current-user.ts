import "server-only";
import { cookies } from "next/headers";
import type { NextRequest } from "next/server";
import { cache } from "react";
import { assertAdmin, assertAuthenticated } from "./policies";
import { SESSION_COOKIE, validateSessionToken } from "./session";

// Route handlers: read the cookie from the request itself, so handlers can be
// invoked directly in integration tests with a constructed NextRequest.
export function getUserFromRequest(req: NextRequest) {
  return validateSessionToken(req.cookies.get(SESSION_COOKIE)?.value);
}

export async function requireUser(req: NextRequest) {
  return assertAuthenticated(await getUserFromRequest(req));
}

export async function requireAdmin(req: NextRequest) {
  return assertAdmin(await getUserFromRequest(req));
}

// Server Components: memoized per render pass. With cacheComponents enabled,
// callers must sit inside a <Suspense> boundary.
export const getCurrentUser = cache(async () => {
  const store = await cookies();
  return validateSessionToken(store.get(SESSION_COOKIE)?.value);
});

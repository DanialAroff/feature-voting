import { forbidden, unauthenticated } from "@/server/http/errors";
import type { PublicUser } from "./types";

// Authorization rules as plain functions: called from routes and services,
// unit-testable without HTTP or a database.

export function assertAuthenticated(user: PublicUser | null): PublicUser {
  if (!user) throw unauthenticated();
  return user;
}

export function assertAdmin(user: PublicUser | null): PublicUser {
  const u = assertAuthenticated(user);
  if (u.role !== "admin") throw forbidden("Only administrators can do that");
  return u;
}

export const isAdmin = (user: PublicUser | null) => user?.role === "admin";

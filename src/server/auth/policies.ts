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

/** Business rule: a user cannot edit another user's request (admins can moderate any). */
export const canEditRequest = (user: PublicUser | null, authorId: number) =>
  !!user && (user.id === authorId || user.role === "admin");

export function assertCanEditRequest(user: PublicUser | null, authorId: number): PublicUser {
  const u = assertAuthenticated(user);
  if (!canEditRequest(u, authorId)) throw forbidden("You can only edit your own requests");
  return u;
}

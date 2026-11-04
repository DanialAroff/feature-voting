// @vitest-environment node
import { describe, expect, test } from "vitest";
import { AppError } from "@/server/http/errors";
import { assertAdmin, assertAuthenticated } from "./policies";
import type { PublicUser } from "./types";

const user: PublicUser = { id: 1, email: "u@test.local", displayName: "U", role: "user" };
const admin: PublicUser = { ...user, id: 2, role: "admin" };

function statusOf(fn: () => unknown) {
  try {
    fn();
  } catch (err) {
    return err instanceof AppError ? err.status : "non-AppError";
  }
  return "no error";
}

describe("authorization policies", () => {
  test("anonymous callers get 401", () => {
    expect(statusOf(() => assertAuthenticated(null))).toBe(401);
    expect(statusOf(() => assertAdmin(null))).toBe(401);
  });

  test("non-admins get 403 from admin checks", () => {
    expect(assertAuthenticated(user)).toBe(user);
    expect(statusOf(() => assertAdmin(user))).toBe(403);
  });

  test("admins pass", () => {
    expect(assertAdmin(admin)).toBe(admin);
  });
});

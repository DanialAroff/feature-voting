// @vitest-environment node
import { describe, expect, test } from "vitest";
import { hashPassword, verifyPassword } from "./password";

describe("password hashing", () => {
  test("verifies the right password and rejects a wrong one", async () => {
    const hash = await hashPassword("correct horse");
    expect(hash).toMatch(/^\$argon2id\$/);
    expect(await verifyPassword(hash, "correct horse")).toBe(true);
    expect(await verifyPassword(hash, "wrong horse")).toBe(false);
  });

  test("salts each hash", async () => {
    expect(await hashPassword("same")).not.toBe(await hashPassword("same"));
  });

  test("treats a malformed hash as a failed login", async () => {
    expect(await verifyPassword("not-a-hash", "anything")).toBe(false);
  });
});

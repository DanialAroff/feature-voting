import "server-only";
import { eq, sql } from "drizzle-orm";
import { hashPassword, verifyPassword } from "@/server/auth/password";
import type { PublicUser } from "@/server/auth/types";
import { db } from "@/server/db";
import { isUniqueViolation } from "@/server/db/errors";
import { users } from "@/server/db/schema";
import { AppError, conflict } from "@/server/http/errors";
import type { LoginInput, RegisterInput } from "@/lib/validation/auth";

const publicColumns = {
  id: users.id,
  email: users.email,
  displayName: users.displayName,
  role: users.role,
};

export async function registerUser(input: RegisterInput): Promise<PublicUser> {
  const passwordHash = await hashPassword(input.password);
  try {
    // Role is never taken from input: self-registration always creates a plain user.
    const [user] = await db
      .insert(users)
      .values({ email: input.email, displayName: input.displayName, passwordHash, role: "user" })
      .returning(publicColumns);
    return user;
  } catch (err) {
    // The unique index decides, so two simultaneous sign-ups can't both win.
    if (isUniqueViolation(err, "users_email_lower_uq")) {
      throw conflict("An account with this email already exists", {
        email: ["An account with this email already exists"],
      });
    }
    throw err;
  }
}

// Verified against a dummy hash when the email is unknown, so response time
// doesn't reveal which emails have accounts.
let dummyHash: Promise<string> | undefined;

export async function authenticate(input: LoginInput): Promise<PublicUser> {
  const [row] = await db
    .select({ ...publicColumns, passwordHash: users.passwordHash })
    .from(users)
    .where(eq(sql`lower(${users.email})`, input.email.toLowerCase()));

  dummyHash ??= hashPassword("dummy-password-for-timing");
  const ok = await verifyPassword(row?.passwordHash ?? (await dummyHash), input.password);
  if (!row || !ok) {
    // Same message either way: don't reveal whether the email exists.
    throw new AppError(401, "UNAUTHENTICATED", "Invalid email or password");
  }
  return { id: row.id, email: row.email, displayName: row.displayName, role: row.role };
}

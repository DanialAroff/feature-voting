// Shared by the API (server-side validation) and the forms (instant feedback).
import { z } from "zod";

const email = z
  .string()
  .trim()
  .toLowerCase()
  .pipe(z.email({ message: "Enter a valid email address" }));

export const registerSchema = z.object({
  email,
  displayName: z
    .string()
    .trim()
    .min(1, "Enter a display name")
    .max(50, "Display name must be at most 50 characters"),
  password: z
    .string()
    .min(8, "Password must be at least 8 characters")
    .max(128, "Password must be at most 128 characters"),
});

export const loginSchema = z.object({
  email,
  password: z.string().min(1, "Enter your password").max(128),
});

export type RegisterInput = z.infer<typeof registerSchema>;
export type LoginInput = z.infer<typeof loginSchema>;

import { z } from "zod";

// Limit mirrors the comments_body_length CHECK constraint.
export const createCommentSchema = z.object({
  body: z.string().trim().min(1, "Write a comment first").max(5000, "Comments must be at most 5000 characters"),
  // Admin-only; a non-admin sending true gets 403 rather than a silent downgrade.
  official: z.boolean().optional().default(false),
});
export type CreateCommentInput = z.infer<typeof createCommentSchema>;

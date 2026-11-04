import { z } from "zod";
import { REQUEST_STATUSES, SORT_OPTIONS, type RequestSort } from "@/lib/requests";

// Limits mirror the CHECK constraints in the schema.
export const createRequestSchema = z.object({
  title: z
    .string()
    .trim()
    .min(3, "Title must be at least 3 characters")
    .max(120, "Title must be at most 120 characters"),
  description: z
    .string()
    .trim()
    .min(1, "Describe the request")
    .max(5000, "Description must be at most 5000 characters"),
});
export type CreateRequestInput = z.infer<typeof createRequestSchema>;

// Only title and description are editable; status and author are not, whatever the body says.
export const updateRequestSchema = createRequestSchema
  .partial()
  .refine((v) => v.title !== undefined || v.description !== undefined, { message: "Nothing to update" });
export type UpdateRequestInput = z.infer<typeof updateRequestSchema>;

const first = (v: unknown) => (Array.isArray(v) ? v[0] : v);
const sortKeys = Object.keys(SORT_OPTIONS) as [RequestSort, ...RequestSort[]];

// Query-string filters. Lenient on purpose: a bad value in a shared URL falls
// back to the default instead of breaking the page.
export const listQuerySchema = z.object({
  q: z.preprocess(first, z.string().trim().max(100).optional()).catch(undefined),
  status: z.preprocess(first, z.enum(REQUEST_STATUSES).optional()).catch(undefined),
  sort: z.preprocess(first, z.enum(sortKeys)).catch("top"),
  page: z.preprocess(first, z.coerce.number().int().min(1).max(10_000)).catch(1),
});
export type ListQuery = z.infer<typeof listQuerySchema>;

export const requestIdSchema = z.coerce.number().int().positive();

export const mergeRequestSchema = z.object({
  targetId: z.coerce.number({ message: "Enter the number of the request to keep" }).int().positive("Enter a valid request number"),
});
export type MergeRequestInput = z.infer<typeof mergeRequestSchema>;

export const updateStatusSchema = z.object({
  status: z.enum(REQUEST_STATUSES, { message: "Choose a valid status" }),
});
export type UpdateStatusInput = z.infer<typeof updateStatusSchema>;

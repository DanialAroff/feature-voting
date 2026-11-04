// Request vocabulary shared by the server and the UI.
import type { RequestStatus } from "@/server/db/schema";

export const REQUEST_STATUSES = ["under_review", "planned", "in_progress", "released", "declined"] as const;

export const STATUS_LABELS: Record<RequestStatus, string> = {
  under_review: "Under Review",
  planned: "Planned",
  in_progress: "In Progress",
  released: "Released",
  declined: "Declined",
};

export const SORT_OPTIONS = {
  top: "Most votes",
  new: "Newest",
  comments: "Most comments",
} as const;
export type RequestSort = keyof typeof SORT_OPTIONS;

export const PAGE_SIZE = 20;

import { STATUS_LABELS } from "@/lib/requests";
import type { RequestStatus } from "@/server/db/schema";

// Colour is a hint only; the label text carries the meaning (WCAG 1.4.1).
const STYLES: Record<RequestStatus, string> = {
  under_review: "bg-zinc-100 text-zinc-800 dark:bg-zinc-800 dark:text-zinc-200",
  planned: "bg-blue-100 text-blue-900 dark:bg-blue-950 dark:text-blue-200",
  in_progress: "bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-200",
  released: "bg-green-100 text-green-900 dark:bg-green-950 dark:text-green-200",
  declined: "bg-red-100 text-red-900 dark:bg-red-950 dark:text-red-200",
};

export function StatusBadge({ status }: { status: RequestStatus }) {
  return (
    <span className={`inline-block rounded-full px-2.5 py-0.5 text-xs font-medium ${STYLES[status]}`}>
      {STATUS_LABELS[status]}
    </span>
  );
}

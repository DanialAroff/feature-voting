import { formatDate } from "@/lib/format";
import { STATUS_LABELS } from "@/lib/requests";
import type { StatusChangeEntry } from "@/server/services/status";

// "Follow progress": every status change, oldest first, visible to everyone.
export function StatusTimeline({ createdAt, history }: { createdAt: Date; history: StatusChangeEntry[] }) {
  return (
    <section aria-labelledby="progress-heading">
      <h2 id="progress-heading" className="mb-3 text-lg font-semibold">
        Progress
      </h2>
      <ol className="flex flex-col gap-3 border-l-2 border-zinc-200 pl-4 dark:border-zinc-800">
        <TimelineItem date={createdAt} text="Submitted, Under Review" />
        {history.map((h) => (
          <TimelineItem
            key={h.id}
            date={h.createdAt}
            text={`${STATUS_LABELS[h.fromStatus]} → ${STATUS_LABELS[h.toStatus]}`}
            by={h.actor.displayName}
          />
        ))}
      </ol>
    </section>
  );
}

function TimelineItem({ date, text, by }: { date: Date; text: string; by?: string }) {
  return (
    <li className="text-sm">
      <span className="font-medium">{text}</span>
      <span className="text-zinc-600 dark:text-zinc-400">
        {" "}
        · <time dateTime={new Date(date).toISOString()}>{formatDate(date)}</time>
        {by && ` by ${by}`}
      </span>
    </li>
  );
}

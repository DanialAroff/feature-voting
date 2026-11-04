import Link from "next/link";
import { formatDate, plural } from "@/lib/format";
import type { CommentView } from "@/server/services/comments";
import { CommentForm } from "./comment-form";

type Props = {
  requestId: number;
  comments: CommentView[];
  viewer: { isAdmin: boolean } | null;
};

export function CommentThread({ requestId, comments, viewer }: Props) {
  return (
    <section aria-labelledby="comments-heading" className="flex flex-col gap-4">
      <h2 id="comments-heading" className="text-lg font-semibold">
        {plural(comments.length, "comment")}
      </h2>

      {comments.length === 0 ? (
        <p className="text-sm text-zinc-600 dark:text-zinc-400">No comments yet. Start the discussion.</p>
      ) : (
        <ol className="flex flex-col gap-3">
          {comments.map((c) => (
            <CommentItem key={c.id} comment={c} />
          ))}
        </ol>
      )}

      {viewer ? (
        <CommentForm requestId={requestId} isAdmin={viewer.isAdmin} />
      ) : (
        <p className="text-sm">
          <Link
            href={`/login?next=${encodeURIComponent(`/requests/${requestId}`)}`}
            className="font-medium text-blue-700 underline dark:text-blue-400"
          >
            Log in
          </Link>{" "}
          to join the discussion.
        </p>
      )}
    </section>
  );
}

function CommentItem({ comment: c }: { comment: CommentView }) {
  const official = c.kind === "official";
  return (
    <li
      className={`rounded-lg border p-4 ${
        official
          ? "border-amber-300 bg-amber-50 dark:border-amber-800 dark:bg-amber-950/40"
          : "border-zinc-200 dark:border-zinc-800"
      }`}
    >
      <div className="mb-1.5 flex flex-wrap items-center gap-2 text-sm">
        <span className="font-medium">{c.author.displayName}</span>
        {official && (
          <span className="rounded bg-amber-200 px-1.5 py-0.5 text-xs font-medium text-amber-950">Official response</span>
        )}
        <time dateTime={new Date(c.createdAt).toISOString()} className="text-zinc-600 dark:text-zinc-400">
          {formatDate(c.createdAt)}
        </time>
        {c.originRequestId && (
          <span className="text-zinc-600 dark:text-zinc-400">· originally on #{c.originRequestId}</span>
        )}
      </div>
      {/* Plain text: React escapes it, so comments can't inject HTML. */}
      <p className="whitespace-pre-wrap text-sm leading-relaxed">{c.body}</p>
    </li>
  );
}

/** The newest official response, pinned under the title so it's seen first. */
export function PinnedOfficialResponse({ comments }: { comments: CommentView[] }) {
  const latest = comments.findLast((c) => c.kind === "official");
  if (!latest) return null;
  return (
    <aside
      aria-label="Official response"
      className="rounded-lg border-l-4 border-amber-500 bg-amber-50 px-4 py-3 dark:bg-amber-950/40"
    >
      <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-amber-900 dark:text-amber-300">
        Official response · {latest.author.displayName} · {formatDate(latest.createdAt)}
      </p>
      <p className="whitespace-pre-wrap text-sm leading-relaxed">{latest.body}</p>
    </aside>
  );
}

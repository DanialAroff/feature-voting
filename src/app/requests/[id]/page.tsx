import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { Suspense } from "react";
import { CommentThread, PinnedOfficialResponse } from "@/components/comments/comment-thread";
import { MergeControl } from "@/components/requests/merge-control";
import { StatusBadge } from "@/components/requests/status-badge";
import { StatusControl } from "@/components/requests/status-control";
import { StatusTimeline } from "@/components/requests/status-timeline";
import { VoteButton } from "@/components/requests/vote-button";
import { formatDate, plural } from "@/lib/format";
import { requestIdSchema } from "@/lib/validation/requests";
import { getCurrentUser } from "@/server/auth/current-user";
import { canEditRequest, isAdmin } from "@/server/auth/policies";
import { listComments } from "@/server/services/comments";
import { getMergedFrom } from "@/server/services/merge";
import { getRequest } from "@/server/services/requests";
import { getStatusHistory } from "@/server/services/status";

export default function RequestPage({ params, searchParams }: PageProps<"/requests/[id]">) {
  return (
    <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-8">
      <Link href="/" className="text-sm text-blue-700 underline dark:text-blue-400">
        ← All requests
      </Link>
      <Suspense fallback={<DetailSkeleton />}>
        <RequestDetail params={params} searchParams={searchParams} />
      </Suspense>
    </main>
  );
}

type Props = {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

async function RequestDetail({ params, searchParams }: Props) {
  const parsed = requestIdSchema.safeParse((await params).id);
  if (!parsed.success) notFound();

  const viewer = await getCurrentUser();
  const [request, history, comments, mergedFrom] = await Promise.all([
    getRequest(parsed.data, viewer?.id ?? null),
    getStatusHistory(parsed.data),
    listComments(parsed.data),
    getMergedFrom(parsed.data),
  ]);
  if (!request) notFound();
  // Merged duplicates live on as tombstones; old links follow them to the target.
  if (request.mergedIntoId) redirect(`/requests/${request.mergedIntoId}?mergedFrom=${request.id}`);

  const { mergedFrom: arrivedFromId } = await searchParams;
  const arrivedFrom = mergedFrom.find((m) => String(m.id) === arrivedFromId);
  const admin = isAdmin(viewer);

  return (
    <article className="mt-4 flex flex-col gap-4">
      {arrivedFrom && (
        <p role="status" className="rounded-md bg-blue-50 px-3 py-2 text-sm text-blue-900 dark:bg-blue-950 dark:text-blue-200">
          #{arrivedFrom.id} &ldquo;{arrivedFrom.title}&rdquo; was merged into this request. Its votes and comments are here now.
        </p>
      )}
      <header className="flex items-start gap-4">
        <VoteButton
          key={`${request.voteCount}-${request.hasVoted}`}
          requestId={request.id}
          initial={{ voted: request.hasVoted, voteCount: request.voteCount }}
          canVote={!!viewer}
          size="lg"
        />
        <div className="flex flex-col gap-2">
          <h1 className="text-2xl font-semibold">
            <span className="text-zinc-500">#{request.id}</span> {request.title}
          </h1>
          <div className="flex flex-wrap items-center gap-3 text-sm text-zinc-600 dark:text-zinc-400">
            <StatusBadge status={request.status} />
            <span>
              by {request.author.displayName} ·{" "}
              <time dateTime={new Date(request.createdAt).toISOString()}>{formatDate(request.createdAt)}</time>
            </span>
            <span>{plural(request.commentCount, "comment")}</span>
            {canEditRequest(viewer, request.author.id) && (
              <Link href={`/requests/${request.id}/edit`} className="text-blue-700 underline dark:text-blue-400">
                Edit
              </Link>
            )}
          </div>
          {mergedFrom.length > 0 && (
            <p className="text-sm text-zinc-600 dark:text-zinc-400">
              Merged from {mergedFrom.map((m) => `#${m.id} "${m.title}"`).join(", ")}
            </p>
          )}
        </div>
      </header>
      <PinnedOfficialResponse comments={comments} />
      {/* Hiding admin controls is UX only; the API enforces admin-only on its own. */}
      {admin && (
        <div className="flex flex-col gap-3">
          <StatusControl key={request.status} requestId={request.id} current={request.status} />
          <MergeControl sourceId={request.id} />
        </div>
      )}
      {/* Plain text: React escapes it, so user content can't inject HTML. */}
      <p className="whitespace-pre-wrap leading-relaxed">{request.description}</p>
      <StatusTimeline createdAt={request.createdAt} history={history} />
      <CommentThread requestId={request.id} comments={comments} viewer={viewer && { isAdmin: admin }} />
    </article>
  );
}

function DetailSkeleton() {
  return (
    <div aria-busy="true" aria-label="Loading request" className="mt-4 flex flex-col gap-4">
      <div className="h-8 w-2/3 animate-pulse rounded bg-zinc-100 dark:bg-zinc-900" />
      <div className="h-12 animate-pulse rounded bg-zinc-100 dark:bg-zinc-900" />
      <div className="h-24 animate-pulse rounded bg-zinc-100 dark:bg-zinc-900" />
    </div>
  );
}

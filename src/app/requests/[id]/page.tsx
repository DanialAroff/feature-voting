import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { Suspense } from "react";
import { StatusBadge } from "@/components/requests/status-badge";
import { VoteButton } from "@/components/requests/vote-button";
import { formatDate, plural } from "@/lib/format";
import { requestIdSchema } from "@/lib/validation/requests";
import { getCurrentUser } from "@/server/auth/current-user";
import { getRequest } from "@/server/services/requests";

export default function RequestPage({ params }: PageProps<"/requests/[id]">) {
  return (
    <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-8">
      <Link href="/" className="text-sm text-blue-700 underline dark:text-blue-400">
        ← All requests
      </Link>
      <Suspense fallback={<DetailSkeleton />}>
        <RequestDetail params={params} />
      </Suspense>
    </main>
  );
}

async function RequestDetail({ params }: { params: Promise<{ id: string }> }) {
  const parsed = requestIdSchema.safeParse((await params).id);
  if (!parsed.success) notFound();

  const viewer = await getCurrentUser();
  const request = await getRequest(parsed.data, viewer?.id ?? null);
  if (!request) notFound();
  // Merged duplicates live on as tombstones; old links follow them to the target.
  if (request.mergedIntoId) redirect(`/requests/${request.mergedIntoId}`);

  return (
    <article className="mt-4 flex flex-col gap-4">
      <header className="flex items-start gap-4">
        <VoteButton
          key={`${request.voteCount}-${request.hasVoted}`}
          requestId={request.id}
          initial={{ voted: request.hasVoted, voteCount: request.voteCount }}
          canVote={!!viewer}
          size="lg"
        />
        <div className="flex flex-col gap-2">
          <h1 className="text-2xl font-semibold">{request.title}</h1>
          <div className="flex flex-wrap items-center gap-3 text-sm text-zinc-600 dark:text-zinc-400">
            <StatusBadge status={request.status} />
            <span>
              by {request.author.displayName} ·{" "}
              <time dateTime={new Date(request.createdAt).toISOString()}>{formatDate(request.createdAt)}</time>
            </span>
            <span>{plural(request.commentCount, "comment")}</span>
          </div>
        </div>
      </header>
      {/* Plain text: React escapes it, so user content can't inject HTML. */}
      <p className="whitespace-pre-wrap leading-relaxed">{request.description}</p>
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

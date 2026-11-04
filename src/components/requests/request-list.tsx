import Link from "next/link";
import { formatDate, plural } from "@/lib/format";
import { listQuerySchema, type ListQuery } from "@/lib/validation/requests";
import { getCurrentUser } from "@/server/auth/current-user";
import { listRequests, type RequestSummary } from "@/server/services/requests";
import { StatusBadge } from "./status-badge";
import { VoteButton } from "./vote-button";

type SearchParams = Record<string, string | string[] | undefined>;

// Server Component: reads the DB directly through the service (no HTTP hop).
// Rendered inside <Suspense> because it awaits request data.
export async function RequestList({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const query = listQuerySchema.parse(await searchParams);
  const viewer = await getCurrentUser();
  const page = await listRequests(query, viewer?.id ?? null);

  if (page.items.length === 0) return <EmptyState filtered={!!(query.q || query.status)} />;

  return (
    <section aria-labelledby="results-heading">
      <h2 id="results-heading" className="sr-only">
        Results
      </h2>
      <p className="mb-3 text-sm text-zinc-600 dark:text-zinc-400" aria-live="polite">
        {plural(page.total, "request")}
      </p>
      <ul className="flex flex-col gap-3">
        {page.items.map((r) => (
          <RequestRow key={r.id} request={r} canVote={!!viewer} />
        ))}
      </ul>
      {page.totalPages > 1 && <Pagination query={query} totalPages={page.totalPages} />}
    </section>
  );
}

function RequestRow({ request: r, canVote }: { request: RequestSummary; canVote: boolean }) {
  return (
    <li className="flex gap-4 rounded-lg border border-zinc-200 p-4 dark:border-zinc-800">
      {/* key: re-seed local state whenever the server sends fresh numbers */}
      <VoteButton
        key={`${r.voteCount}-${r.hasVoted}`}
        requestId={r.id}
        initial={{ voted: r.hasVoted, voteCount: r.voteCount }}
        canVote={canVote}
      />
      <div className="flex min-w-0 flex-1 flex-col gap-1.5">
        <Link href={`/requests/${r.id}`} className="font-medium hover:underline">
          {r.title}
        </Link>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-zinc-600 dark:text-zinc-400">
          <StatusBadge status={r.status} />
          <span>{plural(r.commentCount, "comment")}</span>
          <span>
            by {r.author.displayName} · <time dateTime={new Date(r.createdAt).toISOString()}>{formatDate(r.createdAt)}</time>
          </span>
        </div>
      </div>
    </li>
  );
}

function Pagination({ query, totalPages }: { query: ListQuery; totalPages: number }) {
  const href = (page: number) => {
    const p = new URLSearchParams();
    if (query.q) p.set("q", query.q);
    if (query.status) p.set("status", query.status);
    if (query.sort !== "top") p.set("sort", query.sort);
    if (page > 1) p.set("page", String(page));
    const s = p.toString();
    return s ? `/?${s}` : "/";
  };
  const linkClass = "rounded-md border border-zinc-300 px-3 py-1.5 text-sm hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800";
  return (
    <nav aria-label="Pagination" className="mt-6 flex items-center justify-between">
      {query.page > 1 ? (
        <Link href={href(query.page - 1)} className={linkClass}>
          ← Previous
        </Link>
      ) : (
        <span />
      )}
      <span className="text-sm text-zinc-600 dark:text-zinc-400">
        Page {query.page} of {totalPages}
      </span>
      {query.page < totalPages ? (
        <Link href={href(query.page + 1)} className={linkClass}>
          Next →
        </Link>
      ) : (
        <span />
      )}
    </nav>
  );
}

function EmptyState({ filtered }: { filtered: boolean }) {
  return (
    <div className="rounded-lg border border-dashed border-zinc-300 p-10 text-center dark:border-zinc-700">
      {filtered ? (
        <>
          <p className="font-medium">No requests match your filters.</p>
          <Link href="/" className="mt-2 inline-block text-sm text-blue-700 underline dark:text-blue-400">
            Clear filters
          </Link>
        </>
      ) : (
        <>
          <p className="font-medium">No feature requests yet.</p>
          <Link href="/requests/new" className="mt-2 inline-block text-sm text-blue-700 underline dark:text-blue-400">
            Be the first to suggest one
          </Link>
        </>
      )}
    </div>
  );
}

export function RequestListSkeleton() {
  return (
    <div aria-busy="true" aria-label="Loading requests" className="flex flex-col gap-3">
      {Array.from({ length: 4 }, (_, i) => (
        <div key={i} className="h-20 animate-pulse rounded-lg bg-zinc-100 dark:bg-zinc-900" />
      ))}
    </div>
  );
}

import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { StatusBadge } from "@/components/requests/status-badge";
import { formatDate } from "@/lib/format";
import { REQUEST_STATUSES, STATUS_LABELS } from "@/lib/requests";
import { getCurrentUser } from "@/server/auth/current-user";
import { isAdmin } from "@/server/auth/policies";
import { getUsageStats } from "@/server/services/stats";

export const metadata: Metadata = { title: "Usage stats · Feature Requests" };

export default function StatsPage() {
  return (
    <main className="mx-auto w-full max-w-4xl flex-1 px-4 py-8">
      <h1 className="mb-6 text-2xl font-semibold">Usage stats</h1>
      <Suspense fallback={<div aria-busy="true" aria-label="Loading stats" className="h-64 animate-pulse rounded-lg bg-zinc-100 dark:bg-zinc-900" />}>
        <Stats />
      </Suspense>
    </main>
  );
}

// Page checks are for UX; GET /api/stats and getUsageStats enforce admin-only on their own.
async function Stats() {
  const viewer = await getCurrentUser();
  if (!viewer) redirect("/login?next=/admin/stats");
  if (!isAdmin(viewer)) {
    return (
      <p role="alert" className="rounded-lg border border-zinc-200 p-6 dark:border-zinc-800">
        Usage stats are only available to administrators.
      </p>
    );
  }

  const s = await getUsageStats(viewer);
  const pct = (n: number) => (s.totals.requests ? Math.round((n / s.totals.requests) * 100) : 0);

  return (
    <div className="flex flex-col gap-8">
      <section aria-labelledby="totals-heading">
        <h2 id="totals-heading" className="mb-3 text-lg font-semibold">
          Totals
        </h2>
        <dl className="grid grid-cols-2 gap-3 sm:grid-cols-5">
          <Tile label="Requests" value={s.totals.requests} />
          <Tile label="Votes" value={s.totals.votes} />
          <Tile label="Comments" value={s.totals.comments} />
          <Tile label="Users" value={s.totals.users} />
          <Tile label="Duplicates merged" value={s.totals.mergedDuplicates} />
        </dl>
      </section>

      <section aria-labelledby="week-heading">
        <h2 id="week-heading" className="mb-3 text-lg font-semibold">
          Last 7 days
        </h2>
        <dl className="grid grid-cols-3 gap-3">
          <Tile label="New requests" value={s.last7Days.requests} />
          <Tile label="Votes cast" value={s.last7Days.votes} />
          <Tile label="Comments" value={s.last7Days.comments} />
        </dl>
      </section>

      <section aria-labelledby="status-heading">
        <h2 id="status-heading" className="mb-3 text-lg font-semibold">
          Requests by status
        </h2>
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-zinc-200 text-left dark:border-zinc-800">
              <th scope="col" className="py-2 font-medium">Status</th>
              <th scope="col" className="py-2 text-right font-medium">Requests</th>
              <th scope="col" className="py-2 text-right font-medium">Share</th>
            </tr>
          </thead>
          <tbody>
            {REQUEST_STATUSES.map((status) => (
              <tr key={status} className="border-b border-zinc-100 dark:border-zinc-900">
                <th scope="row" className="py-2 text-left font-normal">
                  <Link href={`/?status=${status}`} className="hover:underline" aria-label={`${STATUS_LABELS[status]} requests`}>
                    <StatusBadge status={status} />
                  </Link>
                </th>
                <td className="py-2 text-right tabular-nums">{s.byStatus[status]}</td>
                <td className="py-2 text-right tabular-nums text-zinc-600 dark:text-zinc-400">{pct(s.byStatus[status])}%</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section aria-labelledby="top-heading">
        <h2 id="top-heading" className="mb-3 text-lg font-semibold">
          Most-voted requests
        </h2>
        {s.topRequests.length === 0 ? (
          <p className="text-sm text-zinc-600 dark:text-zinc-400">No requests yet.</p>
        ) : (
          <ol className="flex flex-col gap-2">
            {s.topRequests.map((r) => (
              <li key={r.id} className="flex items-center gap-3 text-sm">
                <span className="w-16 shrink-0 text-right font-semibold tabular-nums">{r.voteCount} votes</span>
                <Link href={`/requests/${r.id}`} className="hover:underline">
                  #{r.id} {r.title}
                </Link>
                <StatusBadge status={r.status} />
              </li>
            ))}
          </ol>
        )}
      </section>

      <p className="text-xs text-zinc-600 dark:text-zinc-400">
        Merged duplicates and merge notes are excluded from totals. Generated {formatDate(s.generatedAt)}.
      </p>
    </div>
  );
}

function Tile({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg border border-zinc-200 p-4 dark:border-zinc-800">
      <dt className="text-sm text-zinc-600 dark:text-zinc-400">{label}</dt>
      <dd className="text-2xl font-semibold tabular-nums">{value}</dd>
    </div>
  );
}

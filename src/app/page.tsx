import Link from "next/link";
import { Suspense } from "react";
import { RequestFilters } from "@/components/requests/request-filters";
import { RequestList, RequestListSkeleton } from "@/components/requests/request-list";

// The heading and layout are the static shell; filters and results read the
// URL, so each streams in behind its own boundary.
export default function HomePage({ searchParams }: PageProps<"/">) {
  return (
    <main className="mx-auto w-full max-w-4xl flex-1 px-4 py-8">
      <div className="mb-6 flex items-center justify-between gap-4">
        <h1 className="text-2xl font-semibold">Feature requests</h1>
        <Link href="/requests/new" className="rounded-md bg-blue-700 px-4 py-2 text-sm font-medium text-white hover:bg-blue-800">
          New request
        </Link>
      </div>
      <div className="mb-6">
        <Suspense fallback={<div className="h-16" />}>
          <RequestFilters />
        </Suspense>
      </div>
      <Suspense fallback={<RequestListSkeleton />}>
        <RequestList searchParams={searchParams} />
      </Suspense>
    </main>
  );
}

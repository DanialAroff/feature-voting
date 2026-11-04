"use client";

import { Button } from "@/components/ui/button";

// Catches unexpected render errors (e.g. the database is down) for any page.
// retry() re-fetches the segment's data (Next 16.3+); reset() would only re-render.
export default function ErrorPage({ retry }: { error: Error & { digest?: string }; retry: () => void }) {
  return (
    <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-16 text-center">
      <h1 className="text-2xl font-semibold">Something went wrong</h1>
      <p className="mt-2 mb-4 text-zinc-600 dark:text-zinc-400">Please try again in a moment.</p>
      <Button onClick={() => retry()}>Try again</Button>
    </main>
  );
}

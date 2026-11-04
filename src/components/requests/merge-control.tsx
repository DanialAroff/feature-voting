"use client";

import { useMutation } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { api, ApiError } from "@/lib/api-client";
import { STATUS_LABELS } from "@/lib/requests";
import type { RequestStatus } from "@/server/db/schema";

type Preview = { id: number; title: string; voteCount: number; status: RequestStatus; mergedIntoId: number | null };

// Admin-only. Two steps on purpose: merging can't be undone, so the admin sees
// which request they're merging into before confirming.
export function MergeControl({ sourceId }: { sourceId: number }) {
  const router = useRouter();
  const [targetInput, setTargetInput] = useState("");
  const [preview, setPreview] = useState<Preview | null>(null);
  const [error, setError] = useState<string | null>(null);

  const lookup = useMutation({
    mutationFn: (id: number) => api<{ request: Preview }>(`/api/requests/${id}`),
    onSuccess: ({ request }) => {
      if (request.mergedIntoId) setError(`#${request.id} was itself merged into #${request.mergedIntoId}. Merge into that one instead.`);
      else setPreview(request);
    },
    onError: (err) => setError(err instanceof ApiError && err.status === 404 ? "No request with that number." : err.message),
  });

  const merge = useMutation({
    mutationFn: (targetId: number) => api(`/api/requests/${sourceId}/merge`, "POST", { targetId }),
    onSuccess: (_data, targetId) => router.push(`/requests/${targetId}?mergedFrom=${sourceId}`),
    onError: (err) => {
      setPreview(null);
      setError(err.message);
    },
  });

  function onPreview(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setPreview(null);
    const id = Number(targetInput.replace(/^#/, ""));
    if (!Number.isInteger(id) || id <= 0) return setError("Enter a request number, e.g. 3.");
    if (id === sourceId) return setError("A request can't be merged into itself.");
    lookup.mutate(id);
  }

  return (
    <section aria-labelledby="merge-heading" className="rounded-lg border border-amber-300 bg-amber-50 p-4 dark:border-amber-800 dark:bg-amber-950/40">
      <h2 id="merge-heading" className="text-sm font-medium">
        Merge this duplicate <span className="font-normal text-zinc-600 dark:text-zinc-400">(admin)</span>
      </h2>
      <p className="mb-3 text-sm text-zinc-600 dark:text-zinc-400">
        Votes and comments move to the request you keep. This request then redirects there.
      </p>
      <form onSubmit={onPreview} className="flex flex-wrap items-end gap-3">
        <div className="flex flex-col gap-1">
          <label htmlFor="merge-target" className="text-sm">
            Request number to keep
          </label>
          <input
            id="merge-target"
            inputMode="numeric"
            value={targetInput}
            onChange={(e) => {
              setTargetInput(e.target.value);
              setPreview(null);
            }}
            placeholder="e.g. 3"
            className="w-32 rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 outline-none focus-visible:ring-2 focus-visible:ring-blue-600 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100"
          />
        </div>
        <Button type="submit" variant="secondary" pending={lookup.isPending}>
          {lookup.isPending ? "Looking up…" : "Preview"}
        </Button>
      </form>

      {preview && (
        <div className="mt-3 flex flex-wrap items-center gap-3 rounded-md bg-white p-3 text-sm dark:bg-zinc-900">
          <span>
            Merge into <strong>#{preview.id} {preview.title}</strong> ({preview.voteCount} votes, {STATUS_LABELS[preview.status]})?
          </span>
          <Button pending={merge.isPending} onClick={() => merge.mutate(preview.id)}>
            {merge.isPending ? "Merging…" : `Confirm merge into #${preview.id}`}
          </Button>
          <Button variant="secondary" onClick={() => setPreview(null)} disabled={merge.isPending}>
            Cancel
          </Button>
        </div>
      )}

      <p role="alert" className="mt-2 text-sm text-red-700 empty:hidden dark:text-red-400">
        {error}
      </p>
    </section>
  );
}

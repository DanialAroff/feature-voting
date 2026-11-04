"use client";

import { useMutation } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { api, ApiError } from "@/lib/api-client";
import { REQUEST_STATUSES, STATUS_LABELS } from "@/lib/requests";
import type { RequestStatus } from "@/server/db/schema";

// Admin-only control. Not optimistic, unlike voting: a status change is rare,
// deliberate and visible to everyone, so we wait for the server to confirm.
export function StatusControl({ requestId, current }: { requestId: number; current: RequestStatus }) {
  const router = useRouter();
  const [selected, setSelected] = useState<RequestStatus>(current);
  const [message, setMessage] = useState<{ kind: "ok" | "error"; text: string } | null>(null);

  const mutation = useMutation({
    mutationFn: (status: RequestStatus) =>
      api<{ status: RequestStatus; changed: boolean }>(`/api/requests/${requestId}/status`, "PUT", { status }),
    onSuccess: ({ status }) => {
      setMessage({ kind: "ok", text: `Status set to ${STATUS_LABELS[status]}.` });
      router.refresh(); // re-render badge and timeline from the server
    },
    onError: (err) => {
      if (err instanceof ApiError && err.details.mergedIntoId) {
        router.push(`/requests/${err.details.mergedIntoId}`);
        return;
      }
      setMessage({ kind: "error", text: err.message });
    },
  });

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        setMessage(null);
        mutation.mutate(selected);
      }}
      className="flex flex-wrap items-end gap-3 rounded-lg border border-amber-300 bg-amber-50 p-4 dark:border-amber-800 dark:bg-amber-950/40"
    >
      <div className="flex flex-col gap-1">
        <label htmlFor="status-select" className="text-sm font-medium">
          Status <span className="font-normal text-zinc-600 dark:text-zinc-400">(admin)</span>
        </label>
        <select
          id="status-select"
          value={selected}
          onChange={(e) => setSelected(e.target.value as RequestStatus)}
          className="rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 outline-none focus-visible:ring-2 focus-visible:ring-blue-600 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100"
        >
          {REQUEST_STATUSES.map((s) => (
            <option key={s} value={s}>
              {STATUS_LABELS[s]}
            </option>
          ))}
        </select>
      </div>
      <Button type="submit" pending={mutation.isPending} disabled={selected === current}>
        {mutation.isPending ? "Saving…" : "Update status"}
      </Button>
      <p
        aria-live="polite"
        className={`text-sm ${message?.kind === "error" ? "text-red-700 dark:text-red-400" : "text-green-800 dark:text-green-300"}`}
      >
        {message?.text}
      </p>
    </form>
  );
}

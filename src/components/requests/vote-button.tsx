"use client";

import { useMutation } from "@tanstack/react-query";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { api, ApiError } from "@/lib/api-client";

type VoteState = { voted: boolean; voteCount: number };

type Props = {
  requestId: number;
  initial: VoteState;
  canVote: boolean; // false when logged out
  size?: "sm" | "lg";
};

// Optimistic toggle: the UI flips immediately, then settles on what the server
// says. Each click sends the *desired* state (PUT or DELETE), so quick repeated
// clicks are safe, and only the latest response is applied so an older reply
// arriving late can't overwrite a newer click.
export function VoteButton({ requestId, initial, canVote, size = "sm" }: Props) {
  const router = useRouter();
  const pathname = usePathname();
  const [state, setState] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  const latest = useRef(0);
  const confirmed = useRef(initial); // last state the server agreed to

  const mutation = useMutation({
    mutationFn: ({ voted }: { voted: boolean; seq: number }) =>
      api<VoteState>(`/api/requests/${requestId}/vote`, voted ? "PUT" : "DELETE"),
    onMutate: ({ voted }) => {
      setError(null);
      setState((s) => ({ voted, voteCount: s.voteCount + (voted ? 1 : -1) }));
    },
    onSuccess: (server, { seq }) => {
      confirmed.current = server;
      if (seq === latest.current) setState(server);
    },
    onError: (err, { seq }) => {
      if (err instanceof ApiError && err.details.mergedIntoId) {
        router.push(`/requests/${err.details.mergedIntoId}`);
        return;
      }
      if (seq !== latest.current) return;
      setState(confirmed.current); // roll back to what the server last confirmed
      setError(err instanceof ApiError && err.status === 401 ? "Please log in again to vote." : "Couldn't save your vote. Try again.");
    },
  });

  const sizes = size === "lg" ? "h-16 w-16 text-lg" : "h-14 w-14";
  const label = `${state.voted ? "Remove your vote" : "Vote for this request"} (${state.voteCount} ${state.voteCount === 1 ? "vote" : "votes"})`;

  const body = (
    <>
      <span aria-hidden className="text-xs leading-none">
        ▲
      </span>
      <span className="font-semibold leading-tight">{state.voteCount}</span>
    </>
  );

  const base = `flex shrink-0 flex-col items-center justify-center rounded-md border outline-none focus-visible:ring-2 focus-visible:ring-blue-600 ${sizes}`;

  if (!canVote) {
    return (
      <Link
        href={`/login?next=${encodeURIComponent(pathname)}`}
        aria-label={`Log in to vote (${state.voteCount} ${state.voteCount === 1 ? "vote" : "votes"})`}
        className={`${base} border-zinc-300 bg-zinc-50 hover:bg-zinc-100 dark:border-zinc-700 dark:bg-zinc-900 dark:hover:bg-zinc-800`}
      >
        {body}
      </Link>
    );
  }

  return (
    <div className="flex flex-col items-center gap-1">
      <button
        type="button"
        aria-pressed={state.voted}
        aria-label={label}
        title={label}
        onClick={() => {
          latest.current += 1;
          mutation.mutate({ voted: !state.voted, seq: latest.current });
        }}
        className={`${base} ${
          state.voted
            ? "border-blue-700 bg-blue-700 text-white hover:bg-blue-800"
            : "border-zinc-300 bg-white hover:bg-zinc-100 dark:border-zinc-700 dark:bg-zinc-900 dark:hover:bg-zinc-800"
        }`}
      >
        {body}
      </button>
      {error && (
        <p role="alert" className="max-w-32 text-center text-xs text-red-700 dark:text-red-400">
          {error}
        </p>
      )}
    </div>
  );
}

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
// says. Each request sends the *desired* state (PUT or DELETE), so retries are
// safe. Requests go out one at a time: parallel ones could reach the server in
// a different order than they were sent, leaving the vote opposite to the last
// click. While one is in flight, further clicks only update the intent; when it
// returns, another request is sent if the intent no longer matches the server.
export function VoteButton({ requestId, initial, canVote, size = "sm" }: Props) {
  const router = useRouter();
  const pathname = usePathname();
  const [state, setState] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false); // exposed as aria-busy
  const confirmed = useRef(initial); // last state the server agreed to
  const desired = useRef(initial.voted); // the user's latest intent
  // A ref, not mutation.isPending: two clicks can land before React re-renders.
  const inFlight = useRef(false);

  const mutation = useMutation({
    mutationFn: async () => {
      try {
        while (desired.current !== confirmed.current.voted) {
          const voted = desired.current;
          confirmed.current = await api<VoteState>(`/api/requests/${requestId}/vote`, voted ? "PUT" : "DELETE");
        }
        return confirmed.current;
      } finally {
        // Cleared in the same tick as the final check, so a click can't slip between them unsent.
        inFlight.current = false;
      }
    },
    onSuccess: (server) => {
      if (inFlight.current) return; // a newer click's run will settle instead
      setState(server);
      setSyncing(false);
    },
    onError: (err) => {
      if (err instanceof ApiError && err.details.mergedIntoId) {
        router.push(`/requests/${err.details.mergedIntoId}`);
        return;
      }
      if (inFlight.current) return;
      desired.current = confirmed.current.voted;
      setState(confirmed.current); // roll back to what the server last confirmed
      setSyncing(false);
      setError(err instanceof ApiError && err.status === 401 ? "Please log in again to vote." : "Couldn't save your vote. Try again.");
    },
  });

  function toggle() {
    const voted = !desired.current;
    desired.current = voted;
    setError(null);
    setState((s) => ({ voted, voteCount: s.voteCount + (voted ? 1 : -1) }));
    if (inFlight.current) return; // the running loop picks up the new intent
    inFlight.current = true;
    setSyncing(true);
    mutation.mutate();
  }

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
        aria-busy={syncing}
        aria-label={label}
        title={label}
        onClick={toggle}
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

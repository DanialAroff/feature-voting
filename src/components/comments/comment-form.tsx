"use client";

import { useMutation } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useRef, useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { TextAreaField } from "@/components/ui/field";
import { api, ApiError } from "@/lib/api-client";
import { createCommentSchema, type CreateCommentInput } from "@/lib/validation/comments";

export function CommentForm({ requestId, isAdmin }: { requestId: number; isAdmin: boolean }) {
  const router = useRouter();
  const formRef = useRef<HTMLFormElement>(null);
  const [bodyError, setBodyError] = useState<string[] | undefined>();
  const [status, setStatus] = useState<{ kind: "ok" | "error"; text: string } | null>(null);

  const mutation = useMutation({
    mutationFn: (input: CreateCommentInput) => api(`/api/requests/${requestId}/comments`, "POST", input),
    onSuccess: (_data, input) => {
      formRef.current?.reset();
      setStatus({ kind: "ok", text: input.official ? "Official response posted." : "Comment posted." });
      router.refresh(); // re-render the thread, the count and any pinned response
    },
    onError: (err) => {
      if (err instanceof ApiError && err.details.mergedIntoId) {
        router.push(`/requests/${err.details.mergedIntoId}`);
        return;
      }
      if (err instanceof ApiError && err.fields.body) setBodyError(err.fields.body);
      else setStatus({ kind: "error", text: err.message });
    },
  });

  function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const data = new FormData(e.currentTarget);
    const parsed = createCommentSchema.safeParse({ body: data.get("body"), official: data.get("official") === "on" });
    setStatus(null);
    if (!parsed.success) {
      setBodyError(parsed.error.issues.map((i) => i.message));
      return;
    }
    setBodyError(undefined);
    mutation.mutate(parsed.data);
  }

  return (
    <form ref={formRef} onSubmit={onSubmit} noValidate className="flex flex-col gap-3">
      <TextAreaField label="Add a comment" name="body" rows={3} maxLength={5000} required errors={bodyError} />
      <div className="flex flex-wrap items-center gap-4">
        <Button type="submit" pending={mutation.isPending}>
          {mutation.isPending ? "Posting…" : "Post comment"}
        </Button>
        {isAdmin && (
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" name="official" className="h-4 w-4 accent-amber-600" />
            Post as official response
          </label>
        )}
        <p
          aria-live="polite"
          className={`text-sm ${status?.kind === "error" ? "text-red-700 dark:text-red-400" : "text-green-800 dark:text-green-300"}`}
        >
          {status?.text}
        </p>
      </div>
    </form>
  );
}

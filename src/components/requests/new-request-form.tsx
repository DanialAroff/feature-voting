"use client";

import { useMutation } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { Field, TextAreaField } from "@/components/ui/field";
import { api, ApiError } from "@/lib/api-client";
import { createRequestSchema, type CreateRequestInput } from "@/lib/validation/requests";

type FieldErrors = Record<string, string[] | undefined>;

export function NewRequestForm() {
  const router = useRouter();
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});

  const mutation = useMutation({
    mutationFn: (input: CreateRequestInput) => api<{ request: { id: number } }>("/api/requests", "POST", input),
    onSuccess: ({ request }) => router.push(`/requests/${request.id}`),
    onError: (err) => {
      if (err instanceof ApiError) setFieldErrors(err.fields);
    },
  });

  function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const parsed = createRequestSchema.safeParse(Object.fromEntries(new FormData(e.currentTarget)));
    if (!parsed.success) {
      setFieldErrors(Object.fromEntries(parsed.error.issues.map((i) => [String(i.path[0]), [i.message]])));
      return;
    }
    setFieldErrors({});
    mutation.mutate(parsed.data);
  }

  const formError =
    mutation.error && !(mutation.error instanceof ApiError && Object.keys(mutation.error.fields).length)
      ? mutation.error.message
      : null;

  return (
    <form onSubmit={onSubmit} noValidate className="flex flex-col gap-4">
      {formError && (
        <p role="alert" className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-800 dark:bg-red-950 dark:text-red-200">
          {formError}
        </p>
      )}
      <Field label="Title" name="title" required maxLength={120} placeholder="A short summary of the feature" errors={fieldErrors.title} />
      <TextAreaField
        label="Description"
        name="description"
        required
        maxLength={5000}
        rows={6}
        placeholder="What problem would it solve? How would you use it?"
        errors={fieldErrors.description}
      />
      <div>
        {/* Disabled while pending, so a double click can't submit twice. */}
        <Button type="submit" pending={mutation.isPending}>
          {mutation.isPending ? "Submitting…" : "Submit request"}
        </Button>
      </div>
    </form>
  );
}

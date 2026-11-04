"use client";

import { useMutation } from "@tanstack/react-query";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useState, type FormEvent } from "react";
import type { z } from "zod";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { api, ApiError, safeRedirect } from "@/lib/api-client";
import { loginSchema, registerSchema } from "@/lib/validation/auth";

type Mode = "login" | "register";
type FieldErrors = Record<string, string[] | undefined>;

const config = {
  login: {
    schema: loginSchema,
    endpoint: "/api/auth/login",
    submit: "Log in",
    pending: "Logging in…",
    switchText: "No account yet?",
    switchLink: { href: "/register", label: "Create one" },
  },
  register: {
    schema: registerSchema,
    endpoint: "/api/auth/register",
    submit: "Create account",
    pending: "Creating account…",
    switchText: "Already have an account?",
    switchLink: { href: "/login", label: "Log in" },
  },
} as const;

export function AuthForm({ mode }: { mode: Mode }) {
  const c = config[mode];
  const router = useRouter();
  const next = safeRedirect(useSearchParams().get("next"));
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});

  const mutation = useMutation({
    mutationFn: (input: unknown) => api(c.endpoint, "POST", input),
    onSuccess: () => {
      router.push(next);
      router.refresh(); // re-render server components with the new session
    },
    onError: (err) => {
      if (err instanceof ApiError) setFieldErrors(err.fields);
    },
  });

  function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const values = Object.fromEntries(new FormData(e.currentTarget));
    // Same schema as the server: instant feedback, but the server still decides.
    const parsed = (c.schema as z.ZodType).safeParse(values);
    if (!parsed.success) {
      setFieldErrors(
        Object.fromEntries(parsed.error.issues.map((i) => [String(i.path[0]), [i.message]])),
      );
      return;
    }
    setFieldErrors({});
    mutation.mutate(parsed.data);
  }

  // Field-level problems show next to the field; anything else shows at the top.
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
      <Field label="Email" name="email" type="email" autoComplete="email" required errors={fieldErrors.email} />
      {mode === "register" && (
        <Field label="Display name" name="displayName" autoComplete="nickname" required errors={fieldErrors.displayName} />
      )}
      <Field
        label="Password"
        name="password"
        type="password"
        autoComplete={mode === "login" ? "current-password" : "new-password"}
        required
        errors={fieldErrors.password}
      />
      <Button type="submit" pending={mutation.isPending}>
        {mutation.isPending ? c.pending : c.submit}
      </Button>
      <p className="text-sm text-zinc-600 dark:text-zinc-400">
        {c.switchText}{" "}
        <Link href={c.switchLink.href} className="font-medium text-blue-700 underline dark:text-blue-400">
          {c.switchLink.label}
        </Link>
      </p>
    </form>
  );
}

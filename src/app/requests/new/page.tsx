import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { NewRequestForm } from "@/components/requests/new-request-form";
import { getCurrentUser } from "@/server/auth/current-user";

export const metadata: Metadata = { title: "New request · Feature Requests" };

export default function NewRequestPage() {
  return (
    <main className="mx-auto w-full max-w-2xl flex-1 px-4 py-8">
      <h1 className="mb-6 text-2xl font-semibold">Suggest a feature</h1>
      <Suspense>
        <RequireLogin />
      </Suspense>
    </main>
  );
}

// UX convenience only: the API enforces login on POST regardless.
async function RequireLogin() {
  if (!(await getCurrentUser())) redirect("/login?next=/requests/new");
  return <NewRequestForm />;
}

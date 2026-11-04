import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { Suspense } from "react";
import { RequestForm } from "@/components/requests/request-form";
import { requestIdSchema } from "@/lib/validation/requests";
import { getCurrentUser } from "@/server/auth/current-user";
import { canEditRequest } from "@/server/auth/policies";
import { getRequest } from "@/server/services/requests";

export const metadata: Metadata = { title: "Edit request · Feature Requests" };

export default function EditRequestPage({ params }: PageProps<"/requests/[id]/edit">) {
  return (
    <main className="mx-auto w-full max-w-2xl flex-1 px-4 py-8">
      <h1 className="mb-6 text-2xl font-semibold">Edit request</h1>
      <Suspense>
        <EditForm params={params} />
      </Suspense>
    </main>
  );
}

// Page-level checks are for a friendly UX; PATCH enforces the same rule on its own.
async function EditForm({ params }: { params: Promise<{ id: string }> }) {
  const parsed = requestIdSchema.safeParse((await params).id);
  if (!parsed.success) notFound();
  const id = parsed.data;

  const viewer = await getCurrentUser();
  if (!viewer) redirect(`/login?next=/requests/${id}/edit`);

  const request = await getRequest(id, viewer.id);
  if (!request) notFound();
  if (request.mergedIntoId) redirect(`/requests/${request.mergedIntoId}?mergedFrom=${id}`);

  if (!canEditRequest(viewer, request.author.id)) {
    return (
      <div role="alert" className="rounded-lg border border-zinc-200 p-6 dark:border-zinc-800">
        <p className="font-medium">You can only edit your own requests.</p>
        <Link href={`/requests/${id}`} className="mt-2 inline-block text-sm text-blue-700 underline dark:text-blue-400">
          Back to the request
        </Link>
      </div>
    );
  }

  return <RequestForm mode="edit" requestId={id} initial={{ title: request.title, description: request.description }} />;
}

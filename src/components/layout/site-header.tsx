import Link from "next/link";
import { Suspense } from "react";
import { LogoutButton } from "@/components/auth/logout-button";
import { getCurrentUser } from "@/server/auth/current-user";

// The header shell is static; only the user menu reads the session, so it
// streams in behind its own Suspense boundary (required with cacheComponents).
export function SiteHeader() {
  return (
    <header className="border-b border-zinc-200 dark:border-zinc-800">
      <nav aria-label="Main" className="mx-auto flex max-w-4xl items-center justify-between gap-4 px-4 py-3">
        <Link href="/" className="font-semibold">
          Feature Requests
        </Link>
        <Suspense fallback={<div className="h-9 w-32" aria-hidden />}>
          <UserMenu />
        </Suspense>
      </nav>
    </header>
  );
}

async function UserMenu() {
  const user = await getCurrentUser();
  if (!user) {
    return (
      <div className="flex items-center gap-3 text-sm">
        <Link href="/login" className="font-medium hover:underline">
          Log in
        </Link>
        <Link href="/register" className="rounded-md bg-blue-700 px-3 py-2 font-medium text-white hover:bg-blue-800">
          Sign up
        </Link>
      </div>
    );
  }
  return (
    <div className="flex items-center gap-3 text-sm">
      {user.role === "admin" && (
        // Newest requests awaiting triage.
        <Link href="/?status=under_review&sort=new" className="font-medium hover:underline">
          Review queue
        </Link>
      )}
      <span>
        {user.displayName}
        {user.role === "admin" && (
          <span className="ml-2 rounded bg-amber-100 px-1.5 py-0.5 text-xs font-medium text-amber-900">Admin</span>
        )}
      </span>
      <LogoutButton />
    </div>
  );
}

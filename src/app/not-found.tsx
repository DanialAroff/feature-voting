import Link from "next/link";

export default function NotFound() {
  return (
    <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-16 text-center">
      <h1 className="text-2xl font-semibold">Not found</h1>
      <p className="mt-2 text-zinc-600 dark:text-zinc-400">That page or request doesn&apos;t exist.</p>
      <Link href="/" className="mt-4 inline-block text-blue-700 underline dark:text-blue-400">
        Back to all requests
      </Link>
    </main>
  );
}

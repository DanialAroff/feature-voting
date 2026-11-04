"use client";

import Form from "next/form";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { REQUEST_STATUSES, SORT_OPTIONS, STATUS_LABELS } from "@/lib/requests";

const control =
  "rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 outline-none focus-visible:ring-2 focus-visible:ring-blue-600 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100";

// A GET form: filters live in the URL, so they are shareable, bookmarkable and
// survive refresh. next/form navigates client-side, and the form still works
// without JavaScript. Changing a filter drops ?page, so results restart at page 1.
export function RequestFilters() {
  const params = useSearchParams();
  const q = params.get("q") ?? "";
  const status = params.get("status") ?? "";
  const sort = params.get("sort") ?? "top";
  const filtered = !!(q || status);

  const submitOnChange = (e: React.ChangeEvent<HTMLSelectElement>) => e.currentTarget.form?.requestSubmit();

  return (
    // key: reset uncontrolled inputs when the URL changes (back/forward).
    <Form key={params.toString()} action="/" role="search" className="flex flex-wrap items-end gap-3">
      <div className="flex min-w-48 flex-1 flex-col gap-1">
        <label htmlFor="filter-q" className="text-sm font-medium">
          Search
        </label>
        <input id="filter-q" name="q" type="search" defaultValue={q} placeholder="Search titles and descriptions" maxLength={100} className={control} />
      </div>
      <div className="flex flex-col gap-1">
        <label htmlFor="filter-status" className="text-sm font-medium">
          Status
        </label>
        <select id="filter-status" name="status" defaultValue={status} onChange={submitOnChange} className={control}>
          <option value="">All statuses</option>
          {REQUEST_STATUSES.map((s) => (
            <option key={s} value={s}>
              {STATUS_LABELS[s]}
            </option>
          ))}
        </select>
      </div>
      <div className="flex flex-col gap-1">
        <label htmlFor="filter-sort" className="text-sm font-medium">
          Sort by
        </label>
        <select id="filter-sort" name="sort" defaultValue={sort} onChange={submitOnChange} className={control}>
          {Object.entries(SORT_OPTIONS).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
      </div>
      <button type="submit" className={`${control} font-medium hover:bg-zinc-100 dark:hover:bg-zinc-800`}>
        Search
      </button>
      {filtered && (
        <Link href={sort === "top" ? "/" : `/?sort=${sort}`} className="py-2 text-sm text-blue-700 underline dark:text-blue-400">
          Clear filters
        </Link>
      )}
    </Form>
  );
}

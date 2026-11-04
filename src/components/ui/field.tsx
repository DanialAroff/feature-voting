import type { InputHTMLAttributes, ReactNode, TextareaHTMLAttributes } from "react";

const controlClass =
  "rounded-md border border-zinc-300 bg-white px-3 py-2 text-zinc-900 outline-none focus-visible:ring-2 focus-visible:ring-blue-600 aria-invalid:border-red-600 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100";

type Common = { label: string; name: string; errors?: string[] };

// Label + control + accessible error message (aria-invalid + aria-describedby).
function FieldShell({ label, name, errors, children }: Common & { children: (a11y: object) => ReactNode }) {
  const id = `field-${name}`;
  const errorId = `${id}-error`;
  const hasError = !!errors?.length;
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className="text-sm font-medium">
        {label}
      </label>
      {children({
        id,
        name,
        "aria-invalid": hasError || undefined,
        "aria-describedby": hasError ? errorId : undefined,
        className: controlClass,
      })}
      {hasError && (
        <p id={errorId} className="text-sm text-red-700 dark:text-red-400">
          {errors[0]}
        </p>
      )}
    </div>
  );
}

export function Field({ label, name, errors, ...input }: Common & InputHTMLAttributes<HTMLInputElement>) {
  return (
    <FieldShell label={label} name={name} errors={errors}>
      {(a11y) => <input {...a11y} {...input} />}
    </FieldShell>
  );
}

export function TextAreaField({ label, name, errors, ...textarea }: Common & TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <FieldShell label={label} name={name} errors={errors}>
      {(a11y) => <textarea {...a11y} {...textarea} />}
    </FieldShell>
  );
}

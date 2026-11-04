import type { ReactNode } from "react";

export default function AuthLayout({ children }: { children: ReactNode }) {
  return <main className="mx-auto w-full max-w-sm flex-1 px-4 py-12">{children}</main>;
}

import type { Metadata } from "next";
import { Suspense } from "react";
import { AuthForm } from "@/components/auth/auth-form";

export const metadata: Metadata = { title: "Log in · Feature Requests" };

export default function LoginPage() {
  return (
    <>
      <h1 className="mb-6 text-2xl font-semibold">Log in</h1>
      {/* AuthForm reads ?next=, which is request data, so it needs a boundary. */}
      <Suspense>
        <AuthForm mode="login" />
      </Suspense>
    </>
  );
}

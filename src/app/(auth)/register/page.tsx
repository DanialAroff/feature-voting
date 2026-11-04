import type { Metadata } from "next";
import { Suspense } from "react";
import { AuthForm } from "@/components/auth/auth-form";

export const metadata: Metadata = { title: "Sign up · Feature Requests" };

export default function RegisterPage() {
  return (
    <>
      <h1 className="mb-6 text-2xl font-semibold">Create an account</h1>
      <Suspense>
        <AuthForm mode="register" />
      </Suspense>
    </>
  );
}

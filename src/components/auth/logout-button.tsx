"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/api-client";

export function LogoutButton() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const mutation = useMutation({
    mutationFn: () => api("/api/auth/logout", "POST"),
    onSettled: () => {
      queryClient.clear(); // drop anything cached for the previous user
      router.push("/");
      router.refresh();
    },
  });
  return (
    <Button variant="secondary" pending={mutation.isPending} onClick={() => mutation.mutate()}>
      Log out
    </Button>
  );
}

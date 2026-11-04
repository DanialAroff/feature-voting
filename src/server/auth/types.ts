import type { UserRole } from "@/server/db/schema";

// The only user shape that leaves the server (no password hash, no timestamps).
export type PublicUser = {
  id: number;
  email: string;
  displayName: string;
  role: UserRole;
};

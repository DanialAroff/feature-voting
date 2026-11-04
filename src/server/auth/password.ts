import { hash, verify } from "@node-rs/argon2";

// argon2id with the library's defaults (OWASP-recommended baseline).
export function hashPassword(password: string): Promise<string> {
  return hash(password);
}

export async function verifyPassword(passwordHash: string, password: string): Promise<boolean> {
  try {
    return await verify(passwordHash, password);
  } catch {
    // Malformed hash: treat as a failed login rather than a 500.
    return false;
  }
}

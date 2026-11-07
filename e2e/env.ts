// The e2e suite owns this database: global setup creates, migrates and re-seeds it on every run.
export const E2E_DATABASE_URL =
  process.env.E2E_DATABASE_URL ?? "postgres://app:app@localhost:5432/feature_voting_e2e";

// Demo accounts from scripts/seed.ts.
export const PASSWORD = "password123";
export const ADMIN = "admin@example.com";
export const ALICE = "alice@example.com";
export const BOB = "bob@example.com";

// Runs once before the e2e suite: creates the e2e database if needed, migrates it
// and loads the demo seed, so every run starts from the same known state.
import { execFileSync } from "node:child_process";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";
import { E2E_DATABASE_URL } from "./env";

export default async function setup() {
  // The seed truncates every table; never let it run against dev or integration data.
  if ([process.env.DATABASE_URL, process.env.TEST_DATABASE_URL].includes(E2E_DATABASE_URL)) {
    throw new Error("E2E_DATABASE_URL must point at its own database");
  }
  const url = new URL(E2E_DATABASE_URL);
  const dbName = url.pathname.slice(1);
  if (!/^[a-z0-9_]+$/.test(dbName)) throw new Error(`Unexpected e2e database name: ${dbName}`);

  const adminUrl = new URL(url);
  adminUrl.pathname = "/postgres";
  const admin = postgres(adminUrl.toString(), { max: 1, onnotice: () => {} });
  try {
    const [exists] = await admin`SELECT 1 FROM pg_database WHERE datname = ${dbName}`;
    if (!exists) await admin.unsafe(`CREATE DATABASE ${dbName}`);
  } finally {
    await admin.end();
  }

  const client = postgres(E2E_DATABASE_URL, { max: 1, onnotice: () => {} });
  try {
    await migrate(drizzle(client), { migrationsFolder: "./drizzle" });
  } finally {
    await client.end();
  }

  // Reuse the demo seed (it truncates first), pointed at the e2e database.
  execFileSync(process.execPath, ["node_modules/tsx/dist/cli.mjs", "scripts/seed.ts"], {
    env: { ...process.env, DATABASE_URL: E2E_DATABASE_URL },
    stdio: "inherit",
  });
}

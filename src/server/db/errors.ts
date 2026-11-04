// Drizzle wraps driver errors in DrizzleQueryError; the Postgres error is the cause.
type PgError = { code?: string; constraint_name?: string };

function pgError(err: unknown): PgError | undefined {
  if (typeof err !== "object" || err === null) return undefined;
  if ("code" in err) return err as PgError;
  if ("cause" in err) return pgError((err as { cause: unknown }).cause);
  return undefined;
}

export function isUniqueViolation(err: unknown, constraint?: string): boolean {
  const pg = pgError(err);
  return pg?.code === "23505" && (!constraint || pg.constraint_name === constraint);
}

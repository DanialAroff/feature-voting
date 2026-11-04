import { unstable_rethrow } from "next/navigation";
import type { NextRequest } from "next/server";
import { z, ZodError } from "zod";
import { AppError, forbidden } from "./errors";

type Handler<Ctx> = (req: NextRequest, ctx: Ctx) => Promise<Response>;

// Wraps every route handler: same-origin check for mutations, then one place
// that turns thrown errors into the standard error envelope.
export function route<Ctx>(fn: Handler<Ctx>): Handler<Ctx> {
  return async (req, ctx) => {
    try {
      assertSameOrigin(req);
      return await fn(req, ctx);
    } catch (err) {
      // Let Next's control-flow errors (prerender bail-out, redirect, notFound) through.
      unstable_rethrow(err);
      return errorResponse(err);
    }
  };
}

export async function parseJson<S extends z.ZodType>(req: NextRequest, schema: S): Promise<z.output<S>> {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    throw new AppError(400, "INVALID_JSON", "Request body must be valid JSON");
  }
  return schema.parse(body);
}

export function errorResponse(err: unknown): Response {
  if (err instanceof AppError) {
    return Response.json(
      { error: { code: err.code, message: err.message, fields: err.fields } },
      { status: err.status },
    );
  }
  if (err instanceof ZodError) {
    return Response.json(
      {
        error: {
          code: "VALIDATION_ERROR",
          message: "Some fields are invalid",
          fields: z.flattenError(err).fieldErrors,
        },
      },
      { status: 400 },
    );
  }
  console.error(err);
  return Response.json(
    { error: { code: "INTERNAL", message: "Something went wrong" } },
    { status: 500 },
  );
}

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

// CSRF defence in depth on top of SameSite=Lax cookies: browsers send Origin on
// cross-site and same-origin mutations, so a mismatch means another site is
// submitting on the user's behalf. Requests without Origin (curl, tests) pass.
function assertSameOrigin(req: NextRequest) {
  if (SAFE_METHODS.has(req.method)) return;
  const origin = req.headers.get("origin");
  if (!origin) return;
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host");
  let originHost: string;
  try {
    originHost = new URL(origin).host;
  } catch {
    throw forbidden("Cross-origin request blocked");
  }
  if (originHost !== host) throw forbidden("Cross-origin request blocked");
}

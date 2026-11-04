// Every API error leaves the server in one shape:
//   { "error": { "code": "FORBIDDEN", "message": "...", "fields"?: { name: ["..."] }, "details"?: {...} } }
export type ErrorCode =
  | "VALIDATION_ERROR"
  | "INVALID_JSON"
  | "UNAUTHENTICATED"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "CONFLICT"
  | "INTERNAL";

export class AppError extends Error {
  constructor(
    readonly status: number,
    readonly code: ErrorCode,
    message: string,
    readonly fields?: Record<string, string[]>,
    readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "AppError";
  }
}

export const unauthenticated = (message = "You need to log in first") =>
  new AppError(401, "UNAUTHENTICATED", message);

export const forbidden = (message = "You don't have permission to do that") =>
  new AppError(403, "FORBIDDEN", message);

export const notFound = (message = "Not found") => new AppError(404, "NOT_FOUND", message);

export const conflict = (message: string, fields?: Record<string, string[]>) =>
  new AppError(409, "CONFLICT", message, fields);

/** The request is a merged tombstone; `mergedIntoId` lets clients follow it. */
export const mergedConflict = (mergedIntoId: number) =>
  new AppError(409, "CONFLICT", `This request was merged into #${mergedIntoId}`, undefined, { mergedIntoId });

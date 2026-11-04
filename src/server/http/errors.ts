// Every API error leaves the server in one shape:
//   { "error": { "code": "FORBIDDEN", "message": "...", "fields"?: { name: ["..."] } } }
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

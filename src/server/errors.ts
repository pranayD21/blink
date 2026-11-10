/**
 * Service errors carry the HTTP status the route layer should return (§14):
 * 400 validation, 401 no session, 403 role, 404, 409 version conflict or
 * release check failed, 422 workflow guard failed.
 */
export class AppError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = "AppError";
  }
}

export const badRequest = (message: string, details?: unknown) => new AppError(400, "VALIDATION", message, details);
export const unauthorized = (message = "choose a demo user first") => new AppError(401, "NO_SESSION", message);
export const forbidden = (message: string) => new AppError(403, "FORBIDDEN", message);
export const notFound = (what: string) => new AppError(404, "NOT_FOUND", `${what} not found`);
export const conflict = (message: string, code = "VERSION_CONFLICT", details?: unknown) => new AppError(409, code, message, details);
export const unprocessable = (message: string, code = "WORKFLOW_GUARD", details?: unknown) => new AppError(422, code, message, details);

export function versionConflict(what: string, expected: number, actual: number): AppError {
  return conflict(`${what} changed since you loaded it (you have version ${expected}, it is now ${actual}). Reload and try again.`);
}

/** A user-facing validation error: its message is shown as-is. */
export class DbAdminError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DbAdminError";
  }
}

export const UNAUTHORIZED = "Unauthorized";

/** turn any thrown value into a message that is safe and useful to show */
export function errorMessage(e: unknown, fallback: string): string {
  if (e instanceof DbAdminError) return e.message;
  const err = e as { name?: string; message?: string; code?: number | string; codeName?: string };
  const msg = (err?.message || String(e || "")).trim();
  switch (err?.name) {
    case "MongoServerSelectionError":
    case "MongoNetworkError":
    case "MongoNetworkTimeoutError":
      return `Cannot reach the server: ${msg}`;
    case "MongoParseError":
    case "MongoAPIError":
    case "MongoInvalidArgumentError":
      return msg || fallback;
    case "BSONError":
    case "SyntaxError":
      return `Invalid JSON: ${msg}`;
  }
  if (err?.codeName === "Unauthorized" || err?.code === 13)
    // drop the echoed command document (session ids, cluster time signatures)
    return `Not authorized: ${msg.replace(/(execute command) \{\s*([^:\s]+):[\s\S]*$/, "$1 $2")}`;
  if (err?.code === 18 || err?.codeName === "AuthenticationFailed")
    return "Authentication failed (check username, password and authSource)";
  if (typeof err?.code === "string" && err.code.startsWith("P"))
    return `${fallback}: app database error (${err.code})`;
  return msg ? `${fallback}: ${msg}` : fallback;
}

/** MongoDB "not authorized" error */
export function isUnauthorizedError(e: unknown) {
  const err = e as { code?: number; codeName?: string };
  return err?.code === 13 || err?.codeName === "Unauthorized";
}

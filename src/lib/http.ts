/**
 * HTTP helpers shared by every function: structured errors, JSON responses,
 * body-size limits and client identification.
 */

/** Hard cap on any request body we will read. Every write path is far smaller. */
export const MAX_BODY_BYTES = 4096;

export type ErrorCode =
  | "bad_request"
  | "invalid_json"
  | "body_too_large"
  | "method_not_allowed"
  | "not_found"
  | "challenge_not_found"
  | "challenge_expired"
  | "challenge_used"
  | "player_mismatch"
  | "insufficient_work"
  | "rate_limited"
  | "misconfigured"
  | "conflict"
  | "internal";

const STATUS_BY_CODE: Record<ErrorCode, number> = {
  bad_request: 400,
  invalid_json: 400,
  body_too_large: 413,
  method_not_allowed: 405,
  not_found: 404,
  challenge_not_found: 404,
  challenge_expired: 410,
  challenge_used: 409,
  player_mismatch: 403,
  insufficient_work: 400,
  rate_limited: 429,
  misconfigured: 500,
  conflict: 409,
  internal: 500,
};

export class ApiError extends Error {
  readonly code: ErrorCode;
  readonly details: Record<string, unknown> | undefined;

  constructor(code: ErrorCode, message: string, details?: Record<string, unknown>) {
    super(message);
    this.name = "ApiError";
    this.code = code;
    this.details = details;
  }

  get status(): number {
    return STATUS_BY_CODE[this.code];
  }
}

const BASE_HEADERS: Record<string, string> = {
  "content-type": "application/json; charset=utf-8",
  "cache-control": "no-store",
  "access-control-allow-origin": "*",
  "access-control-allow-headers": "content-type",
  "access-control-allow-methods": "GET,POST,OPTIONS",
};

export function json(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...BASE_HEADERS, ...headers } });
}

export function errorResponse(err: unknown): Response {
  if (err instanceof ApiError) {
    return json({ error: { code: err.code, message: err.message, ...(err.details ?? {}) } }, err.status);
  }
  // Never leak internals (connection strings, key fragments) to callers.
  console.error("unhandled error", err);
  return json({ error: { code: "internal", message: "Internal error" } }, 500);
}

export function preflight(): Response {
  return new Response(null, { status: 204, headers: BASE_HEADERS });
}

export function requireMethod(req: Request, method: "GET" | "POST"): void {
  if (req.method !== method) {
    throw new ApiError("method_not_allowed", `Use ${method} on this endpoint`, { got: req.method });
  }
}

/** Reads a JSON body, refusing anything over MAX_BODY_BYTES. */
export async function readJsonBody(req: Request): Promise<Record<string, unknown>> {
  const declared = req.headers.get("content-length");
  if (declared && Number(declared) > MAX_BODY_BYTES) {
    throw new ApiError("body_too_large", `Request body exceeds ${MAX_BODY_BYTES} bytes`);
  }
  const text = await req.text();
  if (Buffer.byteLength(text, "utf8") > MAX_BODY_BYTES) {
    throw new ApiError("body_too_large", `Request body exceeds ${MAX_BODY_BYTES} bytes`);
  }
  if (text.trim() === "") return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new ApiError("invalid_json", "Request body is not valid JSON");
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new ApiError("bad_request", "Request body must be a JSON object");
  }
  return parsed as Record<string, unknown>;
}

/**
 * Best-effort client IP. Netlify sets `x-nf-client-connection-ip`; we fall back
 * to the left-most `x-forwarded-for` hop. Only ever used as a rate-limit bucket,
 * never as an authorization decision.
 *
 * The value is attacker-controlled and ends up inside a PostgREST filter, so it
 * is reduced to the characters an address can actually contain before it leaves
 * this function.
 */
export function clientIp(req: Request): string {
  const direct = req.headers.get("x-nf-client-connection-ip");
  if (direct) return sanitizeIp(direct);
  const forwarded = req.headers.get("x-forwarded-for");
  if (forwarded) {
    const first = forwarded.split(",")[0];
    if (first) return sanitizeIp(first);
  }
  return "unknown";
}

function sanitizeIp(raw: string): string {
  const cleaned = raw.trim().replace(/[^0-9a-fA-F.:%\[\]]/g, "").slice(0, 45);
  return cleaned === "" ? "unknown" : cleaned;
}

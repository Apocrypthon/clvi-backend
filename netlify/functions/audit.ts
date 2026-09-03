import type { Config } from "@netlify/functions";

import { buildReport } from "../../src/lib/audit.ts";
import { ApiError, errorResponse, json, preflight, requireMethod } from "../../src/lib/http.ts";

/**
 * GET /audit/latest            — the most recent slice of the chain.
 * GET /audit/:fromTs.:toTs     — an explicit inclusive range.
 *
 * `chainOk` is never cached: each request re-walks prev_hash and re-computes
 * every immutable_check from the stored rows.
 */
export default async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") return preflight();
  try {
    requireMethod(req, "GET");
    // Everything after the last `audit` segment. Written this way so the
    // declared routes and Netlify's legacy /.netlify/functions/audit both work.
    const segments = new URL(req.url).pathname.split("/").filter(Boolean);
    const auditIndex = segments.lastIndexOf("audit");
    const tail = auditIndex === -1 ? "" : segments.slice(auditIndex + 1).join("/");

    const report =
      tail === "" || tail === "latest"
        ? await buildReport({ mode: "latest" })
        : await buildReport({ mode: "range", ...parseRange(decodeURIComponent(tail)) });

    const { brokenAt, ...body } = report;
    return json(brokenAt === null ? body : { ...body, brokenAt });
  } catch (err) {
    return errorResponse(err);
  }
};

/**
 * Splits `:fromTs.:toTs`. Both halves are ISO-8601, which itself contains dots
 * (fractional seconds), so the separator is the dot between a `Z`/offset and the
 * next timestamp rather than the first dot in the string.
 */
export function parseRange(tail: string): { fromTs: string; toTs: string } {
  const match = /^(.*?(?:Z|[+-]\d{2}:?\d{2}))\.(.+)$/.exec(tail);
  if (!match || !match[1] || !match[2]) {
    throw new ApiError(
      "bad_request",
      "Range must be /audit/<fromTs>.<toTs> with two ISO-8601 timestamps, e.g. /audit/2026-09-01T00:00:00Z.2026-09-02T00:00:00Z",
      { got: tail.slice(0, 120) },
    );
  }
  const fromTs = toIso(match[1], "fromTs");
  const toTs = toIso(match[2], "toTs");
  if (new Date(fromTs) > new Date(toTs)) {
    throw new ApiError("bad_request", "fromTs must not be after toTs", { fromTs, toTs });
  }
  return { fromTs, toTs };
}

function toIso(value: string, field: string): string {
  if (value.length > 40) throw new ApiError("bad_request", `Field "${field}" is too long`, { field });
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new ApiError("bad_request", `Field "${field}" is not an ISO-8601 timestamp`, { field, got: value });
  }
  return date.toISOString();
}

export const config: Config = { path: ["/audit", "/audit/latest", "/audit/:range"] };

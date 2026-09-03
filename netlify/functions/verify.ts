import type { Config } from "@netlify/functions";

import { verifyReport } from "../../src/lib/audit.ts";
import { errorResponse, json, preflight, readJsonBody, requireMethod } from "../../src/lib/http.ts";

/**
 * POST /verify — re-check the signature on a pasted audit report.
 *
 * Accepts either the report object itself or `{ report: {...} }`. A malformed
 * report and a tampered one both answer `valid: false`: the caller asked whether
 * this is a report the ledger produced, and for both the answer is no. The
 * request itself was well-formed either way, so the status stays 200.
 */
export default async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") return preflight();
  try {
    requireMethod(req, "POST");
    const body = await readJsonBody(req);
    const candidate =
      typeof body["report"] === "object" && body["report"] !== null ? body["report"] : body;
    const valid = verifyReport(candidate);
    return json({ valid, checkedAt: new Date().toISOString() });
  } catch (err) {
    return errorResponse(err);
  }
};

export const config: Config = { path: "/verify" };

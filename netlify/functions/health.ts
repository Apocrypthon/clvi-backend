import type { Config } from "@netlify/functions";

import { buildVersion } from "../../src/lib/env.ts";
import { json, preflight } from "../../src/lib/http.ts";

/** Liveness only: no database access, no secrets echoed. */
export default async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") return preflight();
  return json({ ok: true, ts: new Date().toISOString(), version: buildVersion() });
};

export const config: Config = { path: "/health" };

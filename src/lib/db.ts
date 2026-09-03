/**
 * Minimal Supabase (PostgREST) client built on global fetch.
 *
 * Deliberately dependency-free: the ledger's integrity properties are easier to
 * audit when the only third-party code in the request path is Node itself.
 * Requests are made with the service-role key, so RLS is bypassed — which is why
 * every table is REVOKEd from anon/authenticated in db/schema.sql and the key
 * lives only in Netlify's environment.
 */

import { supabaseServiceRoleKey, supabaseUrl } from "./env.ts";
import { ApiError } from "./http.ts";

export class PostgrestError extends Error {
  readonly status: number;
  readonly code: string | null;

  constructor(status: number, code: string | null, message: string) {
    super(message);
    this.name = "PostgrestError";
    this.status = status;
    this.code = code;
  }

  /** Postgres unique_violation — used to detect a lost race for the chain head. */
  get isUniqueViolation(): boolean {
    return this.code === "23505";
  }
}

const DEFAULT_TIMEOUT_MS = 8000;

async function request(path: string, init: RequestInit & { timeoutMs?: number } = {}): Promise<unknown> {
  const { timeoutMs = DEFAULT_TIMEOUT_MS, ...rest } = init;
  const headers = new Headers(rest.headers);
  const key = supabaseServiceRoleKey();
  headers.set("apikey", key);
  headers.set("authorization", `Bearer ${key}`);
  headers.set("accept", "application/json");
  if (rest.body !== undefined) headers.set("content-type", "application/json");

  let res: Response;
  try {
    res = await fetch(`${supabaseUrl()}/rest/v1${path}`, {
      ...rest,
      headers,
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (cause) {
    throw new ApiError("internal", "Database request failed", { cause: String(cause) });
  }

  const text = await res.text();
  if (!res.ok) {
    let code: string | null = null;
    let message = text.slice(0, 500);
    try {
      const parsed = JSON.parse(text) as { code?: string; message?: string };
      code = parsed.code ?? null;
      message = parsed.message ?? message;
    } catch {
      /* keep the raw text */
    }
    throw new PostgrestError(res.status, code, message);
  }
  if (text === "") return null;
  return JSON.parse(text);
}

export type Filters = Record<string, string>;

function query(filters: Filters, extra: Record<string, string | undefined> = {}): string {
  const params = new URLSearchParams(filters);
  for (const [key, value] of Object.entries(extra)) {
    if (value !== undefined) params.set(key, value);
  }
  const qs = params.toString();
  return qs ? `?${qs}` : "";
}

export async function select<T>(
  table: string,
  filters: Filters,
  options: { select?: string; order?: string; limit?: number } = {},
): Promise<T[]> {
  const rows = await request(
    `/${table}${query(filters, {
      select: options.select ?? "*",
      order: options.order,
      limit: options.limit === undefined ? undefined : String(options.limit),
    })}`,
  );
  return (rows ?? []) as T[];
}

export async function insert<T>(table: string, row: Record<string, unknown>): Promise<T> {
  const rows = (await request(`/${table}`, {
    method: "POST",
    body: JSON.stringify(row),
    headers: { prefer: "return=representation" },
  })) as T[] | null;
  const inserted = rows?.[0];
  if (!inserted) throw new ApiError("internal", `Insert into ${table} returned no row`);
  return inserted;
}

/** Conditional update used to claim a single-use row atomically. */
export async function updateReturning<T>(
  table: string,
  filters: Filters,
  patch: Record<string, unknown>,
): Promise<T[]> {
  const rows = (await request(`/${table}${query(filters)}`, {
    method: "PATCH",
    body: JSON.stringify(patch),
    headers: { prefer: "return=representation" },
  })) as T[] | null;
  return rows ?? [];
}

export async function deleteWhere(table: string, filters: Filters): Promise<void> {
  await request(`/${table}${query(filters)}`, { method: "DELETE" });
}

/**
 * Exact row count via PostgREST's Content-Range header, without fetching rows.
 * `selectExpr` may name an embedded resource (e.g. `token_id,ledger!inner(seq)`)
 * so a count can be constrained by a joined table.
 */
export async function count(table: string, filters: Filters, selectExpr = "count"): Promise<number> {
  const headers = new Headers({ prefer: "count=exact", range: "0-0" });
  const key = supabaseServiceRoleKey();
  headers.set("apikey", key);
  headers.set("authorization", `Bearer ${key}`);
  let res: Response;
  try {
    res = await fetch(`${supabaseUrl()}/rest/v1/${table}${query(filters, { select: selectExpr })}`, {
      headers,
      signal: AbortSignal.timeout(DEFAULT_TIMEOUT_MS),
    });
  } catch (cause) {
    throw new ApiError("internal", "Database request failed", { cause: String(cause) });
  }
  if (!res.ok) throw new PostgrestError(res.status, null, (await res.text()).slice(0, 500));
  const range = res.headers.get("content-range") ?? "";
  const total = range.split("/")[1];
  return total && total !== "*" ? Number(total) : 0;
}

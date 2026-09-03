/**
 * Environment access.
 *
 * SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY and LEDGER_SECRET exist ONLY as
 * Netlify environment variables. Nothing in this repository may contain their
 * values — see SEED.md "Stack rules".
 */

export class MissingEnvError extends Error {
  readonly variable: string;

  constructor(variable: string) {
    super(`Missing required environment variable: ${variable}`);
    this.name = "MissingEnvError";
    this.variable = variable;
  }
}

function required(name: string): string {
  const value = process.env[name];
  if (!value || value.trim() === "") throw new MissingEnvError(name);
  return value.trim();
}

export function supabaseUrl(): string {
  return required("SUPABASE_URL").replace(/\/+$/, "");
}

export function supabaseServiceRoleKey(): string {
  return required("SUPABASE_SERVICE_ROLE_KEY");
}

export function ledgerSecret(): string {
  return required("LEDGER_SECRET");
}

/** Reported by /health so a deploy can be identified without exposing secrets. */
export function buildVersion(): string {
  return (
    process.env["COMMIT_REF"]?.slice(0, 12) ??
    process.env["npm_package_version"] ??
    "dev"
  );
}

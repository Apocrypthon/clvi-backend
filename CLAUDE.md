# CLAUDE.md — clvi-backend

This repo is the **STRATA ledger**. It verifies hash solves, appends them to an
immutable chain, mints one Guardian token per verified find, and publishes signed
self-audit reports of the kWh those solves used. The token audits its own energy.

There is no memory between sessions. **The docs are the memory.**

## Boot sequence (every session, in order)

1. `SEED.md` — the frozen brief. Stack rules and milestones live there.
2. `docs/LOOP.md` — how to run a session.
3. `docs/STATE.md` — where the work actually is, and how to verify it.
4. The last three entries of `docs/CHANGELOG.md`.

Then do exactly what `docs/LOOP.md` says.

## Hard rules

- **Secrets never enter this repo.** `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`
  and `LEDGER_SECRET` exist only as Netlify environment variables. If a value for
  any of them ever appears in a tracked file, that becomes the session's *only*
  task: remove it, and write rotation instructions at the top of `docs/STATE.md`.
- **The stack is frozen**: Netlify Functions (TypeScript) + Supabase Postgres.
  No new runtime dependencies without a recorded decision in
  `docs/ARCHITECTURE.md`.
- **No blockchain, no third-party token contracts.** Guardian tokens are an
  application-level accounting unit in Postgres. See
  `docs/ARCHITECTURE.md#future-decisions`.
- **The ledger is append-only.** Never add an UPDATE or DELETE path against
  `ledger` or `guardian_tokens`; the database refuses them anyway.
- **Every write path validates input sizes and rate-limits by playerId and IP.**
- **Contracts v1 are frozen** (see `SEED.md`); they change only via
  clvi-architecture.

## Layout

```
SEED.md                    the original brief, verbatim
netlify/functions/*.ts     one file per route (Netlify Functions 2.0)
src/lib/*.ts               all logic worth testing; functions stay thin
db/schema.sql              idempotent schema, applied by hand (docs/SCHEMA.md)
tests/*.test.ts            node --test, no framework, no network
scripts/solve.mjs          operator-side proof-of-work solver
dist/                      static status page (Netlify publish dir)
docs/                      the memory
```

## Commands

```
npm run build       # typecheck + unit tests. This is the gate.
npm run typecheck   # tsc --noEmit
npm test            # node --test tests/*.test.ts
```

Unit tests never touch the network. Live checks are curl lines recorded with
their results in `docs/STATE.md#Verify`.

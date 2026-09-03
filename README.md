# clvi-backend

The **STRATA ledger**. It verifies proof-of-work hash solves, appends them to an
immutable hash-chained ledger, mints one Guardian token per verified find, and
publishes **signed self-audit reports of the kWh those solves used**.

The token audits its own energy. That is the product.

```
POST /challenge              issue a single-use proof-of-work challenge
POST /submit                 verify a solve, append it, mint its Guardian token
GET  /audit/latest           signed self-audit of the latest slice of the chain
GET  /audit/<from>.<to>      signed self-audit of an explicit ISO-8601 range
POST /verify                 re-check the signature on a pasted report
GET  /health                 liveness
```

Netlify Functions (TypeScript) + Supabase Postgres. **Zero runtime
dependencies** — the only third-party code in the signing path is Node itself.

## Start here

| | |
| --- | --- |
| `CLAUDE.md` | boot sequence and the hard rules |
| `SEED.md` | the original brief, verbatim |
| `docs/VISION.md` | what this is for, and what it deliberately is not |
| `docs/ARCHITECTURE.md` | the shape, and every decision with its reason |
| `docs/SCHEMA.md` | the tables, and how to apply `db/schema.sql` |
| `docs/STATE.md` | **where the work actually is**, and how to verify it |
| `docs/LOOP.md` | how to run a session |
| `docs/CHANGELOG.md` | what happened, newest first |

## Build

```
npm ci
npm run build     # typecheck + unit tests; this is the gate
```

Unit tests never touch the network. Live checks are curl lines recorded with
their results in `docs/STATE.md#Verify`.

## Secrets

`SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` and `LEDGER_SECRET` exist **only** as
Netlify environment variables. Nothing in this repository may contain their
values. See `.env.example` for the shape and `docs/STATE.md#deploy` for the
consequences of rotating `LEDGER_SECRET`.

## Licence

MIT — see `LICENSE`.

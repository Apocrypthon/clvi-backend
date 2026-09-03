# ARCHITECTURE

## Shape

```
  client (STRATA shell)
        |
        |  POST /challenge          -> salt, difficultyBits, expiresAt
        |  ...hashes locally...
        |  POST /submit             -> tokenId, estKwh, mapEvent
        |  GET  /audit/latest       -> signed report
        |  POST /verify             -> { valid }
        v
  Netlify Functions (TypeScript, Functions 2.0)
        |
        |  PostgREST over HTTPS, service-role key
        v
  Supabase Postgres  (append-only ledger, RLS on, anon revoked)
```

The function files in `netlify/functions/` are thin: parse, validate, call
`src/lib/`, serialize. Everything worth testing lives in `src/lib/` so that
`npm run build` is a real gate with no network access.

## Routes

Declared per-function via `export const config = { path }` (Netlify Functions
2.0), so the URLs in `SEED.md` are the URLs the service actually serves.

| Route | Function | Milestone |
| --- | --- | --- |
| `GET /health` | `health.ts` | M0 |
| `POST /challenge` | `challenge.ts` | M2 |
| `POST /submit` | `submit.ts` | M2 |
| `GET /audit/latest` | `audit.ts` | M3 |
| `GET /audit/<fromTs>.<toTs>` | `audit.ts` | M3 |
| `POST /verify` | `verify.ts` | M3 |
| `GET /map-events?since=` | *not built* | M4 |
| `POST /account` | *not built* | M4 |

## Decisions

### D1 — Zero runtime dependencies

`src/lib/db.ts` talks to Supabase over PostgREST with global `fetch` instead of
`@supabase/supabase-js`. The only third-party code in the request path is Node
itself.

*Why:* the ledger's value is that its integrity properties can be audited. Every
dependency in the signing path is something an auditor has to read too. The
client we need is roughly 130 lines. `@netlify/functions` is a devDependency
(types only) and `typescript` is a devDependency; neither ships.

### D2 — Canonical JSON, not `JSON.stringify`

Every hash and signature is taken over a canonical string: keys sorted, no
whitespace, numbers restricted to safe integers, kWh as fixed 9-decimal strings,
timestamps normalized to millisecond UTC (`src/lib/canonical.ts`).

*Why:* the same logical row must produce the same bytes in three different
places — the append path, the audit walk, and a third party re-checking a pasted
report. `JSON.stringify` guarantees none of that: key order follows insertion,
`0.000375` and `3.75e-4` are the same number, and Postgres renders timestamps
with microseconds and a `+00:00` offset. Any of those would make a signature
depend on who computed it.

### D3 — Two independent integrity properties

```
prev_hash       = SHA-256(canonical JSON of the previous entry)     -> ordering
immutable_check = HMAC-SHA256(LEDGER_SECRET, canonical JSON of row) -> content
```

An entry's canonical bytes exclude its own `immutable_check` (a row cannot commit
to its own MAC) and exclude `seq` (a database ordering key with no player-visible
meaning).

*Why both:* the HMAC alone would let anyone holding `LEDGER_SECRET` rewrite a row
undetectably. The chain alone would let a database-level attacker splice history.
Together, repairing one breaks the other — which is precisely what
`tests/ledger.test.ts` asserts.

### D4 — Chain concurrency is settled by a UNIQUE constraint

`ledger.prev_hash` is `UNIQUE`. Two writers racing for the same chain head cannot
both commit; the loser gets `23505`, re-reads the head and retries
(`appendEntry`, four attempts with a short backoff).

*Why not a lock:* an advisory lock cannot be held across the read-head and
insert HTTP calls that PostgREST forces us into, and a serialized RPC would need
`LEDGER_SECRET` inside Postgres — which the stack rules forbid. The uniqueness
constraint gives the same guarantee with the database as the arbiter.

### D5 — Energy is computed server-side, always

`estimateKwh(ms, deviceClass)` = `watts x clamp(ms, 0, 30 s) / 3.6e9`, with
`{phone 3, tablet 5, laptop 15, desktop 45}`. A client-supplied kWh field, if
present, is ignored.

*Why:* the audit report is the product. A number the client could choose would
make the report a restatement of the client's claim rather than a measurement.
The clamp bounds how much energy a single solve can ever bill, which also bounds
what a lying client can inflate the total by.

### D6 — The challenge is burned before the proof is checked

`/submit` flips `used` false -> true *first* (a conditional `PATCH`, so the
update itself is the mutual exclusion), and only then verifies the nonce.

*Why:* otherwise a caller could grind nonces against one salt through the API,
turning a server-issued challenge into an unlimited oracle. The cost is that a
buggy client burns challenges on failed attempts; it simply asks for a new one.

### D7 — Append-only is enforced in the database, not the code

A `BEFORE UPDATE OR DELETE` trigger on `ledger` and `guardian_tokens` raises
`restrict_violation` for every role, `service_role` included.

*Why:* the deploy holds a service-role key. If append-only were a convention in
the function layer, a compromised deploy — or a careless future session — could
rewrite history. Enforcing it in the table means the ledger is append-only even
to us.

### D8 — Rate limits are stored, not in-memory

Netlify functions are per-request; there is nowhere to keep a counter. Limits are
counted over a sliding window in a `rate_events` table, keyed by `route:player:id`
and `route:ip:addr`, and pruned after 24 h.

*Why:* it is the only bucket that survives a cold start. The cost is a row per
accepted request, which is why the table is explicitly disposable — it is the one
table in this schema that is *not* part of the audit.

## Future decisions

### F1 — On-chain settlement (open)

The Guardian token is deliberately an application-level accounting unit in
Postgres, and no code here anticipates anything else. The design does not
*preclude* settling to a public chain later — a ledger entry's canonical bytes
and its signature are exactly the sort of thing one would anchor — but doing so
would introduce a runtime dependency, a key-custody problem, and an energy cost
that this project would then have to audit and account for. That last point is
not incidental: a token whose selling point is honest energy accounting cannot
quietly acquire an unaudited energy cost.

**Not to be taken in this repo.** If it is ever taken, it belongs in
clvi-architecture first.

### F2 — Rust/Postgres north star (open)

The CLVI programme documents name Rust + Postgres as the eventual server target.
This repo is TypeScript on Netlify because that is what the frozen stack rules
say, and because the whole ledger is ~700 lines of pure functions over canonical
bytes. Should the port happen, `src/lib/canonical.ts`, `src/lib/ledger.ts` and
`src/lib/audit.ts` are the specification: they are dependency-free, and the test
suite is the conformance suite. Postgres and `db/schema.sql` carry over unchanged.

### F3 — Report-level anchoring (open)

`/audit/<from>.<to>` produces a signature over a whole range. Publishing those
signatures somewhere append-only and outside the operator's control would close
the last gap in the trust story (today, an operator holding `LEDGER_SECRET` could
in principle rebuild the entire chain from scratch). Cheapest credible version:
publish each daily report's signature to a second, independently-operated store.
Worth a decision once M4-M6 are done.

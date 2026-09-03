# SCHEMA

The authoritative schema is `db/schema.sql`. It is idempotent — every statement
is `create ... if not exists`, `create or replace`, or `drop trigger if exists`
followed by `create trigger` — so it can be pasted repeatedly without harm.

## One-time application (manual, by an operator)

There is no migration runner in this repo, on purpose: the schema changes rarely
and the append-only trigger is the kind of thing that should be applied by a
human who read it.

1. Open the Supabase project → **SQL Editor** → **New query**.
2. Paste the entire contents of `db/schema.sql`.
3. **Run**. Expect `Success. No rows returned`.
4. Re-run it once more. It must succeed again with no errors — that is the
   idempotence check.
5. Confirm the append-only trigger actually bites:

   ```sql
   -- Expect: ERROR: ledger is append-only: DELETE on entry_id ...
   delete from public.ledger where true;
   ```

   If that statement succeeds (even affecting zero rows without raising on a
   populated table), the trigger did not install — stop and fix it before any
   traffic reaches `/submit`.

6. Record the date you applied it in `docs/STATE.md`.

Re-run steps 1-4 after any change to `db/schema.sql`, and note the change in
`docs/CHANGELOG.md`.

## Tables

### `accounts`

| column | type | notes |
| --- | --- | --- |
| `player_id` | `text` PK | opaque handle from the shell |
| `display_id` | `text` UNIQUE | human-facing short id |
| `name` | `text` | |
| `palette` | `jsonb` | character-creation colours |
| `created_at` | `timestamptz` | |

Written by `POST /account` at **M4**; nothing writes it yet.

### `challenges`

| column | type | notes |
| --- | --- | --- |
| `challenge_id` | `uuid` PK | |
| `salt` | `text` | 16 random bytes, hex; `^[0-9a-f]{32}$` enforced |
| `difficulty_bits` | `smallint` | required leading zero bits, 8-32 enforced |
| `player_id` | `text` | the only player who can spend it |
| `expires_at` | `timestamptz` | issue + 90 s |
| `used` | `boolean` | single-use latch |
| `created_at` | `timestamptz` | orders the per-player difficulty series |

Single use is enforced by the *claim* pattern, not by reading `used` and then
writing it: `/submit` issues `PATCH /challenges?challenge_id=eq.X&used=is.false`
with `used: true`, and treats "zero rows returned" as already-spent. The update
is the mutual exclusion.

### `ledger` — append-only

| column | type | notes |
| --- | --- | --- |
| `entry_id` | `uuid` PK | |
| `seq` | `bigserial` UNIQUE | chain order; **not** hashed |
| `prev_hash` | `char(64)` UNIQUE | SHA-256 of the previous entry's canonical JSON |
| `ts` | `timestamptz` | written by the function, millisecond precision |
| `player_id` | `text` | |
| `cell_id` | `text` | |
| `artifact_id` | `text` | |
| `hashes` | `bigint` | claimed hash count; recorded, never trusted |
| `ms` | `integer` | solve time, `0 <= ms <= 30000` enforced |
| `est_kwh` | `numeric(18,9)` | computed server-side |
| `immutable_check` | `char(64)` | HMAC-SHA256(LEDGER_SECRET, canonical row JSON) |

`prev_hash` of the first entry is 64 zeros (`GENESIS_PREV_HASH`).

`prev_hash` is UNIQUE because that is what makes the chain single-threaded: two
concurrent appends cannot both claim the same head, so the loser retries against
the new one (`ARCHITECTURE.md#d4`).

**Append-only** is enforced by `ledger_no_update_or_delete`, a
`BEFORE UPDATE OR DELETE` trigger that raises `restrict_violation` for every
role — including the `service_role` key the deploy itself holds.

### `guardian_tokens` — append-only

| column | type | notes |
| --- | --- | --- |
| `token_id` | `uuid` PK | |
| `entry_id` | `uuid` UNIQUE FK -> `ledger` | **the mint rule** |
| `est_kwh` | `numeric(18,9)` | copy of the entry's figure, for direct summing |
| `minted_at` | `timestamptz` | |

One token per verified find: the UNIQUE constraint on `entry_id` means a ledger
entry can never mint twice, whatever a retry does.

### `rate_events` — disposable

| column | type | notes |
| --- | --- | --- |
| `event_id` | `bigserial` PK | |
| `bucket` | `text` | `route:player:<id>` or `route:ip:<addr>` |
| `ts` | `timestamptz` | |

The only table here that is *not* part of the audit. Rows are counted over a
sliding window and pruned after 24 h (`pruneRateEvents`, fired on ~2% of
`/challenge` calls).

## Canonical row JSON

The bytes that `prev_hash` and `immutable_check` are taken over. Keys sorted, no
whitespace, `seq` and `immutable_check` excluded:

```json
{"artifactId":"can-tab","cellId":"cell-7","entryId":"<uuid>","estKwh":"0.000050000","hashes":1000,"ms":4000,"playerId":"player-one","prevHash":"<64 hex>","ts":"2026-09-03T00:00:00.000Z"}
```

Two normalizations matter, and both exist because Postgres and JavaScript
disagree about how to render a value:

- **`estKwh` is a string with exactly 9 decimals**, matching `numeric(18,9)`.
  As a JSON number, `0.000375` and `3.75e-4` are the same value with different
  bytes, and float formatting would decide which one you got.
- **`ts` is normalized to millisecond UTC** (`2026-09-03T00:00:00.000Z`).
  PostgREST returns `2026-09-03T00:00:00.123456+00:00`; hashing that rendering
  would make the signature depend on the database's formatting.

Report totals are summed as integer nano-kWh (`nanoKwhToString`) so a long range
never drifts the way repeated float addition would.

## Things the schema deliberately does not do

- **No `LEDGER_SECRET` in the database.** All HMACs are computed in the function
  layer. A database-only attacker can read the ledger but cannot forge a row that
  survives an audit.
- **No RLS policies.** RLS is *enabled* on every table with *no* policies, and
  `anon`/`authenticated` are `REVOKE`d. Only the service-role key reaches these
  tables, so a key leaking into a browser bundle grants nothing.
- **No cascade deletes.** `guardian_tokens.entry_id` is
  `on delete restrict`, and the ledger refuses deletes anyway.

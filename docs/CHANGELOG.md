# CHANGELOG

Newest first. One entry per session: date · what · why · files · verify result.

## 2026-09-03 — bootstrap M0, and M1-M3 written

**What.** Brought the repo up from empty to a complete, unit-tested implementation
of the ledger's core: the schema (M1), challenge + submit (M2), and the signed
self-audit (M3), on top of the M0 scaffold.

- **M0** — `package.json` (zero runtime dependencies), `tsconfig.json`,
  `netlify.toml`, `GET /health`, a static status page in `dist/`, and the docs
  set. `SEED.md` saved verbatim.
- **M1** — `db/schema.sql`: `accounts`, `challenges`, `ledger`,
  `guardian_tokens`, `rate_events`. `ledger` and `guardian_tokens` are
  append-only via a `BEFORE UPDATE OR DELETE` trigger that raises for every role;
  RLS on and `anon`/`authenticated` revoked everywhere.
- **M2** — `POST /challenge` issues a single-use 16-byte salt with a per-player
  difficulty that moves at most one bit per issue toward a 3-6 s median solve,
  expiring in 90 s. `POST /submit` claims the challenge atomically, verifies
  `sha256(salt:nonce:playerId)` against the required leading zero bits,
  recomputes `est_kwh` server-side, appends the chained row and mints exactly one
  Guardian token.
- **M3** — `GET /audit/latest` and `GET /audit/<from>.<to>` re-walk `prev_hash`
  and re-derive every `immutable_check` from the stored rows on each request,
  then sign the whole report. `POST /verify` re-checks a pasted report.

**Why.** The repo was empty, and `SEED.md`'s definition of done for this run is
M1-M3 live. Three decisions in that work are worth carrying forward:

- *Canonical JSON everywhere* (`ARCHITECTURE.md#d2`). Signatures must not depend
  on who computed them; `JSON.stringify`, float formatting and Postgres timestamp
  rendering all break that.
- *Two independent integrity properties* (`#d3`). The HMAC alone would let a
  secret-holder rewrite a row; the chain alone would let a database-level
  attacker splice history. Together, repairing one breaks the other.
- *Burn the challenge before checking the proof* (`#d6`). Otherwise `/submit` is
  an unlimited hashing oracle against a server-issued salt.

The per-player and per-IP rate limits arrived early with M2 rather than waiting
for M5, because "every write path validates input sizes and rate limits by
playerId + IP" is a frozen stack rule, not a milestone.

**Files.** `SEED.md`, `CLAUDE.md`, `README.md`, `package.json`, `tsconfig.json`,
`netlify.toml`, `.gitignore`, `.env.example`, `db/schema.sql`,
`src/lib/{canonical,env,http,validate,db,energy,pow,difficulty,rate,ledger,audit}.ts`,
`netlify/functions/{health,challenge,submit,audit,verify}.ts`,
`tests/{canonical,energy,pow,ledger,audit,difficulty,validate}.test.ts`,
`scripts/solve.mjs`, `dist/index.html`,
`docs/{VISION,ARCHITECTURE,SCHEMA,STATE,LOOP,CHANGELOG}.md`.

**Verify.** Offline gate **PASS**: `npm run build` → `tsc` clean, `node --test`
`# pass 60 / # fail 0`. The tamper cases in `tests/ledger.test.ts` confirm the
chain notices an edited row, a re-signed edited row, a dropped entry, and a
mid-chain range checked against the wrong seed hash.

Live walk **NOT RUN** — this session had no Netlify site, no Supabase project and
no credentials, so `db/schema.sql` has never been applied and none of the curl
steps in `docs/STATE.md#Verify` have been executed. That is written at the top of
`STATE.md` as the standing blocker, and applying the schema plus running the walk
is item 1 of `Next`.

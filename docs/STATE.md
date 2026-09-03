# STATE

**Last session:** 2026-09-03 · bootstrap M0 + M1 + M2 + M3.

## Blocker — read this first

**Nothing here has been run against a live deploy.** This session had no Netlify
site, no Supabase project and no credentials, so:

- `db/schema.sql` has **never been applied**. No table exists yet.
- Every curl line in [#Verify](#verify) is written but **unrun**. Their recorded
  result is `NOT RUN`, not `pass`.
- The offline gate (`npm run build`: typecheck + 60 unit tests) **does** pass, and
  it covers all the logic that is worth covering without a database: canonical
  bytes, chain construction, tamper detection, report signing, energy maths,
  difficulty tuning and input validation.

**The next session's first job is the first item in `Next`.** Until then, treat
M1-M3 as *written and unit-tested*, not as *live*.

Two specific things a first live run should be ready to find, because they are
the only places that assume PostgREST behaviour no unit test can check:

1. `src/lib/audit.ts` `countTokens()` counts Guardian tokens through the
   `guardian_tokens -> ledger` foreign key with an embedded filter
   (`?select=token_id,ledger!inner(seq)&ledger.and=(seq.gte.N,seq.lte.M)`). If
   PostgREST names that relationship differently, the call throws and the code
   falls back to a `minted_at` window count, which can differ by a row at a range
   edge. The fallback logs; check the function log after the first audit.
2. `src/lib/db.ts` `count()` reads the exact count out of the `Content-Range`
   header (`Prefer: count=exact`). If a proxy strips that header the count comes
   back `0` rather than erroring.

## Where the work is

| Milestone | Status |
| --- | --- |
| M0 — scaffold, `/health`, status page, docs | **done** (unrun live) |
| M1 — schema | **written**, `db/schema.sql`; not yet applied to a database |
| M2 — `POST /challenge`, `POST /submit` | **written**, unit-tested; not yet run live |
| M3 — `GET /audit/latest`, `GET /audit/<from>.<to>`, `POST /verify` | **written**, unit-tested; not yet run live |
| M4 — `GET /map-events`, `POST /account` | not started |
| M5 — abuse hardening + `docs/THREATS.md` | partial (see below) |
| M6 — live totals on the status page | not started |

M5 is partial *by necessity*, not by scope creep: the frozen stack rule "every
write path validates input sizes and rate limits by playerId + IP" is not
optional, so `/challenge` and `/submit` already carry size caps, strict field
validation, structured 4xx codes, per-player and per-IP sliding-window limits
(`/challenge` 30·player/min and 90·ip/min; `/submit` 60·player/day — mirroring
the client — and 120·ip/hour) and the `[12, 24]` difficulty clamp. What M5 still
owes is `docs/THREATS.md` and a review of the limits against real traffic.

## Next

In order. Take the first one, finish it completely, stop.

1. **Apply the schema and run the live walk.** Follow `docs/SCHEMA.md`
   ("One-time application"), then run every command in [#Verify](#verify) and
   **paste the real output into this file**, replacing each `NOT RUN`. Record the
   date the schema was applied. If something breaks, that is the increment — fix
   it and record it.
2. **M4 — `GET /map-events?since=`** returning `MapEvent[]` capped at 500,
   ordered by `ts`, sourced from `ledger` (`{cellId, ts, kind:"restored"}`).
   Validate and clamp `since`; reject a missing or unparseable one with
   `bad_request`.
3. **M4 — `POST /account`** writing `accounts` from the shell's character
   creation. Same validation and rate-limit treatment as the other write paths;
   `display_id` collisions must return a structured 409, not a 500.
4. **M5 — `docs/THREATS.md`**: replay, pre-compute, and clock-skew defenses,
   each naming the code that implements it. Re-examine the rate limits above once
   there is real traffic to look at.
5. **M6 — live totals on `dist/index.html`**: entries, tokens, total est kWh and
   a `chainOk` badge, fetched client-side from `/audit/latest`. The page already
   fetches `/health`; extend it, do not rewrite it.

## Deploy

- **Netlify site:** not yet created. `netlify.toml` is ready: build
  `npm run build`, publish `dist`, functions `netlify/functions`, Node 22.
- **Environment variables** (Netlify UI → Site configuration → Environment
  variables). These are the *only* place these values may exist:
  - `SUPABASE_URL` — the project URL, e.g. `https://<ref>.supabase.co`
  - `SUPABASE_SERVICE_ROLE_KEY` — service role, **not** the anon key
  - `LEDGER_SECRET` — 32+ random bytes; generate with
    `node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"`
- **Rotating `LEDGER_SECRET` invalidates every existing `immutable_check` and
  every published report signature.** The `prev_hash` chain survives (it uses no
  secret), so ordering stays provable, but `chainOk` will read `false` for every
  row written under the old secret. There is no re-signing path, and there should
  not be one: it would be indistinguishable from rewriting history. Treat the
  secret as permanent for the life of a ledger.
- **Supabase project:** not yet created. After creating it, apply
  `db/schema.sql` per `docs/SCHEMA.md` and record the date here.
  Schema applied on: `NOT APPLIED`.

## Verify

Two tiers. The offline gate runs anywhere; the live walk needs a deploy.

### Offline gate — run every session

```
npm ci
npm run build
```

**Result 2026-09-03: PASS.** `tsc -p tsconfig.json` clean; `node --test` →
`# pass 60 / # fail 0` across `tests/canonical.test.ts`, `tests/energy.test.ts`,
`tests/pow.test.ts`, `tests/ledger.test.ts`, `tests/audit.test.ts`,
`tests/difficulty.test.ts`, `tests/validate.test.ts`.

The tamper cases in `tests/ledger.test.ts` are the ones that matter: editing a
row breaks its `immutable_check`; re-signing the edited row with the real secret
still breaks the next row's `prev_hash`; dropping a middle entry breaks the walk;
and a mid-chain range only verifies against the seed hash of the row before it.

### Live walk — the definition of done for M1-M3

Set `BASE` to the deploy, then run these in order from the repo root.

```bash
BASE=https://<your-site>.netlify.app
PLAYER=demo-player-1

# 1 — liveness
curl -sS "$BASE/health"
# expect: {"ok":true,"ts":"...","version":"..."}

# 2 — challenge
CH=$(curl -sS -X POST "$BASE/challenge" \
      -H 'content-type: application/json' \
      -d "{\"playerId\":\"$PLAYER\"}")
echo "$CH"
# expect: {"challengeId":"<uuid>","salt":"<32 hex>","difficultyBits":18,"expiresAt":"..."}

# 3 — solve it locally (this is the work the client does)
SOLVE=$(node scripts/solve.mjs --challenge-json "$CH" --player "$PLAYER")
echo "$SOLVE"
# expect: {"nonce":"...","hashes":N,"ms":N,"digest":"0000...."}

# 4 — submit; this appends the entry and mints the token
BODY=$(node -e '
  const ch = JSON.parse(process.argv[1]);
  const s = JSON.parse(process.argv[2]);
  process.stdout.write(JSON.stringify({
    challengeId: ch.challengeId,
    playerId: process.argv[3],
    cellId: "cell-42",
    artifactId: "can-tab",
    nonce: s.nonce,
    hashes: s.hashes,
    ms: s.ms,
    deviceClass: "laptop",
  }));
' "$CH" "$SOLVE" "$PLAYER")
curl -sS -X POST "$BASE/submit" -H 'content-type: application/json' -d "$BODY"
# expect: {"tokenId":"<uuid>","estKwh":<number>,"mapEvent":{"cellId":"cell-42","ts":"...","kind":"restored"},"entry":{...}}

# 5 — the same challenge must not work twice
curl -sS -X POST "$BASE/submit" -H 'content-type: application/json' -d "$BODY"
# expect: HTTP 409 {"error":{"code":"challenge_used",...}}

# 6 — the signed self-audit; the entry from step 4 must be in it
REPORT=$(curl -sS "$BASE/audit/latest"); echo "$REPORT"
# expect: {"rangeStart":...,"rangeEnd":...,"entryCount":>=1,"tokenCount":== entryCount,
#          "totalEstKwh":...,"chainOk":true,"generatedAt":...,"signature":"<64 hex>"}
# entryCount == tokenCount is the mint invariant: one token per verified find.

# 7 — the report verifies
curl -sS -X POST "$BASE/verify" -H 'content-type: application/json' -d "$REPORT"
# expect: {"valid":true,"checkedAt":"..."}

# 8 — a tampered report does not
TAMPERED=$(node -e '
  const r = JSON.parse(process.argv[1]);
  r.totalEstKwh = 0;
  process.stdout.write(JSON.stringify(r));
' "$REPORT")
curl -sS -X POST "$BASE/verify" -H 'content-type: application/json' -d "$TAMPERED"
# expect: {"valid":false,...}

# 9 — an explicit range audits and signs the same way
FROM=$(node -e 'process.stdout.write(new Date(Date.now()-3600e3).toISOString())')
TO=$(node -e 'process.stdout.write(new Date().toISOString())')
curl -sS "$BASE/audit/$FROM.$TO"
# expect: a report whose entryCount covers the last hour, chainOk true

# 10 — the ledger really is append-only (Supabase SQL editor)
#   delete from public.ledger where true;
# expect: ERROR: ledger is append-only: DELETE on entry_id ...
```

**Result: NOT RUN** — no deploy existed as of 2026-09-03. Record each step's
actual output here on the first live run.

## Notes for the next session

- The branch for this work is `claude/strata-ledger-bootstrap-csa88x`, assigned
  by the session harness. `SEED.md` says `origin loop`; the harness instruction
  wins, and `docs/LOOP.md` now records that rule. Do not push to a branch you
  were not given.
- `npm run build` is the gate and takes about a second. Run it before every
  commit.
- Function files stay thin. If you find yourself writing logic in
  `netlify/functions/`, it belongs in `src/lib/` where a test can reach it.
- There are **zero runtime dependencies** and that is a deliberate decision
  (`docs/ARCHITECTURE.md#d1`). Adding one needs a recorded decision, not a
  reflex `npm install`.

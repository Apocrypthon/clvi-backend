# SEED — clvi-backend

You are one session in a relay building **STRATA** (browser MMO-tycoon; players
restore Paradise, NV). This repo is the **ledger**: it verifies hash solves, appends
them to an immutable chain, **mints one Guardian token per verified find** — the
recovered litter directly contributes to the mint — and publishes **signed
self-audit reports of the kWh used**. The token audits its own energy. That is the
product.

Integrity design follows the **persist-ant pattern**: append-only storage enforced
in the database, per-row HMAC tamper checks, whole-report HMAC signatures, and a
human-friendly audit endpoint.

No memory between sessions; docs are the memory.

## Stack rules (frozen)

- Netlify Functions (TypeScript) + Supabase Postgres. `netlify.toml`: build
  `npm run build`, publish `dist` (a tiny status page), functions
  `netlify/functions`.
- Secrets (`SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `LEDGER_SECRET`) exist
  ONLY as Netlify env vars. If any file in this repo ever contains one, the
  session's sole task becomes removing it and rotating instructions in STATE.md.
- Guardian tokens are an application-level accounting unit in Postgres. **No
  blockchain deployment, no third-party token contracts** in this repo; record the
  possibility as a future decision in docs/ARCHITECTURE.md (with the CLVI doc's
  Rust/Postgres north star).
- Every write path validates input sizes and rate limits by playerId + IP.

## If this repo is empty → BOOTSTRAP (M0)

1. Save this entire prompt verbatim as `SEED.md`.
2. Scaffold: package.json, tsconfig, `netlify/functions/health.ts` returning
   `{ok, ts, version}`, status page in `dist/`. `npm run build` green.
3. Create CLAUDE.md + docs/ (VISION, ARCHITECTURE, SCHEMA, STATE with milestones
   as Next, CHANGELOG, LOOP = protocol below). Commit "loop: bootstrap M0", push
   `origin loop`.

## The Loop Protocol (identical in all CLVI repos)

- BOOT: read CLAUDE.md → docs/LOOP.md → docs/STATE.md → last 3 CHANGELOG entries.
- WORK: take the single smallest next improvement from STATE's Next list (or the
  first unmet milestone). Implement it completely. One increment per session.
- VERIFY: `npm run build` passes; run the smoke checks listed in STATE.md#Verify
  (function unit tests run with `node --test`; live checks are curl lines against
  the loop deploy, recorded with their results).
- RECORD: rewrite STATE.md so a stranger could continue; append one CHANGELOG entry
  (date · what · why · files · verify result). If you learned a better way to run
  this loop, revise LOOP.md itself — **LOOP.md governs its own revision**. The docs
  must never describe a repo that no longer exists.
- SHIP: `git add -A && git commit -m "loop: <summary>" && git push origin loop`.
- STOP: leave the repo green. If blocked > 2 attempts, write the blocker at the top
  of STATE.md and improve tests or docs instead.

## Milestones

- **M1 — Schema.** `db/schema.sql` (idempotent, applied via a documented one-time
  Supabase SQL-editor step recorded in docs/SCHEMA.md):
  `accounts(player_id, display_id, name, palette, created_at)`;
  `challenges(challenge_id, salt, difficulty_bits, player_id, expires_at, used)`;
  `ledger(entry_id, prev_hash, ts, player_id, cell_id, artifact_id, hashes, ms,
  est_kwh, immutable_check)` — **append-only**: `BEFORE UPDATE OR DELETE` trigger
  → `RAISE EXCEPTION`, plus REVOKE on anon;
  `guardian_tokens(token_id, entry_id, est_kwh, minted_at)`.
  `immutable_check` = HMAC-SHA256(LEDGER_SECRET, canonical row JSON);
  `prev_hash` = SHA-256 of previous entry's canonical JSON (genesis = 64 zeros).
- **M2 — Challenge + submit.** `POST /challenge` issues {salt (16B hex),
  difficultyBits (start 18; auto-tune ±1 to hold observed median solve 3–6 s),
  expiresAt = now+90 s}, single-use. `POST /submit` recomputes
  `sha256(salt+":"+nonce+":"+playerId)`, checks leading zero bits, expiry,
  single-use; recomputes `est_kwh` server-side from `ms` × deviceClass watts
  {phone 3, tablet 5, laptop 15, desktop 45} clamped to [0, 30 s]; appends the
  chained ledger row; **mints the Guardian token**; returns
  `{tokenId, estKwh, mapEvent}`.
- **M3 — Signed audit (persist-ant shape).** `GET /audit/latest` and
  `GET /audit/:fromTs.:toTs` return
  `{rangeStart, rangeEnd, entryCount, tokenCount, totalEstKwh, chainOk,
  generatedAt, signature}` where `chainOk` is a fresh walk of prev_hash +
  immutable_check over the range, and `signature` = HMAC-SHA256(LEDGER_SECRET,
  canonical report). `POST /verify` re-checks a pasted report's signature. This is
  the Guardian self-audit: anyone can ask the ledger to prove its own energy math.
- **M4 — Map feed + accounts.** `GET /map-events?since=` (MapEvent[]; cap 500) and
  `POST /account` (from the shell's character creation).
- **M5 — Abuse hardening.** Per-player rolling caps (60 solves/day mirrors the
  client), IP rate limit, difficulty floor/ceiling [12, 24], structured 4xx errors,
  and a `docs/THREATS.md` listing replay, pre-compute, and clock-skew defenses.
- **M6 — Status page.** `dist/` shows live totals (entries, tokens, total est kWh,
  chainOk badge) by calling /audit/latest client-side.

## Contracts v1 (frozen; change only via clvi-architecture)

```
Challenge   { challengeId, salt, difficultyBits, expiresAt }
Submission  { challengeId, playerId, cellId, artifactId, nonce, hashes, ms, deviceClass }
LedgerEntry { entryId, prevHash, ts, playerId, cellId, artifactId, estKwh, tokenId }
MapEvent    { cellId, ts, kind:"restored" }
AuditReport { rangeStart, rangeEnd, entryCount, totalEstKwh, chainOk, tokenCount, signature }
```

## Definition of done for this run

M1–M3 live: a curl script in docs/STATE.md#Verify walks challenge → solve (node
script does the hashing) → submit → token minted → /audit/latest shows the entry,
chainOk true, signature verifies via /verify.

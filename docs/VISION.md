# VISION

## STRATA

A browser MMO-tycoon in which players restore Paradise, NV. Play is the loop of
finding and recovering litter; the world visibly heals as cells are restored.

## What this repo is

The **ledger**. It is the part of STRATA that has to be true.

A player's client does real work — it hashes until it finds a nonce that meets a
server-issued difficulty. That work is what a "find" costs. This service:

1. **issues** the challenge (single-use, expiring, difficulty tuned per player),
2. **verifies** the solve,
3. **appends** it to an immutable, hash-chained ledger,
4. **mints one Guardian token** for it — the recovered litter directly
   contributes to the mint,
5. **publishes signed self-audit reports** of the kWh those solves consumed.

## The product is the audit

Anything can claim to be green. The Guardian token is interesting only because
**the token audits its own energy**, and it does so in a form a stranger can
check:

- The energy figure is computed **server-side** from solve time and device class.
  A client cannot report its own kWh; it can only report how long it hashed and
  on what.
- Every ledger row carries an HMAC over its own contents, and the SHA-256 of the
  row before it. Editing history requires breaking both, and repairing one breaks
  the other (`tests/ledger.test.ts` demonstrates exactly this).
- `GET /audit/latest` re-walks the chain on every request — `chainOk` is never
  cached — and signs the whole report.
- `POST /verify` re-checks a report someone pasted from anywhere.

So the honest sentence this repo is built to earn is: *ask the ledger to prove
its own energy math, and it will.*

## What this repo is deliberately not

- **Not a blockchain.** Guardian tokens are an accounting unit in Postgres. No
  chain deployment, no third-party token contracts. See
  `ARCHITECTURE.md#future-decisions` for the conditions under which that would be
  revisited.
- **Not the game.** No world simulation, no economy, no rendering. It receives a
  `cellId` and an `artifactId` and emits a `MapEvent`; what those mean is the
  shell's business.
- **Not an identity provider.** `playerId` is an opaque handle. The ledger binds
  work to it, and that is all it claims.

## Success looks like

A stranger clones this repo, reads `docs/STATE.md`, runs the curl walk in
`#Verify` against the deploy, and watches a solve become a token become a signed
line in an audit they can independently re-verify — without ever being asked to
trust the operator.

# LOOP.md — how to run a session

Identical in all CLVI repos. **This file governs its own revision:** if you learn
a better way to run the loop, change it here, in the same session, and say so in
the CHANGELOG entry.

## BOOT

Read, in order: `CLAUDE.md` → this file → `docs/STATE.md` → the last three
entries of `docs/CHANGELOG.md`. Do not start work before you have read STATE.md's
`Next` list; it is the only authority on what to do.

## WORK

Take **the single smallest next improvement** from STATE's `Next` list, or the
first unmet milestone in `SEED.md` if `Next` is empty. Implement it *completely* —
schema, code, tests and docs — rather than starting two things.

One increment per session. A half-finished second increment costs the next
session more than it saves this one.

## VERIFY

1. `npm run build` must pass. It runs the typecheck and the unit tests, and it is
   the gate: nothing ships red.
2. Run every check in `docs/STATE.md#Verify`. Unit tests are offline. Live checks
   are curl lines against the deploy — **record their actual results**, including
   the date they were last run. A check whose result is not recorded has not been
   run.
3. If a live check cannot be run this session (no deploy, no credentials), say so
   explicitly in STATE.md next to the check. Never imply a check passed.

## RECORD

- Rewrite `docs/STATE.md` so that a stranger with only this repo could continue.
  It describes what *is*, not what was planned. The docs must never describe a
  repo that no longer exists.
- Append **one** entry to `docs/CHANGELOG.md`: date · what · why · files · verify
  result.
- Update `docs/ARCHITECTURE.md` or `docs/SCHEMA.md` if you changed a decision or
  a table. A decision that is not written down will be re-litigated.

## SHIP

```
git add -A && git commit -m "loop: <summary>" && git push -u origin <branch>
```

The branch is whatever the session was told to use. Historically that was `loop`;
sessions driven by an automation harness are given their own branch name and must
use it. **Never push to a branch you were not given.**

## STOP

Leave the repo green. If you are blocked after two attempts, stop trying: write
the blocker at the very top of `docs/STATE.md` — what you tried, what happened,
what the next session should try first — and spend the remaining effort on tests
or docs instead. A well-described blocker is a completed increment.

## Loop hygiene learned so far

- **Record the verification transcript, not a claim.** "chainOk true" is worth
  nothing without the command that produced it.
- **Prefer a testable module over a testable endpoint.** Logic lives in
  `src/lib/`; the function files stay thin wrappers. This is what lets
  `npm run build` be a real gate with no network.
- **Write the failure mode into the test.** The interesting tests here are the
  tamper cases: edit a row, re-sign it, drop one — the chain must notice.

# test/inject

Initial data, as ordered steps. **Not tests** — nothing here asserts behaviour;
each file puts one domain's rows in place so the merchant-behaviour run has
something to work with.

Run it with:

```bash
node scripts/test-inject-all.js
```

That resets nothing. Reset first with `node scripts/test-db-all.js`, which
migrates and seeds without `--dev` — so you start from a bare migrated database:
no providers beyond `INTERNAL`, no base fees, no settlement windows, no agents
and no merchants. Everything else comes from here.

## Order

**The number in the filename is the contract.** `scripts/test-inject-all.js`
reads this directory, sorts by name and runs one jest process per file, stopping
at the first failure.

That script is what enforces the order, not the number. Jest's default sequencer
sorts by last-run failure, then duration, then file size — never by path — so
`npx jest test/inject` on its own would run them in an arbitrary order and in
parallel. `jest-inject.config.js` therefore sets `maxWorkers: 1` and a
`inject-sequencer.js` that sorts by path, so running the directory by hand
behaves the same way as the script.

Number in tens if you want room to slot a step in between without renaming the
rest.

## Why these are not picked up by `npm test`

The root jest config matches `.*\.spec\.ts$` across `apps/` and `libs/`, which
would sweep these into an ordinary test run and mutate the database as a side
effect of running the unit tests. `testPathIgnorePatterns` in `package.json`
excludes `/test/inject/`, and this directory's own config opts them back in.

So: `npm test` never runs these, and `scripts/test-inject-all.js` runs only
these.

## Writing a step

- **Idempotent.** Every endpoint used here upserts, so a step may be re-run
  without a reset. Keep it that way; it is what makes iterating on fixture data
  cheap.
- **Named by what it injects**, since the name is how a script can select one
  step: `it('register')`, not `it('should register providers')`.
- **No negative cases.** A refusal belongs in the E2E spec for that domain, one
  directory up. A step that deliberately fails is a step that stops the run.
- **Use the callers in `src/helper/api.ts`** rather than writing `callDashboard`
  by hand, and the fixtures in `src/helper/constant.ts` rather than literals, so
  changing the initial data is one edit in one place.

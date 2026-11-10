const Sequencer = require('@jest/test-sequencer').default;

/**
 * Runs the injection steps in filename order.
 *
 * The numbers in `01.upstream.spec.ts` and friends are the contract, and
 * nothing in jest honours them by default: the stock sequencer sorts by
 * last-run failure, then recorded duration, then file size, so step 03 can run
 * before step 01 and the whole point of the numbering is lost. Jest's own
 * source documents a path sort as *the* example of a sequencer worth writing,
 * which is all this is.
 *
 * Ordering alone is not enough - `maxWorkers: 1` in jest-inject.config.js is
 * what stops two steps running at once - and neither helps if a step is run
 * directly. `scripts/test-inject-all.js` is the supported entry point; this
 * exists so that running the directory by hand behaves the same way.
 */
module.exports = class InjectSequencer extends Sequencer {
  sort(tests) {
    return [...tests].sort((a, b) => (a.path > b.path ? 1 : -1));
  }

  /** Same order for a sharded run, rather than the stock cache-based one. */
  shard(tests, options) {
    return this.sort(super.shard(tests, options));
  }
};

const path = require('path');

const ROOT = path.resolve(__dirname, '../../../..');

/**
 * The jest config for the injection steps.
 *
 * Derived from the root config in package.json rather than restated, so the
 * nine `moduleNameMapper` entries and the ts-jest transform cannot drift out of
 * sync with the rest of the repo. Only the four things that have to differ are
 * overridden.
 */
const base = require(path.join(ROOT, 'package.json')).jest;

module.exports = {
  ...base,

  rootDir: ROOT,

  /**
   * Only this directory. The root config's `testRegex` is dropped, because jest
   * refuses a config carrying both `testRegex` and `testMatch`.
   */
  testRegex: undefined,
  testMatch: ['<rootDir>/apps/uat-local/test/inject/*.spec.ts'],

  /**
   * The root config excludes this directory so `npm test` never mutates the
   * database; opt back in here. Keep `/node_modules/` - naming the field at all
   * replaces jest's default rather than adding to it.
   */
  testPathIgnorePatterns: ['/node_modules/'],

  /** One step at a time. See inject-sequencer.js for why both are needed. */
  maxWorkers: 1,
  testSequencer: path.join(__dirname, 'inject-sequencer.js'),
};

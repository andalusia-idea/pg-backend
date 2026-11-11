const { readdirSync } = require('fs');
const { spawnSync } = require('child_process');
const path = require('path');

/**
 * [TEST] Injects the initial data, one step at a time, in filename order.
 *
 * PLACEHOLDER: the steps under apps/uat-local/test/inject are `it.todo` stubs
 * for now, so this prints the order it would run and reports every step as
 * todo. It needs no change once they are implemented.
 *
 * Deliberately not a Windows Terminal fan-out like test-start-all.js and
 * test-db-all.js: those start things that then run side by side, while these
 * steps depend on each other. One jest process per file, sequentially, in this
 * terminal, stopping at the first failure - so a broken step cannot leave the
 * database half-injected while later steps pile on top of it.
 *
 * Expects a stack already running (`node scripts/test-start-all.js`) against a
 * freshly reset database (`node scripts/test-db-all.js`).
 */

/**
 * Resolved from this file's own location, not the working directory, so the
 * script runs the same from the repo root, from scripts/, or from anywhere
 * else. Unlike test-start-all.js and test-db-all.js it hardcodes no absolute
 * path, so it needs no edit on another machine.
 */
const REPO_ROOT = path.resolve(__dirname, '..');

/** Repo-relative, forward slashes, because these are passed to jest. */
const INJECT_DIR = 'apps/uat-local/test/inject';
const CONFIG = `${INJECT_DIR}/jest-inject.config.js`;

/**
 * The number in the filename is the order. Read off disk rather than listed
 * here, so adding `06.whatever.spec.ts` needs no edit to this script - which is
 * the whole reason the order lives in the filenames.
 */
const steps = readdirSync(path.join(REPO_ROOT, INJECT_DIR))
  .filter((file) => /^\d+\..+\.spec\.ts$/.test(file))
  .sort();

if (steps.length === 0) {
  console.error(`No injection steps found in ${INJECT_DIR}.`);
  process.exit(1);
}

console.log('🌱 [TEST] Injecting initial data, in order:\n');
steps.forEach((file, i) => console.log(`   ${i + 1}. ${file}`));
console.log('');

for (const [i, file] of steps.entries()) {
  const label = `[${i + 1}/${steps.length}] ${file}`;
  console.log(`\n=== ${label} ===\n`);

  const result = spawnSync(
    'npx',
    [
      'jest',
      '--config',
      CONFIG,
      '--runInBand',
      // --runTestsByPath, not a bare positional: jest treats a positional
      // argument as a *regex* matched against test paths, and a Windows path
      // carries backslashes that a regex reads as escapes.
      '--runTestsByPath',
      `${INJECT_DIR}/${file}`,
    ],
    {
      // Jest resolves rootDir and the module mappings against where it was
      // started, so it runs from the repo root whatever the caller's cwd was.
      cwd: REPO_ROOT,
      stdio: 'inherit',
      // npx is a .cmd on Windows and spawnSync will not resolve it otherwise.
      shell: true,
    },
  );

  if (result.status !== 0) {
    console.error(
      `\n❌ ${label} failed. Stopping - the steps after it depend on this one.\n` +
        '   Fix it, reset with `node scripts/test-db-all.js`, and run again.',
    );
    process.exit(result.status ?? 1);
  }
}

console.log('\n✅ [TEST] All injection steps completed.\n');

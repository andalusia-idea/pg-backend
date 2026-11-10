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

const INJECT_DIR = path.join('apps', 'uat-local', 'test', 'inject');
const CONFIG = path.join(INJECT_DIR, 'jest-inject.config.js');

/**
 * The number in the filename is the order. Read off disk rather than listed
 * here, so adding `06.whatever.spec.ts` needs no edit to this script - which is
 * the whole reason the order lives in the filenames.
 */
const steps = readdirSync(INJECT_DIR)
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
    ['jest', '--config', CONFIG, '--runInBand', path.join(INJECT_DIR, file)],
    // shell: true because npx is a .cmd on Windows and spawnSync will not
    // resolve it otherwise.
    { stdio: 'inherit', shell: true },
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

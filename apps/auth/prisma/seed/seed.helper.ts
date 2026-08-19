import * as argon2 from 'argon2';

/**
 * Hashing lives here rather than importing the dashboard's AuthHelper - apps
 * must not depend on each other, only on libs/. It is one argon2 call, and
 * argon2 encodes its parameters into the hash, so a seeded password keeps
 * verifying even if the app's hashing options change later.
 *
 * When the auth app's own business modules are ported it will need hashing at
 * runtime; that is the point to promote this into a lib and have both the app
 * and this seed use it.
 */
export function hashPassword(password: string): Promise<string> {
  return argon2.hash(password);
}

/** Every seeded account shares one password - these are non-production logins. */
export const SEED_PASSWORD = 'password123';

/** Machine accounts (scheduler / system / reserved) use their own. */
export const ENGINE_PASSWORD = 'hesoyam';

export function logSeeded(label: string, count: number | string): void {
  console.log(`  ${label.padEnd(28)} ${count}`);
}

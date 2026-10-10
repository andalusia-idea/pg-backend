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

// ENGINE_PASSWORD is gone. The machine principals it hashed are now inserted by
// the `machine_principals` migration with a password value that is not a valid
// argon2 hash, so verification always rejects and those 20 accounts are
// structurally unable to sign in. Previously they carried working hashes of a
// shared literal, despite the seed documenting them as unable to log in.

export function logSeeded(label: string, count: number | string): void {
  console.log(`  ${label.padEnd(28)} ${count}`);
}

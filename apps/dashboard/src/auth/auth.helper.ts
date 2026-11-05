import * as argon2 from 'argon2';
import { timingSafeEqual } from 'node:crypto';

export class AuthHelper {
  static hashPassword(password: string): Promise<string> {
    return argon2.hash(password);
  }

  /**
   * Compares two plaintext secrets without leaking their contents through
   * timing.
   *
   * Only for the provisioning passwords in PrincipalConfig, which are compared
   * plaintext-to-plaintext because the account has no hash yet. Everything with
   * a stored hash goes through `verifyPassword`, where argon2 handles this.
   *
   * `timingSafeEqual` throws on a length mismatch, which would itself reveal
   * the expected length, so the lengths are compared first and the result is
   * folded in rather than returned early.
   */
  static secretEquals(expected: string, actual: string): boolean {
    const a = Buffer.from(expected, 'utf8');
    const b = Buffer.from(actual, 'utf8');
    if (a.length !== b.length) {
      // Still do a comparison of equal-length buffers so the work done does not
      // depend on whether the length matched.
      timingSafeEqual(a, a);
      return false;
    }
    return timingSafeEqual(a, b);
  }

  static async verifyPassword(
    hashedPassword: string,
    plainPassword: string,
  ): Promise<boolean> {
    try {
      return await argon2.verify(hashedPassword, plainPassword);
    } catch {
      // argon2 throws on a malformed hash; treat that as "does not match"
      // rather than letting it surface as a 500.
      return false;
    }
  }
}

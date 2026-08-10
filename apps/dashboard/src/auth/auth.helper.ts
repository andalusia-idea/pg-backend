import * as argon2 from 'argon2';

export class AuthHelper {
  static hashPassword(password: string): Promise<string> {
    return argon2.hash(password);
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

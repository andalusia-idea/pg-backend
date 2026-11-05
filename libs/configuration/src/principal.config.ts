import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AppConfig } from './app.config';

/**
 * Minimum length for a provisioning password in production.
 *
 * A floor and nothing more. It does not exclude the seed password: SEED_PASSWORD
 * is `password123456789`, 17 characters, which clears this comfortably.
 * REFUSED_IN_PRODUCTION is what actually keeps that value out.
 */
const MIN_LENGTH_PRODUCTION = 16;

/**
 * Values refused in production outright, whatever their length.
 *
 * This list, not MIN_LENGTH_PRODUCTION, is what stands between a production
 * deploy and a credential that is committed to this repository.
 *
 * `password123456789` is both SEED_PASSWORD and the value .env.example and
 * .env.test use for these two keys, so it reaches production by either of the
 * two routes that actually happen: a seeded database, or an example env file
 * copied onto a server. At 17 characters no length rule will ever catch it -
 * which is the whole reason this list exists and cannot be folded into the one
 * above.
 *
 * `change-me` is the .env.example placeholder for a secret.
 *
 * `password123` was SEED_PASSWORD until 2026-11-05 and no longer appears in the
 * repository. It stays listed because it is still in git history, and in any
 * .env file copied before that change.
 */
const REFUSED_IN_PRODUCTION = ['password123', 'password123456789', 'change-me'];

@Injectable()
export class PrincipalConfig {
  constructor(
    private readonly configService: ConfigService,
    private readonly appConfig: AppConfig,
  ) {}

  private read(key: string): string {
    const raw = this.configService.get<string>(key);

    if (raw === '' || raw === undefined)
      throw new Error(`key [${key}] cannot be empty`);

    /// Local and test are exempt from both rules below so the UAT specs can use
    /// the committed value. It only matters there if a named principal is still
    /// unactivated: once the account holds a real argon2 hash, the login path
    /// never consults this at all.
    if (!this.appConfig.IS_PRODUCTION) return raw;

    if (raw.length < MIN_LENGTH_PRODUCTION) {
      throw new Error(
        `key [${key}] must be at least ${MIN_LENGTH_PRODUCTION} characters in ` +
          `production - until that account's first login it is the only ` +
          `credential standing in front of a named principal`,
      );
    }

    if (REFUSED_IN_PRODUCTION.includes(raw)) {
      throw new Error(
        `key [${key}] is set to a value committed to this repository. This ` +
          `usually means an .env.example or .env.test was copied onto a ` +
          `server - generate a value instead`,
      );
    }

    return raw;
  }

  get INITIAL_SUPER_ADMIN_PASSWORD(): string {
    return this.read('INITIAL_SUPER_ADMIN_PASSWORD');
  }

  get INITIAL_AGENT_INTERNAL_PASSWORD(): string {
    return this.read('INITIAL_AGENT_INTERNAL_PASSWORD');
  }
}

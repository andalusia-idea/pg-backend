import { SetMetadata } from '@nestjs/common';
import { ROLE } from '../auth.constant';

export const ROLES_KEY = 'ROLES_KEY';

/**
 * Marks the roles a handler is intended for.
 *
 * **Nothing enforces this yet.** `RolesGuard` exists and is correct, but is
 * deliberately not registered in AppModule while the role model is being
 * settled - see the note there. Authentication is enforced; role membership
 * is not.
 *
 * Kept on the routes so the intended access is recorded next to the handler
 * and greppable, and so switching enforcement on is a one-line change rather
 * than an audit of every controller.
 */
export const Roles = (...roles: ROLE[]) => SetMetadata(ROLES_KEY, roles);

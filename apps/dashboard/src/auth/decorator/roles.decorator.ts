import { SetMetadata } from '@nestjs/common';
import { ROLE } from '../auth.constant';

export const ROLES_KEY = 'ROLES_KEY';

/** Restricts a handler to the listed roles. Enforced by RolesGuard. */
export const Roles = (...roles: ROLE[]) => SetMetadata(ROLES_KEY, roles);

import { SetMetadata } from '@nestjs/common';

export const PUBLIC_API_KEY = 'PUBLIC_API_KEY';

/** Skips JWT authentication for this handler (login, health). */
export const PublicApi = () => SetMetadata(PUBLIC_API_KEY, true);

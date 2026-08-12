import { Request } from 'express';

/** Every error response carries the path and a timestamp for log correlation. */
export function buildMeta(
  request: Request,
  existingMeta?: unknown,
): Record<string, unknown> {
  return {
    path: request.originalUrl ?? request.url,
    timestamp: new Date().toISOString(),
    ...(typeof existingMeta === 'object' && existingMeta !== null
      ? existingMeta
      : {}),
  };
}

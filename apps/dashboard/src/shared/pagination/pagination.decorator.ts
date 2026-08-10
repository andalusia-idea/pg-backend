import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { Request } from 'express';
import { Pageable } from './pagination';

export const DEFAULT_PAGE = 1;
export const DEFAULT_SIZE = 15;

/**
 * Express query values are `string | string[] | ParsedQs | ParsedQs[]`, so only a
 * plain string is worth parsing - anything else (repeated or nested params) falls
 * back rather than stringifying to something meaningless.
 */
function positiveIntOr(value: unknown, fallback: number): number {
  if (typeof value !== 'string') return fallback;

  const parsed = parseInt(value, 10);
  return Number.isInteger(parsed) && parsed >= 1 ? parsed : fallback;
}

/**
 * Reads `page` / `size` off the query string, falling back to defaults.
 * Invalid or out-of-range values fall back rather than erroring, matching legacy.
 */
export const Pagination = createParamDecorator(
  (
    defaults: Pageable = { page: DEFAULT_PAGE, size: DEFAULT_SIZE },
    context: ExecutionContext,
  ): Pageable => {
    const request: Request = context.switchToHttp().getRequest();

    return {
      page: positiveIntOr(request.query.page, defaults.page),
      size: positiveIntOr(request.query.size, defaults.size),
    };
  },
);

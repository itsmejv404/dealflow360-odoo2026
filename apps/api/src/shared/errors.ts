import type { NextFunction, Request, Response } from 'express';
import { MulterError } from 'multer';
import { ZodError, type ZodIssue } from 'zod';
import { logger } from '../lib/logger.js';

export class HttpError extends Error {
  constructor(
    public readonly statusCode: number,
    message: string,
  ) {
    super(message);
    this.name = 'HttpError';
  }
}

/**
 * Converts a Zod issue into user-appropriate text. Raw Zod internals
 * ("Expected number, received null") never reach the UI: invalid-type issues
 * become a friendly generic prompt, while custom business messages from the
 * schemas (e.g. "Price must be greater than 0") are preserved.
 */
export function friendlyZodMessage(issues: ZodIssue[]): string {
  const first = issues[0];
  if (!first) {
    return 'Please review the values you entered.';
  }
  if (first.code === 'invalid_type' || first.code === 'unrecognized_keys' || first.code === 'invalid_union') {
    return 'Some values are missing or invalid — please review your input and try again.';
  }
  return first.message || 'Please review the values you entered.';
}

export function notFoundHandler(_req: Request, res: Response): void {
  res.status(404).json({ error: 'Not Found' });
}

export function errorHandler(err: unknown, _req: Request, res: Response, _next: NextFunction): void {
  if (err instanceof HttpError) {
    res.status(err.statusCode).json({ error: err.message });
    return;
  }

  // Multer upload failures → precise client errors instead of a generic 500.
  if (err instanceof MulterError) {
    const message =
      err.code === 'LIMIT_FILE_SIZE'
        ? 'Uploaded file is too large. Maximum allowed size is 5 MB.'
        : err.code === 'LIMIT_UNEXPECTED_FILE'
          ? 'Unexpected upload field. Use the "logo" field for logo uploads.'
          : `Upload failed: ${err.message}`;
    res.status(400).json({ error: message });
    return;
  }

  // Safety net: any uncaught ZodError is a client-input problem, never a 500 —
  // and its message is always user-friendly, never raw Zod internals.
  if (err instanceof ZodError) {
    res.status(400).json({ error: friendlyZodMessage(err.issues) });
    return;
  }

  // nginx/proxy body-size rejections and similar surface as PayloadError in
  // the express body parsers; give them the proper 413 semantics.
  const maybeStatus = (err as { statusCode?: number; status?: number; type?: string; expose?: boolean }) ?? {};
  const status = maybeStatus.statusCode ?? maybeStatus.status;

  if (status === 413 || maybeStatus.type === 'entity.too.large') {
    res.status(413).json({ error: 'Request body too large. Maximum allowed upload size is 5 MB.' });
    return;
  }

  // Malformed JSON / aborted bodies from the body parsers carry a 4xx status —
  // surface them as client errors with a clear message, never a generic 500.
  if (typeof status === 'number' && status >= 400 && status < 500) {
    const message =
      maybeStatus.type === 'entity.parse.failed'
        ? 'Request body is not valid JSON.'
        : err instanceof Error && err.message
          ? err.message
          : 'Invalid request.';
    res.status(status).json({ error: message });
    return;
  }

  logger.error({ err }, 'unhandled error');
  res.status(500).json({ error: 'Internal Server Error' });
}

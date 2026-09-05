import type { NextFunction, Request, Response } from 'express';
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

export function notFoundHandler(_req: Request, res: Response): void {
  res.status(404).json({ error: 'Not Found' });
}

export function errorHandler(err: unknown, _req: Request, res: Response, _next: NextFunction): void {
  if (err instanceof HttpError) {
    res.status(err.statusCode).json({ error: err.message });
    return;
  }
  logger.error({ err }, 'unhandled error');
  res.status(500).json({ error: 'Internal Server Error' });
}

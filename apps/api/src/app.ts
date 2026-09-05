import express from 'express';
import { healthRouter } from './modules/health/health.routes.js';
import { errorHandler, notFoundHandler } from './shared/errors.js';

export function createApp(): express.Express {
  const app = express();

  app.disable('x-powered-by');
  app.use(express.json());

  // Module registry — every domain module mounts its router here.
  app.use('/api/health', healthRouter);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}

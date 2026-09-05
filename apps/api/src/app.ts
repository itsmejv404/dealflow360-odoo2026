import express from 'express';
import { authRouter } from './modules/auth/auth.routes.js';
import { catalogRouter } from './modules/catalog/catalog.routes.js';
import { healthRouter } from './modules/health/health.routes.js';
import { onboardingRouter } from './modules/onboarding/onboarding.routes.js';
import { organizationRouter } from './modules/organization/organization.routes.js';
import { platformRouter } from './modules/platform/platform.routes.js';
import { quotationsRouter } from './modules/quotations/quotations.routes.js';
import { rulebookRouter } from './modules/rulebook/rulebook.routes.js';
import { tenantDemoRouter } from './modules/tenant-demo/demo.routes.js';
import { usersRouter } from './modules/users/users.routes.js';
import { errorHandler, notFoundHandler } from './shared/errors.js';

export function createApp(): express.Express {
  const app = express();

  app.disable('x-powered-by');
  app.use(express.json());

  // Module registry — every domain module mounts its router here.
  app.use('/api/auth', authRouter);
  app.use('/api/catalog', catalogRouter);
  app.use('/api/health', healthRouter);
  app.use('/api/onboarding', onboardingRouter);
  app.use('/api/organization', organizationRouter);
  app.use('/api/quotations', quotationsRouter);
  app.use('/api/rulebook', rulebookRouter);
  app.use('/api/users', usersRouter);
  app.use('/api/demo', tenantDemoRouter);
  app.use('/api/platform', platformRouter);
  app.use('/platform', platformRouter);


  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}

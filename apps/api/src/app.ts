import express from 'express';
import { approvalsRouter } from './modules/approvals/approvals.routes.js';
import { authRouter } from './modules/auth/auth.routes.js';
import { catalogRouter } from './modules/catalog/catalog.routes.js';
import { governanceRouter } from './modules/governance/governance.routes.js';
import { healthRouter } from './modules/health/health.routes.js';
import { negotiationRouter } from './modules/negotiation/negotiation.routes.js';
import { onboardingRouter } from './modules/onboarding/onboarding.routes.js';
import { organizationRouter } from './modules/organization/organization.routes.js';
import { platformRouter } from './modules/platform/platform.routes.js';
import { portalRouter } from './modules/portal/portal.routes.js';
import { quotationsRouter } from './modules/quotations/quotations.routes.js';
import { recommendationsRouter } from './modules/recommendations/recommendations.routes.js';
import { rulebookRouter } from './modules/rulebook/rulebook.routes.js';
import { tenantDemoRouter } from './modules/tenant-demo/demo.routes.js';
import { usersRouter } from './modules/users/users.routes.js';
import { errorHandler, notFoundHandler } from './shared/errors.js';

export function createApp(): express.Express {
  const app = express();

  app.disable('x-powered-by');
  app.use(express.json());

  // Module registry — every domain module mounts its router here.
  app.use('/api/approvals', approvalsRouter);
  app.use('/api/auth', authRouter);
  app.use('/api/catalog', catalogRouter);
  app.use('/api/governance', governanceRouter);
  app.use('/api/health', healthRouter);
  app.use('/api/negotiation', negotiationRouter);
  app.use('/api/onboarding', onboardingRouter);
  app.use('/api/organization', organizationRouter);
  app.use('/api/platform', platformRouter);
  app.use('/api/portal', portalRouter);
  app.use('/api/quotations', quotationsRouter);
  app.use('/api/recommendations', recommendationsRouter);
  app.use('/api/rulebook', rulebookRouter);
  app.use('/api/users', usersRouter);
  app.use('/api/demo', tenantDemoRouter);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}

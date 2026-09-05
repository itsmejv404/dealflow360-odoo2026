import type { NextFunction, Request, Response } from 'express';
import { prisma } from '../lib/prisma.js';
import { HttpError } from './errors.js';
import { verifyJwt, type InternalJwtPayload, type CustomerJwtPayload, type SuperAdminJwtPayload } from './jwt.js';
import { getTenantDb, type TenantDb } from './tenant-db.js';

export interface TenantContext {
  orgId: string;
  role?: string;
  userId?: string;
  email?: string;
  quotationIds?: string[];
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      tenant?: TenantContext;
      tenantDb?: TenantDb;
      superAdmin?: SuperAdminJwtPayload;
    }
  }
}

/**
 * Middleware that resolves tenant context from JWT and binds tenant-scoped DB.
 */
export async function tenantContextMiddleware(req: Request, _res: Response, next: NextFunction): Promise<void> {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      throw new HttpError(401, 'Authorization header with Bearer token is required');
    }

    const token = authHeader.slice(7).trim();
    let payload;
    try {
      payload = verifyJwt(token);
    } catch {
      throw new HttpError(401, 'Invalid or expired authentication token');
    }

    if (!('org_id' in payload) || !payload.org_id) {
      throw new HttpError(403, 'Token does not contain a valid tenant organization context');
    }

    // Token-audience enforcement: super-admin tokens are platform-scoped and
    // must never resolve a tenant context; customer tokens are only valid for
    // portal endpoints and carry no internal role.
    const tokenTyp = (payload as { typ?: string }).typ;
    if (tokenTyp === 'super_admin') {
      throw new HttpError(403, 'Super Admin tokens are not valid for tenant-scoped endpoints');
    }
    if (tokenTyp === 'customer' && 'role' in payload) {
      throw new HttpError(403, 'Malformed customer token: internal role claims are not permitted');
    }

    const org = await prisma.organization.findUnique({
      where: { id: payload.org_id },
    });

    if (!org) {
      throw new HttpError(404, 'Organization not found');
    }

    if (org.status !== 'active') {
      throw new HttpError(403, 'Organization is suspended');
    }

    const isInternal =
      ('typ' in payload && payload.typ === 'internal') ||
      (!('typ' in payload) && 'role' in payload);

    // If it's an internal user, verify that the user still exists and is active
    if (isInternal) {
      const user = await prisma.user.findUnique({
        where: { id: payload.sub },
      });
      if (!user || user.organizationId !== org.id) {
        throw new HttpError(401, 'User account not found or does not belong to this organization');
      }
      if (user.status !== 'active') {
        throw new HttpError(403, 'User account is inactive or suspended');
      }
    }

    req.tenant = {
      orgId: org.id,
      userId: payload.sub,
      email: payload.email,
      role: isInternal ? (payload as InternalJwtPayload).role : undefined,
      quotationIds: 'quotation_ids' in payload ? (payload as CustomerJwtPayload).quotation_ids : undefined,
    };

    req.tenantDb = getTenantDb(org.id);
    next();
  } catch (err) {
    next(err);
  }
}

/**
 * Route-level RBAC middleware for internal tenant routes.
 * Throws 403 if the authenticated tenant user does not hold one of the allowed roles.
 */
export function requireRoles(allowedRoles: string[]) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    try {
      if (!req.tenant) {
        throw new HttpError(401, 'Authentication required');
      }
      if (!req.tenant.role || !allowedRoles.includes(req.tenant.role)) {
        throw new HttpError(403, `Forbidden: Requires one of [${allowedRoles.join(', ')}] role`);
      }
      next();
    } catch (err) {
      next(err);
    }
  };
}

/**
 * Super Admin guard for platform-level cross-tenant routes.
 */
export function superAdminGuard(req: Request, _res: Response, next: NextFunction): void {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      throw new HttpError(401, 'Authorization header with Bearer token is required');
    }

    const token = authHeader.slice(7).trim();
    let payload;
    try {
      payload = verifyJwt<SuperAdminJwtPayload>(token);
    } catch {
      throw new HttpError(401, 'Invalid or expired token');
    }

    // Token-audience enforcement: internal/customer tokens can never act on
    // the platform namespace, regardless of payload contents.
    if ('typ' in payload && payload.typ !== 'super_admin') {
      throw new HttpError(403, 'Forbidden: Super Admin privileges required');
    }

    if (payload.role !== 'super_admin') {
      throw new HttpError(403, 'Forbidden: Super Admin privileges required');
    }

    req.superAdmin = payload;
    next();
  } catch (err) {
    next(err);
  }
}


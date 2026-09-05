import { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { portalService } from './portal.service.js';
import { negotiationService } from '../negotiation/negotiation.service.js';
import { HttpError } from '../../shared/errors.js';

const commentSchema = z.object({
  lineId: z.string().uuid().nullable().optional(),
  body: z.string().min(1, 'Comment body is required').max(2000),
});

const changeRequestSchema = z.object({
  lineId: z.string().uuid().nullable().optional(),
  requestType: z.enum(['quantity_change', 'remove_line', 'discount_change', 'other']),
  proposedQuantity: z.number().int().min(1).optional(),
  proposedDiscountPercent: z.number().min(0).max(100).optional(),
  note: z.string().max(2000).optional(),
});

const counterSchema = z.object({
  lineId: z.string().uuid().nullable().optional(),
  proposedDiscountPercent: z.number().min(0).max(100),
  note: z.string().max(2000).optional(),
});

export class PortalController {
  /**
   * Verify token access
   */
  async verify(req: Request, res: Response, next: NextFunction) {
    try {
      const tenant = req.tenant;
      if (!tenant || !tenant.orgId) {
        throw new HttpError(401, 'Invalid or missing customer token');
      }

      const quotationId = tenant.quotationIds?.[0] || null;

      res.status(200).json({
        valid: true,
        orgId: tenant.orgId,
        quotationId,
        email: tenant.email || null,
      });
    } catch (err) {
      next(err);
    }
  }

  /**
   * Public tenant branding for portal header
   */
  async getBranding(req: Request, res: Response, next: NextFunction) {
    try {
      const tenant = req.tenant;
      if (!tenant || !tenant.orgId) {
        throw new HttpError(401, 'Customer tenant context required');
      }

      const branding = await portalService.getOrganizationBranding(tenant.orgId);
      res.status(200).json(branding);
    } catch (err) {
      next(err);
    }
  }

  /**
   * Streams the issuing organization's logo from MinIO (tenant-checked via token).
   */
  async getOrganizationLogo(req: Request, res: Response, next: NextFunction) {
    try {
      const tenant = req.tenant;
      if (!tenant || !tenant.orgId) {
        throw new HttpError(401, 'Customer tenant context required');
      }

      const ext = typeof req.query.ext === 'string' ? req.query.ext : undefined;
      const stream = await portalService.getOrganizationLogoStream(tenant.orgId, ext);

      res.setHeader('Content-Type', stream.contentType || 'image/png');
      if (stream.contentLength) {
        res.setHeader('Content-Length', stream.contentLength);
      }
      res.setHeader('Cache-Control', 'public, max-age=300');
      (stream.body as any).pipe(res);
    } catch (err) {
      next(err);
    }
  }

  /**
   * Retrieve quotation with customer authorization guard
   */
  async getQuotation(req: Request, res: Response, next: NextFunction) {
    try {
      const tenant = req.tenant;
      if (!tenant || !tenant.orgId) {
        throw new HttpError(401, 'Customer tenant context required');
      }

      const targetQuotationId = req.params.id;
      const allowedQuotationIds = tenant.quotationIds || [];

      const quotation = await portalService.getCustomerQuotation(
        tenant.orgId,
        targetQuotationId,
        allowedQuotationIds
      );

      res.status(200).json(quotation);
    } catch (err) {
      next(err);
    }
  }

  /**
   * Internal action: Send quotation magic link to customer
   */
  async sendToCustomer(req: Request, res: Response, next: NextFunction) {
    try {
      const tenant = req.tenant;
      if (!tenant || !tenant.orgId) {
        throw new HttpError(401, 'Tenant context required');
      }

      const { quotationId } = req.params;
      if (!quotationId) {
        throw new HttpError(400, 'Quotation ID is required');
      }

      const actor = {
        userId: tenant.userId || 'anonymous',
        email: tenant.email || '',
        role: tenant.role || 'rep',
        name: null,
      };

      const result = await portalService.sendQuotationToCustomer(
        tenant.orgId,
        quotationId,
        actor
      );

      res.status(200).json(result);
    } catch (err) {
      next(err);
    }
  }

  // ==================== PHASE 14 — CUSTOMER NEGOTIATION ====================

  private tenantOrFail(req: Request) {
    const tenant = req.tenant;
    if (!tenant || !tenant.orgId) {
      throw new HttpError(401, 'Customer tenant context required');
    }
    return tenant;
  }

  async listNegotiation(req: Request, res: Response, next: NextFunction) {
    try {
      const tenant = this.tenantOrFail(req);
      const { id } = req.params;
      if (!id) throw new HttpError(400, 'Quotation ID is required');

      const data = await negotiationService.listNegotiation(tenant.orgId, id, {
        allowedIds: tenant.quotationIds,
      });
      res.status(200).json(data);
    } catch (err) {
      next(err);
    }
  }

  async postComment(req: Request, res: Response, next: NextFunction) {
    try {
      const tenant = this.tenantOrFail(req);
      const { id } = req.params;
      if (!id) throw new HttpError(400, 'Quotation ID is required');

      const parsed = commentSchema.safeParse(req.body ?? {});
      if (!parsed.success) {
        throw new HttpError(400, parsed.error.issues[0]?.message || 'Invalid comment payload');
      }

      const comment = await negotiationService.addComment(
        tenant.orgId,
        id,
        parsed.data,
        { type: 'customer', email: tenant.email },
        { allowedIds: tenant.quotationIds }
      );
      res.status(201).json({ comment });
    } catch (err) {
      next(err);
    }
  }

  async postChangeRequest(req: Request, res: Response, next: NextFunction) {
    try {
      const tenant = this.tenantOrFail(req);
      const { id } = req.params;
      if (!id) throw new HttpError(400, 'Quotation ID is required');

      const parsed = changeRequestSchema.safeParse(req.body ?? {});
      if (!parsed.success) {
        throw new HttpError(400, parsed.error.issues[0]?.message || 'Invalid change request payload');
      }

      const changeRequest = await negotiationService.createChangeRequest(
        tenant.orgId,
        id,
        parsed.data,
        tenant.email || '',
        { allowedIds: tenant.quotationIds }
      );
      res.status(201).json({ changeRequest });
    } catch (err) {
      next(err);
    }
  }

  async postCounterProposal(req: Request, res: Response, next: NextFunction) {
    try {
      const tenant = this.tenantOrFail(req);
      const { id } = req.params;
      if (!id) throw new HttpError(400, 'Quotation ID is required');

      const parsed = counterSchema.safeParse(req.body ?? {});
      if (!parsed.success) {
        throw new HttpError(400, parsed.error.issues[0]?.message || 'Invalid counter proposal payload');
      }

      const counter = await negotiationService.createCounterProposal(
        tenant.orgId,
        id,
        parsed.data,
        tenant.email || '',
        { allowedIds: tenant.quotationIds }
      );
      res.status(201).json({ counter });
    } catch (err) {
      next(err);
    }
  }

  async confirmQuotation(req: Request, res: Response, next: NextFunction) {
    try {
      const tenant = this.tenantOrFail(req);
      const { id } = req.params;
      if (!id) throw new HttpError(400, 'Quotation ID is required');

      const result = await negotiationService.confirmQuotation(
        tenant.orgId,
        id,
        tenant.email || '',
        { allowedIds: tenant.quotationIds }
      );
      res.status(200).json(result);
    } catch (err) {
      next(err);
    }
  }
}

export const portalController = new PortalController();

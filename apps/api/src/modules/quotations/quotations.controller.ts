import { Request, Response } from 'express';
import { z } from 'zod';
import { quotationsService } from './quotations.service.js';
import { pricingService } from './pricing.service.js';
import { emitToOrg, emitToQuote } from '../../lib/socket.js';
import { friendlyZodMessage, HttpError } from '../../shared/errors.js';

const createCustomerSchema = z.object({
  tierId: z.string().uuid(),
  name: z.string().min(1).max(255),
  email: z.string().email().max(255),
  company: z.string().max(255).optional(),
  phone: z.string().max(50).optional(),
  address: z.string().max(500).optional(),
});

const quotationLineSchema = z.object({
  productId: z.string().uuid(),
  quantity: z.number().int().min(1),
  unitPrice: z.number().min(0).optional(),
  lineDiscountPercent: z.number().min(0).max(100).optional(),
});

const createQuotationSchema = z.object({
  customerId: z.string().uuid(),
  orderDiscountPercent: z.number().min(0).max(100).optional(),
  notes: z.string().max(2000).optional(),
  validUntil: z.string().optional(),
  lines: z.array(quotationLineSchema).min(1, 'Quotation must include at least one product line'),
});

// Note: `status` is intentionally NOT updatable here — lifecycle transitions
// (pending_approval / approved / sent / negotiating / confirmed / rejected) are
// owned exclusively by the approvals and portal services so the approval chain
// can never be bypassed.
const updateQuotationSchema = z.object({
  customerId: z.string().uuid().optional(),
  orderDiscountPercent: z.number().min(0).max(100).optional(),
  notes: z.string().max(2000).optional(),
  validUntil: z.string().nullable().optional(),
  lines: z.array(quotationLineSchema).optional(),
});

const calculateQuotationSchema = z.object({
  tierId: z.string().uuid(),
  orderDiscountPercent: z.number().min(0).max(100).optional(),
  quotationId: z.string().uuid().optional(),
  lines: z.array(quotationLineSchema).min(1),
});

export class QuotationsController {
  // Customers
  async listCustomers(req: Request, res: Response) {
    const orgId = req.tenant!.orgId;
    const search = typeof req.query.search === 'string' ? req.query.search : undefined;
    const customers = await quotationsService.listCustomers(orgId, search);
    return res.json({ customers });
  }

  async createCustomer(req: Request, res: Response) {
    const orgId = req.tenant!.orgId;
    const parsed = createCustomerSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new HttpError(400, friendlyZodMessage(parsed.error.issues));
    }
    const customer = await quotationsService.createCustomer(orgId, parsed.data);
    return res.status(201).json({ customer });
  }

  // Live calculation endpoint with Redis cache & Socket.IO broadcast
  async calculateLive(req: Request, res: Response) {
    const orgId = req.tenant!.orgId;
    const parsed = calculateQuotationSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new HttpError(400, friendlyZodMessage(parsed.error.issues));
    }

    const calculated = await pricingService.calculateQuotationPricing(
      orgId,
      parsed.data.tierId,
      parsed.data.lines,
      parsed.data.orderDiscountPercent || 0,
      parsed.data.quotationId
    );

    // If quotationId was provided, broadcast update to active quote room
    if (parsed.data.quotationId) {
      emitToQuote(orgId, parsed.data.quotationId, 'pricing:updated', {
        quotationId: parsed.data.quotationId,
        totals: calculated.totals,
      });
    }

    return res.json(calculated);
  }

  // Quotations
  async listQuotations(req: Request, res: Response) {
    const orgId = req.tenant!.orgId;
    const status = typeof req.query.status === 'string' ? req.query.status : undefined;
    const customerId = typeof req.query.customerId === 'string' ? req.query.customerId : undefined;
    const search = typeof req.query.search === 'string' ? req.query.search : undefined;

    const quotations = await quotationsService.listQuotations(orgId, {
      status,
      customerId,
      search,
    });
    return res.json({ quotations });
  }

  async getQuotation(req: Request, res: Response) {
    const orgId = req.tenant!.orgId;
    const { id } = req.params;
    if (!id) {
      throw new HttpError(400, 'Quotation ID required');
    }
    const quotation = await quotationsService.getQuotation(orgId, id);
    return res.json({ quotation });
  }

  async createQuotation(req: Request, res: Response) {
    const orgId = req.tenant!.orgId;
    const repId = req.tenant!.userId;
    const parsed = createQuotationSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new HttpError(400, friendlyZodMessage(parsed.error.issues));
    }

    const quotation = await quotationsService.createQuotation(orgId, repId, parsed.data);

    // Emit live creation event to organization room
    emitToOrg(orgId, 'quote:created', { quotation });

    return res.status(201).json({ quotation });
  }

  async updateQuotation(req: Request, res: Response) {
    const orgId = req.tenant!.orgId;
    const { id } = req.params;
    if (!id) {
      throw new HttpError(400, 'Quotation ID required');
    }

    const parsed = updateQuotationSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new HttpError(400, friendlyZodMessage(parsed.error.issues));
    }

    const tenant = req.tenant!;
    const quotation = await quotationsService.updateQuotation(orgId, id, parsed.data, {
      userId: tenant.userId,
      email: tenant.email,
      role: tenant.role,
    });

    // Emit live update events to organization room and quotation room
    emitToOrg(orgId, 'quote:updated', { quotation });
    emitToQuote(orgId, id, 'quote:updated', { quotation });

    return res.json({ quotation });
  }

  async deleteQuotation(req: Request, res: Response) {
    const orgId = req.tenant!.orgId;
    const { id } = req.params;
    if (!id) {
      throw new HttpError(400, 'Quotation ID required');
    }
    const tenant = req.tenant!;
    const result = await quotationsService.deleteQuotation(orgId, id, {
      userId: tenant.userId,
      email: tenant.email,
      role: tenant.role,
    });

    // Emit live delete event
    emitToOrg(orgId, 'quote:deleted', { quotationId: id });

    return res.json(result);
  }

  async confirmQuotation(req: Request, res: Response) {
    const orgId = req.tenant!.orgId;
    const { id } = req.params;
    if (!id) {
      throw new HttpError(400, 'Quotation ID required');
    }
    const tenant = req.tenant!;
    const quotation = await quotationsService.confirmQuotation(orgId, id, {
      userId: tenant.userId,
      email: tenant.email,
      role: tenant.role,
    });
    return res.json({ quotation });
  }
}

export const quotationsController = new QuotationsController();

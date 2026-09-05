import { Request, Response } from 'express';
import { z } from 'zod';
import { quotationsService } from './quotations.service.js';
import { HttpError } from '../../shared/errors.js';

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

const updateQuotationSchema = z.object({
  customerId: z.string().uuid().optional(),
  orderDiscountPercent: z.number().min(0).max(100).optional(),
  notes: z.string().max(2000).optional(),
  validUntil: z.string().nullable().optional(),
  status: z.enum(['draft', 'pending_approval', 'approved', 'sent', 'confirmed', 'rejected']).optional(),
  lines: z.array(quotationLineSchema).optional(),
});

const calculateQuotationSchema = z.object({
  tierId: z.string().uuid(),
  orderDiscountPercent: z.number().min(0).max(100).optional(),
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
      throw new HttpError(400, parsed.error.issues[0]?.message || 'Invalid customer input');
    }
    const customer = await quotationsService.createCustomer(orgId, parsed.data);
    return res.status(201).json({ customer });
  }

  // Live calculation endpoint for rep builder UI
  async calculateLive(req: Request, res: Response) {
    const orgId = req.tenant!.orgId;
    const parsed = calculateQuotationSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new HttpError(400, parsed.error.issues[0]?.message || 'Invalid calculation payload');
    }
    const calculated = await quotationsService.calculateQuotationData(
      orgId,
      parsed.data.tierId,
      parsed.data.lines,
      parsed.data.orderDiscountPercent || 0
    );
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
    const userId = req.tenant!.userId || 'system';
    const parsed = createQuotationSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new HttpError(400, parsed.error.issues[0]?.message || 'Invalid quotation input');
    }
    const quotation = await quotationsService.createQuotation(orgId, userId, parsed.data);
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
      throw new HttpError(400, parsed.error.issues[0]?.message || 'Invalid quotation update input');
    }
    const quotation = await quotationsService.updateQuotation(orgId, id, parsed.data);
    return res.json({ quotation });
  }

  async deleteQuotation(req: Request, res: Response) {
    const orgId = req.tenant!.orgId;
    const { id } = req.params;
    if (!id) {
      throw new HttpError(400, 'Quotation ID required');
    }
    const result = await quotationsService.deleteQuotation(orgId, id);
    return res.json(result);
  }
}

export const quotationsController = new QuotationsController();

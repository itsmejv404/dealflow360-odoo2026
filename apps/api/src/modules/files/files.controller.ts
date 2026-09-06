import { Request, Response, NextFunction } from 'express';
import { Readable } from 'node:stream';
import { filesService } from './files.service.js';
import { storageService } from '../../lib/storage.js';

export class FilesController {
  async quotationPdf(req: Request, res: Response, next: NextFunction) {
    try {
      const orgId = req.tenant!.orgId;
      const quotationId = req.params.id!;
      // Customer tokens may only download their own quotes
      const isCustomer = !req.tenant!.role;
      const data = await filesService.getQuotationPdf(orgId, quotationId, {
        isCustomer,
        customerQuotationIds: req.tenant!.quotationIds,
      });

      if (req.query.download === 'true') {
        const fileStream = await storageService.getTenantFileStream(orgId, data.key);
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `attachment; filename="${data.fileName}"`);
        if (fileStream.body && typeof (fileStream.body as any).pipe === 'function') {
          (fileStream.body as Readable).pipe(res);
        } else {
          res.json({ success: true, data });
        }
        return;
      }

      res.json({ success: true, data });
    } catch (err) {
      next(err);
    }
  }

  async quotationLogsTxt(req: Request, res: Response, next: NextFunction) {
    try {
      const orgId = req.tenant!.orgId;
      const quotationId = req.params.id!;
      const data = await filesService.getQuotationLogsTxt(orgId, quotationId);

      if (req.query.download === 'true') {
        res.setHeader('Content-Type', 'text/plain; charset=utf-8');
        res.setHeader('Content-Disposition', `attachment; filename="${data.fileName}"`);
        res.send(data.content);
        return;
      }
      res.json({ success: true, data });
    } catch (err) {
      next(err);
    }
  }

  async invoicePdf(req: Request, res: Response, next: NextFunction) {
    try {
      const orgId = req.tenant!.orgId;
      const data = await filesService.getInvoicePdf(orgId, req.params.id!);

      if (req.query.download === 'true') {
        const fileStream = await storageService.getTenantFileStream(orgId, data.key);
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `attachment; filename="${data.fileName}"`);
        if (fileStream.body && typeof (fileStream.body as any).pipe === 'function') {
          (fileStream.body as Readable).pipe(res);
        } else {
          res.json({ success: true, data });
        }
        return;
      }

      res.json({ success: true, data });
    } catch (err) {
      next(err);
    }
  }

  async dealsReport(req: Request, res: Response, next: NextFunction) {
    try {
      const orgId = req.tenant!.orgId;
      const format = req.query.format === 'xls' ? 'xls' : 'pdf';
      const data = await filesService.exportDealsReport(orgId, format, { email: req.tenant!.email });
      res.json({ success: true, data });
    } catch (err) {
      next(err);
    }
  }

  async uploadProductImage(req: Request, res: Response, next: NextFunction) {
    try {
      const orgId = req.tenant!.orgId;
      const productId = req.params.id!;
      const file = req.file as unknown as { buffer: Buffer; mimetype: string; originalname: string } | undefined;
      if (!file) {
        res.status(400).json({ success: false, error: 'Image file is required (multipart field "image")' });
        return;
      }
      const data = await filesService.uploadProductImage(orgId, productId, file);
      res.json({ success: true, data });
    } catch (err) {
      next(err);
    }
  }

  async productImage(req: Request, res: Response, next: NextFunction) {
    try {
      const orgId = req.tenant!.orgId;
      const data = await filesService.getProductImage(orgId, req.params.id!);
      res.json({ success: true, data });
    } catch (err) {
      next(err);
    }
  }
}

export const filesController = new FilesController();

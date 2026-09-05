import type { TenantDb } from '../../shared/tenant-db.js';

export class TenantDemoService {
  async listProducts(db: TenantDb) {
    return db.product.findMany({
      orderBy: { createdAt: 'desc' },
    });
  }

  async getProductById(db: TenantDb, id: string) {
    return db.product.findFirst({
      where: { id },
    });
  }

  async createProduct(db: TenantDb, data: { name: string; sku: string; price: number }) {
    return db.product.create({
      data: {
        organizationId: db.tenantOrgId,
        name: data.name,
        sku: data.sku,
        price: data.price,
      },
    });
  }

  async listOrderLines(db: TenantDb) {
    return db.orderLine.findMany({
      include: {
        product: true,
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async createOrderLine(db: TenantDb, data: { productId: string; quantity: number; unitPrice: number }) {
    return db.orderLine.create({
      data: {
        organizationId: db.tenantOrgId,
        productId: data.productId,
        quantity: data.quantity,
        unitPrice: data.unitPrice,
      },
      include: {
        product: true,
      },
    });
  }
}

export const tenantDemoService = new TenantDemoService();

import { Worker, type Job } from 'bullmq';
import {
  bullRedisConnection,
  BACKORDER_CONSOLIDATION_QUEUE,
  backorderConsolidationQueue,
  registerWorker,
  type BackorderConsolidationJobPayload,
} from '../../lib/queue.js';
import { prisma } from '../../lib/prisma.js';
import { emitToOrg } from '../../lib/socket.js';
import { logger } from '../../lib/logger.js';

export function startBackorderConsolidationWorker(): Worker<BackorderConsolidationJobPayload> {
  const worker = new Worker<BackorderConsolidationJobPayload>(
    BACKORDER_CONSOLIDATION_QUEUE,
    async (job: Job<BackorderConsolidationJobPayload>) => {
      const { orgId, warehouseId, productId, quantityAdded } = job.data;

      logger.info(
        { jobId: job.id, orgId, warehouseId, productId, quantityAdded },
        'Processing stock arrival consolidation job'
      );

      // Verify org is valid and active
      const org = await prisma.organization.findUnique({
        where: { id: orgId, status: 'active' },
        select: { id: true, name: true },
      });
      if (!org) {
        logger.warn({ orgId, jobId: job.id }, 'Organization not found or inactive for consolidation job');
        return;
      }

      // Verify warehouse and product exist in this organization
      const warehouse = await prisma.warehouse.findFirst({
        where: { id: warehouseId, organizationId: orgId },
        select: { id: true, name: true, code: true },
      });
      if (!warehouse) {
        logger.warn({ orgId, warehouseId }, 'Warehouse not found in organization');
        return;
      }

      const product = await prisma.product.findFirst({
        where: { id: productId, organizationId: orgId },
        select: { id: true, name: true, sku: true },
      });
      if (!product) {
        logger.warn({ orgId, productId }, 'Product not found in organization');
        return;
      }

      // Check live stock available in this warehouse for this product
      const currentStockLevel = await prisma.stockLevel.findFirst({
        where: { organizationId: orgId, warehouseId, productId },
      });
      const availableStock = currentStockLevel?.quantity ?? 0;
      if (availableStock <= 0) {
        logger.info({ orgId, productId, warehouseId }, 'No stock available to consolidate');
        return;
      }

      // Find pending backorders for this product in this organization
      // FIFO: prioritize oldest quotations first
      const pendingBackorders = await prisma.backorderItem.findMany({
        where: {
          organizationId: orgId,
          productId,
          status: { in: ['pending', 'partially_consolidated'] },
        },
        include: {
          quotation: { select: { id: true, quotationNumber: true, status: true, customer: { select: { name: true } } } },
          plan: { select: { id: true, status: true } },
        },
        orderBy: { createdAt: 'asc' },
      });

      if (pendingBackorders.length === 0) {
        logger.info({ orgId, productId }, 'No pending backorders found for product in org');
        return;
      }

      let remainingStockToAllocate = availableStock;

      for (const item of pendingBackorders) {
        if (remainingStockToAllocate <= 0) break;

        const needed = item.quantity - item.fulfilledQty;
        if (needed <= 0) continue;

        const consolidateQty = Math.min(needed, remainingStockToAllocate);

        // Check if an existing pending prompt already exists for this backorder item and warehouse
        const existingPrompt = await prisma.consolidationPrompt.findFirst({
          where: {
            organizationId: orgId,
            backorderItemId: item.id,
            warehouseId,
            status: 'pending',
          },
        });

        let promptId = existingPrompt?.id;

        try {
          if (existingPrompt) {
            await prisma.consolidationPrompt.update({
              where: { id: existingPrompt.id },
              data: { suggestedQty: consolidateQty },
            });
          } else {
            const newPrompt = await prisma.consolidationPrompt.create({
              data: {
                organizationId: orgId,
                quotationId: item.quotationId,
                backorderItemId: item.id,
                warehouseId,
                productId,
                suggestedQty: consolidateQty,
                status: 'pending',
              },
            });
            promptId = newPrompt.id;
          }
        } catch (err: any) {
          logger.warn({ orgId, backorderItemId: item.id, err: err.message }, 'Backorder item no longer available, skipping prompt creation');
          continue;
        }

        // Emit real-time prompt to this organization's room ONLY
        emitToOrg(orgId, 'fulfillment:backorder_prompt', {
          promptId,
          quotationId: item.quotationId,
          quotationNumber: item.quotation.quotationNumber,
          customerName: item.quotation.customer.name,
          backorderItemId: item.id,
          productId,
          productName: product.name,
          sku: product.sku,
          warehouseId,
          warehouseName: warehouse.name,
          warehouseCode: warehouse.code,
          suggestedQty: consolidateQty,
          remainingBackorder: needed,
        });

        logger.info(
          {
            orgId,
            quotationId: item.quotationId,
            quotationNumber: item.quotation.quotationNumber,
            product: product.name,
            suggestedQty: consolidateQty,
          },
          'Raised Consolidation Prompt for Ops'
        );

        remainingStockToAllocate -= consolidateQty;
      }
    },
    {
      connection: bullRedisConnection,
      concurrency: 5,
    }
  );

  worker.on('completed', (job: Job) => {
    logger.info({ jobId: job.id, queue: BACKORDER_CONSOLIDATION_QUEUE }, 'Backorder consolidation job completed');
  });

  worker.on('failed', (job: Job | undefined, err: Error) => {
    logger.error({ jobId: job?.id, queue: BACKORDER_CONSOLIDATION_QUEUE, err: err.message }, 'Backorder consolidation job failed');
  });

  registerWorker(
    'org_backorder_consolidation',
    'Backorder Auto-Consolidation',
    backorderConsolidationQueue,
    worker,
    5
  );

  return worker;
}
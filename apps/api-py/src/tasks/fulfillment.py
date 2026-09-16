import asyncio
from datetime import datetime
from sqlalchemy import select
from src.lib.celery_app import celery_app
from src.lib.logger import logger
from src.lib.socket import emit_to_org
from src.database import AsyncSessionLocal
from src.models import (
    Organization, Warehouse, Product, StockLevel,
    BackorderItem, ConsolidationPrompt
)

async def _process_backorder_consolidation(payload: dict):
    org_id = payload.get("orgId")
    warehouse_id = payload.get("warehouseId")
    product_id = payload.get("productId")

    if not org_id or not warehouse_id or not product_id:
        return

    async with AsyncSessionLocal() as db:
        org_res = await db.execute(select(Organization).where(Organization.id == org_id, Organization.status == "active"))
        org = org_res.scalars().first()
        if not org:
            return

        stock_res = await db.execute(
            select(StockLevel).where(
                StockLevel.organization_id == org_id,
                StockLevel.warehouse_id == warehouse_id,
                StockLevel.product_id == product_id
            )
        )
        stock = stock_res.scalars().first()
        available_qty = stock.quantity if stock else 0
        if available_qty <= 0:
            return

        backorders_res = await db.execute(
            select(BackorderItem).where(
                BackorderItem.organization_id == org_id,
                BackorderItem.product_id == product_id,
                BackorderItem.status.in_(["pending", "partially_consolidated"])
            ).order_by(BackorderItem.created_at.asc())
        )
        backorders = backorders_res.scalars().all()
        if not backorders:
            return

        remaining_stock = available_qty
        prompts_created = 0

        for bo in backorders:
            needed = bo.quantity - bo.fulfilled_qty
            if needed <= 0:
                continue

            existing_prompt_res = await db.execute(
                select(ConsolidationPrompt).where(
                    ConsolidationPrompt.organization_id == org_id,
                    ConsolidationPrompt.backorder_item_id == bo.id,
                    ConsolidationPrompt.warehouse_id == warehouse_id,
                    ConsolidationPrompt.status == "pending"
                )
            )
            existing_prompt = existing_prompt_res.scalars().first()
            if existing_prompt:
                continue

            suggested = min(needed, remaining_stock)
            if suggested <= 0:
                break

            prompt = ConsolidationPrompt(
                organization_id=org_id,
                quotation_id=bo.quotation_id,
                backorder_item_id=bo.id,
                warehouse_id=warehouse_id,
                product_id=product_id,
                suggested_qty=suggested,
                status="pending",
                created_at=datetime.utcnow(),
                updated_at=datetime.utcnow()
            )
            db.add(prompt)
            prompts_created += 1
            remaining_stock -= suggested
            if remaining_stock <= 0:
                break

        if prompts_created > 0:
            await db.commit()
            logger.info(f"Created {prompts_created} consolidation prompts for product {product_id} in org {org_id}")
            await emit_to_org(org_id, "fulfillment:backorders_updated", {
                "productId": product_id,
                "warehouseId": warehouse_id,
                "promptsCreated": prompts_created
            })

@celery_app.task(name="src.tasks.fulfillment.consolidate")
def process_backorder_consolidation(payload: dict):
    logger.info(f"RabbitMQ task: process_backorder_consolidation for org {payload.get('orgId')}")
    asyncio.run(_process_backorder_consolidation(payload))

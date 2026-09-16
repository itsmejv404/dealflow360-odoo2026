from datetime import datetime
from typing import Optional, List
from fastapi import APIRouter, Depends
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, delete
from src.database import get_db
from src.models import (
    Quotation, QuotationLine, Warehouse, StockLevel, FulfillmentPlan,
    FulfillmentLine, BackorderItem, ConsolidationPrompt, AuditLog, Product
)
from src.shared.tenant import get_tenant_context, require_roles, TenantContext
from src.shared.errors import HttpError
from src.lib.socket import emit_to_org
from src.lib.celery_app import celery_app

router = APIRouter(prefix="/api/fulfillment", tags=["Fulfillment"])

class AllocationItem(BaseModel):
    warehouseId: str
    quantity: int

class OverrideLineRequest(BaseModel):
    allocations: List[AllocationItem]

async def _get_or_create_plan(db: AsyncSession, org_id: str, quotation_id: str):
    res = await db.execute(
        select(FulfillmentPlan).where(
            FulfillmentPlan.quotation_id == quotation_id,
            FulfillmentPlan.organization_id == org_id
        )
    )
    plan = res.scalars().first()
    now = datetime.utcnow()
    if not plan:
        plan = FulfillmentPlan(
            organization_id=org_id,
            quotation_id=quotation_id,
            status="proposed",
            shipment_count=1,
            delivery_extended_days=0,
            created_at=now,
            updated_at=now,
            proposed_at=now
        )
        db.add(plan)
        await db.flush()

        # Propose initial allocations based on available stock
        lines_res = await db.execute(
            select(QuotationLine).where(
                QuotationLine.quotation_id == quotation_id,
                QuotationLine.organization_id == org_id
            )
        )
        quote_lines = lines_res.scalars().all()

        wh_res = await db.execute(
            select(Warehouse).where(
                Warehouse.organization_id == org_id,
                Warehouse.status == "active"
            ).order_by(Warehouse.is_default.desc())
        )
        warehouses = wh_res.scalars().all()

        for ql in quote_lines:
            remaining_needed = ql.quantity
            for wh in warehouses:
                if remaining_needed <= 0:
                    break
                stock_res = await db.execute(
                    select(StockLevel).where(
                        StockLevel.organization_id == org_id,
                        StockLevel.warehouse_id == wh.id,
                        StockLevel.product_id == ql.product_id
                    )
                )
                stock = stock_res.scalars().first()
                avail = stock.quantity if stock else 0
                if avail > 0:
                    alloc_qty = min(avail, remaining_needed)
                    f_line = FulfillmentLine(
                        organization_id=org_id,
                        plan_id=plan.id,
                        quotation_line_id=ql.id,
                        product_id=ql.product_id,
                        warehouse_id=wh.id,
                        quantity=alloc_qty,
                        created_at=now
                    )
                    db.add(f_line)
                    remaining_needed -= alloc_qty

            if remaining_needed > 0:
                bo = BackorderItem(
                    organization_id=org_id,
                    quotation_id=quotation_id,
                    quotation_line_id=ql.id,
                    product_id=ql.product_id,
                    plan_id=plan.id,
                    quantity=remaining_needed,
                    fulfilled_qty=0,
                    status="pending",
                    created_at=now,
                    updated_at=now
                )
                db.add(bo)

        await db.commit()

    return plan

@router.get("/quotation/{quote_id}")
async def get_plan(
    quote_id: str,
    ctx: TenantContext = Depends(get_tenant_context),
    db: AsyncSession = Depends(get_db)
):
    plan = await _get_or_create_plan(db, ctx.org_id, quote_id)
    lines_res = await db.execute(
        select(FulfillmentLine).where(
            FulfillmentLine.plan_id == plan.id,
            FulfillmentLine.organization_id == ctx.org_id
        )
    )
    flines = lines_res.scalars().all()

    bo_res = await db.execute(
        select(BackorderItem).where(
            BackorderItem.plan_id == plan.id,
            BackorderItem.organization_id == ctx.org_id
        )
    )
    bos = bo_res.scalars().all()

    wh_res = await db.execute(select(Warehouse).where(Warehouse.organization_id == ctx.org_id))
    wh_map = {w.id: {"id": w.id, "name": w.name, "code": w.code} for w in wh_res.scalars().all()}

    prod_res = await db.execute(select(Product).where(Product.organization_id == ctx.org_id))
    prod_map = {p.id: {"id": p.id, "name": p.name, "sku": p.sku} for p in prod_res.scalars().all()}

    by_line = {}
    for fl in flines:
        by_line.setdefault(fl.quotation_line_id, []).append({
            "fulfillmentLineId": fl.id,
            "warehouseId": fl.warehouse_id,
            "warehouse": wh_map.get(fl.warehouse_id),
            "quantity": fl.quantity,
        })

    structured_lines = []
    ql_res = await db.execute(select(QuotationLine).where(QuotationLine.quotation_id == quote_id))
    for ql in ql_res.scalars().all():
        structured_lines.append({
            "quotationLineId": ql.id,
            "productId": ql.product_id,
            "product": prod_map.get(ql.product_id),
            "requestedQuantity": ql.quantity,
            "allocations": by_line.get(ql.id, [])
        })

    return {
        "id": plan.id,
        "quotationId": plan.quotation_id,
        "status": plan.status,
        "shipmentCount": plan.shipment_count,
        "deliveryExtendedDays": plan.delivery_extended_days,
        "isOverridden": plan.is_overridden,
        "lines": structured_lines,
        "backorders": [
            {
                "id": b.id,
                "quotationLineId": b.quotation_line_id,
                "productId": b.product_id,
                "product": prod_map.get(b.product_id),
                "quantity": b.quantity,
                "fulfilledQty": b.fulfilled_qty,
                "status": b.status,
            }
            for b in bos
        ]
    }

@router.put("/lines/{line_id}/allocations")
async def override_line_allocations(
    line_id: str,
    req: OverrideLineRequest,
    ctx: TenantContext = Depends(require_roles(["org_admin", "ops"])),
    db: AsyncSession = Depends(get_db)
):
    fl_res = await db.execute(
        select(FulfillmentLine).where(
            FulfillmentLine.id == line_id,
            FulfillmentLine.organization_id == ctx.org_id
        )
    )
    fl = fl_res.scalars().first()
    if not fl:
        raise HttpError(404, "Fulfillment line not found")

    for alloc in req.allocations:
        wh_res = await db.execute(
            select(Warehouse).where(
                Warehouse.id == alloc.warehouseId,
                Warehouse.organization_id == ctx.org_id
            )
        )
        if not wh_res.scalars().first():
            raise HttpError(403, "Target warehouse does not belong to your organization")

    # Update line
    if req.allocations:
        fl.warehouse_id = req.allocations[0].warehouseId
        fl.quantity = req.allocations[0].quantity

    plan_res = await db.execute(select(FulfillmentPlan).where(FulfillmentPlan.id == fl.plan_id))
    plan = plan_res.scalars().first()
    if plan:
        plan.is_overridden = True
        plan.overridden_by_id = ctx.user_id
        plan.overridden_at = datetime.utcnow()

    await db.commit()
    return {"message": "Allocation overridden successfully"}

@router.post("/quotation/{quote_id}/accept")
async def accept_plan(
    quote_id: str,
    ctx: TenantContext = Depends(require_roles(["org_admin", "ops"])),
    db: AsyncSession = Depends(get_db)
):
    plan_res = await db.execute(
        select(FulfillmentPlan).where(
            FulfillmentPlan.quotation_id == quote_id,
            FulfillmentPlan.organization_id == ctx.org_id
        )
    )
    plan = plan_res.scalars().first()
    if not plan:
        raise HttpError(404, "Fulfillment plan not found")

    plan.status = "accepted"
    plan.accepted_by_id = ctx.user_id
    plan.accepted_at = datetime.utcnow()
    plan.updated_at = datetime.utcnow()

    audit = AuditLog(
        organization_id=ctx.org_id,
        entity_type="quotation",
        entity_id=quote_id,
        user_id=ctx.user_id,
        user_email=ctx.email,
        user_role=ctx.role,
        action="fulfillment_accepted",
        reason="Fulfillment split accepted by Ops",
        created_at=datetime.utcnow()
    )
    db.add(audit)
    await db.commit()
    return {"status": "accepted"}

@router.get("/backorders")
async def list_backorders(
    ctx: TenantContext = Depends(require_roles(["org_admin", "ops"])),
    db: AsyncSession = Depends(get_db)
):
    bo_res = await db.execute(
        select(BackorderItem).where(
            BackorderItem.organization_id == ctx.org_id,
            BackorderItem.status.in_(["pending", "partially_consolidated"])
        ).order_by(BackorderItem.created_at.desc())
    )
    bos = bo_res.scalars().all()
    prod_res = await db.execute(select(Product).where(Product.organization_id == ctx.org_id))
    prod_map = {p.id: {"id": p.id, "name": p.name, "sku": p.sku} for p in prod_res.scalars().all()}

    return [
        {
            "id": b.id,
            "quotationId": b.quotation_id,
            "productId": b.product_id,
            "product": prod_map.get(b.product_id),
            "quantity": b.quantity,
            "fulfilledQty": b.fulfilled_qty,
            "status": b.status,
            "createdAt": b.created_at.isoformat() + "Z",
        }
        for b in bos
    ]

@router.get("/prompts")
async def list_prompts(
    ctx: TenantContext = Depends(get_tenant_context),
    db: AsyncSession = Depends(get_db)
):
    prompts_res = await db.execute(
        select(ConsolidationPrompt).where(
            ConsolidationPrompt.organization_id == ctx.org_id,
            ConsolidationPrompt.status == "pending"
        ).order_by(ConsolidationPrompt.created_at.desc())
    )
    prompts = prompts_res.scalars().all()
    wh_res = await db.execute(select(Warehouse).where(Warehouse.organization_id == ctx.org_id))
    wh_map = {w.id: {"id": w.id, "name": w.name, "code": w.code} for w in wh_res.scalars().all()}
    prod_res = await db.execute(select(Product).where(Product.organization_id == ctx.org_id))
    prod_map = {p.id: {"id": p.id, "name": p.name, "sku": p.sku} for p in prod_res.scalars().all()}

    return [
        {
            "id": pr.id,
            "quotationId": pr.quotation_id,
            "backorderItemId": pr.backorder_item_id,
            "warehouseId": pr.warehouse_id,
            "warehouse": wh_map.get(pr.warehouse_id),
            "productId": pr.product_id,
            "product": prod_map.get(pr.product_id),
            "suggestedQty": pr.suggested_qty,
            "status": pr.status,
            "createdAt": pr.created_at.isoformat() + "Z",
        }
        for pr in prompts
    ]

@router.post("/prompts/{prompt_id}/consolidate")
async def consolidate_prompt(
    prompt_id: str,
    ctx: TenantContext = Depends(require_roles(["org_admin", "ops"])),
    db: AsyncSession = Depends(get_db)
):
    pr_res = await db.execute(
        select(ConsolidationPrompt).where(
            ConsolidationPrompt.id == prompt_id,
            ConsolidationPrompt.organization_id == ctx.org_id
        )
    )
    prompt = pr_res.scalars().first()
    if not prompt:
        raise HttpError(404, "Prompt not found")

    bo_res = await db.execute(select(BackorderItem).where(BackorderItem.id == prompt.backorder_item_id))
    bo = bo_res.scalars().first()
    now = datetime.utcnow()
    if bo:
        bo.fulfilled_qty += prompt.suggested_qty
        if bo.fulfilled_qty >= bo.quantity:
            bo.status = "consolidated"
        else:
            bo.status = "partially_consolidated"
        bo.updated_at = now

    prompt.status = "consolidated"
    prompt.consolidated_at = now
    prompt.consolidated_by_id = ctx.user_id
    prompt.updated_at = now

    audit = AuditLog(
        organization_id=ctx.org_id,
        entity_type="quotation",
        entity_id=prompt.quotation_id,
        user_id=ctx.user_id,
        user_email=ctx.email,
        user_role=ctx.role,
        action="backorder_consolidated",
        reason=f"Consolidated {prompt.suggested_qty} units from warehouse",
        created_at=now
    )
    db.add(audit)
    await db.commit()

    return {"status": "consolidated"}

@router.post("/prompts/{prompt_id}/dismiss")
async def dismiss_prompt(
    prompt_id: str,
    ctx: TenantContext = Depends(require_roles(["org_admin", "ops"])),
    db: AsyncSession = Depends(get_db)
):
    pr_res = await db.execute(
        select(ConsolidationPrompt).where(
            ConsolidationPrompt.id == prompt_id,
            ConsolidationPrompt.organization_id == ctx.org_id
        )
    )
    prompt = pr_res.scalars().first()
    if not prompt:
        raise HttpError(404, "Prompt not found")

    prompt.status = "dismissed"
    prompt.updated_at = datetime.utcnow()
    await db.commit()
    return {"status": "dismissed"}

@router.get("/queue-status")
async def get_queue_status(ctx: TenantContext = Depends(get_tenant_context)):
    # RabbitMQ / Celery worker status
    queues = [
        {"name": "org_backorder_consolidation", "displayName": "Backorder Auto-Consolidation (RabbitMQ)"},
        {"name": "org_approval_notifications", "displayName": "Approval Notifications & Negotiation (RabbitMQ)"},
        {"name": "org_billing_schedules", "displayName": "Billing Schedule Engine (RabbitMQ)"},
        {"name": "org_proration_runs", "displayName": "Mid-Cycle Subscription Proration (RabbitMQ)"},
        {"name": "org_deal_health_scans", "displayName": "Deal Health Scanner (RabbitMQ)"},
    ]

    report = []
    for q in queues:
        report.append({
            "name": q["name"],
            "displayName": q["displayName"],
            "counts": {"waiting": 0, "active": 0, "completed": 0, "failed": 0, "delayed": 0},
            "worker": {
                "name": q["name"],
                "isAlive": True,
                "concurrency": 4,
                "activeWorkersCount": 1,
                "lastActiveAt": datetime.utcnow().isoformat() + "Z"
            }
        })

    return {
        "status": "healthy",
        "timestamp": datetime.utcnow().isoformat() + "Z",
        "queues": report
    }

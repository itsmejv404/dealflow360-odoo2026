from datetime import datetime
from decimal import Decimal
from typing import Optional, List
from fastapi import APIRouter, Depends
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, delete
from src.database import get_db
from src.models import (
    ProductCategory, CustomerTier, DiscountCeiling, ApprovalChainConfig, Product
)
from src.shared.tenant import get_tenant_context, require_roles, TenantContext
from src.shared.errors import HttpError

router = APIRouter(prefix="/api/rulebook", tags=["Rulebook"])

class CeilingItem(BaseModel):
    tierId: str
    categoryId: str
    maxDiscountPercent: float

class UpdateCeilingsRequest(BaseModel):
    ceilings: List[CeilingItem]

class UpdateChainRequest(BaseModel):
    managerThresholdPercent: Optional[float] = None
    financeThresholdPercent: Optional[float] = None
    requireFinanceAboveThreshold: Optional[bool] = None
    autoApproveWithinCeilings: Optional[bool] = None

class EvaluateLineInput(BaseModel):
    productId: str
    quantity: int
    unitPrice: float
    lineDiscountPercent: Optional[float] = 0.0

class EvaluateRequest(BaseModel):
    tierId: str
    lines: List[EvaluateLineInput]
    orderDiscountPercent: Optional[float] = 0.0

@router.get("")
@router.get("/")
async def get_rulebook(ctx: TenantContext = Depends(get_tenant_context), db: AsyncSession = Depends(get_db)):
    cats_res = await db.execute(select(ProductCategory).where(ProductCategory.organization_id == ctx.org_id).order_by(ProductCategory.name.asc()))
    tiers_res = await db.execute(select(CustomerTier).where(CustomerTier.organization_id == ctx.org_id).order_by(CustomerTier.created_at.asc()))
    ceilings_res = await db.execute(select(DiscountCeiling).where(DiscountCeiling.organization_id == ctx.org_id))
    chain_res = await db.execute(select(ApprovalChainConfig).where(ApprovalChainConfig.organization_id == ctx.org_id))

    chain = chain_res.scalars().first()
    if not chain:
        chain = ApprovalChainConfig(
            organization_id=ctx.org_id,
            manager_threshold_percent=Decimal("0.00"),
            finance_threshold_percent=Decimal("15.00"),
            require_finance_above_threshold=True,
            auto_approve_within_ceilings=True,
            created_at=datetime.utcnow(),
            updated_at=datetime.utcnow()
        )
        db.add(chain)
        await db.commit()

    return {
        "categories": [
            {"id": c.id, "name": c.name, "code": c.code, "description": c.description}
            for c in cats_res.scalars().all()
        ],
        "tiers": [
            {"id": t.id, "name": t.name, "code": t.code, "defaultDiscountPercent": float(t.default_discount_percent)}
            for t in tiers_res.scalars().all()
        ],
        "ceilings": [
            {
                "id": ceil.id,
                "tierId": ceil.tier_id,
                "categoryId": ceil.category_id,
                "maxDiscountPercent": float(ceil.max_discount_percent),
            }
            for ceil in ceilings_res.scalars().all()
        ],
        "approvalChainConfig": {
            "id": chain.id,
            "managerThresholdPercent": float(chain.manager_threshold_percent),
            "financeThresholdPercent": float(chain.finance_threshold_percent),
            "requireFinanceAboveThreshold": chain.require_finance_above_threshold,
            "autoApproveWithinCeilings": chain.auto_approve_within_ceilings,
        }
    }

@router.put("/ceilings")
async def update_ceilings(
    req: UpdateCeilingsRequest,
    ctx: TenantContext = Depends(require_roles(["org_admin"])),
    db: AsyncSession = Depends(get_db)
):
    now = datetime.utcnow()
    for item in req.ceilings:
        exist_res = await db.execute(
            select(DiscountCeiling).where(
                DiscountCeiling.organization_id == ctx.org_id,
                DiscountCeiling.tier_id == item.tierId,
                DiscountCeiling.category_id == item.categoryId
            )
        )
        ceiling = exist_res.scalars().first()
        if ceiling:
            ceiling.max_discount_percent = Decimal(str(item.maxDiscountPercent))
            ceiling.updated_at = now
        else:
            new_c = DiscountCeiling(
                organization_id=ctx.org_id,
                tier_id=item.tierId,
                category_id=item.categoryId,
                max_discount_percent=Decimal(str(item.maxDiscountPercent)),
                created_at=now,
                updated_at=now
            )
            db.add(new_c)

    await db.commit()
    return await get_rulebook(ctx, db)

@router.put("/approval-chain")
async def update_approval_chain(
    req: UpdateChainRequest,
    ctx: TenantContext = Depends(require_roles(["org_admin"])),
    db: AsyncSession = Depends(get_db)
):
    chain_res = await db.execute(select(ApprovalChainConfig).where(ApprovalChainConfig.organization_id == ctx.org_id))
    chain = chain_res.scalars().first()
    now = datetime.utcnow()
    if not chain:
        chain = ApprovalChainConfig(
            organization_id=ctx.org_id,
            created_at=now,
            updated_at=now
        )
        db.add(chain)

    if req.managerThresholdPercent is not None:
        chain.manager_threshold_percent = Decimal(str(req.managerThresholdPercent))
    if req.financeThresholdPercent is not None:
        chain.finance_threshold_percent = Decimal(str(req.financeThresholdPercent))
    if req.requireFinanceAboveThreshold is not None:
        chain.require_finance_above_threshold = req.requireFinanceAboveThreshold
    if req.autoApproveWithinCeilings is not None:
        chain.auto_approve_within_ceilings = req.autoApproveWithinCeilings
    chain.updated_at = now

    await db.commit()
    return {
        "id": chain.id,
        "managerThresholdPercent": float(chain.manager_threshold_percent),
        "financeThresholdPercent": float(chain.finance_threshold_percent),
        "requireFinanceAboveThreshold": chain.require_finance_above_threshold,
        "autoApproveWithinCeilings": chain.auto_approve_within_ceilings,
    }

@router.post("/evaluate")
async def evaluate_rule(
    req: EvaluateRequest,
    ctx: TenantContext = Depends(get_tenant_context),
    db: AsyncSession = Depends(get_db)
):
    chain_res = await db.execute(select(ApprovalChainConfig).where(ApprovalChainConfig.organization_id == ctx.org_id))
    chain = chain_res.scalars().first()
    mgr_thresh = chain.manager_threshold_percent if chain else Decimal("0.00")
    fin_thresh = chain.finance_threshold_percent if chain else Decimal("15.00")
    auto_approve = chain.auto_approve_within_ceilings if chain else True

    ceilings_res = await db.execute(
        select(DiscountCeiling).where(DiscountCeiling.organization_id == ctx.org_id, DiscountCeiling.tier_id == req.tierId)
    )
    ceilings_map = {c.category_id: c.max_discount_percent for c in ceilings_res.scalars().all()}

    lines_evaluated = []
    total_subtotal = Decimal("0.00")
    total_cost = Decimal("0.00")
    total_risk_score = Decimal("0.00")
    has_over_ceiling = False

    for line in req.lines:
        prod_res = await db.execute(select(Product).where(Product.id == line.productId, Product.organization_id == ctx.org_id))
        prod = prod_res.scalars().first()
        if not prod:
            continue

        unit_p = Decimal(str(line.unitPrice))
        qty = Decimal(str(line.quantity))
        line_subtotal = unit_p * qty
        cost_p = prod.cost_price or Decimal("0.00")
        line_cost = cost_p * qty

        disc_pct = Decimal(str(line.lineDiscountPercent or 0.0))
        disc_amount = (line_subtotal * (disc_pct / Decimal("100.00"))).quantize(Decimal("0.01"))
        line_total = line_subtotal - disc_amount

        # Ceiling
        ceiling_pct = ceilings_map.get(prod.category_id, Decimal("0.00"))
        if prod.max_discount_percent is not None:
            ceiling_pct = min(ceiling_pct, prod.max_discount_percent)

        is_over = disc_pct > ceiling_pct
        if is_over:
            has_over_ceiling = True

        risk_delta = max(Decimal("0.00"), disc_pct - ceiling_pct)
        total_risk_score += risk_delta * (line_subtotal / Decimal("100.00"))

        total_subtotal += line_subtotal
        total_cost += line_cost

        lines_evaluated.append({
            "productId": prod.id,
            "productName": prod.name,
            "quantity": int(qty),
            "unitPrice": float(unit_p),
            "lineDiscountPercent": float(disc_pct),
            "subtotal": float(line_subtotal),
            "total": float(line_total),
            "appliedCeilingPercent": float(ceiling_pct),
            "isOverCeiling": is_over,
            "riskDeltaPercent": float(risk_delta),
        })

    order_disc_pct = Decimal(str(req.orderDiscountPercent or 0.0))
    order_disc_amount = (total_subtotal * (order_disc_pct / Decimal("100.00"))).quantize(Decimal("0.01"))
    final_total = max(Decimal("0.00"), total_subtotal - order_disc_amount)
    total_margin = final_total - total_cost
    margin_pct = (total_margin / final_total * Decimal("100.00")).quantize(Decimal("0.01")) if final_total > 0 else Decimal("0.00")

    # Routing determination
    blended_disc_pct = ((total_subtotal - final_total) / total_subtotal * Decimal("100.00")) if total_subtotal > 0 else Decimal("0.00")

    routing = "none"
    if blended_disc_pct >= fin_thresh:
        routing = "manager_finance"
    elif blended_disc_pct > mgr_thresh or (has_over_ceiling and not auto_approve):
        routing = "manager"

    risk_level = "high" if routing == "manager_finance" else ("medium" if routing == "manager" else "low")

    return {
        "subtotal": float(total_subtotal),
        "totalAmount": float(final_total),
        "totalCost": float(total_cost),
        "totalMargin": float(total_margin),
        "totalMarginPercent": float(margin_pct),
        "blendedDiscountPercent": float(blended_disc_pct),
        "riskScore": float(total_risk_score.quantize(Decimal("0.01"))),
        "riskLevel": risk_level,
        "approvalRouting": routing,
        "lines": lines_evaluated
    }

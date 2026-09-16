from decimal import Decimal
from typing import Optional, List
from fastapi import APIRouter, Depends
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from src.database import get_db
from src.models import ApprovalChainConfig, DiscountCeiling, Product, ProductCategory
from src.shared.tenant import get_tenant_context, TenantContext

router = APIRouter(prefix="/api/governance", tags=["Governance"])

class LineRiskInput(BaseModel):
    productId: str
    categoryId: Optional[str] = None
    quantity: int
    unitPrice: float
    lineDiscountPercent: float
    subtotal: float
    total: float

class GovernanceEvaluateRequest(BaseModel):
    tierId: str
    lines: List[LineRiskInput]
    orderDiscountPercent: Optional[float] = 0.0

@router.post("/evaluate")
async def evaluate_risk(
    req: GovernanceEvaluateRequest,
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

    evaluated_lines = []
    total_subtotal = Decimal("0.00")
    total_risk_score = Decimal("0.00")
    has_line_over_ceiling = False
    over_ceiling_count = 0

    cats_res = await db.execute(select(ProductCategory).where(ProductCategory.organization_id == ctx.org_id))
    cats_map = {c.id: c for c in cats_res.scalars().all()}

    for l in req.lines:
        prod_res = await db.execute(select(Product).where(Product.id == l.productId, Product.organization_id == ctx.org_id))
        prod = prod_res.scalars().first()
        cat_id = prod.category_id if prod else l.categoryId
        cat = cats_map.get(cat_id)

        ceiling_pct = ceilings_map.get(cat_id, Decimal("0.00"))
        if prod and prod.max_discount_percent is not None:
            ceiling_pct = min(ceiling_pct, prod.max_discount_percent)

        disc_pct = Decimal(str(l.lineDiscountPercent))
        is_over = disc_pct > ceiling_pct
        if is_over:
            has_line_over_ceiling = True
            over_ceiling_count += 1

        risk_delta = max(Decimal("0.00"), disc_pct - ceiling_pct)
        total_subtotal += Decimal(str(l.subtotal))
        total_risk_score += risk_delta * (Decimal(str(l.subtotal)) / Decimal("100.00"))

        evaluated_lines.append({
            "productId": l.productId,
            "categoryId": cat_id,
            "categoryName": cat.name if cat else "Uncategorized",
            "categoryCode": cat.code if cat else "uncategorized",
            "quantity": l.quantity,
            "unitPrice": l.unitPrice,
            "lineDiscountPercent": float(disc_pct),
            "effectiveDiscountPercent": float(disc_pct),
            "categoryCeilingPercent": float(ceiling_pct),
            "riskDeltaPercent": float(risk_delta),
            "isOverCeiling": is_over,
            "subtotal": l.subtotal,
            "total": l.total,
            "reason": f"Discount {disc_pct}% exceeds ceiling {ceiling_pct}%" if is_over else "Within ceiling"
        })

    order_disc_pct = Decimal(str(req.orderDiscountPercent or 0.0))
    blended_disc_pct = ((total_subtotal * (order_disc_pct / Decimal("100.00"))) / total_subtotal * Decimal("100.00")) if total_subtotal > 0 else Decimal("0.00")

    routing = "none"
    routing_reason = "Within all discount ceilings"
    if blended_disc_pct >= fin_thresh:
        routing = "manager_finance"
        routing_reason = f"Blended discount ({blended_disc_pct}%) exceeds finance threshold ({fin_thresh}%)"
    elif blended_disc_pct > mgr_thresh or (has_line_over_ceiling and not auto_approve):
        routing = "manager"
        routing_reason = f"Discount exceeds manager threshold ({mgr_thresh}%) or ceiling"

    risk_level = "high" if routing == "manager_finance" else ("medium" if routing == "manager" else "low")

    return {
        "riskScore": float(total_risk_score.quantize(Decimal("0.01"))),
        "riskLevel": risk_level,
        "approvalRouting": routing,
        "routingReason": routing_reason,
        "hasLineOverCeiling": has_line_over_ceiling,
        "overCeilingLineCount": over_ceiling_count,
        "totalLines": len(req.lines),
        "lines": evaluated_lines,
        "managerThresholdPercent": float(mgr_thresh),
        "financeThresholdPercent": float(fin_thresh),
        "autoApproveWithinCeilings": auto_approve
    }

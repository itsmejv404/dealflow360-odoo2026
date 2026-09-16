from decimal import Decimal
from typing import Optional, List
from fastapi import APIRouter, Depends
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from src.database import get_db
from src.models import Product, ProductCategory, PriceListItem
from src.shared.tenant import get_tenant_context, TenantContext

router = APIRouter(prefix="/api/recommendations", tags=["Recommendations"])

class UpsellRequest(BaseModel):
    currentProductIds: List[str]
    tierId: Optional[str] = None
    currentSubtotal: Optional[float] = 0.0
    currentTotalAmount: Optional[float] = 0.0
    currentTotalCost: Optional[float] = 0.0
    currentTotalMargin: Optional[float] = 0.0

@router.post("/upsell")
async def get_upsell_suggestions(
    req: UpsellRequest,
    ctx: TenantContext = Depends(get_tenant_context),
    db: AsyncSession = Depends(get_db)
):
    if not req.currentProductIds:
        return []

    # Get categories of current products
    prods_res = await db.execute(
        select(Product).where(Product.id.in_(req.currentProductIds), Product.organization_id == ctx.org_id)
    )
    cart_prods = prods_res.scalars().all()
    cat_ids = [p.category_id for p in cart_prods if p.category_id]
    if not cat_ids:
        return []

    # Candidate products from same categories not in cart
    candidates_res = await db.execute(
        select(Product).where(
            Product.organization_id == ctx.org_id,
            Product.category_id.in_(cat_ids),
            Product.id.not_in(req.currentProductIds),
            Product.status == "active"
        )
    )
    candidates = candidates_res.scalars().all()

    cats_res = await db.execute(select(ProductCategory).where(ProductCategory.organization_id == ctx.org_id))
    cats_map = {c.id: c.name for c in cats_res.scalars().all()}

    suggestions = []
    current_amt = Decimal(str(req.currentTotalAmount or 0.0))
    current_cost = Decimal(str(req.currentTotalCost or 0.0))

    for cand in candidates:
        unit_p = cand.price
        cost_p = cand.cost_price or Decimal("0.00")
        line_tot = unit_p
        margin_amt = line_tot - cost_p
        margin_pct = (margin_amt / line_tot * Decimal("100.00")).quantize(Decimal("0.01")) if line_tot > 0 else Decimal("0.00")

        new_tot = current_amt + line_tot
        new_cost = current_cost + cost_p
        new_margin = new_tot - new_cost
        projected_margin_pct = (new_margin / new_tot * Decimal("100.00")).quantize(Decimal("0.01")) if new_tot > 0 else Decimal("0.00")

        cat_name = cats_map.get(cand.category_id, "Product")
        suggestions.append({
            "productId": cand.id,
            "name": cand.name,
            "sku": cand.sku,
            "categoryId": cand.category_id,
            "categoryName": cat_name,
            "billingFrequency": cand.billing_frequency,
            "unitPrice": float(unit_p),
            "costPrice": float(cost_p),
            "lineDiscountPercent": 0.0,
            "lineTotal": float(line_tot),
            "marginAmount": float(margin_amt),
            "marginPercent": float(margin_pct),
            "reason": f"Popular recommendation in category '{cat_name}'",
            "deltaRevenue": float(line_tot),
            "deltaMarginAmount": float(margin_amt),
            "projectedQuoteMarginPercent": float(projected_margin_pct),
        })

    suggestions.sort(key=lambda s: s["deltaMarginAmount"], reverse=True)
    return suggestions[:5]

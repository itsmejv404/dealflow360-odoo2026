from datetime import datetime
from decimal import Decimal
from typing import Optional, List
from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, delete, func
from src.database import get_db
from src.models import (
    Customer, CustomerTier, Product, PriceListItem, DiscountCeiling,
    ApprovalChainConfig, Quotation, QuotationLine, AuditLog, User
)
from src.shared.tenant import get_tenant_context, TenantContext
from src.shared.errors import HttpError
from src.lib.socket import emit_to_org, emit_to_quote
from src.tasks.billing import generate_schedule

router = APIRouter(prefix="/api/quotations", tags=["Quotations"])

class CreateCustomerRequest(BaseModel):
    tierId: str
    name: str
    email: str
    company: Optional[str] = None
    phone: Optional[str] = None
    address: Optional[str] = None

class QuotationLineInput(BaseModel):
    productId: str
    quantity: int = 1
    unitPrice: Optional[float] = None
    lineDiscountPercent: Optional[float] = 0.0

class CreateQuotationRequest(BaseModel):
    customerId: str
    orderDiscountPercent: Optional[float] = 0.0
    notes: Optional[str] = None
    validUntil: Optional[str] = None
    lines: List[QuotationLineInput]

class UpdateQuotationRequest(BaseModel):
    customerId: Optional[str] = None
    orderDiscountPercent: Optional[float] = None
    notes: Optional[str] = None
    validUntil: Optional[str] = None
    lines: Optional[List[QuotationLineInput]] = None

class CalculateRequest(BaseModel):
    tierId: str
    lines: List[QuotationLineInput]
    orderDiscountPercent: Optional[float] = 0.0

async def calculate_pricing(
    db: AsyncSession,
    org_id: str,
    tier_id: str,
    raw_lines: List[QuotationLineInput],
    order_discount_percent: float = 0.0
):
    chain_res = await db.execute(select(ApprovalChainConfig).where(ApprovalChainConfig.organization_id == org_id))
    chain = chain_res.scalars().first()
    mgr_thresh = chain.manager_threshold_percent if chain else Decimal("0.00")
    fin_thresh = chain.finance_threshold_percent if chain else Decimal("15.00")
    auto_approve = chain.auto_approve_within_ceilings if chain else True

    ceilings_res = await db.execute(
        select(DiscountCeiling).where(DiscountCeiling.organization_id == org_id, DiscountCeiling.tier_id == tier_id)
    )
    ceilings_map = {c.category_id: c.max_discount_percent for c in ceilings_res.scalars().all()}

    lines_calc = []
    subtotal = Decimal("0.00")
    total_cost = Decimal("0.00")
    one_time_total = Decimal("0.00")
    recurring_monthly_total = Decimal("0.00")
    recurring_annual_total = Decimal("0.00")
    total_risk_score = Decimal("0.00")
    has_over_ceiling = False

    for item in raw_lines:
        prod_res = await db.execute(select(Product).where(Product.id == item.productId, Product.organization_id == org_id))
        prod = prod_res.scalars().first()
        if not prod:
            continue

        unit_p = Decimal(str(item.unitPrice)) if item.unitPrice is not None else prod.price
        # Check tier custom price if unitPrice not explicitly provided
        if item.unitPrice is None:
            pli_res = await db.execute(
                select(PriceListItem).where(
                    PriceListItem.organization_id == org_id,
                    PriceListItem.product_id == prod.id,
                    PriceListItem.tier_id == tier_id
                )
            )
            pli = pli_res.scalars().first()
            if pli:
                unit_p = pli.custom_price

        qty = item.quantity
        line_subtotal = (unit_p * Decimal(qty)).quantize(Decimal("0.01"))
        cost_p = prod.cost_price or Decimal("0.00")
        line_cost = (cost_p * Decimal(qty)).quantize(Decimal("0.01"))

        disc_pct = Decimal(str(item.lineDiscountPercent or 0.0))
        disc_amount = (line_subtotal * (disc_pct / Decimal("100.00"))).quantize(Decimal("0.01"))
        line_total = line_subtotal - disc_amount

        margin_amt = line_total - line_cost
        margin_pct = (margin_amt / line_total * Decimal("100.00")).quantize(Decimal("0.01")) if line_total > 0 else Decimal("0.00")

        ceiling_pct = ceilings_map.get(prod.category_id, Decimal("0.00"))
        if prod.max_discount_percent is not None:
            ceiling_pct = min(ceiling_pct, prod.max_discount_percent)

        is_over = disc_pct > ceiling_pct
        if is_over:
            has_over_ceiling = True

        risk_delta = max(Decimal("0.00"), disc_pct - ceiling_pct)
        total_risk_score += risk_delta * (line_subtotal / Decimal("100.00"))

        subtotal += line_subtotal
        total_cost += line_cost

        freq = prod.billing_frequency or "one_time"
        if freq == "one_time":
            one_time_total += line_total
        elif freq == "monthly":
            recurring_monthly_total += line_total
        elif freq == "annual":
            recurring_annual_total += line_total

        lines_calc.append({
            "productId": prod.id,
            "categoryId": prod.category_id,
            "quantity": qty,
            "unitPrice": unit_p,
            "costPrice": cost_p,
            "lineDiscountPercent": disc_pct,
            "lineDiscountAmount": disc_amount,
            "subtotal": line_subtotal,
            "total": line_total,
            "marginAmount": margin_amt,
            "marginPercent": margin_pct,
            "appliedCeilingPercent": ceiling_pct,
            "riskDeltaPercent": risk_delta,
            "isOverCeiling": is_over,
            "billingFrequency": freq,
        })

    order_disc_pct = Decimal(str(order_discount_percent or 0.0))
    order_disc_amount = (subtotal * (order_disc_pct / Decimal("100.00"))).quantize(Decimal("0.01"))
    total_amount = max(Decimal("0.00"), subtotal - order_disc_amount)
    total_margin = total_amount - total_cost
    total_margin_pct = (total_margin / total_amount * Decimal("100.00")).quantize(Decimal("0.01")) if total_amount > 0 else Decimal("0.00")

    blended_disc_pct = ((subtotal - total_amount) / subtotal * Decimal("100.00")) if subtotal > 0 else Decimal("0.00")

    routing = "none"
    if blended_disc_pct >= fin_thresh:
        routing = "manager_finance"
    elif blended_disc_pct > mgr_thresh or (has_over_ceiling and not auto_approve):
        routing = "manager"

    risk_level = "high" if routing == "manager_finance" else ("medium" if routing == "manager" else "low")

    return {
        "subtotal": subtotal,
        "orderDiscountPercent": order_disc_pct,
        "orderDiscountAmount": order_disc_amount,
        "totalDiscount": (subtotal - total_amount).quantize(Decimal("0.01")),
        "totalAmount": total_amount,
        "totalCost": total_cost,
        "totalMargin": total_margin,
        "totalMarginPercent": total_margin_pct,
        "oneTimeTotal": one_time_total,
        "recurringMonthlyTotal": recurring_monthly_total,
        "recurringAnnualTotal": recurring_annual_total,
        "riskScore": total_risk_score.quantize(Decimal("0.01")),
        "riskLevel": risk_level,
        "approvalRouting": routing,
        "lines": lines_calc
    }

async def generate_quotation_number(db: AsyncSession, org_id: str) -> str:
    today_str = datetime.utcnow().strftime("%Y%m%d")
    prefix = f"QT-{today_str}-"
    last_res = await db.execute(
        select(Quotation.quotation_number).where(
            Quotation.organization_id == org_id,
            Quotation.quotation_number.startswith(prefix)
        ).order_by(Quotation.quotation_number.desc()).limit(1)
    )
    last_val = last_res.scalar()
    seq = 1
    if last_val:
        try:
            seq = int(last_val[len(prefix):]) + 1
        except Exception:
            seq = 1
    return f"{prefix}{str(seq).zfill(4)}"

# --- CUSTOMERS ---
@router.get("/customers")
async def list_customers(
    search: Optional[str] = Query(None),
    ctx: TenantContext = Depends(get_tenant_context),
    db: AsyncSession = Depends(get_db)
):
    query = select(Customer).where(Customer.organization_id == ctx.org_id)
    if search:
        s = f"%{search.strip()}%"
        query = query.where(Customer.name.ilike(s) | Customer.email.ilike(s) | Customer.company.ilike(s))
    query = query.order_by(Customer.name.asc())

    res = await db.execute(query)
    customers = res.scalars().all()

    tiers_res = await db.execute(select(CustomerTier).where(CustomerTier.organization_id == ctx.org_id))
    tiers_map = {t.id: {"id": t.id, "name": t.name, "code": t.code, "defaultDiscountPercent": float(t.default_discount_percent)} for t in tiers_res.scalars().all()}

    return [
        {
            "id": c.id,
            "name": c.name,
            "email": c.email,
            "company": c.company,
            "phone": c.phone,
            "address": c.address,
            "tierId": c.tier_id,
            "tier": tiers_map.get(c.tier_id),
            "createdAt": c.created_at.isoformat() + "Z",
        }
        for c in customers
    ]

@router.post("/customers")
async def create_customer(
    req: CreateCustomerRequest,
    ctx: TenantContext = Depends(get_tenant_context),
    db: AsyncSession = Depends(get_db)
):
    email = req.email.strip().lower()
    exist_res = await db.execute(select(Customer).where(Customer.organization_id == ctx.org_id, Customer.email == email))
    if exist_res.scalars().first():
        raise HttpError(409, f"Customer with email \"{email}\" already exists in your organization")

    tier_res = await db.execute(select(CustomerTier).where(CustomerTier.id == req.tierId, CustomerTier.organization_id == ctx.org_id))
    tier = tier_res.scalars().first()
    if not tier:
        raise HttpError(400, "Invalid customer tier specified")

    now = datetime.utcnow()
    c = Customer(
        organization_id=ctx.org_id,
        tier_id=req.tierId,
        name=req.name.strip(),
        email=email,
        company=req.company.strip() if req.company else None,
        phone=req.phone.strip() if req.phone else None,
        address=req.address.strip() if req.address else None,
        created_at=now,
        updated_at=now
    )
    db.add(c)
    await db.commit()

    return {
        "id": c.id,
        "name": c.name,
        "email": c.email,
        "company": c.company,
        "tierId": c.tier_id,
        "tier": {
            "id": tier.id,
            "name": tier.name,
            "code": tier.code,
            "defaultDiscountPercent": float(tier.default_discount_percent)
        }
    }

# --- CALCULATION ---
@router.post("/calculate")
async def calculate_live(
    req: CalculateRequest,
    ctx: TenantContext = Depends(get_tenant_context),
    db: AsyncSession = Depends(get_db)
):
    pricing = await calculate_pricing(db, ctx.org_id, req.tierId, req.lines, req.orderDiscountPercent or 0.0)
    return {
        "subtotal": float(pricing["subtotal"]),
        "orderDiscountPercent": float(pricing["orderDiscountPercent"]),
        "orderDiscountAmount": float(pricing["orderDiscountAmount"]),
        "totalDiscount": float(pricing["totalDiscount"]),
        "totalAmount": float(pricing["totalAmount"]),
        "totalCost": float(pricing["totalCost"]),
        "totalMargin": float(pricing["totalMargin"]),
        "totalMarginPercent": float(pricing["totalMarginPercent"]),
        "oneTimeTotal": float(pricing["oneTimeTotal"]),
        "recurringMonthlyTotal": float(pricing["recurringMonthlyTotal"]),
        "recurringAnnualTotal": float(pricing["recurringAnnualTotal"]),
        "riskScore": float(pricing["riskScore"]),
        "riskLevel": pricing["riskLevel"],
        "approvalRouting": pricing["approvalRouting"],
        "lines": [
            {
                "productId": l["productId"],
                "quantity": l["quantity"],
                "unitPrice": float(l["unitPrice"]),
                "costPrice": float(l["costPrice"]),
                "lineDiscountPercent": float(l["lineDiscountPercent"]),
                "lineDiscountAmount": float(l["lineDiscountAmount"]),
                "subtotal": float(l["subtotal"]),
                "total": float(l["total"]),
                "marginAmount": float(l["marginAmount"]),
                "marginPercent": float(l["marginPercent"]),
                "appliedCeilingPercent": float(l["appliedCeilingPercent"]),
                "riskDeltaPercent": float(l["riskDeltaPercent"]),
                "isOverCeiling": l["isOverCeiling"],
                "billingFrequency": l["billingFrequency"],
            }
            for l in pricing["lines"]
        ]
    }

# --- QUOTATIONS ---
@router.get("")
@router.get("/")
async def list_quotations(
    status: Optional[str] = Query(None),
    customerId: Optional[str] = Query(None),
    search: Optional[str] = Query(None),
    ctx: TenantContext = Depends(get_tenant_context),
    db: AsyncSession = Depends(get_db)
):
    query = select(Quotation).where(Quotation.organization_id == ctx.org_id)
    if status:
        query = query.where(Quotation.status == status)
    if customerId:
        query = query.where(Quotation.customer_id == customerId)
    if search:
        s = f"%{search.strip()}%"
        query = query.where(Quotation.quotation_number.ilike(s))

    query = query.order_by(Quotation.created_at.desc())
    res = await db.execute(query)
    quotes = res.scalars().all()

    cust_res = await db.execute(select(Customer).where(Customer.organization_id == ctx.org_id))
    cust_map = {c.id: {"id": c.id, "name": c.name, "email": c.email, "company": c.company} for c in cust_res.scalars().all()}

    rep_res = await db.execute(select(User).where(User.organization_id == ctx.org_id))
    rep_map = {u.id: {"id": u.id, "name": u.name, "email": u.email} for u in rep_res.scalars().all()}

    return [
        {
            "id": q.id,
            "quotationNumber": q.quotation_number,
            "status": q.status,
            "customerId": q.customer_id,
            "customer": cust_map.get(q.customer_id),
            "repId": q.rep_id,
            "rep": rep_map.get(q.rep_id),
            "subtotal": float(q.subtotal),
            "totalDiscount": float(q.total_discount),
            "totalAmount": float(q.total_amount),
            "totalMargin": float(q.total_margin),
            "totalMarginPercent": float(q.total_margin_percent),
            "riskScore": float(q.risk_score),
            "riskLevel": q.risk_level,
            "approvalRouting": q.approval_routing,
            "createdAt": q.created_at.isoformat() + "Z",
            "updatedAt": q.updated_at.isoformat() + "Z",
        }
        for q in quotes
    ]

@router.get("/{quote_id}")
async def get_quotation(
    quote_id: str,
    ctx: TenantContext = Depends(get_tenant_context),
    db: AsyncSession = Depends(get_db)
):
    res = await db.execute(select(Quotation).where(Quotation.id == quote_id, Quotation.organization_id == ctx.org_id))
    q = res.scalars().first()
    if not q:
        raise HttpError(404, "Quotation not found")

    cust_res = await db.execute(select(Customer).where(Customer.id == q.customer_id, Customer.organization_id == ctx.org_id))
    cust = cust_res.scalars().first()

    tier_res = await db.execute(select(CustomerTier).where(CustomerTier.id == q.tier_id, CustomerTier.organization_id == ctx.org_id))
    tier = tier_res.scalars().first()

    rep_res = await db.execute(select(User).where(User.id == q.rep_id, User.organization_id == ctx.org_id))
    rep = rep_res.scalars().first()

    lines_res = await db.execute(select(QuotationLine).where(QuotationLine.quotation_id == q.id, QuotationLine.organization_id == ctx.org_id).order_by(QuotationLine.created_at.asc()))
    lines = lines_res.scalars().all()

    prod_ids = [l.product_id for l in lines]
    prods_res = await db.execute(select(Product).where(Product.id.in_(prod_ids)))
    prod_map = {p.id: p for p in prods_res.scalars().all()}

    return {
        "id": q.id,
        "quotationNumber": q.quotation_number,
        "status": q.status,
        "customerId": q.customer_id,
        "customer": {
            "id": cust.id,
            "name": cust.name,
            "email": cust.email,
            "company": cust.company,
            "phone": cust.phone,
            "address": cust.address,
            "tier": {"id": tier.id, "name": tier.name, "code": tier.code} if tier else None
        } if cust else None,
        "tierId": q.tier_id,
        "repId": q.rep_id,
        "rep": {"id": rep.id, "name": rep.name, "email": rep.email} if rep else None,
        "orderDiscountPercent": float(q.order_discount_percent),
        "orderDiscountAmount": float(q.order_discount_amount),
        "subtotal": float(q.subtotal),
        "totalDiscount": float(q.total_discount),
        "totalAmount": float(q.total_amount),
        "totalCost": float(q.total_cost),
        "totalMargin": float(q.total_margin),
        "totalMarginPercent": float(q.total_margin_percent),
        "oneTimeTotal": float(q.one_time_total),
        "recurringMonthlyTotal": float(q.recurring_monthly_total),
        "recurringAnnualTotal": float(q.recurring_annual_total),
        "riskScore": float(q.risk_score),
        "riskLevel": q.risk_level,
        "approvalRouting": q.approval_routing,
        "notes": q.notes,
        "validUntil": q.valid_until.isoformat() + "Z" if q.valid_until else None,
        "lines": [
            {
                "id": l.id,
                "productId": l.product_id,
                "product": {
                    "id": prod_map[l.product_id].id,
                    "name": prod_map[l.product_id].name,
                    "sku": prod_map[l.product_id].sku,
                    "price": float(prod_map[l.product_id].price),
                    "costPrice": float(prod_map[l.product_id].cost_price) if prod_map[l.product_id].cost_price else None,
                    "billingFrequency": prod_map[l.product_id].billing_frequency,
                } if l.product_id in prod_map else None,
                "quantity": l.quantity,
                "unitPrice": float(l.unit_price),
                "costPrice": float(l.cost_price),
                "lineDiscountPercent": float(l.line_discount_percent),
                "lineDiscountAmount": float(l.line_discount_amount),
                "subtotal": float(l.subtotal),
                "total": float(l.total),
                "marginAmount": float(l.margin_amount),
                "marginPercent": float(l.margin_percent),
                "appliedCeilingPercent": float(l.applied_ceiling_percent),
                "riskDeltaPercent": float(l.risk_delta_percent),
                "isOverCeiling": l.is_over_ceiling,
                "billingFrequency": l.billing_frequency,
            }
            for l in lines
        ],
        "createdAt": q.created_at.isoformat() + "Z",
        "updatedAt": q.updated_at.isoformat() + "Z",
    }

@router.post("")
@router.post("/")
async def create_quotation(
    req: CreateQuotationRequest,
    ctx: TenantContext = Depends(get_tenant_context),
    db: AsyncSession = Depends(get_db)
):
    cust_res = await db.execute(select(Customer).where(Customer.id == req.customerId, Customer.organization_id == ctx.org_id))
    cust = cust_res.scalars().first()
    if not cust:
        raise HttpError(400, "Invalid customer selected for this organization")

    pricing = await calculate_pricing(db, ctx.org_id, cust.tier_id, req.lines, req.orderDiscountPercent or 0.0)
    q_number = await generate_quotation_number(db, ctx.org_id)

    now = datetime.utcnow()
    valid_until = datetime.fromisoformat(req.validUntil.replace("Z", "+00:00")).replace(tzinfo=None) if req.validUntil else None

    quote = Quotation(
        organization_id=ctx.org_id,
        quotation_number=q_number,
        customer_id=cust.id,
        tier_id=cust.tier_id,
        rep_id=ctx.user_id,
        status="draft",
        order_discount_percent=pricing["orderDiscountPercent"],
        order_discount_amount=pricing["orderDiscountAmount"],
        subtotal=pricing["subtotal"],
        total_discount=pricing["totalDiscount"],
        total_amount=pricing["totalAmount"],
        total_cost=pricing["totalCost"],
        total_margin=pricing["totalMargin"],
        total_margin_percent=pricing["totalMarginPercent"],
        one_time_total=pricing["oneTimeTotal"],
        recurring_monthly_total=pricing["recurringMonthlyTotal"],
        recurring_annual_total=pricing["recurringAnnualTotal"],
        risk_score=pricing["riskScore"],
        risk_level=pricing["riskLevel"],
        approval_routing=pricing["approvalRouting"],
        notes=req.notes,
        valid_until=valid_until,
        created_at=now,
        updated_at=now
    )
    db.add(quote)
    await db.flush()

    for item in pricing["lines"]:
        line = QuotationLine(
            organization_id=ctx.org_id,
            quotation_id=quote.id,
            product_id=item["productId"],
            category_id=item["categoryId"],
            quantity=item["quantity"],
            unit_price=item["unitPrice"],
            cost_price=item["costPrice"],
            line_discount_percent=item["lineDiscountPercent"],
            line_discount_amount=item["lineDiscountAmount"],
            subtotal=item["subtotal"],
            total=item["total"],
            margin_amount=item["marginAmount"],
            margin_percent=item["marginPercent"],
            applied_ceiling_percent=item["appliedCeilingPercent"],
            risk_delta_percent=item["riskDeltaPercent"],
            is_over_ceiling=item["isOverCeiling"],
            billing_frequency=item["billingFrequency"],
            created_at=now,
            updated_at=now
        )
        db.add(line)

    audit = AuditLog(
        organization_id=ctx.org_id,
        entity_type="quotation",
        entity_id=quote.id,
        user_id=ctx.user_id,
        user_email=ctx.email,
        user_role=ctx.role,
        action="created",
        reason="Initial quote draft created",
        created_at=now
    )
    db.add(audit)
    await db.commit()

    await emit_to_org(ctx.org_id, "quote:created", {"quotationId": quote.id, "quotationNumber": quote.quotation_number})
    return await get_quotation(quote.id, ctx, db)

@router.put("/{quote_id}")
async def update_quotation(
    quote_id: str,
    req: UpdateQuotationRequest,
    ctx: TenantContext = Depends(get_tenant_context),
    db: AsyncSession = Depends(get_db)
):
    res = await db.execute(select(Quotation).where(Quotation.id == quote_id, Quotation.organization_id == ctx.org_id))
    quote = res.scalars().first()
    if not quote:
        raise HttpError(404, "Quotation not found")

    if quote.status not in ("draft", "pending_approval"):
        raise HttpError(400, f"Cannot edit quotation in status '{quote.status}'")

    cust_id = req.customerId or quote.customer_id
    cust_res = await db.execute(select(Customer).where(Customer.id == cust_id, Customer.organization_id == ctx.org_id))
    cust = cust_res.scalars().first()

    raw_lines = req.lines
    if raw_lines is None:
        lines_res = await db.execute(select(QuotationLine).where(QuotationLine.quotation_id == quote.id))
        raw_lines = [
            QuotationLineInput(
                productId=l.product_id,
                quantity=l.quantity,
                unitPrice=float(l.unit_price),
                lineDiscountPercent=float(l.line_discount_percent)
            )
            for l in lines_res.scalars().all()
        ]

    order_disc = req.orderDiscountPercent if req.orderDiscountPercent is not None else float(quote.order_discount_percent)
    pricing = await calculate_pricing(db, ctx.org_id, cust.tier_id, raw_lines, order_disc)

    now = datetime.utcnow()
    quote.customer_id = cust.id
    quote.tier_id = cust.tier_id
    quote.order_discount_percent = pricing["orderDiscountPercent"]
    quote.order_discount_amount = pricing["orderDiscountAmount"]
    quote.subtotal = pricing["subtotal"]
    quote.total_discount = pricing["totalDiscount"]
    quote.total_amount = pricing["totalAmount"]
    quote.total_cost = pricing["totalCost"]
    quote.total_margin = pricing["totalMargin"]
    quote.total_margin_percent = pricing["totalMarginPercent"]
    quote.one_time_total = pricing["oneTimeTotal"]
    quote.recurring_monthly_total = pricing["recurringMonthlyTotal"]
    quote.recurring_annual_total = pricing["recurringAnnualTotal"]
    quote.risk_score = pricing["riskScore"]
    quote.risk_level = pricing["riskLevel"]
    quote.approval_routing = pricing["approvalRouting"]
    if req.notes is not None:
        quote.notes = req.notes
    if req.validUntil is not None:
        quote.valid_until = datetime.fromisoformat(req.validUntil.replace("Z", "+00:00")).replace(tzinfo=None)
    quote.updated_at = now

    if req.lines is not None:
        await db.execute(delete(QuotationLine).where(QuotationLine.quotation_id == quote.id, QuotationLine.organization_id == ctx.org_id))
        for item in pricing["lines"]:
            line = QuotationLine(
                organization_id=ctx.org_id,
                quotation_id=quote.id,
                product_id=item["productId"],
                category_id=item["categoryId"],
                quantity=item["quantity"],
                unit_price=item["unitPrice"],
                cost_price=item["costPrice"],
                line_discount_percent=item["lineDiscountPercent"],
                line_discount_amount=item["lineDiscountAmount"],
                subtotal=item["subtotal"],
                total=item["total"],
                margin_amount=item["marginAmount"],
                margin_percent=item["marginPercent"],
                applied_ceiling_percent=item["appliedCeilingPercent"],
                risk_delta_percent=item["riskDeltaPercent"],
                is_over_ceiling=item["isOverCeiling"],
                billing_frequency=item["billingFrequency"],
                created_at=now,
                updated_at=now
            )
            db.add(line)

    await db.commit()
    await emit_to_quote(ctx.org_id, quote.id, "quote:updated", {"quotationId": quote.id})
    return await get_quotation(quote.id, ctx, db)

@router.delete("/{quote_id}")
async def delete_quotation(
    quote_id: str,
    ctx: TenantContext = Depends(get_tenant_context),
    db: AsyncSession = Depends(get_db)
):
    res = await db.execute(select(Quotation).where(Quotation.id == quote_id, Quotation.organization_id == ctx.org_id))
    quote = res.scalars().first()
    if not quote:
        raise HttpError(404, "Quotation not found")
    if quote.status not in ("draft", "rejected"):
        raise HttpError(400, "Only draft or rejected quotations can be deleted")

    await db.delete(quote)
    await db.commit()
    return {"message": "Quotation deleted successfully"}

@router.post("/{quote_id}/confirm")
async def confirm_quotation(
    quote_id: str,
    ctx: TenantContext = Depends(get_tenant_context),
    db: AsyncSession = Depends(get_db)
):
    res = await db.execute(select(Quotation).where(Quotation.id == quote_id, Quotation.organization_id == ctx.org_id))
    quote = res.scalars().first()
    if not quote:
        raise HttpError(404, "Quotation not found")

    quote.status = "confirmed"
    quote.updated_at = datetime.utcnow()

    audit = AuditLog(
        organization_id=ctx.org_id,
        entity_type="quotation",
        entity_id=quote.id,
        user_id=ctx.user_id,
        user_email=ctx.email,
        user_role=ctx.role,
        action="customer_confirmed",
        reason="Quotation confirmed and accepted",
        created_at=datetime.utcnow()
    )
    db.add(audit)
    await db.commit()

    # Trigger RabbitMQ task for billing schedule generation
    generate_schedule.delay({"orgId": ctx.org_id, "quotationId": quote.id})

    await emit_to_org(ctx.org_id, "quote:confirmed", {"quotationId": quote.id})
    return await get_quotation(quote.id, ctx, db)

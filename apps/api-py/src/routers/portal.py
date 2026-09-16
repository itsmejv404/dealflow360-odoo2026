from datetime import datetime, timedelta
from decimal import Decimal
from typing import Optional, List
from fastapi import APIRouter, Depends, Response
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from src.database import get_db
from src.models import (
    Quotation, QuotationLine, Product, Organization, Customer,
    NegotiationComment, ChangeRequest, CounterProposal, AuditLog
)
from src.shared.tenant import (
    get_tenant_context, require_roles, TenantContext, get_portal_context
)
from src.shared.jwt_utils import sign_customer_token
from src.shared.errors import HttpError
from src.lib.socket import emit_to_quote, emit_to_org
from src.lib.mailer import send_email
from src.lib.minio_client import storage_service
from src.tasks.approvals import process_approval_notification
from src.tasks.billing import generate_schedule

router = APIRouter(prefix="/api/portal", tags=["Portal"])

class CustomerCommentRequest(BaseModel):
    lineId: Optional[str] = None
    body: str

class CustomerChangeRequest(BaseModel):
    lineId: Optional[str] = None
    requestType: str # "quantity_change" | "remove_line" | "discount_change" | "other"
    proposedQuantity: Optional[int] = None
    proposedDiscountPercent: Optional[float] = None
    note: Optional[str] = None

class CustomerCounterRequest(BaseModel):
    lineId: Optional[str] = None
    proposedDiscountPercent: float
    note: Optional[str] = None

@router.post("/send/{quote_id}")
async def send_to_customer(
    quote_id: str,
    ctx: TenantContext = Depends(require_roles(["rep", "manager", "org_admin"])),
    db: AsyncSession = Depends(get_db)
):
    q_res = await db.execute(select(Quotation).where(Quotation.id == quote_id, Quotation.organization_id == ctx.org_id))
    quote = q_res.scalars().first()
    if not quote:
        raise HttpError(404, "Quotation not found")

    cust_res = await db.execute(select(Customer).where(Customer.id == quote.customer_id))
    cust = cust_res.scalars().first()
    if not cust:
        raise HttpError(404, "Customer not found")

    org_res = await db.execute(select(Organization).where(Organization.id == ctx.org_id))
    org = org_res.scalars().first()

    magic_token = sign_customer_token({
        "sub": cust.id,
        "email": cust.email,
        "org_id": ctx.org_id,
        "quotation_ids": [quote.id],
    })

    quote.status = "sent"
    quote.updated_at = datetime.utcnow()
    await db.commit()

    link = f"http://localhost:5174/portal/?token={magic_token}"
    subject = f"Your Quotation {quote.quotation_number} from {org.name if org else 'Us'}"
    html = f"""
    <h3>Review your quote {quote.quotation_number}</h3>
    <p>Please click the link below to view, comment, negotiate, or confirm:</p>
    <p><a href="{link}">Open Quotation Portal</a></p>
    """
    send_email(cust.email, subject, html)

    return {"message": "Quotation sent to customer", "token": magic_token}

@router.get("/verify")
async def verify_portal_token(ctx: TenantContext = Depends(get_portal_context)):
    return {
        "valid": True,
        "email": ctx.email,
        "orgId": ctx.org_id,
        "quotationIds": ctx.quotation_ids or []
    }

@router.get("/organization")
async def get_portal_organization(
    ctx: TenantContext = Depends(get_portal_context),
    db: AsyncSession = Depends(get_db)
):
    org_res = await db.execute(select(Organization).where(Organization.id == ctx.org_id))
    org = org_res.scalars().first()
    if not org:
        raise HttpError(404, "Organization not found")
    return {
        "id": org.id,
        "name": org.name,
        "slug": org.slug,
        "logoUrl": org.logo_url,
        "contactEmail": org.contact_email,
        "currency": org.currency,
    }

@router.get("/organization/logo")
async def get_portal_logo(
    ctx: TenantContext = Depends(get_portal_context),
    db: AsyncSession = Depends(get_db)
):
    for ext, mime in [("png", "image/png"), ("jpg", "image/jpeg"), ("webp", "image/webp"), ("svg", "image/svg+xml")]:
        try:
            content, c_type = storage_service.get_tenant_file(ctx.org_id, f"logo.{ext}")
            return Response(content=content, media_type=mime)
        except Exception:
            continue
    raise HttpError(404, "Logo not found")

@router.get("/quotation")
@router.get("/quotation/{quote_id}")
async def get_portal_quotation(
    quote_id: Optional[str] = None,
    ctx: TenantContext = Depends(get_portal_context),
    db: AsyncSession = Depends(get_db)
):
    target_id = quote_id or (ctx.quotation_ids[0] if ctx.quotation_ids else None)
    if not target_id:
        raise HttpError(404, "No quotation specified")

    if ctx.quotation_ids and target_id not in ctx.quotation_ids:
        raise HttpError(403, "Unauthorized to access this quotation")

    q_res = await db.execute(select(Quotation).where(Quotation.id == target_id, Quotation.organization_id == ctx.org_id))
    q = q_res.scalars().first()
    if not q:
        raise HttpError(404, "Quotation not found")

    lines_res = await db.execute(
        select(QuotationLine).where(QuotationLine.quotation_id == q.id, QuotationLine.organization_id == ctx.org_id).order_by(QuotationLine.created_at.asc())
    )
    lines = lines_res.scalars().all()

    prod_ids = [l.product_id for l in lines]
    prods_res = await db.execute(select(Product).where(Product.id.in_(prod_ids)))
    prod_map = {p.id: p for p in prods_res.scalars().all()}

    return {
        "id": q.id,
        "quotationNumber": q.quotation_number,
        "status": q.status,
        "subtotal": float(q.subtotal),
        "totalDiscount": float(q.total_discount),
        "totalAmount": float(q.total_amount),
        "oneTimeTotal": float(q.one_time_total),
        "recurringMonthlyTotal": float(q.recurring_monthly_total),
        "validUntil": q.valid_until.isoformat() + "Z" if q.valid_until else None,
        "lines": [
            {
                "id": l.id,
                "productId": l.product_id,
                "product": {
                    "id": prod_map[l.product_id].id,
                    "name": prod_map[l.product_id].name,
                    "sku": prod_map[l.product_id].sku,
                } if l.product_id in prod_map else None,
                "quantity": l.quantity,
                "unitPrice": float(l.unit_price),
                "lineDiscountPercent": float(l.line_discount_percent),
                "subtotal": float(l.subtotal),
                "total": float(l.total),
                "billingFrequency": l.billing_frequency,
            }
            for l in lines
        ]
    }

@router.get("/quotation/{quote_id}/negotiation")
async def list_portal_negotiation(
    quote_id: str,
    ctx: TenantContext = Depends(get_portal_context),
    db: AsyncSession = Depends(get_db)
):
    comm_res = await db.execute(
        select(NegotiationComment).where(
            NegotiationComment.quotation_id == quote_id,
            NegotiationComment.organization_id == ctx.org_id
        ).order_by(NegotiationComment.created_at.asc())
    )
    comments = comm_res.scalars().all()

    cr_res = await db.execute(
        select(ChangeRequest).where(
            ChangeRequest.quotation_id == quote_id,
            ChangeRequest.organization_id == ctx.org_id
        ).order_by(ChangeRequest.created_at.desc())
    )
    change_requests = cr_res.scalars().all()

    cp_res = await db.execute(
        select(CounterProposal).where(
            CounterProposal.quotation_id == quote_id,
            CounterProposal.organization_id == ctx.org_id
        ).order_by(CounterProposal.created_at.desc())
    )
    counter_proposals = cp_res.scalars().all()

    return {
        "comments": [
            {
                "id": c.id,
                "lineId": c.line_id,
                "authorType": c.author_type,
                "authorName": c.author_name,
                "body": c.body,
                "createdAt": c.created_at.isoformat() + "Z",
            }
            for c in comments
        ],
        "changeRequests": [
            {
                "id": cr.id,
                "lineId": cr.line_id,
                "requestType": cr.request_type,
                "proposedQuantity": cr.proposed_quantity,
                "proposedDiscountPercent": float(cr.proposed_discount_percent) if cr.proposed_discount_percent is not None else None,
                "note": cr.note,
                "status": cr.status,
                "createdAt": cr.created_at.isoformat() + "Z",
            }
            for cr in change_requests
        ],
        "counterProposals": [
            {
                "id": cp.id,
                "lineId": cp.line_id,
                "proposedDiscountPercent": float(cp.proposed_discount_percent),
                "note": cp.note,
                "status": cp.status,
                "createdAt": cp.created_at.isoformat() + "Z",
            }
            for cp in counter_proposals
        ]
    }

@router.post("/quotation/{quote_id}/comments")
async def portal_post_comment(
    quote_id: str,
    req: CustomerCommentRequest,
    ctx: TenantContext = Depends(get_portal_context),
    db: AsyncSession = Depends(get_db)
):
    now = datetime.utcnow()
    comment = NegotiationComment(
        organization_id=ctx.org_id,
        quotation_id=quote_id,
        line_id=req.lineId,
        author_type="customer",
        author_id=ctx.user_id,
        author_name=ctx.email.split("@")[0] if ctx.email else "Customer",
        author_email=ctx.email,
        body=req.body.strip(),
        created_at=now
    )
    db.add(comment)
    await db.commit()

    await emit_to_quote(ctx.org_id, quote_id, "negotiation:comment_added", {"quotationId": quote_id})
    return {"comment": {"id": comment.id, "body": comment.body}}

@router.post("/quotation/{quote_id}/change-requests")
async def portal_post_change_request(
    quote_id: str,
    req: CustomerChangeRequest,
    ctx: TenantContext = Depends(get_portal_context),
    db: AsyncSession = Depends(get_db)
):
    now = datetime.utcnow()
    cr = ChangeRequest(
        organization_id=ctx.org_id,
        quotation_id=quote_id,
        line_id=req.lineId,
        request_type=req.requestType,
        proposed_quantity=req.proposedQuantity,
        proposed_discount_percent=Decimal(str(req.proposedDiscountPercent)) if req.proposedDiscountPercent is not None else None,
        note=req.note,
        status="open",
        requested_by_type="customer",
        requested_by_name=ctx.email.split("@")[0] if ctx.email else "Customer",
        requested_by_email=ctx.email,
        created_at=now
    )
    db.add(cr)

    # Move quote to negotiating
    q_res = await db.execute(select(Quotation).where(Quotation.id == quote_id))
    q = q_res.scalars().first()
    if q and q.status in ("sent", "approved"):
        q.status = "negotiating"
        q.updated_at = now

    await db.commit()
    await emit_to_quote(ctx.org_id, quote_id, "negotiation:change_request_added", {"quotationId": quote_id})
    return {"changeRequest": {"id": cr.id, "status": cr.status}}

@router.post("/quotation/{quote_id}/counters")
async def portal_post_counter(
    quote_id: str,
    req: CustomerCounterRequest,
    ctx: TenantContext = Depends(get_portal_context),
    db: AsyncSession = Depends(get_db)
):
    now = datetime.utcnow()
    cp = CounterProposal(
        organization_id=ctx.org_id,
        quotation_id=quote_id,
        line_id=req.lineId,
        proposed_discount_percent=Decimal(str(req.proposedDiscountPercent)),
        note=req.note,
        status="open",
        proposed_by_type="customer",
        proposed_by_name=ctx.email.split("@")[0] if ctx.email else "Customer",
        proposed_by_email=ctx.email,
        created_at=now
    )
    db.add(cp)

    q_res = await db.execute(select(Quotation).where(Quotation.id == quote_id))
    q = q_res.scalars().first()
    if q and q.status in ("sent", "approved"):
        q.status = "negotiating"
        q.updated_at = now

    await db.commit()
    await emit_to_quote(ctx.org_id, quote_id, "negotiation:counter_added", {"quotationId": quote_id})
    return {"counterProposal": {"id": cp.id, "status": cp.status}}

@router.post("/quotation/{quote_id}/confirm")
async def portal_confirm_quotation(
    quote_id: str,
    ctx: TenantContext = Depends(get_portal_context),
    db: AsyncSession = Depends(get_db)
):
    q_res = await db.execute(select(Quotation).where(Quotation.id == quote_id, Quotation.organization_id == ctx.org_id))
    q = q_res.scalars().first()
    if not q:
        raise HttpError(404, "Quotation not found")

    now = datetime.utcnow()
    q.status = "confirmed"
    q.updated_at = now

    audit = AuditLog(
        organization_id=ctx.org_id,
        entity_type="quotation",
        entity_id=q.id,
        user_id=ctx.user_id,
        user_email=ctx.email,
        user_role="customer",
        action="customer_confirmed",
        reason="Customer accepted quotation via portal",
        created_at=now
    )
    db.add(audit)
    await db.commit()

    # Trigger RabbitMQ Celery task for billing schedule generation
    generate_schedule.delay({"orgId": ctx.org_id, "quotationId": q.id})

    await emit_to_org(ctx.org_id, "quote:confirmed", {"quotationId": q.id})
    return {"status": "confirmed"}

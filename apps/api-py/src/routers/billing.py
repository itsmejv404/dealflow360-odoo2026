from datetime import datetime, timedelta
from decimal import Decimal
from typing import Optional, List, Literal
from fastapi import APIRouter, Depends, Query, Response
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, delete, func
from src.database import get_db
from src.models import (
    Quotation, QuotationLine, Product, Organization, Invoice,
    InvoiceLine, InvoiceSurcharge, Subscription, BillingSchedule,
    CreditNote, Payment, DeadLetterJob, AuditLog
)
from src.shared.tenant import get_tenant_context, require_roles, TenantContext
from src.shared.errors import HttpError
from src.tasks.billing import generate_schedule, modify_quantity

router = APIRouter(prefix="/api/billing", tags=["Billing"])

class SurchargeRequest(BaseModel):
    label: str
    kind: Literal["amount", "percent"] = "amount"
    value: float

class PayRequest(BaseModel):
    paymentMethod: Optional[str] = "credit_card"

class ModifySubRequest(BaseModel):
    newQuantity: int
    reason: Optional[str] = None

class WebhookRequest(BaseModel):
    event: str
    data: dict

async def generate_invoice_number(db: AsyncSession, org_id: str) -> str:
    org_res = await db.execute(select(Organization).where(Organization.id == org_id))
    org = org_res.scalars().first()
    slug = (org.slug if org else "ORG").upper().replace("-", "")
    year = datetime.utcnow().year
    prefix = f"{slug}-INV-{year}-"
    last_res = await db.execute(
        select(Invoice.invoice_number).where(
            Invoice.organization_id == org_id,
            Invoice.invoice_number.startswith(prefix)
        ).order_by(Invoice.invoice_number.desc()).limit(1)
    )
    last_val = last_res.scalar()
    seq = 1
    if last_val:
        try:
            seq = int(last_val[len(prefix):]) + 1
        except Exception:
            seq = 1
    return f"{prefix}{str(seq).zfill(4)}"

async def generate_subscription_number(db: AsyncSession, org_id: str) -> str:
    org_res = await db.execute(select(Organization).where(Organization.id == org_id))
    org = org_res.scalars().first()
    slug = (org.slug if org else "ORG").upper().replace("-", "")
    year = datetime.utcnow().year
    prefix = f"{slug}-SUB-{year}-"
    cnt_res = await db.execute(select(func.count()).select_from(Subscription).where(Subscription.organization_id == org_id))
    seq = (cnt_res.scalar() or 0) + 1
    return f"{prefix}{str(seq).zfill(4)}"

# --- WEBHOOK ---
@router.post("/webhooks")
async def handle_webhook(req: WebhookRequest, db: AsyncSession = Depends(get_db)):
    # Handle payment provider webhooks (mock / sandbox)
    return {"status": "received"}

# --- QUOTATION SPLIT ---
@router.post("/quotation/{quote_id}/split")
@router.post("/quotations/{quote_id}/split")
async def split_quotation_order(
    quote_id: str,
    ctx: TenantContext = Depends(get_tenant_context),
    db: AsyncSession = Depends(get_db)
):
    q_res = await db.execute(select(Quotation).where(Quotation.id == quote_id, Quotation.organization_id == ctx.org_id))
    quote = q_res.scalars().first()
    if not quote:
        raise HttpError(404, "Quotation not found")

    # Check if already split
    exist_inv = await db.execute(select(Invoice).where(Invoice.quotation_id == quote.id, Invoice.organization_id == ctx.org_id))
    exist_subs = await db.execute(select(Subscription).where(Subscription.quotation_id == quote.id, Subscription.organization_id == ctx.org_id))
    first_inv = exist_inv.scalars().first()
    first_subs = exist_subs.scalars().all()
    if first_inv or first_subs:
        return {
            "quotationId": quote.id,
            "oneTimeInvoice": {"id": first_inv.id, "invoiceNumber": first_inv.invoice_number, "totalAmount": float(first_inv.total_amount)} if first_inv else None,
            "subscriptionsCreated": len(first_subs)
        }

    lines_res = await db.execute(
        select(QuotationLine).where(QuotationLine.quotation_id == quote.id, QuotationLine.organization_id == ctx.org_id)
    )
    lines = lines_res.scalars().all()

    now = datetime.utcnow()
    one_time_lines = [l for l in lines if l.billing_frequency == "one_time"]
    recurring_lines = [l for l in lines if l.billing_frequency != "one_time"]

    created_inv = None
    if one_time_lines:
        inv_num = await generate_invoice_number(db, ctx.org_id)
        subtot = sum(l.subtotal for l in one_time_lines)
        tot_disc = sum(l.line_discount_amount for l in one_time_lines)
        tot_amt = sum(l.total for l in one_time_lines)

        created_inv = Invoice(
            organization_id=ctx.org_id,
            quotation_id=quote.id,
            invoice_number=inv_num,
            type="one_time",
            status="issued",
            currency="USD",
            subtotal=subtot,
            discount_amount=tot_disc,
            total_amount=tot_amt,
            amount_paid=Decimal("0.00"),
            amount_refunded=Decimal("0.00"),
            due_date=now + timedelta(days=14),
            issued_at=now,
            created_at=now,
            updated_at=now
        )
        db.add(created_inv)
        await db.flush()

        prod_ids = [l.product_id for l in one_time_lines]
        prods_res = await db.execute(select(Product).where(Product.id.in_(prod_ids)))
        prod_map = {p.id: p for p in prods_res.scalars().all()}

        for l in one_time_lines:
            inv_line = InvoiceLine(
                organization_id=ctx.org_id,
                invoice_id=created_inv.id,
                quotation_line_id=l.id,
                product_id=l.product_id,
                description=prod_map[l.product_id].name if l.product_id in prod_map else "Product",
                quantity=l.quantity,
                unit_price=l.unit_price,
                discount_percent=l.line_discount_percent,
                subtotal=l.subtotal,
                total_amount=l.total,
                created_at=now
            )
            db.add(inv_line)

    subs_created = 0
    if recurring_lines:
        prod_ids = [l.product_id for l in recurring_lines]
        prods_res = await db.execute(select(Product).where(Product.id.in_(prod_ids)))
        prod_map = {p.id: p for p in prods_res.scalars().all()}

        for l in recurring_lines:
            sub_num = await generate_subscription_number(db, ctx.org_id)
            sub = Subscription(
                organization_id=ctx.org_id,
                quotation_id=quote.id,
                quotation_line_id=l.id,
                product_id=l.product_id,
                customer_id=quote.customer_id,
                subscription_number=sub_num,
                name=prod_map[l.product_id].name if l.product_id in prod_map else "Subscription",
                billing_frequency=l.billing_frequency,
                quantity=l.quantity,
                unit_price=l.unit_price,
                discount_percent=l.line_discount_percent,
                recurring_amount=l.total,
                currency="USD",
                status="active",
                start_date=now,
                current_period_start=now,
                current_period_end=now + (timedelta(days=365) if l.billing_frequency == "annual" else timedelta(days=30)),
                next_billing_date=now + (timedelta(days=365) if l.billing_frequency == "annual" else timedelta(days=30)),
                created_at=now,
                updated_at=now
            )
            db.add(sub)
            subs_created += 1

    await db.commit()

    if subs_created > 0:
        # Trigger Celery RabbitMQ task
        generate_schedule.delay({"orgId": ctx.org_id, "quotationId": quote.id})

    return {
        "quotationId": quote.id,
        "oneTimeInvoice": {
            "id": created_inv.id,
            "invoiceNumber": created_inv.invoice_number,
            "totalAmount": float(created_inv.total_amount)
        } if created_inv else None,
        "subscriptionsCreated": subs_created
    }

@router.get("/quotation/{quote_id}")
@router.get("/quotations/{quote_id}/summary")
async def get_quotation_billing(
    quote_id: str,
    ctx: TenantContext = Depends(get_tenant_context),
    db: AsyncSession = Depends(get_db)
):
    invs_res = await db.execute(select(Invoice).where(Invoice.quotation_id == quote_id, Invoice.organization_id == ctx.org_id))
    invoices = invs_res.scalars().all()

    subs_res = await db.execute(select(Subscription).where(Subscription.quotation_id == quote_id, Subscription.organization_id == ctx.org_id))
    subs = subs_res.scalars().all()

    return {
        "invoices": [
            {
                "id": i.id,
                "invoiceNumber": i.invoice_number,
                "type": i.type,
                "status": i.status,
                "totalAmount": float(i.total_amount),
                "amountPaid": float(i.amount_paid),
                "dueDate": i.due_date.isoformat() + "Z",
            }
            for i in invoices
        ],
        "subscriptions": [
            {
                "id": s.id,
                "subscriptionNumber": s.subscription_number,
                "name": s.name,
                "status": s.status,
                "recurringAmount": float(s.recurring_amount),
                "billingFrequency": s.billing_frequency,
            }
            for s in subs
        ]
    }

# --- INVOICES ---
@router.get("/invoices")
async def list_invoices(
    status: Optional[str] = Query(None),
    ctx: TenantContext = Depends(get_tenant_context),
    db: AsyncSession = Depends(get_db)
):
    query = select(Invoice).where(Invoice.organization_id == ctx.org_id)
    if status:
        query = query.where(Invoice.status == status)
    query = query.order_by(Invoice.issued_at.desc())

    res = await db.execute(query)
    invoices = res.scalars().all()

    return [
        {
            "id": i.id,
            "invoiceNumber": i.invoice_number,
            "quotationId": i.quotation_id,
            "type": i.type,
            "status": i.status,
            "currency": i.currency,
            "subtotal": float(i.subtotal),
            "discountAmount": float(i.discount_amount),
            "totalAmount": float(i.total_amount),
            "amountPaid": float(i.amount_paid),
            "amountRefunded": float(i.amount_refunded),
            "dueDate": i.due_date.isoformat() + "Z",
            "issuedAt": i.issued_at.isoformat() + "Z",
            "paidAt": i.paid_at.isoformat() + "Z" if i.paid_at else None,
        }
        for i in invoices
    ]

@router.get("/export/sales-activities/csv")
@router.get("/sales-activities/export/csv")
async def export_sales_activities_csv(
    ctx: TenantContext = Depends(get_tenant_context),
    db: AsyncSession = Depends(get_db)
):
    invs_res = await db.execute(select(Invoice).where(Invoice.organization_id == ctx.org_id).order_by(Invoice.issued_at.desc()))
    invoices = invs_res.scalars().all()

    csv_lines = ["Invoice Number,Type,Status,Subtotal,Discount,Total,Paid,Due Date,Issued At"]
    for i in invoices:
        csv_lines.append(f"{i.invoice_number},{i.type},{i.status},{i.subtotal},{i.discount_amount},{i.total_amount},{i.amount_paid},{i.due_date.strftime('%Y-%m-%d')},{i.issued_at.strftime('%Y-%m-%d')}")

    return Response(
        content="\n".join(csv_lines),
        media_type="text/csv",
        headers={"Content-Disposition": f"attachment; filename=sales_activities_{ctx.org_id}.csv"}
    )

@router.get("/invoices/{invoice_id}")
async def get_invoice(
    invoice_id: str,
    ctx: TenantContext = Depends(get_tenant_context),
    db: AsyncSession = Depends(get_db)
):
    res = await db.execute(select(Invoice).where(Invoice.id == invoice_id, Invoice.organization_id == ctx.org_id))
    inv = res.scalars().first()
    if not inv:
        raise HttpError(404, "Invoice not found")

    lines_res = await db.execute(select(InvoiceLine).where(InvoiceLine.invoice_id == inv.id))
    lines = lines_res.scalars().all()

    surcharges_res = await db.execute(select(InvoiceSurcharge).where(InvoiceSurcharge.invoice_id == inv.id))
    surcharges = surcharges_res.scalars().all()

    return {
        "id": inv.id,
        "invoiceNumber": inv.invoice_number,
        "quotationId": inv.quotation_id,
        "type": inv.type,
        "status": inv.status,
        "currency": inv.currency,
        "subtotal": float(inv.subtotal),
        "discountAmount": float(inv.discount_amount),
        "totalAmount": float(inv.total_amount),
        "amountPaid": float(inv.amount_paid),
        "amountRefunded": float(inv.amount_refunded),
        "dueDate": inv.due_date.isoformat() + "Z",
        "issuedAt": inv.issued_at.isoformat() + "Z",
        "paidAt": inv.paid_at.isoformat() + "Z" if inv.paid_at else None,
        "lines": [
            {
                "id": l.id,
                "description": l.description,
                "quantity": l.quantity,
                "unitPrice": float(l.unit_price),
                "discountPercent": float(l.discount_percent),
                "subtotal": float(l.subtotal),
                "totalAmount": float(l.total_amount),
            }
            for l in lines
        ],
        "surcharges": [
            {
                "id": s.id,
                "label": s.label,
                "kind": s.kind,
                "value": float(s.value),
                "computedAmount": float(s.computed_amount),
            }
            for s in surcharges
        ]
    }

@router.post("/invoices/{invoice_id}/surcharges")
async def add_surcharge(
    invoice_id: str,
    req: SurchargeRequest,
    ctx: TenantContext = Depends(require_roles(["org_admin", "manager", "finance", "rep"])),
    db: AsyncSession = Depends(get_db)
):
    inv_res = await db.execute(select(Invoice).where(Invoice.id == invoice_id, Invoice.organization_id == ctx.org_id))
    inv = inv_res.scalars().first()
    if not inv:
        raise HttpError(404, "Invoice not found")

    val = Decimal(str(req.value))
    computed = val if req.kind == "amount" else (inv.subtotal * (val / Decimal("100.00"))).quantize(Decimal("0.01"))

    sc = InvoiceSurcharge(
        organization_id=ctx.org_id,
        invoice_id=inv.id,
        label=req.label,
        kind=req.kind,
        value=val,
        computed_amount=computed,
        created_at=datetime.utcnow()
    )
    db.add(sc)
    inv.total_amount += computed
    inv.updated_at = datetime.utcnow()
    await db.commit()

    return {"id": sc.id, "computedAmount": float(computed)}

@router.delete("/invoices/{invoice_id}/surcharges/{surcharge_id}")
async def remove_surcharge(
    invoice_id: str,
    surcharge_id: str,
    ctx: TenantContext = Depends(require_roles(["org_admin", "manager", "finance", "rep"])),
    db: AsyncSession = Depends(get_db)
):
    res = await db.execute(select(InvoiceSurcharge).where(InvoiceSurcharge.id == surcharge_id, InvoiceSurcharge.organization_id == ctx.org_id))
    sc = res.scalars().first()
    if not sc:
        raise HttpError(404, "Surcharge not found")

    inv_res = await db.execute(select(Invoice).where(Invoice.id == invoice_id))
    inv = inv_res.scalars().first()
    if inv:
        inv.total_amount -= sc.computed_amount
        inv.updated_at = datetime.utcnow()

    await db.delete(sc)
    await db.commit()
    return {"message": "Surcharge removed"}

@router.post("/invoices/{invoice_id}/pay")
async def pay_invoice(
    invoice_id: str,
    req: PayRequest,
    ctx: TenantContext = Depends(require_roles(["org_admin", "finance", "rep"])),
    db: AsyncSession = Depends(get_db)
):
    inv_res = await db.execute(select(Invoice).where(Invoice.id == invoice_id, Invoice.organization_id == ctx.org_id))
    inv = inv_res.scalars().first()
    if not inv:
        raise HttpError(404, "Invoice not found")

    now = datetime.utcnow()
    inv.status = "paid"
    inv.amount_paid = inv.total_amount
    inv.paid_at = now
    inv.updated_at = now

    tx_ref = f"tx_{inv.id[:8]}_{int(now.timestamp())}"
    payment = Payment(
        organization_id=ctx.org_id,
        invoice_id=inv.id,
        transaction_reference=tx_ref,
        payment_type="charge",
        payment_method=req.paymentMethod or "credit_card",
        amount=inv.total_amount,
        currency=inv.currency,
        status="succeeded",
        created_at=now
    )
    db.add(payment)
    await db.commit()

    return {"status": "paid", "transactionReference": tx_ref}

# --- SUBSCRIPTIONS ---
@router.get("/subscriptions")
async def list_subscriptions(
    ctx: TenantContext = Depends(get_tenant_context),
    db: AsyncSession = Depends(get_db)
):
    res = await db.execute(select(Subscription).where(Subscription.organization_id == ctx.org_id).order_by(Subscription.created_at.desc()))
    subs = res.scalars().all()
    return [
        {
            "id": s.id,
            "subscriptionNumber": s.subscription_number,
            "name": s.name,
            "status": s.status,
            "billingFrequency": s.billing_frequency,
            "quantity": s.quantity,
            "unitPrice": float(s.unit_price),
            "discountPercent": float(s.discount_percent),
            "recurringAmount": float(s.recurring_amount),
            "nextBillingDate": s.next_billing_date.isoformat() + "Z",
        }
        for s in subs
    ]

@router.get("/subscriptions/{sub_id}")
async def get_subscription(
    sub_id: str,
    ctx: TenantContext = Depends(get_tenant_context),
    db: AsyncSession = Depends(get_db)
):
    res = await db.execute(select(Subscription).where(Subscription.id == sub_id, Subscription.organization_id == ctx.org_id))
    s = res.scalars().first()
    if not s:
        raise HttpError(404, "Subscription not found")

    sched_res = await db.execute(
        select(BillingSchedule).where(BillingSchedule.subscription_id == s.id).order_by(BillingSchedule.period_number.asc())
    )
    scheds = sched_res.scalars().all()

    return {
        "id": s.id,
        "subscriptionNumber": s.subscription_number,
        "name": s.name,
        "status": s.status,
        "billingFrequency": s.billing_frequency,
        "quantity": s.quantity,
        "unitPrice": float(s.unit_price),
        "discountPercent": float(s.discount_percent),
        "recurringAmount": float(s.recurring_amount),
        "startDate": s.start_date.isoformat() + "Z",
        "currentPeriodStart": s.current_period_start.isoformat() + "Z",
        "currentPeriodEnd": s.current_period_end.isoformat() + "Z",
        "nextBillingDate": s.next_billing_date.isoformat() + "Z",
        "schedules": [
            {
                "id": sc.id,
                "periodNumber": sc.period_number,
                "periodStart": sc.period_start.isoformat() + "Z",
                "periodEnd": sc.period_end.isoformat() + "Z",
                "dueDate": sc.due_date.isoformat() + "Z",
                "expectedAmount": float(sc.expected_amount),
                "status": sc.status,
            }
            for sc in scheds
        ]
    }

@router.get("/subscriptions/{sub_id}/proration-preview")
async def preview_proration(
    sub_id: str,
    newQuantity: int = Query(...),
    ctx: TenantContext = Depends(get_tenant_context),
    db: AsyncSession = Depends(get_db)
):
    res = await db.execute(select(Subscription).where(Subscription.id == sub_id, Subscription.organization_id == ctx.org_id))
    s = res.scalars().first()
    if not s:
        raise HttpError(404, "Subscription not found")

    qty_diff = newQuantity - s.quantity
    now = datetime.utcnow()
    total_days = max(1, (s.current_period_end - s.current_period_start).days)
    remaining_days = max(0, (s.current_period_end - now).days)
    fraction = Decimal(remaining_days) / Decimal(total_days)

    disc_pct = s.discount_percent
    amt_delta = (s.unit_price * Decimal(abs(qty_diff))) * (Decimal("1.00") - (disc_pct / Decimal("100.00")))
    prorated = (amt_delta * fraction).quantize(Decimal("0.01"))

    return {
        "currentQuantity": s.quantity,
        "newQuantity": newQuantity,
        "proratedAmount": float(prorated),
        "adjustmentType": "credit" if qty_diff < 0 else "charge",
        "remainingDays": remaining_days,
        "totalDays": total_days
    }

@router.post("/subscriptions/{sub_id}/modify-quantity")
async def modify_subscription_qty(
    sub_id: str,
    req: ModifySubRequest,
    ctx: TenantContext = Depends(require_roles(["org_admin", "finance", "rep", "ops"])),
    db: AsyncSession = Depends(get_db)
):
    res = await db.execute(select(Subscription).where(Subscription.id == sub_id, Subscription.organization_id == ctx.org_id))
    s = res.scalars().first()
    if not s:
        raise HttpError(404, "Subscription not found")

    # Delegate mid-cycle calculation & credit note issuance to RabbitMQ task
    modify_quantity.delay({
        "orgId": ctx.org_id,
        "subscriptionId": s.id,
        "newQuantity": req.newQuantity,
        "reason": req.reason or "Mid-cycle subscription modification"
    })

    return {"message": "Proration task queued via RabbitMQ"}

# --- CREDIT NOTES ---
@router.get("/credit-notes")
async def list_credit_notes(
    ctx: TenantContext = Depends(get_tenant_context),
    db: AsyncSession = Depends(get_db)
):
    res = await db.execute(select(CreditNote).where(CreditNote.organization_id == ctx.org_id).order_by(CreditNote.created_at.desc()))
    cns = res.scalars().all()
    return [
        {
            "id": c.id,
            "creditNoteNumber": c.credit_note_number,
            "quotationId": c.quotation_id,
            "subscriptionId": c.subscription_id,
            "amount": float(c.amount),
            "currency": c.currency,
            "reason": c.reason,
            "status": c.status,
            "createdAt": c.created_at.isoformat() + "Z",
        }
        for c in cns
    ]

@router.get("/credit-notes/{cn_id}")
async def get_credit_note(
    cn_id: str,
    ctx: TenantContext = Depends(get_tenant_context),
    db: AsyncSession = Depends(get_db)
):
    res = await db.execute(select(CreditNote).where(CreditNote.id == cn_id, CreditNote.organization_id == ctx.org_id))
    c = res.scalars().first()
    if not c:
        raise HttpError(404, "Credit note not found")
    return {
        "id": c.id,
        "creditNoteNumber": c.credit_note_number,
        "quotationId": c.quotation_id,
        "subscriptionId": c.subscription_id,
        "amount": float(c.amount),
        "currency": c.currency,
        "reason": c.reason,
        "status": c.status,
        "createdAt": c.created_at.isoformat() + "Z",
    }

@router.post("/credit-notes/{cn_id}/refund")
async def refund_credit_note(
    cn_id: str,
    ctx: TenantContext = Depends(require_roles(["org_admin", "finance"])),
    db: AsyncSession = Depends(get_db)
):
    res = await db.execute(select(CreditNote).where(CreditNote.id == cn_id, CreditNote.organization_id == ctx.org_id))
    c = res.scalars().first()
    if not c:
        raise HttpError(404, "Credit note not found")
    now = datetime.utcnow()
    c.status = "refunded"
    c.refunded_at = now
    c.updated_at = now

    tx_ref = f"ref_{c.id[:8]}_{int(now.timestamp())}"
    pmt = Payment(
        organization_id=ctx.org_id,
        credit_note_id=c.id,
        transaction_reference=tx_ref,
        payment_type="refund",
        amount=c.amount,
        currency=c.currency,
        status="succeeded",
        created_at=now
    )
    db.add(pmt)
    await db.commit()
    return {"status": "refunded", "transactionReference": tx_ref}

# --- DLQ ---
@router.get("/dlq")
async def list_dlq(
    ctx: TenantContext = Depends(require_roles(["org_admin", "finance", "ops"])),
    db: AsyncSession = Depends(get_db)
):
    res = await db.execute(
        select(DeadLetterJob).where(DeadLetterJob.organization_id == ctx.org_id).order_by(DeadLetterJob.failed_at.desc())
    )
    jobs = res.scalars().all()
    return [
        {
            "id": j.id,
            "queueName": j.queue_name,
            "jobId": j.job_id,
            "jobName": j.job_name,
            "errorMessage": j.error_message,
            "status": j.status,
            "retryCount": j.retry_count,
            "failedAt": j.failed_at.isoformat() + "Z",
        }
        for j in jobs
    ]

@router.get("/dlq/{job_id}")
async def get_dlq(
    job_id: str,
    ctx: TenantContext = Depends(require_roles(["org_admin", "finance", "ops"])),
    db: AsyncSession = Depends(get_db)
):
    res = await db.execute(select(DeadLetterJob).where(DeadLetterJob.id == job_id, DeadLetterJob.organization_id == ctx.org_id))
    j = res.scalars().first()
    if not j:
        raise HttpError(404, "DLQ job not found")
    return {
        "id": j.id,
        "queueName": j.queue_name,
        "jobId": j.job_id,
        "jobName": j.job_name,
        "payload": j.payload,
        "errorMessage": j.error_message,
        "status": j.status,
        "retryCount": j.retry_count,
        "failedAt": j.failed_at.isoformat() + "Z",
    }

@router.post("/dlq/{job_id}/retry")
async def retry_dlq(
    job_id: str,
    ctx: TenantContext = Depends(require_roles(["org_admin", "finance", "ops"])),
    db: AsyncSession = Depends(get_db)
):
    res = await db.execute(select(DeadLetterJob).where(DeadLetterJob.id == job_id, DeadLetterJob.organization_id == ctx.org_id))
    j = res.scalars().first()
    if not j:
        raise HttpError(404, "DLQ job not found")
    j.status = "retried"
    j.retry_count += 1
    j.resolved_at = datetime.utcnow()
    await db.commit()
    return {"status": "retried"}

@router.post("/dlq/{job_id}/dismiss")
async def dismiss_dlq(
    job_id: str,
    ctx: TenantContext = Depends(require_roles(["org_admin", "finance", "ops"])),
    db: AsyncSession = Depends(get_db)
):
    res = await db.execute(select(DeadLetterJob).where(DeadLetterJob.id == job_id, DeadLetterJob.organization_id == ctx.org_id))
    j = res.scalars().first()
    if not j:
        raise HttpError(404, "DLQ job not found")
    j.status = "dismissed"
    j.resolved_at = datetime.utcnow()
    await db.commit()
    return {"status": "dismissed"}

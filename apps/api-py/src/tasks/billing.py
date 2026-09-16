import asyncio
from datetime import datetime, timedelta
from decimal import Decimal
from sqlalchemy import select, func
from src.lib.celery_app import celery_app
from src.lib.logger import logger
from src.lib.socket import emit_to_org
from src.database import AsyncSessionLocal
from src.models import (
    Organization, Subscription, BillingSchedule, Invoice,
    InvoiceLine, CreditNote, Quotation
)

def add_billing_period(start_date: datetime, frequency: str, period_index: int):
    # Approximation for periods
    if frequency == "annual":
        start = start_date.replace(year=start_date.year + period_index)
        end = start_date.replace(year=start_date.year + period_index + 1) - timedelta(days=1)
    elif frequency == "quarterly":
        months = period_index * 3
        year_add = (start_date.month + months - 1) // 12
        new_month = (start_date.month + months - 1) % 12 + 1
        start = start_date.replace(year=start_date.year + year_add, month=new_month)
        
        months_end = (period_index + 1) * 3
        year_add_end = (start_date.month + months_end - 1) // 12
        new_month_end = (start_date.month + months_end - 1) % 12 + 1
        end = start_date.replace(year=start_date.year + year_add_end, month=new_month_end) - timedelta(days=1)
    else: # monthly
        year_add = (start_date.month + period_index - 1) // 12
        new_month = (start_date.month + period_index - 1) % 12 + 1
        start = start_date.replace(year=start_date.year + year_add, month=new_month)

        year_add_end = (start_date.month + period_index) // 12
        new_month_end = (start_date.month + period_index) % 12 + 1
        end = start_date.replace(year=start_date.year + year_add_end, month=new_month_end) - timedelta(days=1)

    end = end.replace(hour=23, minute=59, second=59, microsecond=999999)
    due = start + timedelta(days=14)
    return start, end, due

async def _process_billing_schedule(payload: dict):
    org_id = payload.get("orgId")
    quotation_id = payload.get("quotationId")
    sub_id = payload.get("subscriptionId")

    async with AsyncSessionLocal() as db:
        query = select(Subscription).where(
            Subscription.organization_id == org_id,
            Subscription.quotation_id == quotation_id,
            Subscription.status == "active"
        )
        if sub_id:
            query = query.where(Subscription.id == sub_id)

        subs_res = await db.execute(query)
        subs = subs_res.scalars().all()
        if not subs:
            return

        total_created = 0
        for sub in subs:
            # Check existing count
            sched_res = await db.execute(
                select(BillingSchedule).where(
                    BillingSchedule.organization_id == org_id,
                    BillingSchedule.subscription_id == sub.id
                )
            )
            existing = sched_res.scalars().all()
            if existing:
                continue

            cycles = 12 if sub.billing_frequency in ("monthly", "one_time") else (4 if sub.billing_frequency == "quarterly" else 1)
            start_date = sub.start_date or datetime.utcnow()

            for i in range(cycles):
                p_start, p_end, due = add_billing_period(start_date, sub.billing_frequency, i)
                sched = BillingSchedule(
                    organization_id=org_id,
                    quotation_id=quotation_id,
                    subscription_id=sub.id,
                    period_number=i + 1,
                    period_start=p_start,
                    period_end=p_end,
                    due_date=due,
                    expected_amount=sub.recurring_amount,
                    currency=sub.currency,
                    status="pending",
                    created_at=datetime.utcnow(),
                    updated_at=datetime.utcnow()
                )
                db.add(sched)
                total_created += 1

        if total_created > 0:
            await db.commit()
            logger.info(f"Generated {total_created} billing schedule periods for quote {quotation_id}")
            await emit_to_org(org_id, "billing:schedules_updated", {
                "quotationId": quotation_id,
                "periodsCreated": total_created
            })

async def _process_proration(payload: dict):
    org_id = payload.get("orgId")
    sub_id = payload.get("subscriptionId")
    new_qty = payload.get("newQuantity")
    reason = payload.get("reason", "Mid-cycle subscription quantity change")

    if not org_id or not sub_id or new_qty is None:
        return

    async with AsyncSessionLocal() as db:
        sub_res = await db.execute(select(Subscription).where(Subscription.id == sub_id, Subscription.organization_id == org_id))
        sub = sub_res.scalars().first()
        if not sub:
            return

        old_qty = sub.quantity
        if old_qty == new_qty:
            return

        unit_price = sub.unit_price
        disc_pct = sub.discount_percent
        new_recurring = (unit_price * Decimal(new_qty)) * (Decimal("1.00") - (disc_pct / Decimal("100.00")))

        # Proration math: credit if reduction, charge if increase
        qty_diff = new_qty - old_qty
        now = datetime.utcnow()
        period_start = sub.current_period_start or now
        period_end = sub.current_period_end or (now + timedelta(days=30))
        total_days = max(1, (period_end - period_start).days)
        remaining_days = max(0, (period_end - now).days)
        fraction_remaining = Decimal(remaining_days) / Decimal(total_days)

        amount_delta = (unit_price * Decimal(abs(qty_diff))) * (Decimal("1.00") - (disc_pct / Decimal("100.00")))
        prorated_amount = (amount_delta * fraction_remaining).quantize(Decimal("0.01"))

        sub.quantity = new_qty
        sub.recurring_amount = new_recurring.quantize(Decimal("0.01"))
        sub.updated_at = now

        # If quantity reduced, generate CreditNote
        if qty_diff < 0 and prorated_amount > Decimal("0.00"):
            org_res = await db.execute(select(Organization).where(Organization.id == org_id))
            org = org_res.scalars().first()
            slug = (org.slug if org else "ORG").upper().replace("-", "")
            year = now.year
            cn_count_res = await db.execute(select(func.count()).select_from(CreditNote).where(CreditNote.organization_id == org_id))
            cn_count = cn_count_res.scalar() or 0
            cn_num = f"{slug}-CN-{year}-{str(cn_count + 1).zfill(4)}"

            credit_note = CreditNote(
                organization_id=org_id,
                credit_note_number=cn_num,
                quotation_id=sub.quotation_id,
                subscription_id=sub.id,
                amount=prorated_amount,
                currency=sub.currency,
                reason=reason,
                status="issued",
                created_at=now,
                updated_at=now
            )
            db.add(credit_note)

        await db.commit()
        logger.info(f"Proration processed for subscription {sub_id} in org {org_id}: {old_qty} -> {new_qty}")
        await emit_to_org(org_id, "billing:subscription_prorated", {
            "subscriptionId": sub_id,
            "oldQuantity": old_qty,
            "newQuantity": new_qty
        })

@celery_app.task(name="src.tasks.billing.generate_schedule")
def generate_schedule(payload: dict):
    logger.info(f"RabbitMQ task: generate_schedule for quote {payload.get('quotationId')}")
    asyncio.run(_process_billing_schedule(payload))

@celery_app.task(name="src.tasks.billing.modify_quantity")
def modify_quantity(payload: dict):
    logger.info(f"RabbitMQ task: modify_quantity for sub {payload.get('subscriptionId')}")
    asyncio.run(_process_proration(payload))

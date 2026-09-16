import asyncio
from datetime import datetime, timedelta
from decimal import Decimal
from sqlalchemy import select
from src.lib.celery_app import celery_app
from src.lib.logger import logger
from src.lib.socket import emit_to_org
from src.lib.mailer import send_deal_health_alert_email
from src.database import AsyncSessionLocal
from src.models import Organization, Quotation, DealHealthAlert, User

async def _scan_deal_health_for_org(org_id: str):
    async with AsyncSessionLocal() as db:
        org_res = await db.execute(select(Organization).where(Organization.id == org_id, Organization.status == "active"))
        org = org_res.scalars().first()
        if not org:
            return

        quotes_res = await db.execute(
            select(Quotation).where(
                Quotation.organization_id == org_id,
                Quotation.status.in_(["draft", "pending_approval", "sent", "negotiating"])
            )
        )
        quotes = quotes_res.scalars().all()
        now = datetime.utcnow()
        new_alerts = 0

        for q in quotes:
            # 1. Stalled quote check (> 7 days inactive)
            age = (now - q.updated_at).total_seconds() / 86400
            if age > 7.0:
                exist_res = await db.execute(
                    select(DealHealthAlert).where(
                        DealHealthAlert.organization_id == org_id,
                        DealHealthAlert.quotation_id == q.id,
                        DealHealthAlert.alert_type == "stalled_quote",
                        DealHealthAlert.status == "open"
                    )
                )
                if not exist_res.scalars().first():
                    alert = DealHealthAlert(
                        organization_id=org_id,
                        quotation_id=q.id,
                        rep_id=q.rep_id,
                        alert_type="stalled_quote",
                        severity="medium" if age < 14 else "high",
                        title=f"Quote {q.quotation_number} Stalled",
                        detail=f"Quote has had no activity for {int(age)} days in status '{q.status}'.",
                        status="open",
                        created_at=now,
                        updated_at=now
                    )
                    db.add(alert)
                    new_alerts += 1

            # 2. Discount anomaly check
            if q.order_discount_percent > Decimal("20.00") or q.risk_score > Decimal("60.00"):
                exist_res = await db.execute(
                    select(DealHealthAlert).where(
                        DealHealthAlert.organization_id == org_id,
                        DealHealthAlert.quotation_id == q.id,
                        DealHealthAlert.alert_type == "discount_anomaly",
                        DealHealthAlert.status == "open"
                    )
                )
                if not exist_res.scalars().first():
                    alert = DealHealthAlert(
                        organization_id=org_id,
                        quotation_id=q.id,
                        rep_id=q.rep_id,
                        alert_type="discount_anomaly",
                        severity="high",
                        title=f"High Discount Risk: {q.quotation_number}",
                        detail=f"Quote discount is {q.order_discount_percent}% with risk score {q.risk_score}.",
                        status="open",
                        created_at=now,
                        updated_at=now
                    )
                    db.add(alert)
                    new_alerts += 1

        if new_alerts > 0:
            await db.commit()
            logger.info(f"Scan complete for org {org_id}: created {new_alerts} alerts")
            await emit_to_org(org_id, "dealhealth:alerts_updated", {"count": new_alerts})

@celery_app.task(name="src.tasks.dealhealth.scan_org")
def scan_org(payload: dict):
    org_id = payload.get("orgId")
    logger.info(f"RabbitMQ task: scan_org for {org_id}")
    if org_id:
        asyncio.run(_scan_deal_health_for_org(org_id))

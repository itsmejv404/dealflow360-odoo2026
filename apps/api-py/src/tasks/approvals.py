import asyncio
from src.lib.celery_app import celery_app
from src.lib.logger import logger
from src.lib.mailer import (
    send_approval_requested_email,
    send_approval_decision_email,
    send_negotiation_activity_email,
    send_quote_confirmed_email,
)
from src.database import AsyncSessionLocal
from src.models import Organization
from sqlalchemy import select

async def _process_approval_notification(payload: dict):
    org_id = payload.get("orgId")
    type_ = payload.get("type")
    recipients = payload.get("recipients", [])

    if not org_id or not recipients:
        return

    async with AsyncSessionLocal() as db:
        org_res = await db.execute(select(Organization).where(Organization.id == org_id))
        org = org_res.scalars().first()
        if not org:
            logger.warning(f"Org {org_id} not found for approval notification")
            return

        payload["orgName"] = org.name

        if type_ == "manager_review_requested":
            payload["stage"] = "manager"
            send_approval_requested_email(payload)
        elif type_ == "finance_escalation_requested":
            payload["stage"] = "finance"
            send_approval_requested_email(payload)
        elif type_ == "decision_rendered":
            send_approval_decision_email(payload)
        elif type_ in ("counter_received", "change_request_received", "comment"):
            send_negotiation_activity_email(payload)
        elif type_ in ("quote_confirmed", "quote_confirmed_reapproval"):
            send_quote_confirmed_email(payload)

@celery_app.task(name="src.tasks.approvals.notify")
def process_approval_notification(payload: dict):
    logger.info(f"RabbitMQ task: process_approval_notification for org {payload.get('orgId')}")
    asyncio.run(_process_approval_notification(payload))

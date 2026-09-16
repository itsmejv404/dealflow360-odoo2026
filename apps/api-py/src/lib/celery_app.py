from celery import Celery
from src.config.env import settings

celery_app = Celery(
    "dealflow360",
    broker=settings.RABBITMQ_URL,
    backend="rpc://",
    include=[
        "src.tasks.approvals",
        "src.tasks.fulfillment",
        "src.tasks.billing",
        "src.tasks.dealhealth",
    ]
)

celery_app.conf.update(
    task_serializer="json",
    accept_content=["json"],
    result_serializer="json",
    timezone="UTC",
    enable_utc=True,
    task_default_queue="default",
    task_routes={
        "src.tasks.approvals.*": {"queue": "org_approval_notifications"},
        "src.tasks.fulfillment.*": {"queue": "org_backorder_consolidation"},
        "src.tasks.billing.generate_schedule": {"queue": "org_billing_schedules"},
        "src.tasks.billing.modify_quantity": {"queue": "org_proration_runs"},
        "src.tasks.dealhealth.*": {"queue": "org_deal_health_scans"},
    },
)

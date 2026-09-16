from datetime import datetime
from typing import Optional
from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func
from src.database import get_db
from src.models import DealHealthAlert, Quotation, User
from src.shared.tenant import get_tenant_context, require_roles, TenantContext
from src.shared.errors import HttpError
from src.lib.socket import emit_to_org

router = APIRouter(prefix="/api/dealhealth", tags=["DealHealth"])

class NudgeRequest(BaseModel):
    message: Optional[str] = None

@router.get("/alerts")
async def list_alerts(
    status: Optional[str] = Query(None),
    severity: Optional[str] = Query(None),
    ctx: TenantContext = Depends(get_tenant_context),
    db: AsyncSession = Depends(get_db)
):
    query = select(DealHealthAlert).where(DealHealthAlert.organization_id == ctx.org_id)
    if status:
        query = query.where(DealHealthAlert.status == status)
    if severity:
        query = query.where(DealHealthAlert.severity == severity)
    query = query.order_by(DealHealthAlert.created_at.desc())

    res = await db.execute(query)
    alerts = res.scalars().all()

    q_ids = [a.quotation_id for a in alerts if a.quotation_id]
    quotes_res = await db.execute(select(Quotation).where(Quotation.id.in_(q_ids)))
    quotes_map = {q.id: q.quotation_number for q in quotes_res.scalars().all()}

    rep_ids = [a.rep_id for a in alerts if a.rep_id]
    reps_res = await db.execute(select(User).where(User.id.in_(rep_ids)))
    reps_map = {u.id: {"id": u.id, "name": u.name, "email": u.email} for u in reps_res.scalars().all()}

    return [
        {
            "id": a.id,
            "quotationId": a.quotation_id,
            "quotationNumber": quotes_map.get(a.quotation_id),
            "repId": a.rep_id,
            "rep": reps_map.get(a.rep_id),
            "alertType": a.alert_type,
            "severity": a.severity,
            "title": a.title,
            "detail": a.detail,
            "status": a.status,
            "nudgedAt": a.nudged_at.isoformat() + "Z" if a.nudged_at else None,
            "resolvedAt": a.resolved_at.isoformat() + "Z" if a.resolved_at else None,
            "createdAt": a.created_at.isoformat() + "Z",
        }
        for a in alerts
    ]

@router.get("/alerts/{alert_id}")
async def get_alert(
    alert_id: str,
    ctx: TenantContext = Depends(get_tenant_context),
    db: AsyncSession = Depends(get_db)
):
    res = await db.execute(select(DealHealthAlert).where(DealHealthAlert.id == alert_id, DealHealthAlert.organization_id == ctx.org_id))
    a = res.scalars().first()
    if not a:
        raise HttpError(404, "Alert not found")

    q = None
    if a.quotation_id:
        q_res = await db.execute(select(Quotation).where(Quotation.id == a.quotation_id))
        q = q_res.scalars().first()

    rep = None
    if a.rep_id:
        rep_res = await db.execute(select(User).where(User.id == a.rep_id))
        rep = rep_res.scalars().first()

    return {
        "id": a.id,
        "quotationId": a.quotation_id,
        "quotationNumber": q.quotation_number if q else None,
        "rep": {"id": rep.id, "name": rep.name, "email": rep.email} if rep else None,
        "alertType": a.alert_type,
        "severity": a.severity,
        "title": a.title,
        "detail": a.detail,
        "status": a.status,
        "createdAt": a.created_at.isoformat() + "Z",
    }

@router.get("/summary")
async def get_summary(
    ctx: TenantContext = Depends(get_tenant_context),
    db: AsyncSession = Depends(get_db)
):
    open_res = await db.execute(
        select(func.count()).select_from(DealHealthAlert).where(
            DealHealthAlert.organization_id == ctx.org_id,
            DealHealthAlert.status == "open"
        )
    )
    open_count = open_res.scalar() or 0

    high_res = await db.execute(
        select(func.count()).select_from(DealHealthAlert).where(
            DealHealthAlert.organization_id == ctx.org_id,
            DealHealthAlert.status == "open",
            DealHealthAlert.severity == "high"
        )
    )
    high_count = high_res.scalar() or 0

    return {
        "openAlertsCount": open_count,
        "highSeverityCount": high_count,
        "status": "warning" if high_count > 0 else ("attention" if open_count > 0 else "healthy")
    }

@router.post("/alerts/{alert_id}/nudge")
async def nudge_alert(
    alert_id: str,
    req: Optional[NudgeRequest] = None,
    ctx: TenantContext = Depends(require_roles(["org_admin", "manager", "finance"])),
    db: AsyncSession = Depends(get_db)
):
    res = await db.execute(select(DealHealthAlert).where(DealHealthAlert.id == alert_id, DealHealthAlert.organization_id == ctx.org_id))
    a = res.scalars().first()
    if not a:
        raise HttpError(404, "Alert not found")

    a.status = "nudged"
    a.nudged_at = datetime.utcnow()
    a.updated_at = datetime.utcnow()
    await db.commit()

    await emit_to_org(ctx.org_id, "dealhealth:alert_nudged", {"alertId": a.id})
    return {"status": "nudged"}

@router.post("/alerts/{alert_id}/resolve")
async def resolve_alert(
    alert_id: str,
    ctx: TenantContext = Depends(require_roles(["org_admin", "manager", "finance"])),
    db: AsyncSession = Depends(get_db)
):
    res = await db.execute(select(DealHealthAlert).where(DealHealthAlert.id == alert_id, DealHealthAlert.organization_id == ctx.org_id))
    a = res.scalars().first()
    if not a:
        raise HttpError(404, "Alert not found")

    a.status = "resolved"
    a.resolved_at = datetime.utcnow()
    a.updated_at = datetime.utcnow()
    await db.commit()

    await emit_to_org(ctx.org_id, "dealhealth:alert_resolved", {"alertId": a.id})
    return {"status": "resolved"}

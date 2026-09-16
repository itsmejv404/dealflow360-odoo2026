from datetime import datetime
from decimal import Decimal
from typing import Optional, List
from fastapi import APIRouter, Depends
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func
from src.database import get_db
from src.models import (
    Quotation, ApprovalRequest, AuditLog, User, Customer, Organization
)
from src.shared.tenant import get_tenant_context, require_roles, TenantContext
from src.shared.errors import HttpError
from src.lib.socket import emit_to_org, emit_to_quote
from src.tasks.approvals import process_approval_notification

router = APIRouter(prefix="/api/approvals", tags=["Approvals"])

class ActionRequest(BaseModel):
    reason: Optional[str] = "Approved"

class SubmitRequest(BaseModel):
    notes: Optional[str] = None

@router.post("/submit/{quote_id}")
async def submit_for_approval(
    quote_id: str,
    req: Optional[SubmitRequest] = None,
    ctx: TenantContext = Depends(get_tenant_context),
    db: AsyncSession = Depends(get_db)
):
    res = await db.execute(select(Quotation).where(Quotation.id == quote_id, Quotation.organization_id == ctx.org_id))
    quote = res.scalars().first()
    if not quote:
        raise HttpError(404, "Quotation not found")

    if quote.status == "approved":
        raise HttpError(400, "Quotation is already approved")

    now = datetime.utcnow()
    routing = quote.approval_routing

    if routing == "none":
        quote.status = "approved"
        quote.updated_at = now
        audit = AuditLog(
            organization_id=ctx.org_id,
            entity_type="quotation",
            entity_id=quote.id,
            user_id=ctx.user_id,
            user_email=ctx.email,
            user_role=ctx.role,
            action="auto_approved",
            reason="Within rulebook discount ceilings — auto-approved",
            created_at=now
        )
        db.add(audit)
        await db.commit()
        await emit_to_org(ctx.org_id, "quote:approved", {"quotationId": quote.id})
        return {"status": "approved", "message": "Quote auto-approved"}

    # Route to manager
    quote.status = "pending_approval"
    quote.updated_at = now

    approval_req = ApprovalRequest(
        organization_id=ctx.org_id,
        quotation_id=quote.id,
        stage="manager",
        status="pending",
        assigned_role="manager",
        requested_by_id=ctx.user_id,
        reason=req.notes if req else None,
        created_at=now,
        updated_at=now
    )
    db.add(approval_req)

    audit = AuditLog(
        organization_id=ctx.org_id,
        entity_type="quotation",
        entity_id=quote.id,
        user_id=ctx.user_id,
        user_email=ctx.email,
        user_role=ctx.role,
        action="submitted_for_approval",
        reason=req.notes if req else "Submitted for manager approval",
        created_at=now
    )
    db.add(audit)
    await db.commit()

    # Find manager recipients
    mgrs_res = await db.execute(
        select(User.email).where(User.organization_id == ctx.org_id, User.role.in_(["manager", "org_admin"]))
    )
    recipients = [r for r in mgrs_res.scalars().all() if r]

    process_approval_notification.delay({
        "orgId": ctx.org_id,
        "type": "manager_review_requested",
        "quotationId": quote.id,
        "quotationNumber": quote.quotation_number,
        "requestedByEmail": ctx.email,
        "requestedByName": ctx.email.split("@")[0] if ctx.email else "Rep",
        "riskScore": float(quote.risk_score),
        "riskLevel": quote.risk_level,
        "recipients": recipients,
    })

    await emit_to_org(ctx.org_id, "approval:requested", {"quotationId": quote.id, "stage": "manager"})
    return {"status": "pending_approval", "stage": "manager"}

@router.post("/approve/{quote_id}")
async def approve(
    quote_id: str,
    req: ActionRequest,
    ctx: TenantContext = Depends(require_roles(["manager", "finance", "org_admin"])),
    db: AsyncSession = Depends(get_db)
):
    res = await db.execute(select(Quotation).where(Quotation.id == quote_id, Quotation.organization_id == ctx.org_id))
    quote = res.scalars().first()
    if not quote:
        raise HttpError(404, "Quotation not found")

    pending_req_res = await db.execute(
        select(ApprovalRequest).where(
            ApprovalRequest.quotation_id == quote.id,
            ApprovalRequest.organization_id == ctx.org_id,
            ApprovalRequest.status == "pending"
        ).order_by(ApprovalRequest.created_at.desc())
    )
    appr_req = pending_req_res.scalars().first()
    now = datetime.utcnow()

    # If manager approves but routing requires finance:
    if appr_req and appr_req.stage == "manager" and quote.approval_routing == "manager_finance":
        appr_req.status = "approved"
        appr_req.actioned_by_id = ctx.user_id
        appr_req.actioned_at = now
        appr_req.reason = req.reason
        appr_req.updated_at = now

        # Create finance stage
        fin_req = ApprovalRequest(
            organization_id=ctx.org_id,
            quotation_id=quote.id,
            stage="finance",
            status="pending",
            assigned_role="finance",
            requested_by_id=ctx.user_id,
            reason="Escalated to finance",
            created_at=now,
            updated_at=now
        )
        db.add(fin_req)

        audit = AuditLog(
            organization_id=ctx.org_id,
            entity_type="quotation",
            entity_id=quote.id,
            user_id=ctx.user_id,
            user_email=ctx.email,
            user_role=ctx.role,
            action="finance_escalated",
            reason=req.reason,
            created_at=now
        )
        db.add(audit)
        await db.commit()

        fin_users_res = await db.execute(
            select(User.email).where(User.organization_id == ctx.org_id, User.role.in_(["finance", "org_admin"]))
        )
        recipients = [r for r in fin_users_res.scalars().all() if r]

        process_approval_notification.delay({
            "orgId": ctx.org_id,
            "type": "finance_escalation_requested",
            "quotationId": quote.id,
            "quotationNumber": quote.quotation_number,
            "requestedByEmail": ctx.email,
            "riskScore": float(quote.risk_score),
            "riskLevel": quote.risk_level,
            "recipients": recipients,
        })
        return {"status": "escalated_to_finance"}

    # Final approval
    if appr_req:
        appr_req.status = "approved"
        appr_req.actioned_by_id = ctx.user_id
        appr_req.actioned_at = now
        appr_req.reason = req.reason
        appr_req.updated_at = now

    quote.status = "approved"
    quote.updated_at = now

    action_name = "finance_approved" if appr_req and appr_req.stage == "finance" else "manager_approved"
    audit = AuditLog(
        organization_id=ctx.org_id,
        entity_type="quotation",
        entity_id=quote.id,
        user_id=ctx.user_id,
        user_email=ctx.email,
        user_role=ctx.role,
        action=action_name,
        reason=req.reason,
        created_at=now
    )
    db.add(audit)
    await db.commit()

    await emit_to_org(ctx.org_id, "quote:approved", {"quotationId": quote.id})
    return {"status": "approved"}

@router.post("/reject/{quote_id}")
async def reject(
    quote_id: str,
    req: ActionRequest,
    ctx: TenantContext = Depends(require_roles(["manager", "finance", "org_admin"])),
    db: AsyncSession = Depends(get_db)
):
    res = await db.execute(select(Quotation).where(Quotation.id == quote_id, Quotation.organization_id == ctx.org_id))
    quote = res.scalars().first()
    if not quote:
        raise HttpError(404, "Quotation not found")

    now = datetime.utcnow()
    pending_req_res = await db.execute(
        select(ApprovalRequest).where(
            ApprovalRequest.quotation_id == quote.id,
            ApprovalRequest.organization_id == ctx.org_id,
            ApprovalRequest.status == "pending"
        )
    )
    appr_req = pending_req_res.scalars().first()
    if appr_req:
        appr_req.status = "rejected"
        appr_req.actioned_by_id = ctx.user_id
        appr_req.actioned_at = now
        appr_req.reason = req.reason
        appr_req.updated_at = now

    quote.status = "rejected"
    quote.updated_at = now

    audit = AuditLog(
        organization_id=ctx.org_id,
        entity_type="quotation",
        entity_id=quote.id,
        user_id=ctx.user_id,
        user_email=ctx.email,
        user_role=ctx.role,
        action="rejected",
        reason=req.reason,
        created_at=now
    )
    db.add(audit)
    await db.commit()

    await emit_to_org(ctx.org_id, "quote:rejected", {"quotationId": quote.id})
    return {"status": "rejected"}

@router.get("/pending")
async def get_pending(
    ctx: TenantContext = Depends(require_roles(["manager", "finance", "org_admin"])),
    db: AsyncSession = Depends(get_db)
):
    query = select(ApprovalRequest).where(
        ApprovalRequest.organization_id == ctx.org_id,
        ApprovalRequest.status == "pending"
    )
    if ctx.role == "manager":
        query = query.where(ApprovalRequest.assigned_role == "manager")
    elif ctx.role == "finance":
        query = query.where(ApprovalRequest.assigned_role == "finance")

    query = query.order_by(ApprovalRequest.created_at.desc())
    res = await db.execute(query)
    reqs = res.scalars().all()

    quote_ids = [r.quotation_id for r in reqs]
    quotes_res = await db.execute(select(Quotation).where(Quotation.id.in_(quote_ids)))
    quotes_map = {q.id: q for q in quotes_res.scalars().all()}

    return [
        {
            "id": r.id,
            "quotationId": r.quotation_id,
            "quotationNumber": quotes_map[r.quotation_id].quotation_number if r.quotation_id in quotes_map else "",
            "totalAmount": float(quotes_map[r.quotation_id].total_amount) if r.quotation_id in quotes_map else 0.0,
            "riskScore": float(quotes_map[r.quotation_id].risk_score) if r.quotation_id in quotes_map else 0.0,
            "riskLevel": quotes_map[r.quotation_id].risk_level if r.quotation_id in quotes_map else "low",
            "stage": r.stage,
            "status": r.status,
            "assignedRole": r.assigned_role,
            "createdAt": r.created_at.isoformat() + "Z",
        }
        for r in reqs
    ]

@router.get("/quotation/{quote_id}/audit")
async def get_quotation_audit(
    quote_id: str,
    ctx: TenantContext = Depends(get_tenant_context),
    db: AsyncSession = Depends(get_db)
):
    logs_res = await db.execute(
        select(AuditLog).where(
            AuditLog.organization_id == ctx.org_id,
            AuditLog.entity_type == "quotation",
            AuditLog.entity_id == quote_id
        ).order_by(AuditLog.created_at.desc())
    )
    logs = logs_res.scalars().all()
    return [
        {
            "id": l.id,
            "action": l.action,
            "reason": l.reason,
            "userId": l.user_id,
            "userEmail": l.user_email,
            "userRole": l.user_role,
            "createdAt": l.created_at.isoformat() + "Z",
        }
        for l in logs
    ]

@router.get("/audit-logs")
async def get_org_audit(
    ctx: TenantContext = Depends(require_roles(["org_admin", "manager"])),
    db: AsyncSession = Depends(get_db)
):
    logs_res = await db.execute(
        select(AuditLog).where(AuditLog.organization_id == ctx.org_id).order_by(AuditLog.created_at.desc()).limit(100)
    )
    logs = logs_res.scalars().all()
    return [
        {
            "id": l.id,
            "entityType": l.entity_type,
            "entityId": l.entity_id,
            "action": l.action,
            "reason": l.reason,
            "userId": l.user_id,
            "userEmail": l.user_email,
            "userRole": l.user_role,
            "createdAt": l.created_at.isoformat() + "Z",
        }
        for l in logs
    ]

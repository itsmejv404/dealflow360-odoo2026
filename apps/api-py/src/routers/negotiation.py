from datetime import datetime
from decimal import Decimal
from typing import Optional, Literal
from fastapi import APIRouter, Depends
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from src.database import get_db
from src.models import (
    Quotation, QuotationLine, NegotiationComment, ChangeRequest, CounterProposal, AuditLog
)
from src.shared.tenant import require_roles, TenantContext
from src.shared.errors import HttpError
from src.lib.socket import emit_to_quote
from src.tasks.approvals import process_approval_notification

router = APIRouter(prefix="/api/negotiation", tags=["Negotiation"])

class InternalCommentRequest(BaseModel):
    lineId: Optional[str] = None
    body: str

class ResolveRequest(BaseModel):
    action: Literal["accept", "decline"]
    note: Optional[str] = None

@router.get("/{quote_id}")
async def list_negotiation(
    quote_id: str,
    ctx: TenantContext = Depends(require_roles(["org_admin", "rep", "manager", "finance", "ops"])),
    db: AsyncSession = Depends(get_db)
):
    q_res = await db.execute(select(Quotation).where(Quotation.id == quote_id, Quotation.organization_id == ctx.org_id))
    quote = q_res.scalars().first()
    if not quote:
        raise HttpError(404, "Quotation not found")

    comm_res = await db.execute(
        select(NegotiationComment).where(
            NegotiationComment.quotation_id == quote.id,
            NegotiationComment.organization_id == ctx.org_id
        ).order_by(NegotiationComment.created_at.asc())
    )
    comments = [
        {
            "id": c.id,
            "lineId": c.line_id,
            "authorType": c.author_type,
            "authorName": c.author_name,
            "authorEmail": c.author_email,
            "body": c.body,
            "createdAt": c.created_at.isoformat() + "Z",
        }
        for c in comm_res.scalars().all()
    ]

    cr_res = await db.execute(
        select(ChangeRequest).where(
            ChangeRequest.quotation_id == quote.id,
            ChangeRequest.organization_id == ctx.org_id
        ).order_by(ChangeRequest.created_at.desc())
    )
    change_requests = [
        {
            "id": cr.id,
            "lineId": cr.line_id,
            "requestType": cr.request_type,
            "proposedQuantity": cr.proposed_quantity,
            "proposedDiscountPercent": float(cr.proposed_discount_percent) if cr.proposed_discount_percent is not None else None,
            "note": cr.note,
            "status": cr.status,
            "requestedByType": cr.requested_by_type,
            "requestedByName": cr.requested_by_name,
            "requestedByEmail": cr.requested_by_email,
            "resolvedAt": cr.resolved_at.isoformat() + "Z" if cr.resolved_at else None,
            "resolutionNote": cr.resolution_note,
            "createdAt": cr.created_at.isoformat() + "Z",
        }
        for cr in cr_res.scalars().all()
    ]

    cp_res = await db.execute(
        select(CounterProposal).where(
            CounterProposal.quotation_id == quote.id,
            CounterProposal.organization_id == ctx.org_id
        ).order_by(CounterProposal.created_at.desc())
    )
    counter_proposals = [
        {
            "id": cp.id,
            "lineId": cp.line_id,
            "proposedDiscountPercent": float(cp.proposed_discount_percent),
            "note": cp.note,
            "status": cp.status,
            "proposedByType": cp.proposed_by_type,
            "proposedByName": cp.proposed_by_name,
            "proposedByEmail": cp.proposed_by_email,
            "decidedAt": cp.decided_at.isoformat() + "Z" if cp.decided_at else None,
            "decisionNote": cp.decision_note,
            "createdAt": cp.created_at.isoformat() + "Z",
        }
        for cp in cp_res.scalars().all()
    ]

    return {
        "comments": comments,
        "changeRequests": change_requests,
        "counterProposals": counter_proposals,
    }

@router.post("/{quote_id}/comments")
async def post_comment(
    quote_id: str,
    req: InternalCommentRequest,
    ctx: TenantContext = Depends(require_roles(["org_admin", "rep", "manager", "finance", "ops"])),
    db: AsyncSession = Depends(get_db)
):
    q_res = await db.execute(select(Quotation).where(Quotation.id == quote_id, Quotation.organization_id == ctx.org_id))
    quote = q_res.scalars().first()
    if not quote:
        raise HttpError(404, "Quotation not found")

    now = datetime.utcnow()
    comment = NegotiationComment(
        organization_id=ctx.org_id,
        quotation_id=quote.id,
        line_id=req.lineId,
        author_type="internal",
        author_id=ctx.user_id,
        author_name=ctx.email.split("@")[0] if ctx.email else "Rep",
        author_email=ctx.email,
        body=req.body.strip(),
        created_at=now
    )
    db.add(comment)
    await db.commit()

    await emit_to_quote(ctx.org_id, quote.id, "negotiation:comment_added", {
        "quotationId": quote.id,
        "commentId": comment.id
    })

    return {
        "comment": {
            "id": comment.id,
            "lineId": comment.line_id,
            "authorType": comment.author_type,
            "authorName": comment.author_name,
            "authorEmail": comment.author_email,
            "body": comment.body,
            "createdAt": comment.created_at.isoformat() + "Z",
        }
    }

@router.post("/{quote_id}/change-requests/{request_id}/resolve")
async def resolve_change_request(
    quote_id: str,
    request_id: str,
    req: ResolveRequest,
    ctx: TenantContext = Depends(require_roles(["manager", "org_admin"])),
    db: AsyncSession = Depends(get_db)
):
    cr_res = await db.execute(
        select(ChangeRequest).where(
            ChangeRequest.id == request_id,
            ChangeRequest.quotation_id == quote_id,
            ChangeRequest.organization_id == ctx.org_id
        )
    )
    cr = cr_res.scalars().first()
    if not cr:
        raise HttpError(404, "Change request not found")

    now = datetime.utcnow()
    cr.status = "accepted" if req.action == "accept" else "declined"
    cr.resolved_by_id = ctx.user_id
    cr.resolved_at = now
    cr.resolution_note = req.note

    audit = AuditLog(
        organization_id=ctx.org_id,
        entity_type="quotation",
        entity_id=quote_id,
        user_id=ctx.user_id,
        user_email=ctx.email,
        user_role=ctx.role,
        action=f"change_request_{req.action}ed",
        reason=req.note,
        created_at=now
    )
    db.add(audit)
    await db.commit()

    await emit_to_quote(ctx.org_id, quote_id, "negotiation:change_request_resolved", {
        "requestId": request_id,
        "status": cr.status
    })

    return {"status": cr.status}

@router.post("/{quote_id}/counters/{counter_id}/resolve")
async def resolve_counter_proposal(
    quote_id: str,
    counter_id: str,
    req: ResolveRequest,
    ctx: TenantContext = Depends(require_roles(["manager", "org_admin"])),
    db: AsyncSession = Depends(get_db)
):
    cp_res = await db.execute(
        select(CounterProposal).where(
            CounterProposal.id == counter_id,
            CounterProposal.quotation_id == quote_id,
            CounterProposal.organization_id == ctx.org_id
        )
    )
    cp = cp_res.scalars().first()
    if not cp:
        raise HttpError(404, "Counter proposal not found")

    now = datetime.utcnow()
    cp.status = "accepted" if req.action == "accept" else "declined"
    cp.decided_by_id = ctx.user_id
    cp.decided_at = now
    cp.decision_note = req.note

    audit = AuditLog(
        organization_id=ctx.org_id,
        entity_type="quotation",
        entity_id=quote_id,
        user_id=ctx.user_id,
        user_email=ctx.email,
        user_role=ctx.role,
        action=f"counter_{req.action}ed",
        reason=req.note,
        created_at=now
    )
    db.add(audit)
    await db.commit()

    await emit_to_quote(ctx.org_id, quote_id, "negotiation:counter_resolved", {
        "counterId": counter_id,
        "status": cp.status
    })

    return {"status": cp.status}

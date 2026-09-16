import secrets
from datetime import datetime, timedelta
from typing import Optional, Literal
from fastapi import APIRouter, Depends
from pydantic import BaseModel, EmailStr
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from src.database import get_db
from src.models import (
    User, Organization, OrganizationInvite, AuditLog, DeadLetterJob,
    ApprovalChainConfig, ShippingRuleConfig, PaymentGatewayConfig
)
from src.shared.jwt_utils import verify_password, sign_super_admin_token
from src.shared.tenant import get_super_admin, SuperAdminContext
from src.shared.errors import HttpError
from src.lib.mailer import send_invite_email

router = APIRouter(prefix="/api/platform", tags=["Platform"])

class PlatformLoginRequest(BaseModel):
    email: str
    password: str

class CreateOrgRequest(BaseModel):
    name: str
    slug: str
    currency: Optional[str] = "USD"
    timezone: Optional[str] = "UTC"

class UpdateOrgRequest(BaseModel):
    name: Optional[str] = None
    status: Optional[Literal["active", "suspended"]] = None

class InviteAdminRequest(BaseModel):
    email: str

@router.post("/auth/login")
async def login(req: PlatformLoginRequest, db: AsyncSession = Depends(get_db)):
    email = req.email.lower().strip()
    user_res = await db.execute(select(User).where(User.email == email))
    user = user_res.scalars().first()
    if not user or user.role != "super_admin":
        raise HttpError(401, "Invalid Super Admin credentials")

    if not verify_password(req.password, user.password_hash):
        raise HttpError(401, "Invalid Super Admin credentials")

    token = sign_super_admin_token({
        "sub": user.id,
        "email": user.email,
        "role": "super_admin"
    })

    return {
        "token": token,
        "user": {
            "id": user.id,
            "email": user.email,
            "role": user.role,
        }
    }

@router.get("/organizations")
async def list_organizations(
    _admin: SuperAdminContext = Depends(get_super_admin),
    db: AsyncSession = Depends(get_db)
):
    orgs_res = await db.execute(select(Organization).order_by(Organization.created_at.desc()))
    orgs = orgs_res.scalars().all()
    return [
        {
            "id": o.id,
            "name": o.name,
            "slug": o.slug,
            "status": o.status,
            "logoUrl": o.logo_url,
            "currency": o.currency,
            "timezone": o.timezone,
            "onboardingCompleted": o.onboarding_completed,
            "createdAt": o.created_at.isoformat() + "Z",
            "updatedAt": o.updated_at.isoformat() + "Z",
        }
        for o in orgs
    ]

@router.post("/organizations")
async def create_organization(
    req: CreateOrgRequest,
    _admin: SuperAdminContext = Depends(get_super_admin),
    db: AsyncSession = Depends(get_db)
):
    slug = req.slug.lower().strip()
    existing_res = await db.execute(select(Organization).where(Organization.slug == slug))
    if existing_res.scalars().first():
        raise HttpError(409, "Organization with this slug already exists")

    now = datetime.utcnow()
    org = Organization(
        name=req.name.strip(),
        slug=slug,
        status="active",
        currency=req.currency or "USD",
        timezone=req.timezone or "UTC",
        onboarding_completed=False,
        created_at=now,
        updated_at=now
    )
    db.add(org)
    await db.flush()

    # Create default configurations
    approval_config = ApprovalChainConfig(
        organization_id=org.id,
        manager_threshold_percent=0.00,
        finance_threshold_percent=15.00,
        require_finance_above_threshold=True,
        auto_approve_within_ceilings=True,
        created_at=now,
        updated_at=now
    )
    db.add(approval_config)

    shipping_config = ShippingRuleConfig(
        organization_id=org.id,
        allow_split_shipments=True,
        charge_for_split_shipments=False,
        delivery_extension_days=3,
        created_at=now,
        updated_at=now
    )
    db.add(shipping_config)

    gateway_config = PaymentGatewayConfig(
        organization_id=org.id,
        provider="sandbox",
        api_key=f"sb_key_{org.slug}",
        webhook_secret=f"sb_whsec_{org.slug}",
        auto_capture=True,
        is_enabled=True,
        created_at=now,
        updated_at=now
    )
    db.add(gateway_config)

    await db.commit()

    return {
        "id": org.id,
        "name": org.name,
        "slug": org.slug,
        "status": org.status,
        "createdAt": org.created_at.isoformat() + "Z",
    }

@router.get("/organizations/{org_id}")
async def get_organization(
    org_id: str,
    _admin: SuperAdminContext = Depends(get_super_admin),
    db: AsyncSession = Depends(get_db)
):
    org_res = await db.execute(select(Organization).where(Organization.id == org_id))
    org = org_res.scalars().first()
    if not org:
        raise HttpError(404, "Organization not found")

    return {
        "id": org.id,
        "name": org.name,
        "slug": org.slug,
        "status": org.status,
        "logoUrl": org.logo_url,
        "currency": org.currency,
        "timezone": org.timezone,
        "onboardingCompleted": org.onboarding_completed,
        "createdAt": org.created_at.isoformat() + "Z",
        "updatedAt": org.updated_at.isoformat() + "Z",
    }

@router.patch("/organizations/{org_id}")
async def update_organization(
    org_id: str,
    req: UpdateOrgRequest,
    _admin: SuperAdminContext = Depends(get_super_admin),
    db: AsyncSession = Depends(get_db)
):
    org_res = await db.execute(select(Organization).where(Organization.id == org_id))
    org = org_res.scalars().first()
    if not org:
        raise HttpError(404, "Organization not found")

    if req.name is not None:
        org.name = req.name
    if req.status is not None:
        org.status = req.status
    org.updated_at = datetime.utcnow()
    await db.commit()

    return {
        "id": org.id,
        "name": org.name,
        "slug": org.slug,
        "status": org.status,
        "updatedAt": org.updated_at.isoformat() + "Z",
    }

@router.post("/organizations/{org_id}/invites")
async def invite_org_admin(
    org_id: str,
    req: InviteAdminRequest,
    _admin: SuperAdminContext = Depends(get_super_admin),
    db: AsyncSession = Depends(get_db)
):
    email = req.email.lower().strip()
    org_res = await db.execute(select(Organization).where(Organization.id == org_id))
    org = org_res.scalars().first()
    if not org:
        raise HttpError(404, "Organization not found")

    token = secrets.token_hex(32)
    expires_at = datetime.utcnow() + timedelta(days=7)
    invite = OrganizationInvite(
        organization_id=org_id,
        email=email,
        role="org_admin",
        token=token,
        expires_at=expires_at,
        created_at=datetime.utcnow(),
        updated_at=datetime.utcnow()
    )
    db.add(invite)
    await db.commit()

    send_invite_email(email, org.name, token)

    return {
        "id": invite.id,
        "email": invite.email,
        "role": invite.role,
        "token": invite.token,
        "expiresAt": invite.expires_at.isoformat() + "Z",
    }

@router.get("/organizations/{org_id}/invites")
async def list_invites(
    org_id: str,
    _admin: SuperAdminContext = Depends(get_super_admin),
    db: AsyncSession = Depends(get_db)
):
    invites_res = await db.execute(
        select(OrganizationInvite).where(OrganizationInvite.organization_id == org_id).order_by(OrganizationInvite.created_at.desc())
    )
    invites = invites_res.scalars().all()
    return [
        {
            "id": i.id,
            "email": i.email,
            "role": i.role,
            "token": i.token,
            "acceptedAt": i.accepted_at.isoformat() + "Z" if i.accepted_at else None,
            "expiresAt": i.expires_at.isoformat() + "Z",
            "createdAt": i.created_at.isoformat() + "Z",
        }
        for i in invites
    ]

@router.get("/organizations/{org_id}/audit-logs")
async def list_audit_logs(
    org_id: str,
    _admin: SuperAdminContext = Depends(get_super_admin),
    db: AsyncSession = Depends(get_db)
):
    logs_res = await db.execute(
        select(AuditLog).where(AuditLog.organization_id == org_id).order_by(AuditLog.created_at.desc()).limit(100)
    )
    logs = logs_res.scalars().all()
    return [
        {
            "id": l.id,
            "entityType": l.entity_type,
            "entityId": l.entity_id,
            "userId": l.user_id,
            "userEmail": l.user_email,
            "userRole": l.user_role,
            "action": l.action,
            "reason": l.reason,
            "metadata": l.metadata_,
            "createdAt": l.created_at.isoformat() + "Z",
        }
        for l in logs
    ]

@router.get("/dlq")
async def list_dlq(
    _admin: SuperAdminContext = Depends(get_super_admin),
    db: AsyncSession = Depends(get_db)
):
    dlq_res = await db.execute(select(DeadLetterJob).order_by(DeadLetterJob.failed_at.desc()).limit(100))
    jobs = dlq_res.scalars().all()
    return [
        {
            "id": j.id,
            "organizationId": j.organization_id,
            "queueName": j.queue_name,
            "jobId": j.job_id,
            "jobName": j.job_name,
            "payload": j.payload,
            "errorMessage": j.error_message,
            "status": j.status,
            "retryCount": j.retry_count,
            "failedAt": j.failed_at.isoformat() + "Z",
            "resolvedAt": j.resolved_at.isoformat() + "Z" if j.resolved_at else None,
        }
        for j in jobs
    ]

@router.post("/dlq/{job_id}/retry")
async def retry_dlq(
    job_id: str,
    _admin: SuperAdminContext = Depends(get_super_admin),
    db: AsyncSession = Depends(get_db)
):
    job_res = await db.execute(select(DeadLetterJob).where(DeadLetterJob.id == job_id))
    job = job_res.scalars().first()
    if not job:
        raise HttpError(404, "Dead letter job not found")
    job.status = "retried"
    job.retry_count += 1
    job.resolved_at = datetime.utcnow()
    await db.commit()
    return {"message": "Job marked for retry"}

@router.post("/dlq/{job_id}/dismiss")
async def dismiss_dlq(
    job_id: str,
    _admin: SuperAdminContext = Depends(get_super_admin),
    db: AsyncSession = Depends(get_db)
):
    job_res = await db.execute(select(DeadLetterJob).where(DeadLetterJob.id == job_id))
    job = job_res.scalars().first()
    if not job:
        raise HttpError(404, "Dead letter job not found")
    job.status = "dismissed"
    job.resolved_at = datetime.utcnow()
    await db.commit()
    return {"message": "Job dismissed"}

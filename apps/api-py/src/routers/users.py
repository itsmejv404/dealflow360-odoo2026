import secrets
from datetime import datetime, timedelta
from typing import Optional, Literal
from fastapi import APIRouter, Depends
from pydantic import BaseModel, EmailStr
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, delete
from src.database import get_db
from src.models import User, Organization, OrganizationInvite
from src.shared.tenant import require_roles, TenantContext
from src.shared.errors import HttpError
from src.lib.mailer import send_invite_email

router = APIRouter(prefix="/api/users", tags=["Users"])

VALID_ROLES = ["org_admin", "rep", "manager", "finance", "ops"]

class InviteUserRequest(BaseModel):
    email: str
    role: str
    name: Optional[str] = None

class UpdateStatusRequest(BaseModel):
    status: Literal["active", "suspended"]

@router.get("")
@router.get("/")
async def list_users(
    ctx: TenantContext = Depends(require_roles(["org_admin"])),
    db: AsyncSession = Depends(get_db)
):
    users_res = await db.execute(
        select(User).where(User.organization_id == ctx.org_id).order_by(User.created_at.desc())
    )
    users = [
        {
            "id": u.id,
            "email": u.email,
            "name": u.name,
            "role": u.role,
            "status": u.status,
            "createdAt": u.created_at.isoformat() + "Z",
            "updatedAt": u.updated_at.isoformat() + "Z",
        }
        for u in users_res.scalars().all()
    ]

    invites_res = await db.execute(
        select(OrganizationInvite).where(
            OrganizationInvite.organization_id == ctx.org_id,
            OrganizationInvite.accepted_at.is_(None),
            OrganizationInvite.expires_at > datetime.utcnow()
        ).order_by(OrganizationInvite.created_at.desc())
    )
    pending = [
        {
            "id": i.id,
            "email": i.email,
            "role": i.role,
            "createdAt": i.created_at.isoformat() + "Z",
            "expiresAt": i.expires_at.isoformat() + "Z",
        }
        for i in invites_res.scalars().all()
    ]

    return {"users": users, "pendingInvites": pending}

@router.post("/invite")
async def invite_user(
    req: InviteUserRequest,
    ctx: TenantContext = Depends(require_roles(["org_admin"])),
    db: AsyncSession = Depends(get_db)
):
    email = req.email.lower().strip()
    if req.role not in VALID_ROLES:
        raise HttpError(400, f"Invalid role. Must be one of: {', '.join(VALID_ROLES)}")

    org_res = await db.execute(select(Organization).where(Organization.id == ctx.org_id))
    org = org_res.scalars().first()
    if not org:
        raise HttpError(404, "Organization not found")

    existing_user_res = await db.execute(select(User).where(User.email == email))
    existing_user = existing_user_res.scalars().first()
    if existing_user:
        if existing_user.organization_id == ctx.org_id:
            raise HttpError(409, "User with this email already belongs to this organization")
        raise HttpError(409, "User with this email already belongs to another organization")

    await db.execute(
        delete(OrganizationInvite).where(
            OrganizationInvite.organization_id == ctx.org_id,
            OrganizationInvite.email == email
        )
    )

    token = secrets.token_hex(32)
    expires_at = datetime.utcnow() + timedelta(days=7)
    invite = OrganizationInvite(
        organization_id=ctx.org_id,
        email=email,
        role=req.role,
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

@router.patch("/{user_id}/status")
async def update_user_status(
    user_id: str,
    req: UpdateStatusRequest,
    ctx: TenantContext = Depends(require_roles(["org_admin"])),
    db: AsyncSession = Depends(get_db)
):
    if user_id == ctx.user_id:
        raise HttpError(400, "You cannot alter your own account status")

    user_res = await db.execute(
        select(User).where(User.id == user_id, User.organization_id == ctx.org_id)
    )
    user = user_res.scalars().first()
    if not user:
        raise HttpError(404, "User not found in this organization")

    user.status = req.status
    user.updated_at = datetime.utcnow()
    await db.commit()

    return {
        "id": user.id,
        "email": user.email,
        "name": user.name,
        "role": user.role,
        "status": user.status,
        "updatedAt": user.updated_at.isoformat() + "Z",
    }

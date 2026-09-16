from datetime import datetime
from typing import Optional
from fastapi import APIRouter, Depends
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from src.database import get_db
from src.models import OrganizationInvite, Organization, User
from src.shared.jwt_utils import hash_password, sign_internal_token
from src.shared.errors import HttpError

router = APIRouter(prefix="/api/onboarding", tags=["Onboarding"])

class ActivateRequest(BaseModel):
    token: str
    passwordPlain: str
    name: Optional[str] = None

@router.get("/invite/{token}")
async def get_invite(token: str, db: AsyncSession = Depends(get_db)):
    invite_res = await db.execute(
        select(OrganizationInvite).where(OrganizationInvite.token == token)
    )
    invite = invite_res.scalars().first()
    if not invite:
        raise HttpError(404, "Invitation not found")

    if invite.accepted_at:
        raise HttpError(400, "This invitation has already been accepted")

    if invite.expires_at < datetime.utcnow():
        raise HttpError(400, "This invitation has expired")

    org_res = await db.execute(select(Organization).where(Organization.id == invite.organization_id))
    org = org_res.scalars().first()
    if not org or org.status != "active":
        raise HttpError(403, "The organization is currently suspended")

    return {
        "email": invite.email,
        "role": invite.role,
        "organization": {
            "id": org.id,
            "name": org.name,
            "slug": org.slug,
            "status": org.status,
            "logoUrl": org.logo_url,
            "onboardingCompleted": org.onboarding_completed,
        }
    }

@router.post("/activate")
async def activate(req: ActivateRequest, db: AsyncSession = Depends(get_db)):
    invite_res = await db.execute(
        select(OrganizationInvite).where(OrganizationInvite.token == req.token)
    )
    invite = invite_res.scalars().first()
    if not invite:
        raise HttpError(404, "Invitation not found")

    if invite.accepted_at:
        raise HttpError(400, "This invitation has already been accepted")

    if invite.expires_at < datetime.utcnow():
        raise HttpError(400, "This invitation has expired")

    org_res = await db.execute(select(Organization).where(Organization.id == invite.organization_id))
    org = org_res.scalars().first()
    if not org or org.status != "active":
        raise HttpError(403, "The organization is currently suspended")

    pwd_hash = hash_password(req.passwordPlain)

    user_res = await db.execute(select(User).where(User.email == invite.email))
    user = user_res.scalars().first()

    now = datetime.utcnow()
    if user:
        user.password_hash = pwd_hash
        user.organization_id = invite.organization_id
        user.role = invite.role
        user.status = "active"
        if req.name:
            user.name = req.name
        user.updated_at = now
    else:
        user = User(
            email=invite.email,
            password_hash=pwd_hash,
            organization_id=invite.organization_id,
            role=invite.role,
            status="active",
            name=req.name or invite.email.split("@")[0],
            created_at=now,
            updated_at=now
        )
        db.add(user)

    invite.accepted_at = now
    await db.commit()

    token = sign_internal_token({
        "sub": user.id,
        "email": user.email,
        "org_id": org.id,
        "role": user.role,
    })

    return {
        "token": token,
        "user": {
            "id": user.id,
            "email": user.email,
            "name": user.name,
            "role": user.role,
        },
        "organization": {
            "id": org.id,
            "name": org.name,
            "slug": org.slug,
            "onboardingCompleted": org.onboarding_completed,
        }
    }

import secrets
from datetime import datetime, timedelta
from typing import Optional
from fastapi import APIRouter, Depends, status
from pydantic import BaseModel, EmailStr
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from src.database import get_db
from src.models import User, Organization
from src.shared.jwt_utils import verify_password, hash_password, sign_internal_token
from src.shared.tenant import get_tenant_context, TenantContext
from src.shared.errors import HttpError
from src.lib.mailer import send_password_reset_email

router = APIRouter(prefix="/api/auth", tags=["Auth"])

class LoginRequest(BaseModel):
    email: str
    password: str

class UpdateProfileRequest(BaseModel):
    name: Optional[str] = None
    currentPassword: Optional[str] = None
    newPassword: Optional[str] = None

class ForgotPasswordRequest(BaseModel):
    email: str

class ResetPasswordRequest(BaseModel):
    token: str
    newPassword: str

@router.post("/login")
async def login(req: LoginRequest, db: AsyncSession = Depends(get_db)):
    email = req.email.lower().strip()
    user_res = await db.execute(
        select(User).where(User.email == email)
    )
    user = user_res.scalars().first()
    if not user:
        raise HttpError(401, "Invalid email or password")

    if user.role == "super_admin" or not user.organization_id:
        raise HttpError(401, "Please use platform portal for super admin authentication")

    if user.status != "active":
        raise HttpError(403, "Account is inactive or suspended")

    org_res = await db.execute(select(Organization).where(Organization.id == user.organization_id))
    org = org_res.scalars().first()
    if not org or org.status != "active":
        raise HttpError(403, "Organization account is suspended")

    if not verify_password(req.password, user.password_hash):
        raise HttpError(401, "Invalid email or password")

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
            "status": user.status,
        },
        "organization": {
            "id": org.id,
            "name": org.name,
            "slug": org.slug,
            "status": org.status,
            "logoUrl": org.logo_url,
            "currency": org.currency,
            "timezone": org.timezone,
            "onboardingCompleted": org.onboarding_completed,
        }
    }

@router.get("/me")
async def me(ctx: TenantContext = Depends(get_tenant_context), db: AsyncSession = Depends(get_db)):
    user_res = await db.execute(select(User).where(User.id == ctx.user_id, User.organization_id == ctx.org_id))
    user = user_res.scalars().first()
    org_res = await db.execute(select(Organization).where(Organization.id == ctx.org_id))
    org = org_res.scalars().first()
    if not user or not org:
        raise HttpError(404, "User or organization not found")

    return {
        "user": {
            "id": user.id,
            "email": user.email,
            "name": user.name,
            "role": user.role,
            "status": user.status,
        },
        "organization": {
            "id": org.id,
            "name": org.name,
            "slug": org.slug,
            "status": org.status,
            "logoUrl": org.logo_url,
            "currency": org.currency,
            "timezone": org.timezone,
            "onboardingCompleted": org.onboarding_completed,
        }
    }

@router.put("/profile")
async def update_profile(
    req: UpdateProfileRequest,
    ctx: TenantContext = Depends(get_tenant_context),
    db: AsyncSession = Depends(get_db)
):
    user_res = await db.execute(select(User).where(User.id == ctx.user_id, User.organization_id == ctx.org_id))
    user = user_res.scalars().first()
    if not user:
        raise HttpError(404, "User not found")

    if req.name is not None:
        user.name = req.name

    if req.newPassword:
        if not req.currentPassword or not verify_password(req.currentPassword, user.password_hash):
            raise HttpError(400, "Current password is incorrect")
        user.password_hash = hash_password(req.newPassword)

    await db.commit()
    return {
        "id": user.id,
        "email": user.email,
        "name": user.name,
        "role": user.role,
        "status": user.status,
    }

@router.post("/forgot-password")
async def forgot_password(req: ForgotPasswordRequest, db: AsyncSession = Depends(get_db)):
    email = req.email.lower().strip()
    user_res = await db.execute(select(User).where(User.email == email))
    user = user_res.scalars().first()
    if user and user.status == "active":
        token = secrets.token_urlsafe(32)
        user.password_reset_token = token
        user.password_reset_expires = datetime.utcnow() + timedelta(hours=2)
        await db.commit()
        send_password_reset_email(user.email, token)
    return {"message": "If that email exists in our system, a password reset link has been sent."}

@router.post("/reset-password")
async def reset_password(req: ResetPasswordRequest, db: AsyncSession = Depends(get_db)):
    user_res = await db.execute(
        select(User).where(
            User.password_reset_token == req.token,
            User.password_reset_expires > datetime.utcnow()
        )
    )
    user = user_res.scalars().first()
    if not user:
        raise HttpError(400, "Invalid or expired password reset link.")

    user.password_hash = hash_password(req.newPassword)
    user.password_reset_token = None
    user.password_reset_expires = None
    await db.commit()
    return {"message": "Your password has been reset successfully."}

@router.get("/test")
async def test():
    return {"data": "result"}

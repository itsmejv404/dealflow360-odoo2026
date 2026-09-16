from datetime import datetime
from typing import Optional
from fastapi import APIRouter, Depends, UploadFile, File, Response
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from src.database import get_db
from src.models import Organization
from src.shared.tenant import get_tenant_context, require_roles, TenantContext
from src.shared.errors import HttpError
from src.lib.minio_client import storage_service

router = APIRouter(prefix="/api/organization", tags=["Organization"])

class UpdateProfileRequest(BaseModel):
    name: Optional[str] = None
    address: Optional[str] = None
    description: Optional[str] = None
    contactEmail: Optional[str] = None
    contactPhone: Optional[str] = None
    website: Optional[str] = None
    currency: Optional[str] = None
    timezone: Optional[str] = None
    onboardingCompleted: Optional[bool] = None

@router.get("/profile")
async def get_profile(
    ctx: TenantContext = Depends(get_tenant_context),
    db: AsyncSession = Depends(get_db)
):
    org_res = await db.execute(select(Organization).where(Organization.id == ctx.org_id))
    org = org_res.scalars().first()
    if not org:
        raise HttpError(404, "Organization not found")

    return {
        "id": org.id,
        "name": org.name,
        "slug": org.slug,
        "status": org.status,
        "logoUrl": org.logo_url,
        "address": org.address,
        "description": org.description,
        "contactEmail": org.contact_email,
        "contactPhone": org.contact_phone,
        "website": org.website,
        "currency": org.currency,
        "timezone": org.timezone,
        "onboardingCompleted": org.onboarding_completed,
        "createdAt": org.created_at.isoformat() + "Z",
        "updatedAt": org.updated_at.isoformat() + "Z",
    }

@router.patch("/profile")
async def update_profile(
    req: UpdateProfileRequest,
    ctx: TenantContext = Depends(require_roles(["org_admin"])),
    db: AsyncSession = Depends(get_db)
):
    org_res = await db.execute(select(Organization).where(Organization.id == ctx.org_id))
    org = org_res.scalars().first()
    if not org:
        raise HttpError(404, "Organization not found")

    if req.name is not None:
        org.name = req.name
    if req.address is not None:
        org.address = req.address
    if req.description is not None:
        org.description = req.description
    if req.contactEmail is not None:
        org.contact_email = req.contactEmail
    if req.contactPhone is not None:
        org.contact_phone = req.contactPhone
    if req.website is not None:
        org.website = req.website
    if req.currency is not None:
        org.currency = req.currency
    if req.timezone is not None:
        org.timezone = req.timezone
    if req.onboardingCompleted is not None:
        org.onboarding_completed = req.onboardingCompleted

    org.updated_at = datetime.utcnow()
    await db.commit()

    return {
        "id": org.id,
        "name": org.name,
        "slug": org.slug,
        "status": org.status,
        "logoUrl": org.logo_url,
        "address": org.address,
        "description": org.description,
        "contactEmail": org.contact_email,
        "contactPhone": org.contact_phone,
        "website": org.website,
        "currency": org.currency,
        "timezone": org.timezone,
        "onboardingCompleted": org.onboarding_completed,
        "createdAt": org.created_at.isoformat() + "Z",
        "updatedAt": org.updated_at.isoformat() + "Z",
    }

@router.post("/logo")
async def upload_logo(
    logo: UploadFile = File(...),
    ctx: TenantContext = Depends(require_roles(["org_admin"])),
    db: AsyncSession = Depends(get_db)
):
    allowed_mimes = ["image/png", "image/jpeg", "image/webp", "image/svg+xml"]
    if logo.content_type not in allowed_mimes:
        raise HttpError(400, "Invalid file type. Allowed: PNG, JPEG, WEBP, SVG")

    content = await logo.read()
    if len(content) > 5 * 1024 * 1024:
        raise HttpError(400, "File too large. Maximum size is 5MB")

    ext = "png"
    if "svg" in logo.content_type:
        ext = "svg"
    elif "jpeg" in logo.content_type or "jpg" in logo.content_type:
        ext = "jpg"
    elif "webp" in logo.content_type:
        ext = "webp"

    filename = f"logo.{ext}"
    storage_service.upload_tenant_file(ctx.org_id, filename, content, logo.content_type)

    logo_url = f"/api/organization/logo"
    org_res = await db.execute(select(Organization).where(Organization.id == ctx.org_id))
    org = org_res.scalars().first()
    if org:
        org.logo_url = logo_url
        org.updated_at = datetime.utcnow()
        await db.commit()

    return {"logoUrl": logo_url}

@router.get("/logo")
async def get_logo(
    ctx: TenantContext = Depends(get_tenant_context),
    db: AsyncSession = Depends(get_db)
):
    org_res = await db.execute(select(Organization).where(Organization.id == ctx.org_id))
    org = org_res.scalars().first()
    if not org or not org.logo_url:
        raise HttpError(404, "Logo not found")

    for ext, mime in [("png", "image/png"), ("jpg", "image/jpeg"), ("webp", "image/webp"), ("svg", "image/svg+xml")]:
        try:
            content, c_type = storage_service.get_tenant_file(ctx.org_id, f"logo.{ext}")
            return Response(content=content, media_type=mime)
        except Exception:
            continue

    raise HttpError(404, "Logo file not found in storage")

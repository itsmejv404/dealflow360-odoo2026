from dataclasses import dataclass
from typing import List, Optional
from fastapi import Depends, Header
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from src.database import get_db
from src.models import Organization, User
from src.shared.jwt_utils import verify_jwt
from src.shared.errors import HttpError

@dataclass
class TenantContext:
    org_id: str
    user_id: Optional[str] = None
    email: Optional[str] = None
    role: Optional[str] = None
    quotation_ids: Optional[List[str]] = None

@dataclass
class SuperAdminContext:
    sub: str
    email: str
    role: str = "super_admin"

async def get_tenant_context(
    authorization: Optional[str] = Header(None),
    db: AsyncSession = Depends(get_db)
) -> TenantContext:
    if not authorization or not authorization.startswith("Bearer "):
        raise HttpError(401, "Authorization header with Bearer token is required")

    token = authorization[7:].strip()
    payload = verify_jwt(token)

    org_id = payload.get("org_id")
    if not org_id:
        raise HttpError(403, "Token does not contain a valid tenant organization context")

    token_typ = payload.get("typ")
    if token_typ == "super_admin":
        raise HttpError(403, "Super Admin tokens are not valid for tenant-scoped endpoints")
    if token_typ == "customer" and "role" in payload:
        raise HttpError(403, "Malformed customer token: internal role claims are not permitted")

    org_res = await db.execute(select(Organization).where(Organization.id == org_id))
    org = org_res.scalars().first()
    if not org:
        raise HttpError(404, "Organization not found")
    if org.status != "active":
        raise HttpError(403, "Organization is suspended")

    is_internal = token_typ == "internal" or (token_typ is None and "role" in payload)
    role = None
    user_id = payload.get("sub")

    if is_internal:
        if not user_id:
            raise HttpError(401, "Invalid token claims")
        user_res = await db.execute(select(User).where(User.id == user_id))
        user = user_res.scalars().first()
        if not user or user.organization_id != org.id:
            raise HttpError(401, "User account not found or does not belong to this organization")
        if user.status != "active":
            raise HttpError(403, "User account is inactive or suspended")
        role = user.role

    return TenantContext(
        org_id=org.id,
        user_id=user_id,
        email=payload.get("email"),
        role=role,
        quotation_ids=payload.get("quotation_ids")
    )

def require_roles(allowed_roles: List[str]):
    async def role_checker(ctx: TenantContext = Depends(get_tenant_context)) -> TenantContext:
        if not ctx.role or ctx.role not in allowed_roles:
            raise HttpError(403, f"Forbidden: Requires one of [{', '.join(allowed_roles)}] role")
        return ctx
    return role_checker

async def get_super_admin(
    authorization: Optional[str] = Header(None)
) -> SuperAdminContext:
    if not authorization or not authorization.startswith("Bearer "):
        raise HttpError(401, "Authorization header with Bearer token is required")

    token = authorization[7:].strip()
    payload = verify_jwt(token)

    if payload.get("typ") != "super_admin" or payload.get("role") != "super_admin":
        raise HttpError(403, "Forbidden: Super Admin privileges required")

    return SuperAdminContext(
        sub=payload.get("sub", ""),
        email=payload.get("email", ""),
        role="super_admin"
    )

async def get_portal_context(
    authorization: Optional[str] = Header(None),
    db: AsyncSession = Depends(get_db)
) -> TenantContext:
    if not authorization or not authorization.startswith("Bearer "):
        raise HttpError(401, "Authorization header with Bearer token is required")

    token = authorization[7:].strip()
    payload = verify_jwt(token)
    org_id = payload.get("org_id")
    if not org_id:
        raise HttpError(403, "Token does not contain a valid tenant organization context")

    org_res = await db.execute(select(Organization).where(Organization.id == org_id))
    org = org_res.scalars().first()
    if not org or org.status != "active":
        raise HttpError(403, "Organization not found or inactive")

    return TenantContext(
        org_id=org.id,
        user_id=payload.get("sub"),
        email=payload.get("email"),
        role=payload.get("role"),
        quotation_ids=payload.get("quotation_ids", [])
    )

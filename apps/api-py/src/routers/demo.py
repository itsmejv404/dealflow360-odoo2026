from datetime import datetime
from decimal import Decimal
from typing import Optional
from fastapi import APIRouter, Depends
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from src.database import get_db
from src.models import Product, OrderLine
from src.shared.tenant import get_tenant_context, TenantContext
from src.shared.errors import HttpError

router = APIRouter(prefix="/api/demo", tags=["Demo"])

class DemoProductRequest(BaseModel):
    name: str
    sku: str
    price: float

class DemoOrderLineRequest(BaseModel):
    productId: str
    quantity: int = 1
    unitPrice: float

@router.get("/products")
async def list_products(ctx: TenantContext = Depends(get_tenant_context), db: AsyncSession = Depends(get_db)):
    res = await db.execute(select(Product).where(Product.organization_id == ctx.org_id))
    return [{"id": p.id, "name": p.name, "sku": p.sku, "price": float(p.price)} for p in res.scalars().all()]

@router.get("/products/{prod_id}")
async def get_product(prod_id: str, ctx: TenantContext = Depends(get_tenant_context), db: AsyncSession = Depends(get_db)):
    res = await db.execute(select(Product).where(Product.id == prod_id, Product.organization_id == ctx.org_id))
    p = res.scalars().first()
    if not p:
        raise HttpError(404, "Product not found")
    return {"id": p.id, "name": p.name, "sku": p.sku, "price": float(p.price)}

@router.post("/products")
async def create_product(req: DemoProductRequest, ctx: TenantContext = Depends(get_tenant_context), db: AsyncSession = Depends(get_db)):
    now = datetime.utcnow()
    p = Product(
        organization_id=ctx.org_id,
        name=req.name,
        sku=req.sku.upper(),
        price=Decimal(str(req.price)),
        created_at=now,
        updated_at=now
    )
    db.add(p)
    await db.commit()
    return {"id": p.id, "name": p.name, "sku": p.sku, "price": float(p.price)}

@router.get("/order-lines")
async def list_order_lines(ctx: TenantContext = Depends(get_tenant_context), db: AsyncSession = Depends(get_db)):
    res = await db.execute(select(OrderLine).where(OrderLine.organization_id == ctx.org_id))
    return [
        {"id": ol.id, "productId": ol.product_id, "quantity": ol.quantity, "unitPrice": float(ol.unit_price)}
        for ol in res.scalars().all()
    ]

@router.post("/order-lines")
async def create_order_line(req: DemoOrderLineRequest, ctx: TenantContext = Depends(get_tenant_context), db: AsyncSession = Depends(get_db)):
    prod_res = await db.execute(select(Product).where(Product.id == req.productId, Product.organization_id == ctx.org_id))
    if not prod_res.scalars().first():
        raise HttpError(404, "Product not found in this organization")

    now = datetime.utcnow()
    ol = OrderLine(
        organization_id=ctx.org_id,
        product_id=req.productId,
        quantity=req.quantity,
        unit_price=Decimal(str(req.unitPrice)),
        created_at=now,
        updated_at=now
    )
    db.add(ol)
    await db.commit()
    return {"id": ol.id, "productId": ol.product_id, "quantity": ol.quantity, "unitPrice": float(ol.unit_price)}

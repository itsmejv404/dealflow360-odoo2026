from datetime import datetime
from decimal import Decimal
from typing import Optional, List
from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, delete
from src.database import get_db
from src.models import ProductCategory, CustomerTier, Product, PriceListItem, DiscountCeiling
from src.shared.tenant import get_tenant_context, require_roles, TenantContext
from src.shared.errors import HttpError

router = APIRouter(prefix="/api/catalog", tags=["Catalog"])

class CategoryRequest(BaseModel):
    name: str
    code: str
    description: Optional[str] = None

class TierRequest(BaseModel):
    name: str
    code: str
    description: Optional[str] = None
    defaultDiscountPercent: Optional[float] = 0.00

class TierPriceItem(BaseModel):
    tierId: str
    customPrice: float

class CreateProductRequest(BaseModel):
    name: str
    sku: str
    categoryId: Optional[str] = None
    description: Optional[str] = None
    price: float
    costPrice: Optional[float] = None
    billingFrequency: Optional[str] = "one_time"
    status: Optional[str] = "active"
    maxDiscountPercent: Optional[float] = None
    tierPrices: Optional[List[TierPriceItem]] = None

class UpdateProductRequest(BaseModel):
    name: Optional[str] = None
    sku: Optional[str] = None
    categoryId: Optional[str] = None
    description: Optional[str] = None
    price: Optional[float] = None
    costPrice: Optional[float] = None
    billingFrequency: Optional[str] = None
    status: Optional[str] = None
    maxDiscountPercent: Optional[float] = None
    tierPrices: Optional[List[TierPriceItem]] = None

# --- CATEGORIES ---
@router.get("/categories")
async def list_categories(ctx: TenantContext = Depends(get_tenant_context), db: AsyncSession = Depends(get_db)):
    res = await db.execute(select(ProductCategory).where(ProductCategory.organization_id == ctx.org_id).order_by(ProductCategory.name.asc()))
    cats = res.scalars().all()
    return [
        {
            "id": c.id,
            "name": c.name,
            "code": c.code,
            "description": c.description,
            "createdAt": c.created_at.isoformat() + "Z",
            "updatedAt": c.updated_at.isoformat() + "Z",
        }
        for c in cats
    ]

@router.post("/categories")
async def create_category(
    req: CategoryRequest,
    ctx: TenantContext = Depends(require_roles(["org_admin"])),
    db: AsyncSession = Depends(get_db)
):
    code = req.code.lower().strip()
    exist_res = await db.execute(select(ProductCategory).where(ProductCategory.organization_id == ctx.org_id, ProductCategory.code == code))
    if exist_res.scalars().first():
        raise HttpError(409, "Category code already exists in your organization")

    now = datetime.utcnow()
    cat = ProductCategory(
        organization_id=ctx.org_id,
        name=req.name.strip(),
        code=code,
        description=req.description,
        created_at=now,
        updated_at=now
    )
    db.add(cat)
    await db.commit()
    return {
        "id": cat.id,
        "name": cat.name,
        "code": cat.code,
        "description": cat.description,
    }

@router.put("/categories/{cat_id}")
async def update_category(
    cat_id: str,
    req: CategoryRequest,
    ctx: TenantContext = Depends(require_roles(["org_admin"])),
    db: AsyncSession = Depends(get_db)
):
    res = await db.execute(select(ProductCategory).where(ProductCategory.id == cat_id, ProductCategory.organization_id == ctx.org_id))
    cat = res.scalars().first()
    if not cat:
        raise HttpError(404, "Category not found")

    cat.name = req.name.strip()
    cat.code = req.code.lower().strip()
    cat.description = req.description
    cat.updated_at = datetime.utcnow()
    await db.commit()
    return {"id": cat.id, "name": cat.name, "code": cat.code, "description": cat.description}

@router.delete("/categories/{cat_id}")
async def delete_category(
    cat_id: str,
    ctx: TenantContext = Depends(require_roles(["org_admin"])),
    db: AsyncSession = Depends(get_db)
):
    res = await db.execute(select(ProductCategory).where(ProductCategory.id == cat_id, ProductCategory.organization_id == ctx.org_id))
    cat = res.scalars().first()
    if not cat:
        raise HttpError(404, "Category not found")
    await db.delete(cat)
    await db.commit()
    return {"message": "Category deleted successfully"}

# --- TIERS ---
@router.get("/tiers")
async def list_tiers(ctx: TenantContext = Depends(get_tenant_context), db: AsyncSession = Depends(get_db)):
    res = await db.execute(select(CustomerTier).where(CustomerTier.organization_id == ctx.org_id).order_by(CustomerTier.created_at.asc()))
    tiers = res.scalars().all()
    return [
        {
            "id": t.id,
            "name": t.name,
            "code": t.code,
            "description": t.description,
            "defaultDiscountPercent": float(t.default_discount_percent),
            "createdAt": t.created_at.isoformat() + "Z",
            "updatedAt": t.updated_at.isoformat() + "Z",
        }
        for t in tiers
    ]

@router.post("/tiers")
async def create_tier(
    req: TierRequest,
    ctx: TenantContext = Depends(require_roles(["org_admin"])),
    db: AsyncSession = Depends(get_db)
):
    code = req.code.lower().strip()
    exist_res = await db.execute(select(CustomerTier).where(CustomerTier.organization_id == ctx.org_id, CustomerTier.code == code))
    if exist_res.scalars().first():
        raise HttpError(409, "Customer tier code already exists")

    now = datetime.utcnow()
    tier = CustomerTier(
        organization_id=ctx.org_id,
        name=req.name.strip(),
        code=code,
        description=req.description,
        default_discount_percent=Decimal(str(req.defaultDiscountPercent or 0.0)),
        created_at=now,
        updated_at=now
    )
    db.add(tier)
    await db.commit()
    return {
        "id": tier.id,
        "name": tier.name,
        "code": tier.code,
        "description": tier.description,
        "defaultDiscountPercent": float(tier.default_discount_percent),
    }

@router.put("/tiers/{tier_id}")
async def update_tier(
    tier_id: str,
    req: TierRequest,
    ctx: TenantContext = Depends(require_roles(["org_admin"])),
    db: AsyncSession = Depends(get_db)
):
    res = await db.execute(select(CustomerTier).where(CustomerTier.id == tier_id, CustomerTier.organization_id == ctx.org_id))
    tier = res.scalars().first()
    if not tier:
        raise HttpError(404, "Tier not found")

    tier.name = req.name.strip()
    tier.code = req.code.lower().strip()
    tier.description = req.description
    if req.defaultDiscountPercent is not None:
        tier.default_discount_percent = Decimal(str(req.defaultDiscountPercent))
    tier.updated_at = datetime.utcnow()
    await db.commit()
    return {
        "id": tier.id,
        "name": tier.name,
        "code": tier.code,
        "description": tier.description,
        "defaultDiscountPercent": float(tier.default_discount_percent),
    }

@router.delete("/tiers/{tier_id}")
async def delete_tier(
    tier_id: str,
    ctx: TenantContext = Depends(require_roles(["org_admin"])),
    db: AsyncSession = Depends(get_db)
):
    res = await db.execute(select(CustomerTier).where(CustomerTier.id == tier_id, CustomerTier.organization_id == ctx.org_id))
    tier = res.scalars().first()
    if not tier:
        raise HttpError(404, "Tier not found")
    await db.delete(tier)
    await db.commit()
    return {"message": "Customer tier deleted successfully"}

# --- PRODUCTS ---
@router.get("/products")
async def list_products(
    categoryId: Optional[str] = Query(None),
    status: Optional[str] = Query(None),
    ctx: TenantContext = Depends(get_tenant_context),
    db: AsyncSession = Depends(get_db)
):
    query = select(Product).where(Product.organization_id == ctx.org_id)
    if categoryId:
        query = query.where(Product.category_id == categoryId)
    if status:
        query = query.where(Product.status == status)
    query = query.order_by(Product.name.asc())

    res = await db.execute(query)
    products = res.scalars().all()

    # Load price list items and categories
    pli_res = await db.execute(select(PriceListItem).where(PriceListItem.organization_id == ctx.org_id))
    plis = pli_res.scalars().all()
    pli_map = {}
    for p in plis:
        pli_map.setdefault(p.product_id, []).append({
            "id": p.id,
            "tierId": p.tier_id,
            "customPrice": float(p.custom_price)
        })

    cat_res = await db.execute(select(ProductCategory).where(ProductCategory.organization_id == ctx.org_id))
    cats_map = {c.id: {"id": c.id, "name": c.name, "code": c.code} for c in cat_res.scalars().all()}

    return [
        {
            "id": p.id,
            "name": p.name,
            "sku": p.sku,
            "description": p.description,
            "price": float(p.price),
            "costPrice": float(p.cost_price) if p.cost_price is not None else None,
            "billingFrequency": p.billing_frequency,
            "status": p.status,
            "maxDiscountPercent": float(p.max_discount_percent) if p.max_discount_percent is not None else None,
            "categoryId": p.category_id,
            "category": cats_map.get(p.category_id),
            "tierPrices": pli_map.get(p.id, []),
            "createdAt": p.created_at.isoformat() + "Z",
            "updatedAt": p.updated_at.isoformat() + "Z",
        }
        for p in products
    ]

@router.get("/products/{prod_id}")
async def get_product(
    prod_id: str,
    ctx: TenantContext = Depends(get_tenant_context),
    db: AsyncSession = Depends(get_db)
):
    res = await db.execute(select(Product).where(Product.id == prod_id, Product.organization_id == ctx.org_id))
    p = res.scalars().first()
    if not p:
        raise HttpError(404, "Product not found")

    cat_res = await db.execute(select(ProductCategory).where(ProductCategory.id == p.category_id, ProductCategory.organization_id == ctx.org_id))
    cat = cat_res.scalars().first()

    pli_res = await db.execute(select(PriceListItem).where(PriceListItem.product_id == p.id, PriceListItem.organization_id == ctx.org_id))
    plis = pli_res.scalars().all()

    return {
        "id": p.id,
        "name": p.name,
        "sku": p.sku,
        "description": p.description,
        "price": float(p.price),
        "costPrice": float(p.cost_price) if p.cost_price is not None else None,
        "billingFrequency": p.billing_frequency,
        "status": p.status,
        "maxDiscountPercent": float(p.max_discount_percent) if p.max_discount_percent is not None else None,
        "categoryId": p.category_id,
        "category": {"id": cat.id, "name": cat.name, "code": cat.code} if cat else None,
        "tierPrices": [{"id": item.id, "tierId": item.tier_id, "customPrice": float(item.custom_price)} for item in plis],
        "createdAt": p.created_at.isoformat() + "Z",
        "updatedAt": p.updated_at.isoformat() + "Z",
    }

@router.post("/products")
async def create_product(
    req: CreateProductRequest,
    ctx: TenantContext = Depends(require_roles(["org_admin"])),
    db: AsyncSession = Depends(get_db)
):
    sku = req.sku.upper().strip()
    exist_res = await db.execute(select(Product).where(Product.organization_id == ctx.org_id, Product.sku == sku))
    if exist_res.scalars().first():
        raise HttpError(409, "Product SKU already exists in this organization")

    now = datetime.utcnow()
    product = Product(
        organization_id=ctx.org_id,
        name=req.name.strip(),
        sku=sku,
        categoryId=req.categoryId,
        description=req.description,
        price=Decimal(str(req.price)),
        cost_price=Decimal(str(req.costPrice)) if req.costPrice is not None else None,
        billing_frequency=req.billingFrequency or "one_time",
        status=req.status or "active",
        max_discount_percent=Decimal(str(req.maxDiscountPercent)) if req.maxDiscountPercent is not None else None,
        created_at=now,
        updated_at=now
    )
    db.add(product)
    await db.flush()

    if req.tierPrices:
        for tp in req.tierPrices:
            pli = PriceListItem(
                organization_id=ctx.org_id,
                tier_id=tp.tierId,
                product_id=product.id,
                custom_price=Decimal(str(tp.customPrice)),
                created_at=now,
                updated_at=now
            )
            db.add(pli)

    await db.commit()
    return await get_product(product.id, ctx, db)

@router.put("/products/{prod_id}")
async def update_product(
    prod_id: str,
    req: UpdateProductRequest,
    ctx: TenantContext = Depends(require_roles(["org_admin"])),
    db: AsyncSession = Depends(get_db)
):
    res = await db.execute(select(Product).where(Product.id == prod_id, Product.organization_id == ctx.org_id))
    product = res.scalars().first()
    if not product:
        raise HttpError(404, "Product not found")

    if req.sku is not None:
        sku = req.sku.upper().strip()
        exist_res = await db.execute(select(Product).where(Product.organization_id == ctx.org_id, Product.sku == sku, Product.id != prod_id))
        if exist_res.scalars().first():
            raise HttpError(409, "Product SKU already exists in this organization")
        product.sku = sku

    if req.name is not None:
        product.name = req.name.strip()
    if req.categoryId is not None:
        product.category_id = req.categoryId
    if req.description is not None:
        product.description = req.description
    if req.price is not None:
        product.price = Decimal(str(req.price))
    if req.costPrice is not None:
        product.cost_price = Decimal(str(req.costPrice))
    if req.billingFrequency is not None:
        product.billing_frequency = req.billingFrequency
    if req.status is not None:
        product.status = req.status
    if req.maxDiscountPercent is not None:
        product.max_discount_percent = Decimal(str(req.maxDiscountPercent))

    now = datetime.utcnow()
    product.updated_at = now

    if req.tierPrices is not None:
        await db.execute(delete(PriceListItem).where(PriceListItem.organization_id == ctx.org_id, PriceListItem.product_id == prod_id))
        for tp in req.tierPrices:
            pli = PriceListItem(
                organization_id=ctx.org_id,
                tier_id=tp.tierId,
                product_id=product.id,
                custom_price=Decimal(str(tp.customPrice)),
                created_at=now,
                updated_at=now
            )
            db.add(pli)

    await db.commit()
    return await get_product(product.id, ctx, db)

@router.delete("/products/{prod_id}")
async def delete_product(
    prod_id: str,
    ctx: TenantContext = Depends(require_roles(["org_admin"])),
    db: AsyncSession = Depends(get_db)
):
    res = await db.execute(select(Product).where(Product.id == prod_id, Product.organization_id == ctx.org_id))
    product = res.scalars().first()
    if not product:
        raise HttpError(404, "Product not found")

    await db.delete(product)
    await db.commit()
    return {"message": "Product deleted successfully"}

from datetime import datetime
from typing import Optional, List, Literal
from fastapi import APIRouter, Depends, Query, Response
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, delete
from src.database import get_db
from src.models import (
    Warehouse, StockLevel, Product, ShippingRuleConfig, ShippingRuleOverride, Customer
)
from src.shared.tenant import get_tenant_context, require_roles, TenantContext
from src.shared.errors import HttpError
from src.tasks.fulfillment import process_backorder_consolidation

router = APIRouter(prefix="/api/warehouses", tags=["Warehouses"])

class CreateWarehouseRequest(BaseModel):
    name: str
    code: str
    address: Optional[str] = None
    city: Optional[str] = None
    isDefault: Optional[bool] = False

class UpdateWarehouseRequest(BaseModel):
    name: Optional[str] = None
    code: Optional[str] = None
    address: Optional[str] = None
    city: Optional[str] = None
    isDefault: Optional[bool] = None
    status: Optional[Literal["active", "inactive"]] = None

class UpdateShippingRulesRequest(BaseModel):
    allowSplitShipments: Optional[bool] = True
    chargeForSplitShipments: Optional[bool] = False
    deliveryExtensionDays: Optional[int] = 3
    notes: Optional[str] = None

class OverrideRequest(BaseModel):
    customerId: Optional[str] = None
    warehouseId: Optional[str] = None
    allowSplitShipments: Optional[bool] = True
    chargeForSplitShipments: Optional[bool] = False
    deliveryExtensionDays: Optional[int] = 3
    notes: Optional[str] = None

class StockArrivalRequest(BaseModel):
    warehouseId: str
    productId: str
    quantityAdded: int

class SetStockRequest(BaseModel):
    quantity: int

@router.get("")
@router.get("/")
async def list_warehouses(
    ctx: TenantContext = Depends(get_tenant_context),
    db: AsyncSession = Depends(get_db)
):
    res = await db.execute(select(Warehouse).where(Warehouse.organization_id == ctx.org_id).order_by(Warehouse.is_default.desc(), Warehouse.name.asc()))
    warehouses = res.scalars().all()
    return [
        {
            "id": w.id,
            "name": w.name,
            "code": w.code,
            "address": w.address,
            "city": w.city,
            "isDefault": w.is_default,
            "status": w.status,
            "createdAt": w.created_at.isoformat() + "Z",
            "updatedAt": w.updated_at.isoformat() + "Z",
        }
        for w in warehouses
    ]

@router.get("/shipping-rules")
async def get_shipping_rules(
    ctx: TenantContext = Depends(get_tenant_context),
    db: AsyncSession = Depends(get_db)
):
    res = await db.execute(select(ShippingRuleConfig).where(ShippingRuleConfig.organization_id == ctx.org_id))
    cfg = res.scalars().first()
    if not cfg:
        cfg = ShippingRuleConfig(
            organization_id=ctx.org_id,
            allow_split_shipments=True,
            charge_for_split_shipments=False,
            delivery_extension_days=3,
            created_at=datetime.utcnow(),
            updated_at=datetime.utcnow()
        )
        db.add(cfg)
        await db.commit()

    return {
        "id": cfg.id,
        "allowSplitShipments": cfg.allow_split_shipments,
        "chargeForSplitShipments": cfg.charge_for_split_shipments,
        "deliveryExtensionDays": cfg.delivery_extension_days,
        "notes": cfg.notes,
    }

@router.put("/shipping-rules")
async def update_shipping_rules(
    req: UpdateShippingRulesRequest,
    ctx: TenantContext = Depends(require_roles(["org_admin"])),
    db: AsyncSession = Depends(get_db)
):
    res = await db.execute(select(ShippingRuleConfig).where(ShippingRuleConfig.organization_id == ctx.org_id))
    cfg = res.scalars().first()
    now = datetime.utcnow()
    if not cfg:
        cfg = ShippingRuleConfig(organization_id=ctx.org_id, created_at=now)
        db.add(cfg)

    if req.allowSplitShipments is not None:
        cfg.allow_split_shipments = req.allowSplitShipments
    if req.chargeForSplitShipments is not None:
        cfg.charge_for_split_shipments = req.chargeForSplitShipments
    if req.deliveryExtensionDays is not None:
        cfg.delivery_extension_days = req.deliveryExtensionDays
    if req.notes is not None:
        cfg.notes = req.notes
    cfg.updated_at = now
    await db.commit()

    return {
        "id": cfg.id,
        "allowSplitShipments": cfg.allow_split_shipments,
        "chargeForSplitShipments": cfg.charge_for_split_shipments,
        "deliveryExtensionDays": cfg.delivery_extension_days,
        "notes": cfg.notes,
    }

@router.get("/stock")
async def get_stock_matrix(
    ctx: TenantContext = Depends(get_tenant_context),
    db: AsyncSession = Depends(get_db)
):
    wh_res = await db.execute(select(Warehouse).where(Warehouse.organization_id == ctx.org_id).order_by(Warehouse.name.asc()))
    warehouses = wh_res.scalars().all()

    prod_res = await db.execute(select(Product).where(Product.organization_id == ctx.org_id).order_by(Product.name.asc()))
    products = prod_res.scalars().all()

    stock_res = await db.execute(select(StockLevel).where(StockLevel.organization_id == ctx.org_id))
    stocks = stock_res.scalars().all()
    stock_map = {(s.warehouse_id, s.product_id): s.quantity for s in stocks}

    matrix = []
    for p in products:
        row = {
            "productId": p.id,
            "productName": p.name,
            "sku": p.sku,
            "billingFrequency": p.billing_frequency,
            "levels": {w.id: stock_map.get((w.id, p.id), 0) for w in warehouses},
            "totalStock": sum(stock_map.get((w.id, p.id), 0) for w in warehouses)
        }
        matrix.append(row)

    return {
        "warehouses": [{"id": w.id, "name": w.name, "code": w.code} for w in warehouses],
        "products": matrix
    }

@router.get("/export/csv")
@router.get("/stock/export/csv")
async def export_stock_csv(
    ctx: TenantContext = Depends(get_tenant_context),
    db: AsyncSession = Depends(get_db)
):
    data = await get_stock_matrix(ctx, db)
    whs = data["warehouses"]
    lines = ["Product Name,SKU," + ",".join(w["name"] for w in whs) + ",Total Stock"]
    for p in data["products"]:
        row = [f'"{p["productName"]}"', p["sku"]]
        for w in whs:
            row.append(str(p["levels"].get(w["id"], 0)))
        row.append(str(p["totalStock"]))
        lines.append(",".join(row))

    csv_content = "\n".join(lines)
    return Response(
        content=csv_content,
        media_type="text/csv",
        headers={"Content-Disposition": f"attachment; filename=stock_{ctx.org_id}.csv"}
    )

@router.post("")
@router.post("/")
async def create_warehouse(
    req: CreateWarehouseRequest,
    ctx: TenantContext = Depends(require_roles(["org_admin"])),
    db: AsyncSession = Depends(get_db)
):
    code = req.code.upper().strip()
    exist_res = await db.execute(select(Warehouse).where(Warehouse.organization_id == ctx.org_id, Warehouse.code == code))
    if exist_res.scalars().first():
        raise HttpError(409, "Warehouse code already exists")

    now = datetime.utcnow()
    if req.isDefault:
        # Clear existing default
        defs = await db.execute(select(Warehouse).where(Warehouse.organization_id == ctx.org_id, Warehouse.is_default == True))
        for d in defs.scalars().all():
            d.is_default = False

    w = Warehouse(
        organization_id=ctx.org_id,
        name=req.name.strip(),
        code=code,
        address=req.address,
        city=req.city,
        is_default=bool(req.isDefault),
        status="active",
        created_at=now,
        updated_at=now
    )
    db.add(w)
    await db.commit()
    return {"id": w.id, "name": w.name, "code": w.code, "isDefault": w.is_default, "status": w.status}

@router.put("/shipping-rules/overrides")
async def upsert_shipping_rule_override(
    req: OverrideRequest,
    ctx: TenantContext = Depends(require_roles(["org_admin", "manager", "finance"])),
    db: AsyncSession = Depends(get_db)
):
    now = datetime.utcnow()
    query = select(ShippingRuleOverride).where(ShippingRuleOverride.organization_id == ctx.org_id)
    if req.customerId:
        query = query.where(ShippingRuleOverride.customer_id == req.customerId)
    else:
        query = query.where(ShippingRuleOverride.customer_id.is_(None))

    if req.warehouseId:
        query = query.where(ShippingRuleOverride.warehouse_id == req.warehouseId)
    else:
        query = query.where(ShippingRuleOverride.warehouse_id.is_(None))

    exist_res = await db.execute(query)
    override = exist_res.scalars().first()

    if override:
        if req.allowSplitShipments is not None:
            override.allow_split_shipments = req.allowSplitShipments
        if req.chargeForSplitShipments is not None:
            override.charge_for_split_shipments = req.chargeForSplitShipments
        if req.deliveryExtensionDays is not None:
            override.delivery_extension_days = req.deliveryExtensionDays
        if req.notes is not None:
            override.notes = req.notes
        override.updated_at = now
    else:
        override = ShippingRuleOverride(
            organization_id=ctx.org_id,
            customer_id=req.customerId,
            warehouse_id=req.warehouseId,
            allow_split_shipments=bool(req.allowSplitShipments),
            charge_for_split_shipments=bool(req.chargeForSplitShipments),
            delivery_extension_days=req.deliveryExtensionDays or 3,
            notes=req.notes,
            created_at=now,
            updated_at=now
        )
        db.add(override)

    await db.commit()
    return {"id": override.id, "allowSplitShipments": override.allow_split_shipments}

@router.get("/shipping-rules/overrides")
async def list_shipping_rule_overrides(
    ctx: TenantContext = Depends(get_tenant_context),
    db: AsyncSession = Depends(get_db)
):
    res = await db.execute(select(ShippingRuleOverride).where(ShippingRuleOverride.organization_id == ctx.org_id))
    overrides = res.scalars().all()
    return [
        {
            "id": o.id,
            "customerId": o.customer_id,
            "warehouseId": o.warehouse_id,
            "allowSplitShipments": o.allow_split_shipments,
            "chargeForSplitShipments": o.charge_for_split_shipments,
            "deliveryExtensionDays": o.delivery_extension_days,
            "notes": o.notes,
        }
        for o in overrides
    ]

@router.delete("/shipping-rules/overrides/{override_id}")
async def delete_shipping_rule_override(
    override_id: str,
    ctx: TenantContext = Depends(require_roles(["org_admin", "manager", "finance"])),
    db: AsyncSession = Depends(get_db)
):
    res = await db.execute(select(ShippingRuleOverride).where(ShippingRuleOverride.id == override_id, ShippingRuleOverride.organization_id == ctx.org_id))
    o = res.scalars().first()
    if not o:
        raise HttpError(404, "Override not found")
    await db.delete(o)
    await db.commit()
    return {"message": "Override deleted"}

@router.put("/{wh_id}")
async def update_warehouse(
    wh_id: str,
    req: UpdateWarehouseRequest,
    ctx: TenantContext = Depends(require_roles(["org_admin"])),
    db: AsyncSession = Depends(get_db)
):
    res = await db.execute(select(Warehouse).where(Warehouse.id == wh_id, Warehouse.organization_id == ctx.org_id))
    w = res.scalars().first()
    if not w:
        raise HttpError(404, "Warehouse not found")

    if req.name is not None:
        w.name = req.name.strip()
    if req.code is not None:
        w.code = req.code.upper().strip()
    if req.address is not None:
        w.address = req.address
    if req.city is not None:
        w.city = req.city
    if req.status is not None:
        w.status = req.status
    if req.isDefault is not None:
        w.is_default = req.isDefault

    w.updated_at = datetime.utcnow()
    await db.commit()
    return {"id": w.id, "name": w.name, "code": w.code, "isDefault": w.is_default, "status": w.status}

@router.delete("/{wh_id}")
async def delete_warehouse(
    wh_id: str,
    ctx: TenantContext = Depends(require_roles(["org_admin"])),
    db: AsyncSession = Depends(get_db)
):
    res = await db.execute(select(Warehouse).where(Warehouse.id == wh_id, Warehouse.organization_id == ctx.org_id))
    w = res.scalars().first()
    if not w:
        raise HttpError(404, "Warehouse not found")
    await db.delete(w)
    await db.commit()
    return {"message": "Warehouse deleted"}

@router.post("/stock/arrival")
async def record_stock_arrival(
    req: StockArrivalRequest,
    ctx: TenantContext = Depends(require_roles(["org_admin", "ops"])),
    db: AsyncSession = Depends(get_db)
):
    if req.quantityAdded <= 0:
        raise HttpError(400, "quantityAdded must be greater than 0")

    wh_res = await db.execute(select(Warehouse).where(Warehouse.id == req.warehouseId, Warehouse.organization_id == ctx.org_id))
    if not wh_res.scalars().first():
        raise HttpError(404, "Warehouse not found")

    prod_res = await db.execute(select(Product).where(Product.id == req.productId, Product.organization_id == ctx.org_id))
    if not prod_res.scalars().first():
        raise HttpError(404, "Product not found")

    stock_res = await db.execute(
        select(StockLevel).where(
            StockLevel.organization_id == ctx.org_id,
            StockLevel.warehouse_id == req.warehouseId,
            StockLevel.product_id == req.productId
        )
    )
    stock = stock_res.scalars().first()
    now = datetime.utcnow()
    if stock:
        stock.quantity += req.quantityAdded
        stock.updated_at = now
    else:
        stock = StockLevel(
            organization_id=ctx.org_id,
            warehouse_id=req.warehouseId,
            product_id=req.productId,
            quantity=req.quantityAdded,
            created_at=now,
            updated_at=now
        )
        db.add(stock)

    await db.commit()

    # Trigger RabbitMQ backorder consolidation worker
    process_backorder_consolidation.delay({
        "orgId": ctx.org_id,
        "warehouseId": req.warehouseId,
        "productId": req.productId,
        "quantityAdded": req.quantityAdded,
        "timestamp": now.isoformat() + "Z"
    })

    return {
        "warehouseId": req.warehouseId,
        "productId": req.productId,
        "quantity": stock.quantity,
    }

@router.put("/{wh_id}/stock/{prod_id}")
async def set_stock(
    wh_id: str,
    prod_id: str,
    req: SetStockRequest,
    ctx: TenantContext = Depends(require_roles(["org_admin", "ops"])),
    db: AsyncSession = Depends(get_db)
):
    stock_res = await db.execute(
        select(StockLevel).where(
            StockLevel.organization_id == ctx.org_id,
            StockLevel.warehouse_id == wh_id,
            StockLevel.product_id == prod_id
        )
    )
    stock = stock_res.scalars().first()
    now = datetime.utcnow()
    old_qty = stock.quantity if stock else 0

    if stock:
        stock.quantity = req.quantity
        stock.updated_at = now
    else:
        stock = StockLevel(
            organization_id=ctx.org_id,
            warehouse_id=wh_id,
            product_id=prod_id,
            quantity=req.quantity,
            created_at=now,
            updated_at=now
        )
        db.add(stock)

    await db.commit()

    if req.quantity > old_qty:
        process_backorder_consolidation.delay({
            "orgId": ctx.org_id,
            "warehouseId": wh_id,
            "productId": prod_id,
            "quantityAdded": req.quantity - old_qty,
            "timestamp": now.isoformat() + "Z"
        })

    return {"warehouseId": wh_id, "productId": prod_id, "quantity": stock.quantity}

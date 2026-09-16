from fastapi import APIRouter, Depends, UploadFile, File, Response
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from src.database import get_db
from src.models import Quotation, Invoice, Product, AuditLog, Customer
from src.shared.tenant import get_tenant_context, require_roles, TenantContext
from src.shared.errors import HttpError
from src.lib.minio_client import storage_service
from src.lib.gotenberg import html_to_pdf

router = APIRouter(prefix="/api/files", tags=["Files"])

@router.get("/quotations/{quote_id}/pdf")
async def get_quotation_pdf(
    quote_id: str,
    ctx: TenantContext = Depends(get_tenant_context),
    db: AsyncSession = Depends(get_db)
):
    q_res = await db.execute(select(Quotation).where(Quotation.id == quote_id, Quotation.organization_id == ctx.org_id))
    quote = q_res.scalars().first()
    if not quote:
        raise HttpError(404, "Quotation not found")

    html = f"""
    <!DOCTYPE html>
    <html>
    <head><style>body {{ font-family: sans-serif; padding: 20px; }} h1 {{ color: #1e293b; }}</style></head>
    <body>
        <h1>Quotation {quote.quotation_number}</h1>
        <p>Status: {quote.status}</p>
        <p>Total Amount: ${quote.total_amount}</p>
        <p>Total Margin: {quote.total_margin_percent}%</p>
    </body>
    </html>
    """
    pdf_bytes = await html_to_pdf(html)
    return Response(
        content=pdf_bytes,
        media_type="application/pdf",
        headers={"Content-Disposition": f"inline; filename=quote_{quote.quotation_number}.pdf"}
    )

@router.get("/quotations/{quote_id}/logs.txt")
@router.get("/quotations/{quote_id}/logs/txt")
async def get_quotation_logs_txt(
    quote_id: str,
    ctx: TenantContext = Depends(get_tenant_context),
    db: AsyncSession = Depends(get_db)
):
    q_res = await db.execute(select(Quotation).where(Quotation.id == quote_id, Quotation.organization_id == ctx.org_id))
    quote = q_res.scalars().first()
    if not quote:
        raise HttpError(404, "Quotation not found")

    logs_res = await db.execute(
        select(AuditLog).where(
            AuditLog.organization_id == ctx.org_id,
            AuditLog.entity_type == "quotation",
            AuditLog.entity_id == quote.id
        ).order_by(AuditLog.created_at.asc())
    )
    logs = logs_res.scalars().all()

    lines = [f"=== AUDIT LOGS FOR QUOTATION {quote.quotation_number} ==="]
    for l in logs:
        lines.append(f"[{l.created_at.isoformat()}] {l.action.upper()} by {l.user_email or 'System'} ({l.user_role or 'none'}) - {l.reason or ''}")

    return Response(
        content="\n".join(lines),
        media_type="text/plain",
        headers={"Content-Disposition": f"attachment; filename=logs_{quote.quotation_number}.txt"}
    )

@router.get("/invoices/{invoice_id}/pdf")
async def get_invoice_pdf(
    invoice_id: str,
    ctx: TenantContext = Depends(get_tenant_context),
    db: AsyncSession = Depends(get_db)
):
    inv_res = await db.execute(select(Invoice).where(Invoice.id == invoice_id, Invoice.organization_id == ctx.org_id))
    inv = inv_res.scalars().first()
    if not inv:
        raise HttpError(404, "Invoice not found")

    html = f"""
    <!DOCTYPE html>
    <html>
    <head><style>body {{ font-family: sans-serif; padding: 20px; }} h1 {{ color: #1e293b; }}</style></head>
    <body>
        <h1>Invoice {inv.invoice_number}</h1>
        <p>Status: {inv.status}</p>
        <p>Total Amount: ${inv.total_amount}</p>
        <p>Amount Paid: ${inv.amount_paid}</p>
        <p>Due Date: {inv.due_date.strftime('%Y-%m-%d')}</p>
    </body>
    </html>
    """
    pdf_bytes = await html_to_pdf(html)
    return Response(
        content=pdf_bytes,
        media_type="application/pdf",
        headers={"Content-Disposition": f"inline; filename=invoice_{inv.invoice_number}.pdf"}
    )

@router.get("/reports/deals")
async def get_deals_report(
    ctx: TenantContext = Depends(require_roles(["org_admin", "manager", "finance", "rep"])),
    db: AsyncSession = Depends(get_db)
):
    quotes_res = await db.execute(select(Quotation).where(Quotation.organization_id == ctx.org_id).order_by(Quotation.created_at.desc()))
    quotes = quotes_res.scalars().all()

    html = f"""
    <!DOCTYPE html>
    <html>
    <head><style>body {{ font-family: sans-serif; padding: 20px; }} table {{ width: 100%; border-collapse: collapse; }} th, td {{ border: 1px solid #ccc; padding: 8px; text-align: left; }}</style></head>
    <body>
        <h1>Deals Report</h1>
        <table>
            <tr><th>Quotation #</th><th>Status</th><th>Total Amount</th><th>Risk Score</th></tr>
            {''.join(f"<tr><td>{q.quotation_number}</td><td>{q.status}</td><td>${q.total_amount}</td><td>{q.risk_score}</td></tr>" for q in quotes)}
        </table>
    </body>
    </html>
    """
    pdf_bytes = await html_to_pdf(html)
    return Response(
        content=pdf_bytes,
        media_type="application/pdf",
        headers={"Content-Disposition": "inline; filename=deals_report.pdf"}
    )

@router.post("/products/{prod_id}/image")
async def upload_product_image(
    prod_id: str,
    image: UploadFile = File(...),
    ctx: TenantContext = Depends(require_roles(["org_admin"])),
    db: AsyncSession = Depends(get_db)
):
    prod_res = await db.execute(select(Product).where(Product.id == prod_id, Product.organization_id == ctx.org_id))
    prod = prod_res.scalars().first()
    if not prod:
        raise HttpError(404, "Product not found")

    content = await image.read()
    filename = f"products/{prod.id}/image.png"
    storage_service.upload_tenant_file(ctx.org_id, filename, content, image.content_type or "image/png")
    return {"message": "Product image uploaded successfully"}

@router.get("/products/{prod_id}/image")
async def get_product_image(
    prod_id: str,
    ctx: TenantContext = Depends(get_tenant_context),
    db: AsyncSession = Depends(get_db)
):
    prod_res = await db.execute(select(Product).where(Product.id == prod_id, Product.organization_id == ctx.org_id))
    prod = prod_res.scalars().first()
    if not prod:
        raise HttpError(404, "Product not found")

    try:
        content, c_type = storage_service.get_tenant_file(ctx.org_id, f"products/{prod.id}/image.png")
        return Response(content=content, media_type=c_type)
    except Exception:
        raise HttpError(404, "Product image not found")

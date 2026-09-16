import uuid
from datetime import datetime
from decimal import Decimal
from typing import Optional, List, Any
from sqlalchemy import (
    String, Boolean, Integer, Numeric, DateTime, JSON, ForeignKey, UniqueConstraint, Index, Text
)
from sqlalchemy.orm import Mapped, mapped_column, relationship
from src.database import Base

def gen_uuid() -> str:
    return str(uuid.uuid4())

class DealflowMeta(Base):
    __tablename__ = "_dealflow_meta"
    key: Mapped[str] = mapped_column(String, primary_key=True)
    value: Mapped[str] = mapped_column(Text)

class Organization(Base):
    __tablename__ = "organizations"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=gen_uuid)
    name: Mapped[str] = mapped_column(String, nullable=False)
    slug: Mapped[str] = mapped_column(String, unique=True, nullable=False)
    status: Mapped[str] = mapped_column(String, default="active", nullable=False)
    logo_url: Mapped[Optional[str]] = mapped_column(String, nullable=True)
    address: Mapped[Optional[str]] = mapped_column(String, nullable=True)
    description: Mapped[Optional[str]] = mapped_column(String, nullable=True)
    contact_email: Mapped[Optional[str]] = mapped_column(String, nullable=True)
    contact_phone: Mapped[Optional[str]] = mapped_column(String, nullable=True)
    website: Mapped[Optional[str]] = mapped_column(String, nullable=True)
    currency: Mapped[str] = mapped_column(String, default="USD", nullable=False)
    timezone: Mapped[str] = mapped_column(String, default="UTC", nullable=False)
    onboarding_completed: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False)

    users: Mapped[List["User"]] = relationship("User", back_populates="organization", cascade="all, delete-orphan")
    invites: Mapped[List["OrganizationInvite"]] = relationship("OrganizationInvite", back_populates="organization", cascade="all, delete-orphan")
    categories: Mapped[List["ProductCategory"]] = relationship("ProductCategory", back_populates="organization", cascade="all, delete-orphan")
    customer_tiers: Mapped[List["CustomerTier"]] = relationship("CustomerTier", back_populates="organization", cascade="all, delete-orphan")
    products: Mapped[List["Product"]] = relationship("Product", back_populates="organization", cascade="all, delete-orphan")
    customers: Mapped[List["Customer"]] = relationship("Customer", back_populates="organization", cascade="all, delete-orphan")
    quotations: Mapped[List["Quotation"]] = relationship("Quotation", back_populates="organization", cascade="all, delete-orphan")
    approval_chain_config: Mapped[Optional["ApprovalChainConfig"]] = relationship("ApprovalChainConfig", back_populates="organization", uselist=False, cascade="all, delete-orphan")
    shipping_rule_config: Mapped[Optional["ShippingRuleConfig"]] = relationship("ShippingRuleConfig", back_populates="organization", uselist=False, cascade="all, delete-orphan")
    payment_gateway_config: Mapped[Optional["PaymentGatewayConfig"]] = relationship("PaymentGatewayConfig", back_populates="organization", uselist=False, cascade="all, delete-orphan")

class User(Base):
    __tablename__ = "users"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=gen_uuid)
    organization_id: Mapped[Optional[str]] = mapped_column(String, ForeignKey("organizations.id", ondelete="CASCADE"), nullable=True, index=True)
    email: Mapped[str] = mapped_column(String, unique=True, nullable=False)
    password_hash: Mapped[str] = mapped_column(String, nullable=False)
    name: Mapped[Optional[str]] = mapped_column(String, nullable=True)
    role: Mapped[str] = mapped_column(String, nullable=False)
    status: Mapped[str] = mapped_column(String, default="active", nullable=False)
    password_reset_token: Mapped[Optional[str]] = mapped_column(String, nullable=True)
    password_reset_expires: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False)

    organization: Mapped[Optional["Organization"]] = relationship("Organization", back_populates="users")

class OrganizationInvite(Base):
    __tablename__ = "organization_invites"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=gen_uuid)
    organization_id: Mapped[str] = mapped_column(String, ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False, index=True)
    email: Mapped[str] = mapped_column(String, nullable=False, index=True)
    role: Mapped[str] = mapped_column(String, default="org_admin", nullable=False)
    token: Mapped[str] = mapped_column(String, unique=True, nullable=False)
    expires_at: Mapped[datetime] = mapped_column(DateTime, nullable=False)
    accepted_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False)

    organization: Mapped["Organization"] = relationship("Organization", back_populates="invites")

class ProductCategory(Base):
    __tablename__ = "product_categories"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=gen_uuid)
    organization_id: Mapped[str] = mapped_column(String, ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False, index=True)
    name: Mapped[str] = mapped_column(String, nullable=False)
    code: Mapped[str] = mapped_column(String, nullable=False)
    description: Mapped[Optional[str]] = mapped_column(String, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False)

    organization: Mapped["Organization"] = relationship("Organization", back_populates="categories")
    products: Mapped[List["Product"]] = relationship("Product", back_populates="category")

    __table_args__ = (
        UniqueConstraint("organization_id", "id"),
        UniqueConstraint("organization_id", "code"),
    )

class CustomerTier(Base):
    __tablename__ = "customer_tiers"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=gen_uuid)
    organization_id: Mapped[str] = mapped_column(String, ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False, index=True)
    name: Mapped[str] = mapped_column(String, nullable=False)
    code: Mapped[str] = mapped_column(String, nullable=False)
    description: Mapped[Optional[str]] = mapped_column(String, nullable=True)
    default_discount_percent: Mapped[Decimal] = mapped_column(Numeric(5, 2), default=Decimal("0.00"), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False)

    organization: Mapped["Organization"] = relationship("Organization", back_populates="customer_tiers")
    customers: Mapped[List["Customer"]] = relationship("Customer", back_populates="tier")

    __table_args__ = (
        UniqueConstraint("organization_id", "id"),
        UniqueConstraint("organization_id", "code"),
    )

class Product(Base):
    __tablename__ = "products"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=gen_uuid)
    organization_id: Mapped[str] = mapped_column(String, ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False, index=True)
    category_id: Mapped[Optional[str]] = mapped_column(String, ForeignKey("product_categories.id", ondelete="SET NULL"), nullable=True)
    name: Mapped[str] = mapped_column(String, nullable=False)
    sku: Mapped[str] = mapped_column(String, nullable=False)
    description: Mapped[Optional[str]] = mapped_column(String, nullable=True)
    price: Mapped[Decimal] = mapped_column(Numeric(12, 2), nullable=False)
    cost_price: Mapped[Optional[Decimal]] = mapped_column(Numeric(12, 2), nullable=True)
    billing_frequency: Mapped[str] = mapped_column(String, default="one_time", nullable=False)
    status: Mapped[str] = mapped_column(String, default="active", nullable=False)
    max_discount_percent: Mapped[Optional[Decimal]] = mapped_column(Numeric(5, 2), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False)

    organization: Mapped["Organization"] = relationship("Organization", back_populates="products")
    category: Mapped[Optional["ProductCategory"]] = relationship("ProductCategory", back_populates="products")

    __table_args__ = (
        UniqueConstraint("organization_id", "id"),
        UniqueConstraint("organization_id", "sku"),
        Index("ix_products_org_category", "organization_id", "category_id"),
    )

class PriceListItem(Base):
    __tablename__ = "price_list_items"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=gen_uuid)
    organization_id: Mapped[str] = mapped_column(String, ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False, index=True)
    tier_id: Mapped[str] = mapped_column(String, nullable=False)
    product_id: Mapped[str] = mapped_column(String, nullable=False)
    custom_price: Mapped[Decimal] = mapped_column(Numeric(12, 2), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False)

    __table_args__ = (
        UniqueConstraint("organization_id", "id"),
        UniqueConstraint("organization_id", "tier_id", "product_id"),
        Index("ix_price_list_items_org_tier", "organization_id", "tier_id"),
        Index("ix_price_list_items_org_product", "organization_id", "product_id"),
    )

class OrderLine(Base):
    __tablename__ = "order_lines"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=gen_uuid)
    organization_id: Mapped[str] = mapped_column(String, ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False, index=True)
    product_id: Mapped[str] = mapped_column(String, nullable=False)
    quantity: Mapped[int] = mapped_column(Integer, default=1, nullable=False)
    unit_price: Mapped[Decimal] = mapped_column(Numeric(12, 2), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False)

    __table_args__ = (
        UniqueConstraint("organization_id", "id"),
        Index("ix_order_lines_org_product", "organization_id", "product_id"),
    )

class DiscountCeiling(Base):
    __tablename__ = "discount_ceilings"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=gen_uuid)
    organization_id: Mapped[str] = mapped_column(String, ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False, index=True)
    tier_id: Mapped[str] = mapped_column(String, nullable=False)
    category_id: Mapped[str] = mapped_column(String, nullable=False)
    max_discount_percent: Mapped[Decimal] = mapped_column(Numeric(5, 2), default=Decimal("0.00"), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False)

    __table_args__ = (
        UniqueConstraint("organization_id", "id"),
        UniqueConstraint("organization_id", "tier_id", "category_id"),
        Index("ix_discount_ceilings_org_tier", "organization_id", "tier_id"),
        Index("ix_discount_ceilings_org_category", "organization_id", "category_id"),
    )

class ApprovalChainConfig(Base):
    __tablename__ = "approval_chain_configs"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=gen_uuid)
    organization_id: Mapped[str] = mapped_column(String, ForeignKey("organizations.id", ondelete="CASCADE"), unique=True, nullable=False, index=True)
    manager_threshold_percent: Mapped[Decimal] = mapped_column(Numeric(5, 2), default=Decimal("0.00"), nullable=False)
    finance_threshold_percent: Mapped[Decimal] = mapped_column(Numeric(5, 2), default=Decimal("15.00"), nullable=False)
    require_finance_above_threshold: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    auto_approve_within_ceilings: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False)

    organization: Mapped["Organization"] = relationship("Organization", back_populates="approval_chain_config")

class Customer(Base):
    __tablename__ = "customers"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=gen_uuid)
    organization_id: Mapped[str] = mapped_column(String, ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False, index=True)
    tier_id: Mapped[str] = mapped_column(String, ForeignKey("customer_tiers.id", ondelete="RESTRICT"), nullable=False)
    name: Mapped[str] = mapped_column(String, nullable=False)
    email: Mapped[str] = mapped_column(String, nullable=False)
    company: Mapped[Optional[str]] = mapped_column(String, nullable=True)
    phone: Mapped[Optional[str]] = mapped_column(String, nullable=True)
    address: Mapped[Optional[str]] = mapped_column(String, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False)

    organization: Mapped["Organization"] = relationship("Organization", back_populates="customers")
    tier: Mapped["CustomerTier"] = relationship("CustomerTier", back_populates="customers")
    quotations: Mapped[List["Quotation"]] = relationship("Quotation", back_populates="customer")

    __table_args__ = (
        UniqueConstraint("organization_id", "id"),
        UniqueConstraint("organization_id", "email"),
        Index("ix_customers_org_tier", "organization_id", "tier_id"),
    )

class Quotation(Base):
    __tablename__ = "quotations"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=gen_uuid)
    organization_id: Mapped[str] = mapped_column(String, ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False, index=True)
    quotation_number: Mapped[str] = mapped_column(String, nullable=False)
    customer_id: Mapped[str] = mapped_column(String, ForeignKey("customers.id", ondelete="RESTRICT"), nullable=False)
    tier_id: Mapped[str] = mapped_column(String, ForeignKey("customer_tiers.id", ondelete="RESTRICT"), nullable=False)
    rep_id: Mapped[Optional[str]] = mapped_column(String, ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    status: Mapped[str] = mapped_column(String, default="draft", nullable=False)
    order_discount_percent: Mapped[Decimal] = mapped_column(Numeric(5, 2), default=Decimal("0.00"), nullable=False)
    order_discount_amount: Mapped[Decimal] = mapped_column(Numeric(12, 2), default=Decimal("0.00"), nullable=False)
    subtotal: Mapped[Decimal] = mapped_column(Numeric(12, 2), default=Decimal("0.00"), nullable=False)
    total_discount: Mapped[Decimal] = mapped_column(Numeric(12, 2), default=Decimal("0.00"), nullable=False)
    total_amount: Mapped[Decimal] = mapped_column(Numeric(12, 2), default=Decimal("0.00"), nullable=False)
    total_cost: Mapped[Decimal] = mapped_column(Numeric(12, 2), default=Decimal("0.00"), nullable=False)
    total_margin: Mapped[Decimal] = mapped_column(Numeric(12, 2), default=Decimal("0.00"), nullable=False)
    total_margin_percent: Mapped[Decimal] = mapped_column(Numeric(5, 2), default=Decimal("0.00"), nullable=False)
    one_time_total: Mapped[Decimal] = mapped_column(Numeric(12, 2), default=Decimal("0.00"), nullable=False)
    recurring_monthly_total: Mapped[Decimal] = mapped_column(Numeric(12, 2), default=Decimal("0.00"), nullable=False)
    recurring_annual_total: Mapped[Decimal] = mapped_column(Numeric(12, 2), default=Decimal("0.00"), nullable=False)
    risk_score: Mapped[Decimal] = mapped_column(Numeric(5, 2), default=Decimal("0.00"), nullable=False)
    risk_level: Mapped[str] = mapped_column(String, default="low", nullable=False)
    approval_routing: Mapped[str] = mapped_column(String, default="none", nullable=False)
    risk_details: Mapped[Optional[Any]] = mapped_column(JSON, nullable=True)
    notes: Mapped[Optional[str]] = mapped_column(String, nullable=True)
    valid_until: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False)

    organization: Mapped["Organization"] = relationship("Organization", back_populates="quotations")
    customer: Mapped["Customer"] = relationship("Customer", back_populates="quotations")
    tier: Mapped["CustomerTier"] = relationship("CustomerTier")
    rep: Mapped[Optional["User"]] = relationship("User")
    lines: Mapped[List["QuotationLine"]] = relationship("QuotationLine", back_populates="quotation", cascade="all, delete-orphan")
    approval_requests: Mapped[List["ApprovalRequest"]] = relationship("ApprovalRequest", back_populates="quotation", cascade="all, delete-orphan")

    __table_args__ = (
        UniqueConstraint("organization_id", "id"),
        UniqueConstraint("organization_id", "quotation_number"),
        Index("ix_quotations_org_customer", "organization_id", "customer_id"),
        Index("ix_quotations_org_status", "organization_id", "status"),
        Index("ix_quotations_org_risk", "organization_id", "risk_level"),
    )

class QuotationLine(Base):
    __tablename__ = "quotation_lines"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=gen_uuid)
    organization_id: Mapped[str] = mapped_column(String, ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False, index=True)
    quotation_id: Mapped[str] = mapped_column(String, ForeignKey("quotations.id", ondelete="CASCADE"), nullable=False)
    product_id: Mapped[str] = mapped_column(String, ForeignKey("products.id", ondelete="RESTRICT"), nullable=False)
    category_id: Mapped[Optional[str]] = mapped_column(String, nullable=True)
    quantity: Mapped[int] = mapped_column(Integer, default=1, nullable=False)
    unit_price: Mapped[Decimal] = mapped_column(Numeric(12, 2), nullable=False)
    cost_price: Mapped[Decimal] = mapped_column(Numeric(12, 2), default=Decimal("0.00"), nullable=False)
    line_discount_percent: Mapped[Decimal] = mapped_column(Numeric(5, 2), default=Decimal("0.00"), nullable=False)
    line_discount_amount: Mapped[Decimal] = mapped_column(Numeric(12, 2), default=Decimal("0.00"), nullable=False)
    subtotal: Mapped[Decimal] = mapped_column(Numeric(12, 2), default=Decimal("0.00"), nullable=False)
    total: Mapped[Decimal] = mapped_column(Numeric(12, 2), default=Decimal("0.00"), nullable=False)
    margin_amount: Mapped[Decimal] = mapped_column(Numeric(12, 2), default=Decimal("0.00"), nullable=False)
    margin_percent: Mapped[Decimal] = mapped_column(Numeric(5, 2), default=Decimal("0.00"), nullable=False)
    applied_ceiling_percent: Mapped[Decimal] = mapped_column(Numeric(5, 2), default=Decimal("0.00"), nullable=False)
    risk_delta_percent: Mapped[Decimal] = mapped_column(Numeric(5, 2), default=Decimal("0.00"), nullable=False)
    is_over_ceiling: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    billing_frequency: Mapped[str] = mapped_column(String, default="one_time", nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False)

    quotation: Mapped["Quotation"] = relationship("Quotation", back_populates="lines")
    product: Mapped["Product"] = relationship("Product")

    __table_args__ = (
        UniqueConstraint("organization_id", "id"),
        Index("ix_quotation_lines_org_quote", "organization_id", "quotation_id"),
        Index("ix_quotation_lines_org_product", "organization_id", "product_id"),
    )

class ProductAffinity(Base):
    __tablename__ = "product_affinities"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=gen_uuid)
    organization_id: Mapped[str] = mapped_column(String, ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False, index=True)
    product_id: Mapped[str] = mapped_column(String, ForeignKey("products.id", ondelete="CASCADE"), nullable=False)
    recommended_product_id: Mapped[str] = mapped_column(String, ForeignKey("products.id", ondelete="CASCADE"), nullable=False)
    co_purchase_count: Mapped[int] = mapped_column(Integer, default=1, nullable=False)
    affinity_score: Mapped[Decimal] = mapped_column(Numeric(5, 4), default=Decimal("0.0000"), nullable=False)
    recommendation_reason: Mapped[Optional[str]] = mapped_column(String, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False)

    product: Mapped["Product"] = relationship("Product", foreign_keys=[product_id])
    recommended_product: Mapped["Product"] = relationship("Product", foreign_keys=[recommended_product_id])

    __table_args__ = (
        UniqueConstraint("organization_id", "id"),
        UniqueConstraint("organization_id", "product_id", "recommended_product_id"),
        Index("ix_product_affinities_org_product", "organization_id", "product_id"),
        Index("ix_product_affinities_org_rec_prod", "organization_id", "recommended_product_id"),
    )

class ApprovalRequest(Base):
    __tablename__ = "approval_requests"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=gen_uuid)
    organization_id: Mapped[str] = mapped_column(String, ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False, index=True)
    quotation_id: Mapped[str] = mapped_column(String, ForeignKey("quotations.id", ondelete="CASCADE"), nullable=False)
    stage: Mapped[str] = mapped_column(String, nullable=False)
    status: Mapped[str] = mapped_column(String, default="pending", nullable=False)
    assigned_role: Mapped[str] = mapped_column(String, nullable=False)
    requested_by_id: Mapped[Optional[str]] = mapped_column(String, ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    actioned_by_id: Mapped[Optional[str]] = mapped_column(String, ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    reason: Mapped[Optional[str]] = mapped_column(String, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False)
    actioned_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)

    quotation: Mapped["Quotation"] = relationship("Quotation", back_populates="approval_requests")
    requested_by: Mapped[Optional["User"]] = relationship("User", foreign_keys=[requested_by_id])
    actioned_by: Mapped[Optional["User"]] = relationship("User", foreign_keys=[actioned_by_id])

    __table_args__ = (
        UniqueConstraint("organization_id", "id"),
        Index("ix_approval_requests_org_quote", "organization_id", "quotation_id"),
        Index("ix_approval_requests_org_status", "organization_id", "status"),
        Index("ix_approval_requests_org_stage_status", "organization_id", "stage", "status"),
    )

class AuditLog(Base):
    __tablename__ = "audit_logs"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=gen_uuid)
    organization_id: Mapped[str] = mapped_column(String, ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False, index=True)
    entity_type: Mapped[str] = mapped_column(String, nullable=False)
    entity_id: Mapped[str] = mapped_column(String, nullable=False)
    user_id: Mapped[Optional[str]] = mapped_column(String, nullable=True)
    user_email: Mapped[Optional[str]] = mapped_column(String, nullable=True)
    user_role: Mapped[Optional[str]] = mapped_column(String, nullable=True)
    action: Mapped[str] = mapped_column(String, nullable=False)
    reason: Mapped[Optional[str]] = mapped_column(String, nullable=True)
    metadata_: Mapped[Optional[Any]] = mapped_column("metadata", JSON, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, nullable=False)

    __table_args__ = (
        UniqueConstraint("organization_id", "id"),
        Index("ix_audit_logs_org_entity", "organization_id", "entity_type", "entity_id"),
        Index("ix_audit_logs_org_created", "organization_id", "created_at"),
    )

class NegotiationComment(Base):
    __tablename__ = "negotiation_comments"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=gen_uuid)
    organization_id: Mapped[str] = mapped_column(String, ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False, index=True)
    quotation_id: Mapped[str] = mapped_column(String, ForeignKey("quotations.id", ondelete="CASCADE"), nullable=False)
    line_id: Mapped[Optional[str]] = mapped_column(String, nullable=True)
    author_type: Mapped[str] = mapped_column(String, default="customer", nullable=False)
    author_id: Mapped[Optional[str]] = mapped_column(String, ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    author_name: Mapped[str] = mapped_column(String, nullable=False)
    author_email: Mapped[Optional[str]] = mapped_column(String, nullable=True)
    body: Mapped[str] = mapped_column(Text, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, nullable=False)

    __table_args__ = (
        UniqueConstraint("organization_id", "id"),
        Index("ix_negotiation_comments_org_quote_created", "organization_id", "quotation_id", "created_at"),
        Index("ix_negotiation_comments_org_line", "organization_id", "line_id"),
    )

class ChangeRequest(Base):
    __tablename__ = "change_requests"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=gen_uuid)
    organization_id: Mapped[str] = mapped_column(String, ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False, index=True)
    quotation_id: Mapped[str] = mapped_column(String, ForeignKey("quotations.id", ondelete="CASCADE"), nullable=False)
    line_id: Mapped[Optional[str]] = mapped_column(String, nullable=True)
    request_type: Mapped[str] = mapped_column(String, nullable=False)
    proposed_quantity: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    proposed_discount_percent: Mapped[Optional[Decimal]] = mapped_column(Numeric(5, 2), nullable=True)
    note: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    status: Mapped[str] = mapped_column(String, default="open", nullable=False)
    requested_by_type: Mapped[str] = mapped_column(String, default="customer", nullable=False)
    requested_by_name: Mapped[str] = mapped_column(String, nullable=False)
    requested_by_email: Mapped[Optional[str]] = mapped_column(String, nullable=True)
    resolved_by_id: Mapped[Optional[str]] = mapped_column(String, ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    resolved_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)
    resolution_note: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, nullable=False)

    __table_args__ = (
        UniqueConstraint("organization_id", "id"),
        Index("ix_change_requests_org_quote_status", "organization_id", "quotation_id", "status"),
        Index("ix_change_requests_org_line", "organization_id", "line_id"),
    )

class CounterProposal(Base):
    __tablename__ = "counter_proposals"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=gen_uuid)
    organization_id: Mapped[str] = mapped_column(String, ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False, index=True)
    quotation_id: Mapped[str] = mapped_column(String, ForeignKey("quotations.id", ondelete="CASCADE"), nullable=False)
    line_id: Mapped[Optional[str]] = mapped_column(String, nullable=True)
    proposed_discount_percent: Mapped[Decimal] = mapped_column(Numeric(5, 2), nullable=False)
    note: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    status: Mapped[str] = mapped_column(String, default="open", nullable=False)
    proposed_by_type: Mapped[str] = mapped_column(String, default="customer", nullable=False)
    proposed_by_name: Mapped[str] = mapped_column(String, nullable=False)
    proposed_by_email: Mapped[Optional[str]] = mapped_column(String, nullable=True)
    decided_by_id: Mapped[Optional[str]] = mapped_column(String, ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    decided_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)
    decision_note: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, nullable=False)

    __table_args__ = (
        UniqueConstraint("organization_id", "id"),
        Index("ix_counter_proposals_org_quote_status", "organization_id", "quotation_id", "status"),
        Index("ix_counter_proposals_org_line", "organization_id", "line_id"),
    )

class Warehouse(Base):
    __tablename__ = "warehouses"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=gen_uuid)
    organization_id: Mapped[str] = mapped_column(String, ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False, index=True)
    name: Mapped[str] = mapped_column(String, nullable=False)
    code: Mapped[str] = mapped_column(String, nullable=False)
    address: Mapped[Optional[str]] = mapped_column(String, nullable=True)
    city: Mapped[Optional[str]] = mapped_column(String, nullable=True)
    is_default: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    status: Mapped[str] = mapped_column(String, default="active", nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False)

    __table_args__ = (
        UniqueConstraint("organization_id", "id"),
        UniqueConstraint("organization_id", "code"),
    )

class StockLevel(Base):
    __tablename__ = "stock_levels"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=gen_uuid)
    organization_id: Mapped[str] = mapped_column(String, ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False, index=True)
    warehouse_id: Mapped[str] = mapped_column(String, ForeignKey("warehouses.id", ondelete="CASCADE"), nullable=False)
    product_id: Mapped[str] = mapped_column(String, ForeignKey("products.id", ondelete="CASCADE"), nullable=False)
    quantity: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False)

    warehouse: Mapped["Warehouse"] = relationship("Warehouse")
    product: Mapped["Product"] = relationship("Product")

    __table_args__ = (
        UniqueConstraint("organization_id", "id"),
        UniqueConstraint("organization_id", "warehouse_id", "product_id"),
        Index("ix_stock_levels_org_product", "organization_id", "product_id"),
    )

class ShippingRuleConfig(Base):
    __tablename__ = "shipping_rule_configs"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=gen_uuid)
    organization_id: Mapped[str] = mapped_column(String, ForeignKey("organizations.id", ondelete="CASCADE"), unique=True, nullable=False, index=True)
    allow_split_shipments: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    charge_for_split_shipments: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    delivery_extension_days: Mapped[int] = mapped_column(Integer, default=3, nullable=False)
    notes: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False)

    organization: Mapped["Organization"] = relationship("Organization", back_populates="shipping_rule_config")

class ShippingRuleOverride(Base):
    __tablename__ = "shipping_rule_overrides"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=gen_uuid)
    organization_id: Mapped[str] = mapped_column(String, ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False)
    customer_id: Mapped[Optional[str]] = mapped_column(String, ForeignKey("customers.id", ondelete="CASCADE"), nullable=True)
    warehouse_id: Mapped[Optional[str]] = mapped_column(String, ForeignKey("warehouses.id", ondelete="CASCADE"), nullable=True)
    allow_split_shipments: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    charge_for_split_shipments: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    delivery_extension_days: Mapped[int] = mapped_column(Integer, default=3, nullable=False)
    notes: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False)

    __table_args__ = (
        UniqueConstraint("organization_id", "customer_id", "warehouse_id"),
        Index("ix_shipping_rule_overrides_org_cust", "organization_id", "customer_id"),
        Index("ix_shipping_rule_overrides_org_wh", "organization_id", "warehouse_id"),
    )

class FulfillmentPlan(Base):
    __tablename__ = "fulfillment_plans"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=gen_uuid)
    organization_id: Mapped[str] = mapped_column(String, ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False, index=True)
    quotation_id: Mapped[str] = mapped_column(String, ForeignKey("quotations.id", ondelete="CASCADE"), nullable=False)
    status: Mapped[str] = mapped_column(String, default="proposed", nullable=False)
    shipment_count: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    delivery_extended_days: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    extra_charge_note: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    is_overridden: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    overridden_by_id: Mapped[Optional[str]] = mapped_column(String, nullable=True)
    overridden_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)
    accepted_by_id: Mapped[Optional[str]] = mapped_column(String, nullable=True)
    accepted_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)
    proposed_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False)

    lines: Mapped[List["FulfillmentLine"]] = relationship("FulfillmentLine", back_populates="plan", cascade="all, delete-orphan")
    backorder_items: Mapped[List["BackorderItem"]] = relationship("BackorderItem", back_populates="plan", cascade="all, delete-orphan")

    __table_args__ = (
        UniqueConstraint("organization_id", "id"),
        UniqueConstraint("organization_id", "quotation_id"),
        Index("ix_fulfillment_plans_org_status", "organization_id", "status"),
    )

class FulfillmentLine(Base):
    __tablename__ = "fulfillment_lines"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=gen_uuid)
    organization_id: Mapped[str] = mapped_column(String, ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False, index=True)
    plan_id: Mapped[str] = mapped_column(String, ForeignKey("fulfillment_plans.id", ondelete="CASCADE"), nullable=False)
    quotation_line_id: Mapped[str] = mapped_column(String, ForeignKey("quotation_lines.id", ondelete="CASCADE"), nullable=False)
    product_id: Mapped[str] = mapped_column(String, nullable=False)
    warehouse_id: Mapped[str] = mapped_column(String, ForeignKey("warehouses.id", ondelete="RESTRICT"), nullable=False)
    quantity: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, nullable=False)

    plan: Mapped["FulfillmentPlan"] = relationship("FulfillmentPlan", back_populates="lines")
    warehouse: Mapped["Warehouse"] = relationship("Warehouse")

    __table_args__ = (
        UniqueConstraint("organization_id", "id"),
        UniqueConstraint("organization_id", "plan_id", "quotation_line_id", "warehouse_id"),
        Index("ix_fulfillment_lines_org_plan", "organization_id", "plan_id"),
    )

class BackorderItem(Base):
    __tablename__ = "backorder_items"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=gen_uuid)
    organization_id: Mapped[str] = mapped_column(String, ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False, index=True)
    quotation_id: Mapped[str] = mapped_column(String, ForeignKey("quotations.id", ondelete="CASCADE"), nullable=False)
    quotation_line_id: Mapped[str] = mapped_column(String, ForeignKey("quotation_lines.id", ondelete="CASCADE"), nullable=False)
    product_id: Mapped[str] = mapped_column(String, ForeignKey("products.id", ondelete="CASCADE"), nullable=False)
    plan_id: Mapped[str] = mapped_column(String, ForeignKey("fulfillment_plans.id", ondelete="CASCADE"), nullable=False)
    quantity: Mapped[int] = mapped_column(Integer, nullable=False)
    fulfilled_qty: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    status: Mapped[str] = mapped_column(String, default="pending", nullable=False)
    notes: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False)

    plan: Mapped["FulfillmentPlan"] = relationship("FulfillmentPlan", back_populates="backorder_items")
    product: Mapped["Product"] = relationship("Product")

    __table_args__ = (
        UniqueConstraint("organization_id", "id"),
        Index("ix_backorder_items_org_prod_status", "organization_id", "product_id", "status"),
        Index("ix_backorder_items_org_quote", "organization_id", "quotation_id"),
    )

class ConsolidationPrompt(Base):
    __tablename__ = "consolidation_prompts"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=gen_uuid)
    organization_id: Mapped[str] = mapped_column(String, ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False, index=True)
    quotation_id: Mapped[str] = mapped_column(String, ForeignKey("quotations.id", ondelete="CASCADE"), nullable=False)
    backorder_item_id: Mapped[str] = mapped_column(String, ForeignKey("backorder_items.id", ondelete="CASCADE"), nullable=False)
    warehouse_id: Mapped[str] = mapped_column(String, ForeignKey("warehouses.id", ondelete="RESTRICT"), nullable=False)
    product_id: Mapped[str] = mapped_column(String, ForeignKey("products.id", ondelete="CASCADE"), nullable=False)
    suggested_qty: Mapped[int] = mapped_column(Integer, nullable=False)
    status: Mapped[str] = mapped_column(String, default="pending", nullable=False)
    consolidated_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)
    consolidated_by_id: Mapped[Optional[str]] = mapped_column(String, ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False)

    backorder_item: Mapped["BackorderItem"] = relationship("BackorderItem")
    warehouse: Mapped["Warehouse"] = relationship("Warehouse")
    product: Mapped["Product"] = relationship("Product")

    __table_args__ = (
        UniqueConstraint("organization_id", "id"),
        Index("ix_consolidation_prompts_org_status", "organization_id", "status"),
        Index("ix_consolidation_prompts_org_quote", "organization_id", "quotation_id"),
    )

class SubscriptionPlan(Base):
    __tablename__ = "subscription_plans"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=gen_uuid)
    organization_id: Mapped[str] = mapped_column(String, ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False, index=True)
    name: Mapped[str] = mapped_column(String, nullable=False)
    code: Mapped[str] = mapped_column(String, nullable=False)
    description: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    billing_frequency: Mapped[str] = mapped_column(String, default="monthly", nullable=False)
    billing_cycles_count: Mapped[int] = mapped_column(Integer, default=12, nullable=False)
    proration_policy: Mapped[str] = mapped_column(String, default="prorated_daily", nullable=False)
    status: Mapped[str] = mapped_column(String, default="active", nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False)

    __table_args__ = (
        UniqueConstraint("organization_id", "id"),
        UniqueConstraint("organization_id", "code"),
    )

class Subscription(Base):
    __tablename__ = "subscriptions"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=gen_uuid)
    organization_id: Mapped[str] = mapped_column(String, ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False, index=True)
    quotation_id: Mapped[str] = mapped_column(String, ForeignKey("quotations.id", ondelete="CASCADE"), nullable=False)
    quotation_line_id: Mapped[Optional[str]] = mapped_column(String, ForeignKey("quotation_lines.id", ondelete="SET NULL"), nullable=True)
    product_id: Mapped[str] = mapped_column(String, ForeignKey("products.id", ondelete="RESTRICT"), nullable=False)
    customer_id: Mapped[str] = mapped_column(String, ForeignKey("customers.id", ondelete="RESTRICT"), nullable=False)
    subscription_number: Mapped[str] = mapped_column(String, nullable=False)
    name: Mapped[str] = mapped_column(String, nullable=False)
    billing_frequency: Mapped[str] = mapped_column(String, default="monthly", nullable=False)
    quantity: Mapped[int] = mapped_column(Integer, default=1, nullable=False)
    unit_price: Mapped[Decimal] = mapped_column(Numeric(12, 2), nullable=False)
    discount_percent: Mapped[Decimal] = mapped_column(Numeric(5, 2), default=Decimal("0.00"), nullable=False)
    recurring_amount: Mapped[Decimal] = mapped_column(Numeric(12, 2), nullable=False)
    currency: Mapped[str] = mapped_column(String, default="USD", nullable=False)
    status: Mapped[str] = mapped_column(String, default="active", nullable=False)
    start_date: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, nullable=False)
    current_period_start: Mapped[datetime] = mapped_column(DateTime, nullable=False)
    current_period_end: Mapped[datetime] = mapped_column(DateTime, nullable=False)
    next_billing_date: Mapped[datetime] = mapped_column(DateTime, nullable=False)
    cancelled_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False)

    product: Mapped["Product"] = relationship("Product")
    customer: Mapped["Customer"] = relationship("Customer")

    __table_args__ = (
        UniqueConstraint("organization_id", "id"),
        UniqueConstraint("organization_id", "subscription_number"),
        Index("ix_subscriptions_org_quote", "organization_id", "quotation_id"),
        Index("ix_subscriptions_org_cust", "organization_id", "customer_id"),
        Index("ix_subscriptions_org_status", "organization_id", "status"),
    )

class BillingSchedule(Base):
    __tablename__ = "billing_schedules"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=gen_uuid)
    organization_id: Mapped[str] = mapped_column(String, ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False, index=True)
    quotation_id: Mapped[str] = mapped_column(String, ForeignKey("quotations.id", ondelete="CASCADE"), nullable=False)
    subscription_id: Mapped[str] = mapped_column(String, ForeignKey("subscriptions.id", ondelete="CASCADE"), nullable=False)
    period_number: Mapped[int] = mapped_column(Integer, nullable=False)
    period_start: Mapped[datetime] = mapped_column(DateTime, nullable=False)
    period_end: Mapped[datetime] = mapped_column(DateTime, nullable=False)
    due_date: Mapped[datetime] = mapped_column(DateTime, nullable=False)
    expected_amount: Mapped[Decimal] = mapped_column(Numeric(12, 2), nullable=False)
    currency: Mapped[str] = mapped_column(String, default="USD", nullable=False)
    status: Mapped[str] = mapped_column(String, default="pending", nullable=False)
    invoice_id: Mapped[Optional[str]] = mapped_column(String, nullable=True)
    invoiced_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False)

    subscription: Mapped["Subscription"] = relationship("Subscription")

    __table_args__ = (
        UniqueConstraint("organization_id", "id"),
        UniqueConstraint("organization_id", "subscription_id", "period_number"),
        Index("ix_billing_schedules_org_sub", "organization_id", "subscription_id"),
        Index("ix_billing_schedules_org_status", "organization_id", "status"),
    )

class Invoice(Base):
    __tablename__ = "invoices"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=gen_uuid)
    organization_id: Mapped[str] = mapped_column(String, ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False, index=True)
    quotation_id: Mapped[str] = mapped_column(String, ForeignKey("quotations.id", ondelete="CASCADE"), nullable=False)
    subscription_id: Mapped[Optional[str]] = mapped_column(String, ForeignKey("subscriptions.id", ondelete="SET NULL"), nullable=True)
    invoice_number: Mapped[str] = mapped_column(String, nullable=False)
    type: Mapped[str] = mapped_column(String, default="one_time", nullable=False)
    status: Mapped[str] = mapped_column(String, default="issued", nullable=False)
    currency: Mapped[str] = mapped_column(String, default="USD", nullable=False)
    subtotal: Mapped[Decimal] = mapped_column(Numeric(12, 2), default=Decimal("0.00"), nullable=False)
    discount_amount: Mapped[Decimal] = mapped_column(Numeric(12, 2), default=Decimal("0.00"), nullable=False)
    total_amount: Mapped[Decimal] = mapped_column(Numeric(12, 2), default=Decimal("0.00"), nullable=False)
    amount_paid: Mapped[Decimal] = mapped_column(Numeric(12, 2), default=Decimal("0.00"), nullable=False)
    amount_refunded: Mapped[Decimal] = mapped_column(Numeric(12, 2), default=Decimal("0.00"), nullable=False)
    due_date: Mapped[datetime] = mapped_column(DateTime, nullable=False)
    issued_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, nullable=False)
    paid_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)
    notes: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False)

    lines: Mapped[List["InvoiceLine"]] = relationship("InvoiceLine", back_populates="invoice", cascade="all, delete-orphan")
    surcharges: Mapped[List["InvoiceSurcharge"]] = relationship("InvoiceSurcharge", back_populates="invoice", cascade="all, delete-orphan")

    __table_args__ = (
        UniqueConstraint("organization_id", "id"),
        UniqueConstraint("organization_id", "invoice_number"),
        Index("ix_invoices_org_quote", "organization_id", "quotation_id"),
        Index("ix_invoices_org_status", "organization_id", "status"),
        Index("ix_invoices_org_type", "organization_id", "type"),
    )

class InvoiceLine(Base):
    __tablename__ = "invoice_lines"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=gen_uuid)
    organization_id: Mapped[str] = mapped_column(String, ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False, index=True)
    invoice_id: Mapped[str] = mapped_column(String, ForeignKey("invoices.id", ondelete="CASCADE"), nullable=False)
    quotation_line_id: Mapped[Optional[str]] = mapped_column(String, nullable=True)
    product_id: Mapped[Optional[str]] = mapped_column(String, nullable=True)
    description: Mapped[str] = mapped_column(String, nullable=False)
    quantity: Mapped[int] = mapped_column(Integer, default=1, nullable=False)
    unit_price: Mapped[Decimal] = mapped_column(Numeric(12, 2), nullable=False)
    discount_percent: Mapped[Decimal] = mapped_column(Numeric(5, 2), default=Decimal("0.00"), nullable=False)
    subtotal: Mapped[Decimal] = mapped_column(Numeric(12, 2), nullable=False)
    total_amount: Mapped[Decimal] = mapped_column(Numeric(12, 2), nullable=False)
    period_start: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)
    period_end: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, nullable=False)

    invoice: Mapped["Invoice"] = relationship("Invoice", back_populates="lines")

    __table_args__ = (
        UniqueConstraint("organization_id", "id"),
        Index("ix_invoice_lines_org_invoice", "organization_id", "invoice_id"),
    )

class InvoiceSurcharge(Base):
    __tablename__ = "invoice_surcharges"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=gen_uuid)
    organization_id: Mapped[str] = mapped_column(String, ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False, index=True)
    invoice_id: Mapped[str] = mapped_column(String, ForeignKey("invoices.id", ondelete="CASCADE"), nullable=False)
    label: Mapped[str] = mapped_column(String, nullable=False)
    kind: Mapped[str] = mapped_column(String, default="amount", nullable=False)
    value: Mapped[Decimal] = mapped_column(Numeric(12, 2), nullable=False)
    computed_amount: Mapped[Decimal] = mapped_column(Numeric(12, 2), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, nullable=False)

    invoice: Mapped["Invoice"] = relationship("Invoice", back_populates="surcharges")

    __table_args__ = (
        UniqueConstraint("organization_id", "id"),
        Index("ix_invoice_surcharges_org_inv", "organization_id", "invoice_id"),
    )

class CreditNote(Base):
    __tablename__ = "credit_notes"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=gen_uuid)
    organization_id: Mapped[str] = mapped_column(String, ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False, index=True)
    credit_note_number: Mapped[str] = mapped_column(String, nullable=False)
    quotation_id: Mapped[str] = mapped_column(String, ForeignKey("quotations.id", ondelete="CASCADE"), nullable=False)
    subscription_id: Mapped[str] = mapped_column(String, ForeignKey("subscriptions.id", ondelete="CASCADE"), nullable=False)
    invoice_id: Mapped[Optional[str]] = mapped_column(String, nullable=True)
    amount: Mapped[Decimal] = mapped_column(Numeric(12, 2), nullable=False)
    currency: Mapped[str] = mapped_column(String, default="USD", nullable=False)
    reason: Mapped[str] = mapped_column(Text, nullable=False)
    status: Mapped[str] = mapped_column(String, default="issued", nullable=False)
    refunded_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False)

    __table_args__ = (
        UniqueConstraint("organization_id", "id"),
        UniqueConstraint("organization_id", "credit_note_number"),
        Index("ix_credit_notes_org_sub", "organization_id", "subscription_id"),
        Index("ix_credit_notes_org_status", "organization_id", "status"),
    )

class PaymentGatewayConfig(Base):
    __tablename__ = "payment_gateway_configs"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=gen_uuid)
    organization_id: Mapped[str] = mapped_column(String, ForeignKey("organizations.id", ondelete="CASCADE"), unique=True, nullable=False, index=True)
    provider: Mapped[str] = mapped_column(String, default="sandbox", nullable=False)
    api_key: Mapped[str] = mapped_column(String, default="sb_key_dealflow_default", nullable=False)
    webhook_secret: Mapped[str] = mapped_column(String, default="sb_whsec_dealflow_default", nullable=False)
    auto_capture: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    is_enabled: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False)

    organization: Mapped["Organization"] = relationship("Organization", back_populates="payment_gateway_config")

class Payment(Base):
    __tablename__ = "payments"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=gen_uuid)
    organization_id: Mapped[str] = mapped_column(String, ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False, index=True)
    invoice_id: Mapped[Optional[str]] = mapped_column(String, ForeignKey("invoices.id", ondelete="SET NULL"), nullable=True)
    credit_note_id: Mapped[Optional[str]] = mapped_column(String, ForeignKey("credit_notes.id", ondelete="SET NULL"), nullable=True)
    transaction_reference: Mapped[str] = mapped_column(String, nullable=False)
    payment_type: Mapped[str] = mapped_column(String, default="charge", nullable=False)
    payment_method: Mapped[str] = mapped_column(String, default="credit_card", nullable=False)
    amount: Mapped[Decimal] = mapped_column(Numeric(12, 2), nullable=False)
    currency: Mapped[str] = mapped_column(String, default="USD", nullable=False)
    status: Mapped[str] = mapped_column(String, default="succeeded", nullable=False)
    error_message: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    gateway_response: Mapped[Optional[Any]] = mapped_column(JSON, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, nullable=False)

    __table_args__ = (
        UniqueConstraint("organization_id", "id"),
        UniqueConstraint("organization_id", "transaction_reference"),
        Index("ix_payments_org_inv", "organization_id", "invoice_id"),
        Index("ix_payments_org_cn", "organization_id", "credit_note_id"),
        Index("ix_payments_org_status", "organization_id", "status"),
    )

class DeadLetterJob(Base):
    __tablename__ = "dead_letter_jobs"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=gen_uuid)
    organization_id: Mapped[Optional[str]] = mapped_column(String, ForeignKey("organizations.id", ondelete="CASCADE"), nullable=True, index=True)
    queue_name: Mapped[str] = mapped_column(String, nullable=False)
    job_id: Mapped[str] = mapped_column(String, nullable=False)
    job_name: Mapped[str] = mapped_column(String, nullable=False)
    payload: Mapped[Any] = mapped_column(JSON, nullable=False)
    error_message: Mapped[str] = mapped_column(Text, nullable=False)
    stack_trace: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    status: Mapped[str] = mapped_column(String, default="failed", nullable=False)
    retry_count: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    failed_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, nullable=False, index=True)
    resolved_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)

    __table_args__ = (
        Index("ix_dead_letter_jobs_queue_status", "queue_name", "status"),
    )

class DealHealthAlert(Base):
    __tablename__ = "deal_health_alerts"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=gen_uuid)
    organization_id: Mapped[str] = mapped_column(String, ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False, index=True)
    quotation_id: Mapped[Optional[str]] = mapped_column(String, ForeignKey("quotations.id", ondelete="CASCADE"), nullable=True)
    rep_id: Mapped[Optional[str]] = mapped_column(String, ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    alert_type: Mapped[str] = mapped_column(String, nullable=False)
    severity: Mapped[str] = mapped_column(String, default="medium", nullable=False)
    title: Mapped[str] = mapped_column(String, nullable=False)
    detail: Mapped[str] = mapped_column(Text, nullable=False)
    metadata_: Mapped[Optional[Any]] = mapped_column("metadata", JSON, nullable=True)
    status: Mapped[str] = mapped_column(String, default="open", nullable=False)
    nudged_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)
    escalated_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)
    resolved_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False)

    quotation: Mapped[Optional["Quotation"]] = relationship("Quotation")
    rep: Mapped[Optional["User"]] = relationship("User")

    __table_args__ = (
        UniqueConstraint("organization_id", "id"),
        Index("ix_deal_health_alerts_org_status", "organization_id", "status"),
        Index("ix_deal_health_alerts_org_alert_type", "organization_id", "alert_type"),
        Index("ix_deal_health_alerts_org_type_quote", "organization_id", "alert_type", "quotation_id"),
    )

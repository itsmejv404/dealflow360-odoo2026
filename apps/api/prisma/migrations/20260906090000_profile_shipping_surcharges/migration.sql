-- Profile management: password reset tokens on users
ALTER TABLE "users" ADD COLUMN "password_reset_token" TEXT;
ALTER TABLE "users" ADD COLUMN "password_reset_expires" TIMESTAMP(3);

-- Shipping rule overrides (per customer and/or per warehouse)
CREATE TABLE "shipping_rule_overrides" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "customer_id" TEXT,
    "warehouse_id" TEXT,
    "allow_split_shipments" BOOLEAN NOT NULL DEFAULT true,
    "charge_for_split_shipments" BOOLEAN NOT NULL DEFAULT false,
    "delivery_extension_days" INTEGER NOT NULL DEFAULT 3,
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "shipping_rule_overrides_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "shipping_rule_overrides_organization_id_idx" ON "shipping_rule_overrides"("organization_id");
CREATE INDEX "shipping_rule_overrides_organization_id_customer_id_idx" ON "shipping_rule_overrides"("organization_id","customer_id");
CREATE INDEX "shipping_rule_overrides_organization_id_warehouse_id_idx" ON "shipping_rule_overrides"("organization_id","warehouse_id");
CREATE UNIQUE INDEX "shipping_rule_overrides_organization_id_customer_id_warehouse_id_key" ON "shipping_rule_overrides"("organization_id","customer_id","warehouse_id");

ALTER TABLE "shipping_rule_overrides" ADD CONSTRAINT "shipping_rule_overrides_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "shipping_rule_overrides" ADD CONSTRAINT "shipping_rule_overrides_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "shipping_rule_overrides" ADD CONSTRAINT "shipping_rule_overrides_warehouse_id_fkey" FOREIGN KEY ("warehouse_id") REFERENCES "warehouses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Invoice surcharges (additional % or fixed-currency charges)
CREATE TABLE "invoice_surcharges" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "invoice_id" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'amount',
    "value" DECIMAL(12,2) NOT NULL,
    "computed_amount" DECIMAL(12,2) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "invoice_surcharges_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "invoice_surcharges_organization_id_idx" ON "invoice_surcharges"("organization_id");
CREATE INDEX "invoice_surcharges_organization_id_invoice_id_idx" ON "invoice_surcharges"("organization_id","invoice_id");
CREATE UNIQUE INDEX "invoice_surcharges_organization_id_id_key" ON "invoice_surcharges"("organization_id","id");

ALTER TABLE "invoice_surcharges" ADD CONSTRAINT "invoice_surcharges_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "invoice_surcharges" ADD CONSTRAINT "invoice_surcharges_organization_id_invoice_id_fkey" FOREIGN KEY ("organization_id","invoice_id") REFERENCES "invoices"("organization_id","id") ON DELETE CASCADE ON UPDATE CASCADE;

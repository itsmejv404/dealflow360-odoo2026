-- CreateTable
CREATE TABLE "customers" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "tier_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "company" TEXT,
    "phone" TEXT,
    "address" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "customers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "quotations" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "quotation_number" TEXT NOT NULL,
    "customer_id" TEXT NOT NULL,
    "tier_id" TEXT NOT NULL,
    "rep_id" TEXT,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "order_discount_percent" DECIMAL(5,2) NOT NULL DEFAULT 0.00,
    "order_discount_amount" DECIMAL(12,2) NOT NULL DEFAULT 0.00,
    "subtotal" DECIMAL(12,2) NOT NULL DEFAULT 0.00,
    "total_discount" DECIMAL(12,2) NOT NULL DEFAULT 0.00,
    "total_amount" DECIMAL(12,2) NOT NULL DEFAULT 0.00,
    "total_cost" DECIMAL(12,2) NOT NULL DEFAULT 0.00,
    "total_margin" DECIMAL(12,2) NOT NULL DEFAULT 0.00,
    "total_margin_percent" DECIMAL(5,2) NOT NULL DEFAULT 0.00,
    "one_time_total" DECIMAL(12,2) NOT NULL DEFAULT 0.00,
    "recurring_monthly_total" DECIMAL(12,2) NOT NULL DEFAULT 0.00,
    "recurring_annual_total" DECIMAL(12,2) NOT NULL DEFAULT 0.00,
    "notes" TEXT,
    "valid_until" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "quotations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "quotation_lines" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "quotation_id" TEXT NOT NULL,
    "product_id" TEXT NOT NULL,
    "category_id" TEXT,
    "quantity" INTEGER NOT NULL DEFAULT 1,
    "unit_price" DECIMAL(12,2) NOT NULL,
    "cost_price" DECIMAL(12,2) NOT NULL DEFAULT 0.00,
    "line_discount_percent" DECIMAL(5,2) NOT NULL DEFAULT 0.00,
    "line_discount_amount" DECIMAL(12,2) NOT NULL DEFAULT 0.00,
    "subtotal" DECIMAL(12,2) NOT NULL DEFAULT 0.00,
    "total" DECIMAL(12,2) NOT NULL DEFAULT 0.00,
    "margin_amount" DECIMAL(12,2) NOT NULL DEFAULT 0.00,
    "margin_percent" DECIMAL(5,2) NOT NULL DEFAULT 0.00,
    "billing_frequency" TEXT NOT NULL DEFAULT 'one_time',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "quotation_lines_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "customers_organization_id_idx" ON "customers"("organization_id");

-- CreateIndex
CREATE INDEX "customers_organization_id_tier_id_idx" ON "customers"("organization_id", "tier_id");

-- CreateIndex
CREATE UNIQUE INDEX "customers_organization_id_id_key" ON "customers"("organization_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "customers_organization_id_email_key" ON "customers"("organization_id", "email");

-- CreateIndex
CREATE INDEX "quotations_organization_id_idx" ON "quotations"("organization_id");

-- CreateIndex
CREATE INDEX "quotations_organization_id_customer_id_idx" ON "quotations"("organization_id", "customer_id");

-- CreateIndex
CREATE INDEX "quotations_organization_id_status_idx" ON "quotations"("organization_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "quotations_organization_id_id_key" ON "quotations"("organization_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "quotations_organization_id_quotation_number_key" ON "quotations"("organization_id", "quotation_number");

-- CreateIndex
CREATE INDEX "quotation_lines_organization_id_idx" ON "quotation_lines"("organization_id");

-- CreateIndex
CREATE INDEX "quotation_lines_organization_id_quotation_id_idx" ON "quotation_lines"("organization_id", "quotation_id");

-- CreateIndex
CREATE INDEX "quotation_lines_organization_id_product_id_idx" ON "quotation_lines"("organization_id", "product_id");

-- CreateIndex
CREATE UNIQUE INDEX "quotation_lines_organization_id_id_key" ON "quotation_lines"("organization_id", "id");

-- AddForeignKey
ALTER TABLE "customers" ADD CONSTRAINT "customers_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customers" ADD CONSTRAINT "customers_organization_id_tier_id_fkey" FOREIGN KEY ("organization_id", "tier_id") REFERENCES "customer_tiers"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quotations" ADD CONSTRAINT "quotations_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quotations" ADD CONSTRAINT "quotations_organization_id_customer_id_fkey" FOREIGN KEY ("organization_id", "customer_id") REFERENCES "customers"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quotations" ADD CONSTRAINT "quotations_organization_id_tier_id_fkey" FOREIGN KEY ("organization_id", "tier_id") REFERENCES "customer_tiers"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quotations" ADD CONSTRAINT "quotations_rep_id_fkey" FOREIGN KEY ("rep_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quotation_lines" ADD CONSTRAINT "quotation_lines_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quotation_lines" ADD CONSTRAINT "quotation_lines_organization_id_quotation_id_fkey" FOREIGN KEY ("organization_id", "quotation_id") REFERENCES "quotations"("organization_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quotation_lines" ADD CONSTRAINT "quotation_lines_organization_id_product_id_fkey" FOREIGN KEY ("organization_id", "product_id") REFERENCES "products"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quotation_lines" ADD CONSTRAINT "quotation_lines_organization_id_category_id_fkey" FOREIGN KEY ("organization_id", "category_id") REFERENCES "product_categories"("organization_id", "id") ON DELETE SET NULL ON UPDATE CASCADE;

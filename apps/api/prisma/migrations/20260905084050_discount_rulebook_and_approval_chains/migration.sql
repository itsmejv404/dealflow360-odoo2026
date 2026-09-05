-- CreateTable
CREATE TABLE "discount_ceilings" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "tier_id" TEXT NOT NULL,
    "category_id" TEXT NOT NULL,
    "max_discount_percent" DECIMAL(5,2) NOT NULL DEFAULT 0.00,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "discount_ceilings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "approval_chain_configs" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "manager_threshold_percent" DECIMAL(5,2) NOT NULL DEFAULT 0.00,
    "finance_threshold_percent" DECIMAL(5,2) NOT NULL DEFAULT 15.00,
    "require_finance_above_threshold" BOOLEAN NOT NULL DEFAULT true,
    "auto_approve_within_ceilings" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "approval_chain_configs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "discount_ceilings_organization_id_idx" ON "discount_ceilings"("organization_id");

-- CreateIndex
CREATE INDEX "discount_ceilings_organization_id_tier_id_idx" ON "discount_ceilings"("organization_id", "tier_id");

-- CreateIndex
CREATE INDEX "discount_ceilings_organization_id_category_id_idx" ON "discount_ceilings"("organization_id", "category_id");

-- CreateIndex
CREATE UNIQUE INDEX "discount_ceilings_organization_id_id_key" ON "discount_ceilings"("organization_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "discount_ceilings_organization_id_tier_id_category_id_key" ON "discount_ceilings"("organization_id", "tier_id", "category_id");

-- CreateIndex
CREATE UNIQUE INDEX "approval_chain_configs_organization_id_key" ON "approval_chain_configs"("organization_id");

-- CreateIndex
CREATE INDEX "approval_chain_configs_organization_id_idx" ON "approval_chain_configs"("organization_id");

-- AddForeignKey
ALTER TABLE "discount_ceilings" ADD CONSTRAINT "discount_ceilings_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "discount_ceilings" ADD CONSTRAINT "discount_ceilings_organization_id_tier_id_fkey" FOREIGN KEY ("organization_id", "tier_id") REFERENCES "customer_tiers"("organization_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "discount_ceilings" ADD CONSTRAINT "discount_ceilings_organization_id_category_id_fkey" FOREIGN KEY ("organization_id", "category_id") REFERENCES "product_categories"("organization_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "approval_chain_configs" ADD CONSTRAINT "approval_chain_configs_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

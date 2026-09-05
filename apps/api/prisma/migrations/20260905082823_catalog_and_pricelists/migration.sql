-- AlterTable
ALTER TABLE "products" ADD COLUMN     "billing_frequency" TEXT NOT NULL DEFAULT 'one_time',
ADD COLUMN     "category_id" TEXT,
ADD COLUMN     "cost_price" DECIMAL(12,2),
ADD COLUMN     "description" TEXT,
ADD COLUMN     "status" TEXT NOT NULL DEFAULT 'active';

-- CreateTable
CREATE TABLE "product_categories" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "description" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "product_categories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "customer_tiers" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "description" TEXT,
    "default_discount_percent" DECIMAL(5,2) NOT NULL DEFAULT 0.00,
    "rank" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "customer_tiers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "price_list_items" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "tier_id" TEXT NOT NULL,
    "product_id" TEXT NOT NULL,
    "custom_price" DECIMAL(12,2) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "price_list_items_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "product_categories_organization_id_idx" ON "product_categories"("organization_id");

-- CreateIndex
CREATE UNIQUE INDEX "product_categories_organization_id_id_key" ON "product_categories"("organization_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "product_categories_organization_id_code_key" ON "product_categories"("organization_id", "code");

-- CreateIndex
CREATE INDEX "customer_tiers_organization_id_idx" ON "customer_tiers"("organization_id");

-- CreateIndex
CREATE UNIQUE INDEX "customer_tiers_organization_id_id_key" ON "customer_tiers"("organization_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "customer_tiers_organization_id_code_key" ON "customer_tiers"("organization_id", "code");

-- CreateIndex
CREATE INDEX "price_list_items_organization_id_idx" ON "price_list_items"("organization_id");

-- CreateIndex
CREATE INDEX "price_list_items_organization_id_tier_id_idx" ON "price_list_items"("organization_id", "tier_id");

-- CreateIndex
CREATE INDEX "price_list_items_organization_id_product_id_idx" ON "price_list_items"("organization_id", "product_id");

-- CreateIndex
CREATE UNIQUE INDEX "price_list_items_organization_id_id_key" ON "price_list_items"("organization_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "price_list_items_organization_id_tier_id_product_id_key" ON "price_list_items"("organization_id", "tier_id", "product_id");

-- CreateIndex
CREATE INDEX "products_organization_id_category_id_idx" ON "products"("organization_id", "category_id");

-- AddForeignKey
ALTER TABLE "product_categories" ADD CONSTRAINT "product_categories_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_tiers" ADD CONSTRAINT "customer_tiers_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "products" ADD CONSTRAINT "products_organization_id_category_id_fkey" FOREIGN KEY ("organization_id", "category_id") REFERENCES "product_categories"("organization_id", "id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "price_list_items" ADD CONSTRAINT "price_list_items_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "price_list_items" ADD CONSTRAINT "price_list_items_organization_id_tier_id_fkey" FOREIGN KEY ("organization_id", "tier_id") REFERENCES "customer_tiers"("organization_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "price_list_items" ADD CONSTRAINT "price_list_items_organization_id_product_id_fkey" FOREIGN KEY ("organization_id", "product_id") REFERENCES "products"("organization_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

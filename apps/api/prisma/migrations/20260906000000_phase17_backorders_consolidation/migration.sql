-- CreateTable
CREATE TABLE "backorder_items" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "quotation_id" TEXT NOT NULL,
    "quotation_line_id" TEXT NOT NULL,
    "product_id" TEXT NOT NULL,
    "plan_id" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "fulfilled_qty" INTEGER NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "backorder_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "consolidation_prompts" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "quotation_id" TEXT NOT NULL,
    "backorder_item_id" TEXT NOT NULL,
    "warehouse_id" TEXT NOT NULL,
    "product_id" TEXT NOT NULL,
    "suggested_qty" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "consolidated_at" TIMESTAMP(3),
    "consolidated_by_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "consolidation_prompts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "backorder_items_organization_id_idx" ON "backorder_items"("organization_id");

-- CreateIndex
CREATE INDEX "backorder_items_organization_id_product_id_status_idx" ON "backorder_items"("organization_id", "product_id", "status");

-- CreateIndex
CREATE INDEX "backorder_items_organization_id_quotation_id_idx" ON "backorder_items"("organization_id", "quotation_id");

-- CreateIndex
CREATE UNIQUE INDEX "backorder_items_organization_id_id_key" ON "backorder_items"("organization_id", "id");

-- CreateIndex
CREATE INDEX "consolidation_prompts_organization_id_idx" ON "consolidation_prompts"("organization_id");

-- CreateIndex
CREATE INDEX "consolidation_prompts_organization_id_status_idx" ON "consolidation_prompts"("organization_id", "status");

-- CreateIndex
CREATE INDEX "consolidation_prompts_organization_id_quotation_id_idx" ON "consolidation_prompts"("organization_id", "quotation_id");

-- CreateIndex
CREATE UNIQUE INDEX "consolidation_prompts_organization_id_id_key" ON "consolidation_prompts"("organization_id", "id");

-- AddForeignKey
ALTER TABLE "backorder_items" ADD CONSTRAINT "backorder_items_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "backorder_items" ADD CONSTRAINT "backorder_items_organization_id_quotation_id_fkey" FOREIGN KEY ("organization_id", "quotation_id") REFERENCES "quotations"("organization_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "backorder_items" ADD CONSTRAINT "backorder_items_organization_id_quotation_line_id_fkey" FOREIGN KEY ("organization_id", "quotation_line_id") REFERENCES "quotation_lines"("organization_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "backorder_items" ADD CONSTRAINT "backorder_items_organization_id_product_id_fkey" FOREIGN KEY ("organization_id", "product_id") REFERENCES "products"("organization_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "backorder_items" ADD CONSTRAINT "backorder_items_organization_id_plan_id_fkey" FOREIGN KEY ("organization_id", "plan_id") REFERENCES "fulfillment_plans"("organization_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "consolidation_prompts" ADD CONSTRAINT "consolidation_prompts_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "consolidation_prompts" ADD CONSTRAINT "consolidation_prompts_organization_id_quotation_id_fkey" FOREIGN KEY ("organization_id", "quotation_id") REFERENCES "quotations"("organization_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "consolidation_prompts" ADD CONSTRAINT "consolidation_prompts_organization_id_backorder_item_id_fkey" FOREIGN KEY ("organization_id", "backorder_item_id") REFERENCES "backorder_items"("organization_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "consolidation_prompts" ADD CONSTRAINT "consolidation_prompts_organization_id_warehouse_id_fkey" FOREIGN KEY ("organization_id", "warehouse_id") REFERENCES "warehouses"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "consolidation_prompts" ADD CONSTRAINT "consolidation_prompts_organization_id_product_id_fkey" FOREIGN KEY ("organization_id", "product_id") REFERENCES "products"("organization_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "consolidation_prompts" ADD CONSTRAINT "consolidation_prompts_consolidated_by_id_fkey" FOREIGN KEY ("consolidated_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
-- CreateTable
CREATE TABLE "fulfillment_plans" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "quotation_id" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'proposed',
    "shipment_count" INTEGER NOT NULL DEFAULT 0,
    "delivery_extended_days" INTEGER NOT NULL DEFAULT 0,
    "extra_charge_note" TEXT,
    "is_overridden" BOOLEAN NOT NULL DEFAULT false,
    "overridden_by_id" TEXT,
    "overridden_at" TIMESTAMP(3),
    "accepted_by_id" TEXT,
    "accepted_at" TIMESTAMP(3),
    "proposed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "fulfillment_plans_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fulfillment_lines" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "plan_id" TEXT NOT NULL,
    "quotation_line_id" TEXT NOT NULL,
    "product_id" TEXT NOT NULL,
    "warehouse_id" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "fulfillment_lines_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "fulfillment_plans_organization_id_idx" ON "fulfillment_plans"("organization_id");

-- CreateIndex
CREATE INDEX "fulfillment_plans_organization_id_status_idx" ON "fulfillment_plans"("organization_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "fulfillment_plans_organization_id_id_key" ON "fulfillment_plans"("organization_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "fulfillment_plans_organization_id_quotation_id_key" ON "fulfillment_plans"("organization_id", "quotation_id");

-- CreateIndex
CREATE INDEX "fulfillment_lines_organization_id_idx" ON "fulfillment_lines"("organization_id");

-- CreateIndex
CREATE INDEX "fulfillment_lines_organization_id_plan_id_idx" ON "fulfillment_lines"("organization_id", "plan_id");

-- CreateIndex
CREATE UNIQUE INDEX "fulfillment_lines_organization_id_id_key" ON "fulfillment_lines"("organization_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "fulfillment_lines_organization_id_plan_id_quotation_line_id_warehouse_id_key" ON "fulfillment_lines"("organization_id", "plan_id", "quotation_line_id", "warehouse_id");

-- AddForeignKey
ALTER TABLE "fulfillment_plans" ADD CONSTRAINT "fulfillment_plans_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fulfillment_plans" ADD CONSTRAINT "fulfillment_plans_organization_id_quotation_id_fkey" FOREIGN KEY ("organization_id", "quotation_id") REFERENCES "quotations"("organization_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fulfillment_lines" ADD CONSTRAINT "fulfillment_lines_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fulfillment_lines" ADD CONSTRAINT "fulfillment_lines_organization_id_plan_id_fkey" FOREIGN KEY ("organization_id", "plan_id") REFERENCES "fulfillment_plans"("organization_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fulfillment_lines" ADD CONSTRAINT "fulfillment_lines_organization_id_quotation_line_id_fkey" FOREIGN KEY ("organization_id", "quotation_line_id") REFERENCES "quotation_lines"("organization_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fulfillment_lines" ADD CONSTRAINT "fulfillment_lines_organization_id_warehouse_id_fkey" FOREIGN KEY ("organization_id", "warehouse_id") REFERENCES "warehouses"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
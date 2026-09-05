-- CreateTable
CREATE TABLE "product_affinities" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "product_id" TEXT NOT NULL,
    "recommended_product_id" TEXT NOT NULL,
    "co_purchase_count" INTEGER NOT NULL DEFAULT 1,
    "affinity_score" DECIMAL(5,4) NOT NULL DEFAULT 0.0000,
    "recommendation_reason" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "product_affinities_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "product_affinities_organization_id_idx" ON "product_affinities"("organization_id");

-- CreateIndex
CREATE INDEX "product_affinities_organization_id_product_id_idx" ON "product_affinities"("organization_id", "product_id");

-- CreateIndex
CREATE INDEX "product_affinities_organization_id_recommended_product_id_idx" ON "product_affinities"("organization_id", "recommended_product_id");

-- CreateIndex
CREATE UNIQUE INDEX "product_affinities_organization_id_id_key" ON "product_affinities"("organization_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "product_affinities_organization_id_product_id_recommended_p_key" ON "product_affinities"("organization_id", "product_id", "recommended_product_id");

-- AddForeignKey
ALTER TABLE "product_affinities" ADD CONSTRAINT "product_affinities_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_affinities" ADD CONSTRAINT "product_affinities_organization_id_product_id_fkey" FOREIGN KEY ("organization_id", "product_id") REFERENCES "products"("organization_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_affinities" ADD CONSTRAINT "product_affinities_organization_id_recommended_product_id_fkey" FOREIGN KEY ("organization_id", "recommended_product_id") REFERENCES "products"("organization_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AlterTable
ALTER TABLE "quotation_lines" ADD COLUMN     "applied_ceiling_percent" DECIMAL(5,2) NOT NULL DEFAULT 0.00,
ADD COLUMN     "is_over_ceiling" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "risk_delta_percent" DECIMAL(5,2) NOT NULL DEFAULT 0.00;

-- AlterTable
ALTER TABLE "quotations" ADD COLUMN     "approval_routing" TEXT NOT NULL DEFAULT 'none',
ADD COLUMN     "risk_details" JSONB,
ADD COLUMN     "risk_level" TEXT NOT NULL DEFAULT 'low',
ADD COLUMN     "risk_score" DECIMAL(5,2) NOT NULL DEFAULT 0.00;

-- CreateIndex
CREATE INDEX "quotations_organization_id_risk_level_idx" ON "quotations"("organization_id", "risk_level");

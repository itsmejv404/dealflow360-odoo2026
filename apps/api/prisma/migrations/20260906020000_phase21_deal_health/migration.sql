-- Phase 21: Deal Health Monitoring
CREATE TABLE "deal_health_alerts" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "quotation_id" TEXT,
    "rep_id" TEXT,
    "alert_type" TEXT NOT NULL,
    "severity" TEXT NOT NULL DEFAULT 'medium',
    "title" TEXT NOT NULL,
    "detail" TEXT NOT NULL,
    "metadata" JSONB,
    "status" TEXT NOT NULL DEFAULT 'open',
    "nudged_at" TIMESTAMP(3),
    "escalated_at" TIMESTAMP(3),
    "resolved_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "deal_health_alerts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "deal_health_alerts_organization_id_idx" ON "deal_health_alerts"("organization_id");

-- CreateIndex
CREATE INDEX "deal_health_alerts_organization_id_status_idx" ON "deal_health_alerts"("organization_id", "status");

-- CreateIndex
CREATE INDEX "deal_health_alerts_organization_id_alert_type_idx" ON "deal_health_alerts"("organization_id", "alert_type");

-- CreateIndex
CREATE INDEX "deal_health_alerts_organization_id_alert_type_quotation_id_idx" ON "deal_health_alerts"("organization_id", "alert_type", "quotation_id");

-- CreateIndex
CREATE UNIQUE INDEX "deal_health_alerts_organization_id_id_key" ON "deal_health_alerts"("organization_id", "id");

-- AddForeignKey
ALTER TABLE "deal_health_alerts" ADD CONSTRAINT "deal_health_alerts_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "deal_health_alerts" ADD CONSTRAINT "deal_health_alerts_organization_id_quotation_id_fkey" FOREIGN KEY ("organization_id", "quotation_id") REFERENCES "quotations"("organization_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "deal_health_alerts" ADD CONSTRAINT "deal_health_alerts_rep_id_fkey" FOREIGN KEY ("rep_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
